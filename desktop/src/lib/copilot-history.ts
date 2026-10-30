import type { ChatSession, CopilotMessage, CopilotSettings, CopilotSnapshot, EngineConfig } from './copilot-types.ts';
import { COPILOT_LIMITS, COPILOT_STORAGE_KEY, DEFAULT_COPILOT_SETTINGS } from './copilot-types.ts';

export { COPILOT_LIMITS, COPILOT_STORAGE_KEY, DEFAULT_COPILOT_SETTINGS } from './copilot-types.ts';

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

type ErrorCode = 'VALIDATION_ERROR' | 'LIMIT_EXCEEDED' | 'STORAGE_UNAVAILABLE' | 'CORRUPT_STORAGE'
  | 'UNSUPPORTED_VERSION' | 'NOT_FOUND' | 'CONFLICT';

export class CopilotHistoryError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = 'CopilotHistoryError';
    this.code = code;
  }
}

function fail(message: string): never {
  throw new CopilotHistoryError('VALIDATION_ERROR', message);
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function fields(value: Record<string, unknown>, allowed: readonly string[]) {
  if (Object.keys(value).some((key) => !allowed.includes(key))) fail('Unexpected Copilot data fields.');
}

function identifier(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) fail('The chat or message ID is invalid.');
  return value;
}

function revision(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value >= Number.MAX_SAFE_INTEGER) fail('The chat revision is invalid.');
  return value;
}

function timestamp(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(value) || !Number.isFinite(Date.parse(value))) fail('The chat timestamp is invalid.');
  return value;
}

function modelName(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length > COPILOT_LIMITS.modelLength || /[\u0000-\u001f\u007f]/.test(value)) fail('Use a model name of at most 200 characters without control characters.');
  return value.trim();
}

/** Local runners only. Literal loopback avoids DNS/proxy routes to an external service. */
export function normalizeEngineConfig(config: EngineConfig): EngineConfig {
  if (!object(config) || (config.provider !== 'ollama' && config.provider !== 'llamacpp') || typeof config.baseUrl !== 'string') fail('Choose Ollama or llama.cpp and a local HTTP server address.');
  const input = config.baseUrl.trim();
  if (!input || input.length > 256 || input.includes('?') || input.includes('#')) fail('Use a local HTTP origin without a path, query, or fragment.');
  let url: URL;
  try { url = new URL(input); } catch { return fail('Enter a valid local HTTP origin, such as http://127.0.0.1:11434.'); }
  if (url.protocol !== 'http:' || url.username || url.password || url.pathname !== '/' || url.port === '0') fail('Use a local HTTP origin without credentials or a path.');
  if (url.hostname === 'localhost') url.hostname = '127.0.0.1';
  if (url.hostname !== '127.0.0.1' && url.hostname !== '[::1]') fail('Only 127.0.0.1, localhost, or [::1] local runner addresses are supported.');
  return { provider: config.provider, baseUrl: url.origin };
}

function settings(value: unknown): CopilotSettings {
  if (!object(value)) fail('Copilot settings are invalid.');
  fields(value, ['provider', 'baseUrl', 'model', 'systemPrompt', 'temperature', 'contextWindow']);
  const config = normalizeEngineConfig({ provider: value.provider, baseUrl: value.baseUrl } as EngineConfig);
  if (typeof value.systemPrompt !== 'string' || value.systemPrompt.length > COPILOT_LIMITS.systemPromptLength) fail('System prompts support at most 8,000 characters.');
  if (typeof value.temperature !== 'number' || !Number.isFinite(value.temperature) || value.temperature < 0 || value.temperature > 2) fail('Temperature must be between 0 and 2.');
  if (typeof value.contextWindow !== 'number' || !Number.isInteger(value.contextWindow) || value.contextWindow < COPILOT_LIMITS.minContextWindow || value.contextWindow > COPILOT_LIMITS.maxContextWindow) fail('Context window must be an integer between 512 and 32,768.');
  return {
    ...config, model: modelName(value.model), systemPrompt: value.systemPrompt,
    temperature: value.temperature, contextWindow: value.contextWindow,
  };
}

