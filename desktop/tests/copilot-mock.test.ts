import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ChatRequest, ChatStreamEvent } from '../src/lib/copilot-types.ts';
import { MockCopilotEngine, validateChatRequest } from '../src/lib/mock-copilot.ts';

const config = { provider: 'ollama' as const, baseUrl: 'http://127.0.0.1:11434' };
function request(id = 'request-1', content = 'Show me a Python function'): ChatRequest {
  return { requestId: id, config, model: 'demo-small:local', messages: [{ role: 'user', content }], parameters: { systemPrompt: 'Be helpful.', temperature: 0.7, contextWindow: 4096 } };
}

test('mock health and model inventory are explicitly simulated and never request HTTP', async (t) => {
  t.mock.method(globalThis, 'fetch', () => { throw new Error('Browser mock must not access a local or remote runner'); });
  const engine = new MockCopilotEngine(0);
  assert.equal(engine.status(config).mode, 'mock');
  assert.equal(engine.status(config).online, true);
  assert.deepEqual(engine.models(config), ['demo-small:local', 'demo-code:local']);
  const events: ChatStreamEvent[] = [];
  await engine.chat(request(), (event) => events.push(event));
  const deltas = events.filter((event) => event.type === 'delta');
  assert.ok(deltas.length > 5);
  assert.ok(deltas[0].delta!.length < 30, 'response is delivered incrementally');
  const text = deltas.map((event) => event.delta).join('');
  assert.match(text, /```python/);
  assert.match(text, /def summarize/);
  assert.match(text, /demo response/);
  assert.equal(events.at(-1)?.type, 'done');
  assert.equal(events.filter((event) => event.type === 'done').length, 1);
  assert.ok(events.every((event) => event.requestId === 'request-1'));
});

test('cancellation preserves partial deltas, emits one terminal event and releases the busy state', async () => {
  const engine = new MockCopilotEngine(0);
  const events: ChatStreamEvent[] = [];
  await engine.chat(request(), (event) => {
    events.push(event);
    if (event.type === 'delta') engine.cancel('request-1');
  });
  assert.equal(events.filter((event) => event.type === 'delta').length, 1);
  assert.equal(events.at(-1)?.type, 'cancelled');
  assert.equal(events.filter((event) => event.type === 'done').length, 0);
  engine.cancel('missing'); // idempotent and never cancels unrelated work
  const next: ChatStreamEvent[] = [];
  await engine.chat(request('request-2'), (event) => next.push(event));
  assert.equal(next.at(-1)?.type, 'done');
});

test('only one generation is active and a foreign request ID cannot cancel it', async () => {
  const engine = new MockCopilotEngine(0);
  const events: ChatStreamEvent[] = [];
  const first = engine.chat(request(), (event) => events.push(event));
  engine.cancel('foreign');
  await assert.rejects(engine.chat(request('second'), () => {}), { code: 'ENGINE_BUSY' });
  await first;
  assert.equal(events.at(-1)?.type, 'done');
});

test('offline states fail clearly both before generation and during a response', async () => {
  const engine = new MockCopilotEngine(0);
  engine.setOnline(false);
  assert.equal(engine.status(config).online, false);
  assert.throws(() => engine.models(config), { code: 'ENGINE_OFFLINE' });
  await assert.rejects(engine.chat(request(), () => {}), { code: 'ENGINE_OFFLINE' });
  engine.setOnline(true);
  const events: ChatStreamEvent[] = [];
  await engine.chat(request(), (event) => {
    events.push(event);
    if (event.type === 'delta') engine.setOnline(false);
  });
  assert.equal(events.at(-1)?.type, 'error');
  assert.equal(events.at(-1)?.error?.code, 'ENGINE_OFFLINE');
  assert.equal(events.filter((event) => event.type === 'done').length, 0);
  engine.setOnline(true);
  assert.equal(engine.status(config).online, true);
});

test('listener failures do not leave the engine busy', async () => {
  const engine = new MockCopilotEngine(0);
  await assert.rejects(engine.chat(request(), () => { throw new Error('Consumer closed'); }), /Consumer closed/);
  await engine.chat(request('after-close'), () => {});
});

test('request validation rejects invalid endpoints, model names, roles, parameters and input budgets', () => {
  validateChatRequest(request());
  assert.throws(() => validateChatRequest({ ...request(), config: { ...config, baseUrl: 'https://example.com' } }));
  assert.throws(() => validateChatRequest({ ...request(), requestId: '../bad' }));
  assert.throws(() => validateChatRequest({ ...request(), model: '' }));
  assert.throws(() => validateChatRequest({ ...request(), messages: [{ role: 'assistant', content: 'No final user turn' }] }));
  assert.throws(() => validateChatRequest({ ...request(), messages: [{ role: 'user', content: 'x'.repeat(32769) }] }));
  assert.throws(() => validateChatRequest({ ...request(), messages: Array.from({ length: 5 }, () => ({ role: 'user' as const, content: 'x'.repeat(30000) })) }));
  for (const parameters of [
    { ...request().parameters, temperature: Number.NaN },
    { ...request().parameters, contextWindow: 40000 },
    { ...request().parameters, systemPrompt: 'x'.repeat(8001) },
  ]) assert.throws(() => validateChatRequest({ ...request(), parameters }));
});
