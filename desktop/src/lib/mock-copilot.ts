import { normalizeEngineConfig } from './copilot-history.ts';
import type { ChatRequest, ChatStreamEvent, EngineConfig, EngineStatus } from './copilot-types.ts';

export class CopilotTransportError extends Error {
  readonly code: string;
  constructor(code: string, message: string) { super(message); this.code = code; this.name = 'CopilotTransportError'; }
}

export function validateChatRequest(request: ChatRequest): void {
  normalizeEngineConfig(request.config);
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(request.requestId)) throw new CopilotTransportError('INVALID_REQUEST', 'The request ID is invalid.');
  if (!request.model.trim() || request.model.length > 200) throw new CopilotTransportError('INVALID_REQUEST', 'Choose a local model name (up to 200 characters).');
  const { systemPrompt, temperature, contextWindow } = request.parameters;
  if (systemPrompt.length > 8000 || !Number.isFinite(temperature) || temperature < 0 || temperature > 2 || !Number.isInteger(contextWindow) || contextWindow < 512 || contextWindow > 32768) {
    throw new CopilotTransportError('INVALID_REQUEST', 'Use a system prompt up to 8,000 characters, temperature 0–2, and context window 512–32,768.');
  }
  if (!request.messages.length || request.messages.length > 100 || request.messages.at(-1)?.role !== 'user') throw new CopilotTransportError('INVALID_REQUEST', 'Send 1–100 conversation messages ending with a user message.');
  let characters = systemPrompt.length;
  for (const message of request.messages) {
    if (!['user', 'assistant'].includes(message.role) || typeof message.content !== 'string' || !message.content.trim() || message.content.length > 32768) {
      throw new CopilotTransportError('INVALID_REQUEST', 'Each request message must contain 1–32,768 characters. Start a new chat if the conversation is too long.');
    }
    characters += message.content.length;
  }
  if (characters > 131072) throw new CopilotTransportError('INVALID_REQUEST', 'The conversation exceeds the request budget. Start a new chat.');
}

export function buildMockReply(request: ChatRequest): string {
  const prompt = request.messages.at(-1)!.content;
  const continuing = request.messages.length > 1 ? 'Building on our conversation, ' : '';
  if (/code|python|javascript|typescript|function|script/i.test(prompt)) {
    const python = /python/i.test(prompt);
    return `## A small, local example\n\n${continuing}here’s a simple starting point. Keep the input bounded and handle errors at the boundary.\n\n\`\`\`${python ? 'python' : 'typescript'}\n${python ? 'def summarize(values):\n    if not values:\n        return {"count": 0, "average": None}\n    return {"count": len(values), "average": sum(values) / len(values)}\n\nprint(summarize([4, 8, 12]))' : 'function summarize(values: number[]) {\n  if (values.length === 0) return { count: 0, average: null };\n  const total = values.reduce((sum, value) => sum + value, 0);\n  return { count: values.length, average: total / values.length };\n}\n\nconsole.log(summarize([4, 8, 12]));'}\n\`\`\`\n\n- Start with a small test input.\n- Keep processing separate from the UI.\n- Add limits before using large files or collections.\n\n**Preview note:** this is a deterministic demo response, not output from a local model. Code is displayed as text and is never executed.`;
  }
  if (/plan|organize|task|project|start|steps/i.test(prompt)) {
    return `## A manageable starting point\n\n${continuing}I’d keep the first step small enough to finish in one sitting.\n\n- [ ] Write down the outcome you want in one sentence.\n- [ ] Pick one task that moves it forward.\n- [ ] Set aside a short, uninterrupted block of time.\n- [ ] Review what changed before adding another task.\n\n**Keep it lightweight:** one clear next action is often more useful than a long backlog. You can capture the plan in Workspace when you’re ready.\n\nI only receive the messages you send here; I haven’t read your notes, files, or media. This is a simulated response for the browser preview.`;
  }
  return `## Let’s think it through\n\n${continuing}I’d separate the question into **what you know**, **what you need**, and **one useful next step**.\n\n- Describe the result in plain language.\n- Identify the smallest missing piece.\n- Try one reversible change, then check what happened.\n\nIf you share a little more context in your next message, we can make the example more specific. No notes or files are attached automatically.\n\n*This is a browser demo stream.* In the desktop application, choose a running local Ollama or llama.cpp server to generate real model responses.`;
}

interface ActiveStream { id: string; cancelled: boolean; wake?: () => void }

/** No HTTP requests, inference engine, polling, or idle timers. Timers exist only during a demo stream. */
export class MockCopilotEngine {
  private online = true;
  private active: ActiveStream | null = null;
  private readonly delayMs: number;

  constructor(delayMs = 22) { this.delayMs = delayMs; }

  status(config: EngineConfig): EngineStatus {
    const checked = normalizeEngineConfig(config);
    return {
      online: this.online, mode: 'mock', provider: checked.provider, endpoint: checked.baseUrl,
      detail: this.online ? 'Demo engine ready. No local runner is contacted in browser preview.' : 'Simulated offline state. In the desktop app, start your local runner and check the connection again.',
    };
  }

  models(config: EngineConfig): string[] {
    normalizeEngineConfig(config);
    if (!this.online) throw new CopilotTransportError('ENGINE_OFFLINE', 'The demo engine is set offline. Turn off “Simulate offline” to resume preview streaming.');
    return ['demo-small:local', 'demo-code:local'];
  }

  setOnline(online: boolean): void { this.online = online; if (!online) this.active?.wake?.(); }

  cancel(requestId: string): void {
    if (this.active?.id !== requestId) return;
    this.active.cancelled = true;
    this.active.wake?.();
  }

  async chat(request: ChatRequest, onEvent: (event: ChatStreamEvent) => void): Promise<void> {
    validateChatRequest(request);
    if (!this.online) throw new CopilotTransportError('ENGINE_OFFLINE', 'The demo engine is offline. Check the connection or turn off “Simulate offline”.');
    if (this.active) throw new CopilotTransportError('ENGINE_BUSY', 'A response is already streaming. Stop it before sending another message.');
    const active: ActiveStream = { id: request.requestId, cancelled: false };
    this.active = active;
    const emit = (event: Omit<ChatStreamEvent, 'requestId'>) => onEvent({ requestId: request.requestId, ...event });
    try {
      const chunks = buildMockReply(request).match(/.{1,18}/gsu) ?? [];
      for (const delta of chunks) {
        if (active.cancelled) { emit({ type: 'cancelled' }); return; }
        if (!this.online) { emit({ type: 'error', error: { code: 'ENGINE_OFFLINE', message: 'The demo engine went offline. Your partial reply was kept.' } }); return; }
        await new Promise<void>((resolve) => {
          const finish = () => { clearTimeout(timer); active.wake = undefined; resolve(); };
          const timer = setTimeout(finish, this.delayMs);
          active.wake = finish;
        });
        if (active.cancelled) { emit({ type: 'cancelled' }); return; }
        if (!this.online) { emit({ type: 'error', error: { code: 'ENGINE_OFFLINE', message: 'The demo engine went offline. Your partial reply was kept.' } }); return; }
        emit({ type: 'delta', delta });
      }
      emit({ type: 'done' });
    } finally { this.active = null; }
  }
}
