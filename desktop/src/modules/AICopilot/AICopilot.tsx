import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Bot, Check, ChevronDown, Copy, Download, MessageSquare, Plus, RefreshCw, Settings2, Square, Trash2, User, WifiOff, X } from 'lucide-react';
import {
  cancelCopilotChat, checkCopilotEngine, clearCopilotHistory, createCopilotSession,
  deleteCopilotSession, getCopilotHistory, listCopilotModels, saveCopilotSession,
  saveCopilotSettings, setActiveCopilotSession, setMockEngineOnline, streamCopilotChat,
} from '../../lib/ipc';
import type { ChatSession, ChatStreamEvent, CopilotMessage, CopilotSettings, EngineStatus } from '../../lib/ipc';
import ChatMarkdown from './ChatMarkdown';
import './copilot.css';

interface Generation { id: string; sessionId: string; assistantId: string; cancelled: boolean; terminal: boolean }
let recoverySession: ChatSession | null = null;

const FALLBACK_SETTINGS: CopilotSettings = {
  provider: 'ollama', baseUrl: 'http://127.0.0.1:11434', model: '',
  systemPrompt: 'You are a helpful local assistant. Be clear, practical, and concise.', temperature: 0.7, contextWindow: 4096,
};

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : error && typeof error === 'object' && 'message' in error ? String(error.message) : 'This action could not finish. Please try again.';
}

function transcript(session: ChatSession): string {
  return `# ${session.title}\n\n${session.messages.map((message) => `## ${message.role === 'user' ? 'You' : 'Copilot'}${message.status === 'cancelled' ? ' (stopped)' : message.status === 'error' ? ' (error)' : ''}\n\n${message.content}${message.error ? `\n\n> ${message.error}` : ''}`).join('\n\n')}`;
}

function recoverView(session: ChatSession): ChatSession {
  return { ...session, messages: session.messages.map((message) => message.status === 'streaming' ? { ...message, status: 'cancelled' as const, error: 'Unfinished response from an earlier view. This is the last saved partial text.' } : message) };
}