function message(value: unknown): CopilotMessage {
  if (!object(value)) fail('A saved chat message is invalid.');
  fields(value, ['id', 'role', 'content', 'status', 'createdAt', 'error']);
  if (value.role !== 'user' && value.role !== 'assistant') fail('Saved messages must belong to the user or assistant.');
  if (typeof value.status !== 'string' || !['complete', 'streaming', 'cancelled', 'error'].includes(value.status)) fail('The saved message status is invalid.');
  if (typeof value.content !== 'string' || value.content.length > COPILOT_LIMITS.messageLength) fail('A chat message supports at most 64,000 characters.');
  if (value.error !== undefined && (typeof value.error !== 'string' || value.error.length > COPILOT_LIMITS.errorLength)) fail('The saved message error is invalid.');
  return {
    id: identifier(value.id), role: value.role, content: value.content,
    status: value.status as CopilotMessage['status'], createdAt: timestamp(value.createdAt),
    ...(typeof value.error === 'string' ? { error: value.error } : {}),
  };
}

function session(value: unknown): ChatSession {
  if (!object(value)) fail('A saved conversation is invalid.');
  fields(value, ['id', 'title', 'createdAt', 'updatedAt', 'revision', 'model', 'messages']);
  if (typeof value.title !== 'string' || !value.title.trim() || value.title.trim().length > COPILOT_LIMITS.titleLength) fail('Give the chat a title between 1 and 100 characters.');
  if (!Array.isArray(value.messages) || value.messages.length > COPILOT_LIMITS.messages) fail('A conversation supports up to 100 messages. Start a new chat to continue.');
  const messages = value.messages.map(message);
  if (new Set(messages.map((item) => item.id)).size !== messages.length) fail('Saved message IDs are duplicated.');
  return {
    id: identifier(value.id), title: value.title.trim(), createdAt: timestamp(value.createdAt), updatedAt: timestamp(value.updatedAt),
    revision: revision(value.revision), model: modelName(value.model), messages,
  };
}

function cloneSession(value: ChatSession): ChatSession {
  return { ...value, messages: value.messages.map((item) => ({ ...item })) };
}

/**
 * Local profile persistence, available to both browser and native webviews. Each
 * operation reads latest storage and checks session revisions. localStorage has
 * no atomic cross-tab transactions; this detects stale sequential writes only.
 */
export class CopilotHistoryStore {
  static readonly key = COPILOT_STORAGE_KEY;
  private readonly storage: StorageLike;

  constructor(storage: StorageLike) { this.storage = storage; }

  snapshot(): CopilotSnapshot { return this.read(); }

  saveSettings(input: CopilotSettings): CopilotSettings {
    const state = this.read();
    state.settings = settings(input);
    this.write(state);
    return { ...state.settings };
  }

  createSession(model?: string): ChatSession {
    const state = this.read();
    if (state.sessions.length >= COPILOT_LIMITS.sessions) throw new CopilotHistoryError('LIMIT_EXCEEDED', 'The local history supports up to 40 chats. Remove an old chat before starting another.');
    const now = new Date().toISOString();
    const value: ChatSession = {
      id: crypto.randomUUID(), title: 'New chat', createdAt: now, updatedAt: now, revision: 1,
      model: modelName(model ?? state.settings.model), messages: [],
    };
    state.sessions.unshift(value);
    state.activeSessionId = value.id;
    this.write(state);
    return cloneSession(value);
  }

  saveSession(input: ChatSession): ChatSession {
    const state = this.read();
    const draft = session(input);
    const index = state.sessions.findIndex((item) => item.id === draft.id);
    const current = state.sessions[index];
    this.assertRevision(current, draft.revision);
    const saved: ChatSession = { ...draft, createdAt: current.createdAt, updatedAt: new Date().toISOString(), revision: current.revision + 1 };
    state.sessions[index] = saved;
    this.write(state);
    return cloneSession(saved);
  }

  setActiveSession(id: string | null): void {
    const state = this.read();
    if (id !== null) {
      identifier(id);
      if (!state.sessions.some((item) => item.id === id)) throw new CopilotHistoryError('NOT_FOUND', 'This conversation no longer exists.');
    }
    state.activeSessionId = id;
    this.write(state);
  }

