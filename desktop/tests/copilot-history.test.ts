import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CopilotHistoryError, CopilotHistoryStore, COPILOT_STORAGE_KEY, DEFAULT_COPILOT_SETTINGS,
  normalizeEngineConfig, recoverInterruptedSessions,
} from '../src/lib/copilot-history.ts';
import type { StorageLike } from '../src/lib/copilot-history.ts';
import type { CopilotMessage } from '../src/lib/copilot-types.ts';

class MemoryStorage implements StorageLike {
  value: string | null = null;
  writes = 0;
  readBlocked = false;
  writeBlocked = false;
  getItem() { if (this.readBlocked) throw new Error('denied'); return this.value; }
  setItem(_key: string, value: string) { if (this.writeBlocked) throw new Error('full'); this.value = value; this.writes++; }
}

const hasCode = (code: string) => (error: unknown) => error instanceof CopilotHistoryError && error.code === code;
const chatMessage = (id: string, content: string, status: CopilotMessage['status'] = 'complete'): CopilotMessage => ({ id, role: 'assistant', content, status, createdAt: new Date().toISOString() });

test('Copilot accepts only canonical local HTTP origins without credentials, paths, or redirects', (t) => {
  t.mock.method(globalThis, 'fetch', () => { throw new Error('Validation must not access the network'); });
  assert.deepEqual(normalizeEngineConfig({ provider: 'ollama', baseUrl: ' http://localhost:11434/ ' }), { provider: 'ollama', baseUrl: 'http://127.0.0.1:11434' });
  assert.equal(normalizeEngineConfig({ provider: 'llamacpp', baseUrl: 'http://[::1]:8080/' }).baseUrl, 'http://[::1]:8080');
  for (const baseUrl of ['https://127.0.0.1:11434', 'http://example.com', 'http://127.0.0.1.evil', 'http://127.0.0.2:8080', 'http://127.0.0.1:8080/v1', 'http://127.0.0.1:8080?x=1', 'http://127.0.0.1:8080#', 'http://name:password@127.0.0.1:8080', 'http://127.0.0.1:0']) {
    assert.throws(() => normalizeEngineConfig({ provider: 'ollama', baseUrl }), hasCode('VALIDATION_ERROR'));
  }
});

test('Copilot history persists settings, conversations, and selection without exposing mutable references', () => {
  const storage = new MemoryStorage();
  const store = new CopilotHistoryStore(storage);
  const empty = store.snapshot();
  assert.equal(COPILOT_STORAGE_KEY, 'hyden.copilot.v1');
  assert.deepEqual(empty.sessions, []);
  assert.equal(empty.settings.model, '');
  assert.equal(storage.writes, 0);
  const custom = store.saveSettings({ ...DEFAULT_COPILOT_SETTINGS, provider: 'llamacpp', baseUrl: 'http://localhost:8080/', model: ' local-model ' });
  assert.equal(custom.baseUrl, 'http://127.0.0.1:8080');
  assert.equal(custom.model, 'local-model');
  const first = store.createSession();
  const second = store.createSession('another-model');
  assert.equal(first.model, 'local-model');
  assert.equal(store.snapshot().activeSessionId, second.id);
  const saved = store.saveSession({ ...first, title: '  A useful chat  ', messages: [chatMessage('m1', '# Saved response')] });
  assert.equal(saved.title, 'A useful chat');
  assert.equal(saved.revision, 2);
  saved.messages[0].content = 'not saved';
  custom.model = 'not saved';
  store.setActiveSession(first.id);
  const reopened = new CopilotHistoryStore(storage).snapshot();
  assert.equal(reopened.activeSessionId, first.id);
  assert.equal(reopened.settings.model, 'local-model');
  assert.equal(reopened.sessions.find((item) => item.id === first.id)?.messages[0].content, '# Saved response');
  assert.throws(() => store.setActiveSession('missing'), hasCode('NOT_FOUND'));
});

test('Copilot revisions protect stale sequential edits and preserve unrelated chats/settings', () => {
  const storage = new MemoryStorage();
  const a = new CopilotHistoryStore(storage);
  const b = new CopilotHistoryStore(storage);
  const first = a.createSession('m');
  const second = b.createSession('n');
  b.saveSettings({ ...DEFAULT_COPILOT_SETTINGS, temperature: 1 });
  const saved = a.saveSession({ ...first, messages: [chatMessage('a', 'retained')], createdAt: '2000-01-01T00:00:00.000Z' });
  assert.equal(saved.createdAt, first.createdAt);
  assert.equal(b.snapshot().sessions.length, 2);
  assert.equal(a.snapshot().settings.temperature, 1);
  assert.equal(a.snapshot().activeSessionId, second.id, 'background writes do not change selection');
  assert.throws(() => b.saveSession({ ...first, title: 'stale' }), hasCode('CONFLICT'));
  assert.throws(() => b.deleteSession(first.id, first.revision), hasCode('CONFLICT'));
  b.deleteSession(saved.id, saved.revision);
  assert.throws(() => a.saveSession(saved), hasCode('NOT_FOUND'));
});