export default function AICopilot() {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [current, setCurrent] = useState<ChatSession | null>(null);
  const [settings, setSettings] = useState<CopilotSettings>(FALLBACK_SETTINGS);
  const [status, setStatus] = useState<EngineStatus | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [customModel, setCustomModel] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [input, setInput] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const [ready, setReady] = useState(false);
  const [checking, setChecking] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [navigating, setNavigating] = useState(false);
  const [saved, setSaved] = useState(true);
  const [mockOffline, setMockOffline] = useState(false);
  const [atBottom, setAtBottom] = useState(true);
  const mounted = useRef(true);
  const sessionRef = useRef<ChatSession | null>(null);
  const settingsRef = useRef(settings);
  const generation = useRef<Generation | null>(null);
  const sending = useRef(false);
  const sendEpoch = useRef(0);
  const connectionSequence = useRef(0);
  const navigationLock = useRef(false);
  const revisions = useRef(new Map<string, number>());
  const changeVersion = useRef(0);
  const dirty = useRef(false);
  const saveFailure = useRef<unknown>(null);
  const saveTail = useRef<Promise<void>>(Promise.resolve());
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const viewport = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);

  const updateSettings = (next: CopilotSettings) => { settingsRef.current = next; setSettings(next); };
  const showSession = useCallback((session: ChatSession | null, changed = false) => {
    sessionRef.current = session;
    if (changed && session) {
      changeVersion.current++;
      dirty.current = true;
      recoverySession = session;
      if (mounted.current) setSaved(false);
    }
    if (mounted.current) {
      setCurrent(session);
      if (session) setSessions((previous) => [session, ...previous.filter((entry) => entry.id !== session.id)]);
    }
  }, []);

  const persist = useCallback((session: ChatSession): Promise<ChatSession> => {
    const version = changeVersion.current;
    const operation = saveTail.current.then(async () => {
      try {
        const next = await saveCopilotSession({ ...session, revision: revisions.current.get(session.id) ?? session.revision });
        revisions.current.set(next.id, next.revision);
        saveFailure.current = null;
        if (sessionRef.current?.id === next.id) {
          const updated = { ...sessionRef.current, revision: next.revision, updatedAt: next.updatedAt };
          sessionRef.current = updated;
          if (mounted.current) { setCurrent(updated); setSessions((previous) => [updated, ...previous.filter((entry) => entry.id !== updated.id)]); }
          if (version === changeVersion.current) {
            dirty.current = false;
            recoverySession = null;
            if (mounted.current) setSaved(true);
          }
        }
        return next;
      } catch (reason) {
        saveFailure.current = reason;
        if (mounted.current) { setSaved(false); setError(`Chat history was not saved. ${errorText(reason)} Copy or export this conversation before leaving.`); }
        throw reason;
      }
    });
    saveTail.current = operation.then(() => undefined, () => undefined);
    return operation;
  }, []);

  const flush = useCallback(async () => {
    clearTimeout(saveTimer.current);
    saveTimer.current = undefined;
    if (sessionRef.current && dirty.current) await persist(sessionRef.current);
    await saveTail.current;
    if (saveFailure.current) throw saveFailure.current;
  }, [persist]);

  const scheduleSave = useCallback(() => {
    if (saveTimer.current) return;
    saveTimer.current = setTimeout(() => {
      saveTimer.current = undefined;
      if (sessionRef.current && dirty.current) void persist(sessionRef.current).catch(() => undefined);
    }, 500);
  }, [persist]);

  const patchAssistant = useCallback((id: string, patch: Partial<CopilotMessage>) => {
    const session = sessionRef.current;
    if (!session) return;
    showSession({ ...session, messages: session.messages.map((message) => message.id === id ? { ...message, ...patch } : message) }, true);
  }, [showSession]);

  const stop = useCallback(async (save = true) => {
    sendEpoch.current++;
    if (mounted.current) setGenerating(false);
    const active = generation.current;
    if (active) {
      active.cancelled = true;
      active.terminal = true;
      generation.current = null;
      patchAssistant(active.assistantId, { status: 'cancelled' });
      if (mounted.current) setGenerating(false);
      try { await cancelCopilotChat(active.id); }
      catch (reason) { if (mounted.current) setError(`The local runner could not confirm cancellation. ${errorText(reason)}`); }
    }
    if (save) await flush();
    else { clearTimeout(saveTimer.current); saveTimer.current = undefined; await saveTail.current; }
  }, [flush, patchAssistant]);

  const connect = useCallback(async (configuration: CopilotSettings, chooseDefault = false) => {
    const sequence = ++connectionSequence.current;
    if (mounted.current) { setChecking(true); setError(''); }
    try {
      const next = await checkCopilotEngine(configuration);
      if (!mounted.current || sequence !== connectionSequence.current) return;
      setStatus(next);
      if (next.mode === 'mock') setMockOffline(!next.online);
      let available: string[] = [];
      if (next.online) {
        try { available = await listCopilotModels(configuration); }
        catch (reason) {
          if (mounted.current && sequence === connectionSequence.current) setError(`The engine is online, but its model list could not be read. Enter a custom model name. ${errorText(reason)}`);
        }
      }
      if (!mounted.current || sequence !== connectionSequence.current) return;
      setStatus(next); setModels(available);
      let chosen = configuration;
      if (chooseDefault && !configuration.model && available[0]) {
        chosen = { ...settingsRef.current, model: available[0] };
        await saveCopilotSettings(chosen);
        if (!mounted.current || sequence !== connectionSequence.current) return;
        settingsRef.current = chosen; setSettings(chosen);
      }
      setCustomModel(Boolean((chosen.model && !available.includes(chosen.model)) || (next.online && available.length === 0)));
    } catch (reason) {
      if (mounted.current && sequence === connectionSequence.current) { setStatus(null); setModels([]); setError(errorText(reason)); }
    } finally { if (mounted.current && sequence === connectionSequence.current) setChecking(false); }
  }, []);

  useEffect(() => {
    mounted.current = true;
    let disposed = false;
    const initialize = async () => {
      const stored = await getCopilotHistory();
      if (disposed) return;
      const restored: ChatSession[] = [];
      for (const session of stored.sessions) {
        revisions.current.set(session.id, session.revision);
        if (session.messages.some((message) => message.status === 'streaming')) {
          const interrupted = recoverView(session);
          // Read-only recovery: another browser tab may still own a generation.
          restored.push(interrupted);
        } else restored.push(session);
      }
      if (disposed) return;
      setSessions(restored);
      const selected = recoverySession ?? restored.find((session) => session.id === stored.activeSessionId) ?? restored[0] ?? null;
      showSession(selected);
      if (recoverySession) { dirty.current = true; setSaved(false); setError('An unsaved conversation was recovered. Retry saving or export a copy.'); }
      settingsRef.current = stored.settings; setSettings(stored.settings); setReady(true);
      void connect(stored.settings, true);
    };
    void initialize().catch((reason) => {
      if (!disposed) { setError(errorText(reason)); if (recoverySession) { showSession(recoverySession); dirty.current = true; setSaved(false); } }
    }).finally(() => { if (!disposed) setLoading(false); });
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (generation.current || dirty.current) { void stop().catch(() => undefined); event.preventDefault(); event.returnValue = ''; }
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => {
      disposed = true; mounted.current = false;
      window.removeEventListener('beforeunload', beforeUnload);
      clearTimeout(saveTimer.current);
      void stop().catch(() => undefined);
    };
  }, [connect, showSession, stop]);

  useEffect(() => {
    if (nearBottom.current && viewport.current) viewport.current.scrollTop = viewport.current.scrollHeight;
  }, [current?.messages]);

  const navigate = async (operation: () => Promise<void>) => {
    if (navigationLock.current) return;
    navigationLock.current = true; setNavigating(true); setError(''); setNotice('');
    try { await stop(); await operation(); }
    catch (reason) { if (mounted.current) setError(errorText(reason)); }
    finally { navigationLock.current = false; if (mounted.current) setNavigating(false); }
  };

  const newChat = () => void navigate(async () => {
    const created = await createCopilotSession(settingsRef.current.model);
    revisions.current.set(created.id, created.revision);
    showSession(created); dirty.current = false; setSaved(true); setInput(''); nearBottom.current = true;
  });

  const selectChat = (session: ChatSession) => void navigate(async () => {
    await setActiveCopilotSession(session.id);
    const latest = await getCopilotHistory();
    setSessions(latest.sessions);
    const selected = latest.sessions.find((entry) => entry.id === session.id) ?? null;
    if (selected) revisions.current.set(selected.id, selected.revision);
    showSession(selected ? recoverView(selected) : null); dirty.current = false; setSaved(true); setInput(''); nearBottom.current = true;
  });

  const clearHistory = async () => {
    if (navigationLock.current || !window.confirm('Clear all saved conversations? This cannot be undone. Connection settings will stay.')) return;
    navigationLock.current = true; setNavigating(true);
    try {
      await stop(false);
      await clearCopilotHistory();
      recoverySession = null; dirty.current = false; saveFailure.current = null;
      showSession(null); setSessions([]); setSaved(true); setNotice('Chat history cleared.'); setError('');
    } catch (reason) { setError(errorText(reason)); }
    finally { navigationLock.current = false; if (mounted.current) setNavigating(false); }
  };

  const deleteChat = async (session: ChatSession) => {
    if (navigationLock.current || !window.confirm(`Delete “${session.title}”?`)) return;
    navigationLock.current = true; setNavigating(true);
    try {
      if (sessionRef.current?.id === session.id) await stop(false); else await saveTail.current;
      await deleteCopilotSession(session.id, revisions.current.get(session.id) ?? session.revision);
      const latest = await getCopilotHistory();
      setSessions(latest.sessions);
      if (sessionRef.current?.id === session.id) {
        recoverySession = null; dirty.current = false; saveFailure.current = null;
        showSession(latest.sessions.find((entry) => entry.id === latest.activeSessionId) ?? latest.sessions[0] ?? null); setSaved(true);
      }
    } catch (reason) { setError(errorText(reason)); }
    finally { navigationLock.current = false; if (mounted.current) setNavigating(false); }
  };

  const send = async () => {
    const text = input.trim();
    if (!text || sending.current || navigationLock.current || !ready || !status?.online || !settings.model.trim()) return;
    sending.current = true; setGenerating(true); setError(''); setNotice(''); nearBottom.current = true;
    const epoch = ++sendEpoch.current;
    let active: Generation | null = null;
    try {
      await flush();
      if (epoch !== sendEpoch.current || !mounted.current) return;
      const chosen = await saveCopilotSettings(settingsRef.current);
      if (epoch !== sendEpoch.current || !mounted.current) return;
      settingsRef.current = chosen; setSettings(chosen);
      let session = sessionRef.current;
      if (!session) {
        session = await createCopilotSession(chosen.model);
        if (epoch !== sendEpoch.current || !mounted.current) return;
        revisions.current.set(session.id, session.revision);
        showSession(session);
      }
      if (session.messages.length > 98) throw new Error('This conversation has reached 100 messages. Start a new chat to continue.');
      const prior = session.messages.filter((message) => message.status === 'complete' && message.content).map(({ role, content }) => ({ role, content }));
      const timestamp = new Date().toISOString();
      const userMessage: CopilotMessage = { id: crypto.randomUUID(), role: 'user', content: text, status: 'complete', createdAt: timestamp };
      const assistant: CopilotMessage = { id: crypto.randomUUID(), role: 'assistant', content: '', status: 'streaming', createdAt: timestamp };
      const next = { ...session, model: chosen.model, title: session.messages.length ? session.title : text.replace(/\s+/g, ' ').slice(0, 60), messages: [...session.messages, userMessage, assistant] };
      showSession(next, true);
      active = { id: crypto.randomUUID(), sessionId: session.id, assistantId: assistant.id, cancelled: false, terminal: false };
      generation.current = active;
      await persist(next);
      if (epoch !== sendEpoch.current || !mounted.current) return;
      setInput('');
      const onEvent = (event: ChatStreamEvent) => {
        if (!mounted.current || generation.current?.id !== event.requestId || active?.terminal) return;
        if (event.type === 'delta' && !active?.cancelled) {
          const previous = sessionRef.current?.messages.find((message) => message.id === assistant.id)?.content ?? '';
          const combined = previous + (event.delta ?? '');
          if (combined.length > 64000) {
            if (active) { active.terminal = true; active.cancelled = true; }
            patchAssistant(assistant.id, { content: combined.slice(0, 64000), status: 'error', error: 'Response reached the 64,000-character limit.' });
            void cancelCopilotChat(event.requestId).catch(() => undefined);
            if (sessionRef.current) void persist(sessionRef.current).catch(() => undefined);
            generation.current = null; setGenerating(false);
          } else { patchAssistant(assistant.id, { content: combined }); scheduleSave(); }
        } else if (event.type === 'done' || event.type === 'cancelled' || event.type === 'error') {
          if (active) active.terminal = true;
          clearTimeout(saveTimer.current); saveTimer.current = undefined;
          patchAssistant(assistant.id, { status: event.type === 'done' ? 'complete' : event.type === 'cancelled' ? 'cancelled' : 'error', ...(event.error ? { error: event.error.message } : {}) });
          if (event.error) setError(event.error.message);
          if (sessionRef.current) void persist(sessionRef.current).catch(() => undefined);
          generation.current = null; setGenerating(false);
        }
      };
      await streamCopilotChat({ requestId: active.id, config: { provider: chosen.provider, baseUrl: chosen.baseUrl }, model: chosen.model, messages: [...prior, { role: 'user', content: text }], parameters: { systemPrompt: chosen.systemPrompt, temperature: chosen.temperature, contextWindow: chosen.contextWindow } }, onEvent);
      if (!active.terminal && !active.cancelled) throw new Error('The runner ended the stream without a completion signal. The partial response has been kept.');
    } catch (reason) {
      if (active && !active.terminal && !active.cancelled) {
        active.terminal = true;
        patchAssistant(active.assistantId, { status: 'error', error: errorText(reason) });
        if (sessionRef.current) await persist(sessionRef.current).catch(() => undefined);
      }
      if (mounted.current && epoch === sendEpoch.current) setError(errorText(reason));
    } finally {
      if (active && generation.current?.id === active.id) generation.current = null;
      sending.current = false;
      if (mounted.current) setGenerating(false);
    }
  };

  const applySettings = async () => {
    try {
      const next = await saveCopilotSettings(settings);
      updateSettings(next); setNotice('Settings saved. They apply to your next message.');
      await connect(next, true);
    } catch (reason) { setError(errorText(reason)); }
  };

  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); setNotice('Copied to clipboard.'); }
    catch { setError('Clipboard access is unavailable. Export the conversation instead.'); }
  };

  const exportChat = () => {
    if (!current) return;
    const url = URL.createObjectURL(new Blob([transcript(current)], { type: 'text/markdown;charset=utf-8' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${current.title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').slice(0, 70) || 'conversation'}.md`; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const endpointChanged = (patch: Partial<CopilotSettings>) => { connectionSequence.current++; updateSettings({ ...settings, ...patch }); setStatus(null); setModels([]); setChecking(false); };
  const blocked = loading || !ready || navigating;

  return (
    <div className="page ai-page">
      <div className="ai-page-heading"><div className="page-heading"><div className="eyebrow"><span className="tiny-line" /> YOUR TOOLKIT / LOCAL AI</div><h1>A little perspective.</h1><p>A conversation on your machine. A little more room for your ideas.</p></div><button className="ai-settings-toggle" aria-label="Copilot settings" aria-expanded={drawer} aria-controls="ai-settings" onClick={() => setDrawer((value) => !value)}><Settings2 size={15} />Settings</button></div>
      {status?.mode === 'mock' && <div className="ai-demo-banner"><Bot size={16} /><div><strong>Demo streaming · no local model is running in this preview</strong><p>Responses are simulated locally. Your messages are not sent to a model or remote service.</p></div><label><input type="checkbox" aria-label="Simulate offline engine" checked={mockOffline} disabled={generating || checking} onChange={(event) => { const offline = event.target.checked; setMockOffline(offline); void setMockEngineOnline(!offline).then(() => connect(settingsRef.current)); }} />Simulate offline</label></div>}
      {error && <div className="ai-feedback ai-feedback-error" role="alert"><span>{error}</span>{!saved && current && <button onClick={() => void flush().then(() => { setError(''); setNotice('Conversation saved.'); }).catch(() => undefined)}>Retry save</button>}<button aria-label="Dismiss Copilot error" className="icon-button" onClick={() => setError('')}><X size={14} /></button></div>}
      {notice && <div className="ai-feedback" role="status"><Check size={13} /><span>{notice}</span><button className="icon-button" aria-label="Dismiss Copilot notification" onClick={() => setNotice('')}><X size={13} /></button></div>}
      <div className="ai-shell">
        <aside className="ai-history" aria-label="Chat history"><div className="ai-history-heading"><span>YOUR CONVERSATIONS</span><button aria-label="New chat" title="New chat" onClick={newChat} disabled={blocked}><Plus size={17} /></button></div><div className="ai-session-list">{sessions.map((session) => <div className={`ai-session ${current?.id === session.id ? 'ai-session-active' : ''}`} key={session.id}><button className="ai-session-select" aria-label={`Open chat ${session.title}`} aria-current={current?.id === session.id ? 'page' : undefined} disabled={blocked} onClick={() => selectChat(session)}><MessageSquare size={13} /><span><strong>{session.title}</strong><small>{session.messages.length} messages</small></span></button><button className="ai-session-delete" aria-label={`Delete chat ${session.title}`} disabled={blocked} onClick={() => void deleteChat(session)}><Trash2 size={12} /></button></div>)}{!sessions.length && <p className="ai-history-empty">A fresh conversation.<br />A different way to think.</p>}</div><button className="ai-clear-history" disabled={blocked || sessions.length === 0} onClick={() => void clearHistory()}><Trash2 size={12} />Clear history</button><p className="ai-history-note">Saved in this browser or desktop profile. Clearing site data removes saved chats.</p></aside>
        <section className="ai-chat-panel" aria-label="AI chat">
          <div className="ai-chat-toolbar"><div className="ai-model-controls"><Bot size={17} /><select aria-label="Local model" value={customModel ? '__custom' : settings.model} disabled={generating || checking || blocked} onChange={(event) => { if (event.target.value === '__custom') setCustomModel(true); else { setCustomModel(false); updateSettings({ ...settings, model: event.target.value }); } }}><option value="">Select a model</option>{models.map((model) => <option value={model} key={model}>{model}</option>)}<option value="__custom">Custom model…</option></select><button className="icon-button" aria-label="Refresh local models" title="Refresh models" disabled={generating || checking || blocked} onClick={() => void connect(settings, true)}><RefreshCw size={14} /></button></div><span className={`ai-engine-state ${status?.online ? 'ai-engine-online' : ''}`} role="status"><span />{checking ? 'Checking engine…' : status?.online ? status.mode === 'mock' ? 'Demo engine' : 'Local engine connected' : 'Engine offline'}</span></div>
          {customModel && <label className="ai-custom-model"><span>Custom model name</span><input aria-label="Custom model name" value={settings.model} maxLength={200} disabled={generating || blocked} placeholder="e.g. qwen2.5:3b" onChange={(event) => updateSettings({ ...settings, model: event.target.value })} /></label>}
          {drawer && <section id="ai-settings" className="ai-settings-drawer" aria-label="Engine and generation settings"><div className="ai-drawer-heading"><div><h2>Make it your own.</h2><p>Connect to a runner already installed on your machine.</p></div><button className="icon-button" aria-label="Close Copilot settings" onClick={() => setDrawer(false)}><X size={15} /></button></div><div className="ai-settings-grid"><label><span>Local runner</span><select aria-label="Local runner" disabled={generating} value={settings.provider} onChange={(event) => { const provider = event.target.value as CopilotSettings['provider']; endpointChanged({ provider, baseUrl: provider === 'ollama' ? 'http://127.0.0.1:11434' : 'http://127.0.0.1:8080', model: '' }); }}><option value="ollama">Ollama</option><option value="llamacpp">llama.cpp</option></select></label><label><span>Local endpoint</span><input aria-label="Local endpoint" disabled={generating} value={settings.baseUrl} onChange={(event) => endpointChanged({ baseUrl: event.target.value })} placeholder="http://127.0.0.1:11434" /></label><label className="ai-system-prompt"><span>System prompt</span><textarea aria-label="System prompt" value={settings.systemPrompt} maxLength={8000} disabled={generating} onChange={(event) => updateSettings({ ...settings, systemPrompt: event.target.value })} rows={3} /></label><label><span>Temperature <strong>{settings.temperature.toFixed(1)}</strong></span><input type="range" aria-label="Temperature" min="0" max="2" step="0.1" value={settings.temperature} disabled={generating} onChange={(event) => updateSettings({ ...settings, temperature: Number(event.target.value) })} /></label><label><span>Context window <strong>{settings.contextWindow.toLocaleString()}</strong></span><input type="range" aria-label="Context window" min="512" max="32768" step="512" value={settings.contextWindow} disabled={generating} onChange={(event) => updateSettings({ ...settings, contextWindow: Number(event.target.value) })} /></label></div><p className="ai-context-note">{settings.provider === 'ollama' ? 'Context window is sent to Ollama as num_ctx. Larger windows can use more memory.' : 'llama.cpp context capacity is configured when starting its server (--ctx-size). This control does not resize a running server.'} No model is started or downloaded by this app.</p><button className="secondary-button" disabled={generating || checking || blocked} onClick={() => void applySettings()}><Check size={13} />Apply settings & check</button></section>}
          {!checking && !status?.online && <div className="ai-offline" role="region" aria-label="Local engine connection instructions"><WifiOff size={21} /><div><h2>Your local engine is taking a break.</h2><p>{status?.detail ?? 'Check the endpoint and start your local LLM runner, then reconnect. Only loopback addresses are accepted.'}</p><pre>{settings.provider === 'ollama' ? 'ollama serve\nollama list' : 'llama-server -m /path/to/model.gguf --host 127.0.0.1 --port 8080'}</pre><p>{settings.provider === 'ollama' ? 'Install a model separately if none are listed. This app never downloads one automatically.' : 'Set the same port here as your llama.cpp server. Use the server’s installed model name or a custom name.'}</p><button className="secondary-button" onClick={() => void connect(settings, true)} disabled={blocked || checking}><RefreshCw size={13} />Check connection</button></div></div>}
          <div ref={viewport} className="ai-transcript" role="log" aria-label="Conversation messages" aria-live="off" onScroll={(event) => { const element = event.currentTarget; const near = element.scrollHeight - element.scrollTop - element.clientHeight < 90; nearBottom.current = near; setAtBottom(near); }}>
            {!current?.messages.length ? <div className="ai-welcome"><div className="ai-welcome-icon"><Bot size={35} strokeWidth={1.2} /></div><span>ANOTHER WAY TO LOOK AT IT</span><h2>What’s on your mind?</h2><p>Unpack an idea, work through a problem, or start with a small question.</p><div className="ai-starters"><button onClick={() => setInput('Explain a simple local-first application architecture.')}><MessageSquare size={15} />Think through an idea<ChevronDown size={12} /></button><button onClick={() => setInput('Write a short Python example with an explanation.')}><Bot size={15} />Build something small<ChevronDown size={12} /></button></div></div> : current.messages.map((message) => <article className={`ai-message ai-message-${message.role}`} key={message.id} aria-label={message.role === 'user' ? 'Your message' : 'Copilot response'}><span className="ai-avatar">{message.role === 'user' ? <User size={15} /> : <Bot size={16} />}</span><div className="ai-message-main"><div className="ai-message-heading"><strong>{message.role === 'user' ? 'You' : 'Copilot'}</strong>{message.role === 'assistant' && <span>{message.status === 'streaming' ? 'Writing…' : message.status === 'cancelled' ? 'Stopped' : message.status === 'error' ? 'Could not finish' : status?.mode === 'mock' ? 'Demo response' : current.model}</span>}<button aria-label={`Copy ${message.role === 'user' ? 'your message' : 'response'}`} onClick={() => void copy(message.content)}><Copy size={12} /></button></div>{message.content ? <ChatMarkdown content={message.content} onCopy={(text) => void copy(text)} /> : <p className="ai-message-placeholder">{message.status === 'streaming' ? 'Thinking…' : message.status === 'cancelled' ? 'Generation stopped before a response arrived.' : 'No response received.'}</p>}{message.error && <p className="ai-message-error">{message.error}</p>}</div></article>)}
          </div>
          {!atBottom && <button className="ai-jump-bottom" onClick={() => { nearBottom.current = true; if (viewport.current) viewport.current.scrollTop = viewport.current.scrollHeight; setAtBottom(true); }}><ArrowDown size={12} />Latest message</button>}
          <div className="ai-composer-area"><form className="ai-composer" onSubmit={(event) => { event.preventDefault(); void send(); }}><textarea aria-label="Message Copilot" value={input} maxLength={32000} rows={2} disabled={blocked || generating} placeholder={status?.online ? 'A question, an idea, a place to begin…' : 'Connect to your local engine to start…'} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); } }} />{generating ? <button className="ai-send-button ai-stop-button" type="button" aria-label="Stop response" onClick={() => void stop().catch((reason) => setError(errorText(reason)))}><Square size={14} fill="currentColor" /></button> : <button className="ai-send-button" type="submit" aria-label="Send message" disabled={blocked || !status?.online || !settings.model.trim() || !input.trim()}><ArrowUp size={17} /></button>}</form><div className="ai-composer-footer"><span role="status">{generating ? 'Response streaming…' : !saved ? 'Conversation not saved' : ready ? 'Saved locally' : 'History unavailable'}</span><span>Enter to send · Shift + Enter for a new line</span></div></div>
          {current && <div className="ai-chat-export"><button onClick={() => void copy(transcript(current))}><Copy size={12} />Copy conversation</button><button onClick={exportChat}><Download size={12} />Export chat</button></div>}
        </section>
      </div>
      <p className="page-footnote">No account. No cloud fallback. Conversations stay in this browser or desktop profile.</p>
    </div>
  );
}
