/** Serializable Copilot contracts shared by the UI, local profile history, and native transport. */
export type EngineProvider = 'ollama' | 'llamacpp';

export interface EngineConfig {
  provider: EngineProvider;
  baseUrl: string;
}

export interface EngineStatus {
  online: boolean;
  mode: 'native' | 'mock';
  provider: EngineProvider;
  endpoint: string;
  detail: string;
}

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface CopilotParameters {
  systemPrompt: string;
  temperature: number;
  contextWindow: number;
}

export interface CopilotSettings extends EngineConfig, CopilotParameters {
  model: string;
}

export interface ChatRequest {
  requestId: string;
  config: EngineConfig;
  model: string;
  messages: ChatTurn[];
  parameters: CopilotParameters;
}

export interface CopilotErrorData {
  code: string;
  message: string;
}

export interface ChatStreamEvent {
  requestId: string;
  type: 'delta' | 'done' | 'cancelled' | 'error';
  delta?: string;
  error?: CopilotErrorData;
}

export interface CopilotMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  status: 'complete' | 'streaming' | 'cancelled' | 'error';
  createdAt: string;
  error?: string;
}

export interface ChatSession {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  revision: number;
  model: string;
  messages: CopilotMessage[];
}

export interface CopilotSnapshot {
  version: 1;
  sessions: ChatSession[];
  settings: CopilotSettings;
  activeSessionId: string | null;
}

export const COPILOT_STORAGE_KEY = 'hyden.copilot.v1';

export const COPILOT_LIMITS = {
  sessions: 40,
  messages: 100,
  messageLength: 64_000,
  modelLength: 200,
  systemPromptLength: 8_000,
  titleLength: 100,
  errorLength: 2_000,
  storageBytes: 2 * 1024 * 1024,
  minContextWindow: 512,
  maxContextWindow: 32_768,
} as const;

export const DEFAULT_COPILOT_SETTINGS: Readonly<CopilotSettings> = Object.freeze({
  provider: 'ollama',
  baseUrl: 'http://127.0.0.1:11434',
  model: '',
  systemPrompt: 'You are a helpful local assistant. Be clear, concise, and honest about uncertainty.',
  temperature: 0.7,
  contextWindow: 4096,
});