test('clearing history removes sessions and selection while keeping local runner settings', () => {
  const store = new CopilotHistoryStore(new MemoryStorage());
  store.saveSettings({ ...DEFAULT_COPILOT_SETTINGS, model: 'configured-model', systemPrompt: 'My instructions' });
  const first = store.createSession();
  const second = store.createSession();
  store.deleteSession(second.id, second.revision);
  assert.equal(store.snapshot().activeSessionId, first.id);
  store.clearHistory();
  const snapshot = store.snapshot();
  assert.deepEqual(snapshot.sessions, []);
  assert.equal(snapshot.activeSessionId, null);
  assert.equal(snapshot.settings.model, 'configured-model');
  assert.equal(snapshot.settings.systemPrompt, 'My instructions');
});

test('stream recovery is explicit and pure, retaining partial text without changing revisions', () => {
  const storage = new MemoryStorage();
  const store = new CopilotHistoryStore(storage);
  const created = store.createSession();
  const saved = store.saveSession({ ...created, messages: [chatMessage('partial', 'Partially generated', 'streaming')] });
  const writes = storage.writes;
  const original = store.snapshot();
  assert.equal(original.sessions[0].messages[0].status, 'streaming');
  const recovered = recoverInterruptedSessions(original);
  assert.equal(recovered.sessions[0].messages[0].status, 'cancelled');
  assert.equal(recovered.sessions[0].messages[0].content, 'Partially generated');
  assert.match(recovered.sessions[0].messages[0].error!, /interrupted/);
  assert.equal(recovered.sessions[0].revision, saved.revision);
  assert.equal(original.sessions[0].messages[0].status, 'streaming');
  assert.equal(storage.writes, writes);
  assert.equal(store.saveSession(recovered.sessions[0]).revision, saved.revision + 1);
});

test('invalid settings/messages, limits and oversize history fail before committing', () => {
  const storage = new MemoryStorage();
  const store = new CopilotHistoryStore(storage);
  const session = store.createSession();
  const writes = storage.writes;
  for (const changes of [{ temperature: NaN }, { temperature: 2.1 }, { contextWindow: 511 }, { contextWindow: 32769 }, { contextWindow: 513.5 }, { systemPrompt: 'x'.repeat(8001) }, { model: 'x'.repeat(201) }]) {
    assert.throws(() => store.saveSettings({ ...DEFAULT_COPILOT_SETTINGS, ...changes }), hasCode('VALIDATION_ERROR'));
  }
  assert.throws(() => store.saveSession({ ...session, messages: [chatMessage('m', 'x'.repeat(64001))] }), hasCode('VALIDATION_ERROR'));
  assert.throws(() => store.saveSession({ ...session, messages: Array.from({ length: 101 }, (_, index) => chatMessage(`m${index}`, 'x')) }), hasCode('VALIDATION_ERROR'));
  assert.throws(() => store.saveSession({ ...session, messages: [chatMessage('m', 'a'), chatMessage('m', 'b')] }), hasCode('VALIDATION_ERROR'));
  assert.throws(() => store.saveSession({ ...session, messages: Array.from({ length: 17 }, (_, index) => chatMessage(`m${index}`, 'x'.repeat(64000))) }), hasCode('LIMIT_EXCEEDED'));
  assert.equal(storage.writes, writes);
  assert.deepEqual(store.snapshot().sessions[0].messages, []);
  for (let index = 1; index < 40; index++) store.createSession();
  assert.throws(() => store.createSession(), hasCode('LIMIT_EXCEEDED'));
});

test('corrupt/unsupported/unreadable history is preserved instead of being reset', () => {
  const storage = new MemoryStorage();
  const store = new CopilotHistoryStore(storage);
  for (const value of ['not json', '{"version":1,"sessions":[{}]}', JSON.stringify({ version: 1, sessions: [], settings: DEFAULT_COPILOT_SETTINGS, activeSessionId: 'missing' })]) {
    storage.value = value;
    assert.throws(() => store.snapshot(), hasCode('CORRUPT_STORAGE'));
    assert.throws(() => store.clearHistory(), hasCode('CORRUPT_STORAGE'));
    assert.equal(storage.value, value);
  }
  storage.value = '{"version":2}';
  assert.throws(() => store.createSession(), hasCode('UNSUPPORTED_VERSION'));
  assert.equal(storage.value, '{"version":2}');
  storage.readBlocked = true;
  assert.throws(() => store.snapshot(), hasCode('STORAGE_UNAVAILABLE'));
  assert.equal(storage.writes, 0);
});

test('quota failures preserve stored revisions/settings and allow a later retry', () => {
  const storage = new MemoryStorage();
  const store = new CopilotHistoryStore(storage);
  const original = store.createSession();
  const raw = storage.value;
  storage.writeBlocked = true;
  assert.throws(() => store.saveSession({ ...original, messages: [chatMessage('m', 'unsaved')] }), hasCode('STORAGE_UNAVAILABLE'));
  assert.throws(() => store.saveSettings({ ...DEFAULT_COPILOT_SETTINGS, temperature: 1 }), hasCode('STORAGE_UNAVAILABLE'));
  assert.throws(() => store.clearHistory(), hasCode('STORAGE_UNAVAILABLE'));
  assert.equal(storage.value, raw);
  assert.equal(store.snapshot().sessions[0].revision, original.revision);
  storage.writeBlocked = false;
  assert.equal(store.saveSession({ ...original, messages: [chatMessage('m', 'retry')] }).revision, 2);
});