  deleteSession(id: string, expectedRevision: number): void {
    const state = this.read();
    const current = state.sessions.find((item) => item.id === identifier(id));
    this.assertRevision(current, revision(expectedRevision));
    state.sessions = state.sessions.filter((item) => item.id !== id);
    if (state.activeSessionId === id) state.activeSessionId = state.sessions[0]?.id ?? null;
    this.write(state);
  }

  clearHistory(): void {
    const state = this.read();
    this.write({ ...state, sessions: [], activeSessionId: null });
  }

  private assertRevision(current: ChatSession | undefined, expected: number): asserts current is ChatSession {
    if (!current) throw new CopilotHistoryError('NOT_FOUND', 'This conversation was removed. Copy any unsaved response before leaving this view.');
    if (current.revision !== expected) throw new CopilotHistoryError('CONFLICT', 'This conversation changed in another view or tab. Copy the current response before reloading the saved chat.');
  }

  private read(): CopilotSnapshot {
    let raw: string | null;
    try { raw = this.storage.getItem(COPILOT_STORAGE_KEY); }
    catch { throw new CopilotHistoryError('STORAGE_UNAVAILABLE', 'Local chat history cannot be read. Allow browser storage or use a profile where it is available.'); }
    if (raw === null) return { version: 1, sessions: [], settings: { ...DEFAULT_COPILOT_SETTINGS }, activeSessionId: null };
    try {
      if (raw.length * 2 > COPILOT_LIMITS.storageBytes) fail('The saved history exceeds its supported size.');
      const parsed: unknown = JSON.parse(raw);
      if (!object(parsed)) fail('The saved history is invalid.');
      if (parsed.version !== 1) throw new CopilotHistoryError('UNSUPPORTED_VERSION', 'This chat history uses an unsupported version. It was preserved. Use a compatible app version or back up browser storage before changing it.');
      fields(parsed, ['version', 'sessions', 'settings', 'activeSessionId']);
      if (!Array.isArray(parsed.sessions) || parsed.sessions.length > COPILOT_LIMITS.sessions) fail('The saved conversation list is invalid.');
      const sessions = parsed.sessions.map(session);
      if (new Set(sessions.map((item) => item.id)).size !== sessions.length) fail('Saved conversation IDs are duplicated.');
      if (parsed.activeSessionId !== null && (typeof parsed.activeSessionId !== 'string' || !sessions.some((item) => item.id === parsed.activeSessionId))) fail('The active conversation does not exist.');
      return { version: 1, sessions, settings: settings(parsed.settings), activeSessionId: parsed.activeSessionId as string | null };
    } catch (error) {
      if (error instanceof CopilotHistoryError && error.code === 'UNSUPPORTED_VERSION') throw error;
      throw new CopilotHistoryError('CORRUPT_STORAGE', 'Saved chat history could not be read safely and was preserved. Back up browser storage before repairing or clearing it.');
    }
  }

  private write(value: CopilotSnapshot): void {
    const raw = JSON.stringify(value);
    // Conservative UTF-16 estimate stays below common per-origin quota sizes.
    if (raw.length * 2 > COPILOT_LIMITS.storageBytes) throw new CopilotHistoryError('LIMIT_EXCEEDED', 'Local chat history reached its 2 MiB limit. Copy important chats and remove old sessions before saving more.');
    try { this.storage.setItem(COPILOT_STORAGE_KEY, raw); }
    catch { throw new CopilotHistoryError('STORAGE_UNAVAILABLE', 'Local chat history could not save this change (unavailable or full). Keep the chat open and copy the response before retrying.'); }
  }
}

/** Called explicitly on app/view initialization, never during an active stream read. */
export function recoverInterruptedSessions(snapshot: CopilotSnapshot): CopilotSnapshot {
  return {
    ...snapshot, settings: { ...snapshot.settings },
    sessions: snapshot.sessions.map((value) => ({
      ...value,
      messages: value.messages.map((item) => item.status === 'streaming'
        ? { ...item, status: 'cancelled', error: item.error || 'Response interrupted when the page or chat view was closed.' }
        : { ...item }),
    })),
  };
}
