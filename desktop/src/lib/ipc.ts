import { Channel, invoke, isTauri } from '@tauri-apps/api/core';
import type { DownloadJob, ImportResult, MediaItem, MediaKind, MediaLibrary } from './media-types';
import type { WorkspaceNote, WorkspaceSheet, WorkspaceSnapshot } from './workspace-types';
import type { ChatRequest, ChatSession, ChatStreamEvent, CopilotSettings, CopilotSnapshot, EngineConfig, EngineStatus } from './copilot-types';
import type { BrowserCapabilities, BrowserPurgeReport, BrowserSnapshot } from './browser-types';
import type { EditorCapabilities, EditorTrimRequest, FFmpegPlan, NativeImageRequest } from './editor-types';
import type { DesignSnapshot, FigmaBookmark, ScratchpadDocument } from './design-types';

export type { DownloadJob, ImportResult, MediaItem, MediaKind, MediaLibrary, MediaError } from './media-types';
export type { WorkspaceNote, WorkspaceSheet, WorkspaceSnapshot } from './workspace-types';
export type { ChatRequest, ChatSession, ChatStreamEvent, CopilotMessage, CopilotSettings, CopilotSnapshot, EngineConfig, EngineProvider, EngineStatus } from './copilot-types';
export type { BrowserCapabilities, BrowserPurgeReport, BrowserSnapshot, BrowserTab } from './browser-types';
export type { EditorCapabilities, EditorTrimRequest, FFmpegPlan, NativeImageRequest, ImageFormat } from './editor-types';
export type { ImageSettings, SourceImage } from './browser-image';
export type { DesignSnapshot, FigmaBookmark, ScratchpadDocument, DesignShape, DesignPoint, ParsedFigmaUrl } from './design-types';

export interface ShellStatus {
  appVersion: string;
  host: 'desktop' | 'browser';
  persistence: 'not-configured';
  workerState: 'not-started';
}

/** Browser preview has no native privileges. Native failures never fall back to mocked success. */
export async function getShellStatus(): Promise<ShellStatus> {
  if (!isTauri()) {
    return {
      appVersion: '0.1.0',
      host: 'browser',
      persistence: 'not-configured',
      workerState: 'not-started',
    };
  }

  return invoke<ShellStatus>('shell_status');
}

// Browser implementation is loaded only when the media module first needs it.
let browserEngine: Promise<import('./browser-media').BrowserMediaEngine> | undefined;
function browserMedia() {
  browserEngine ??= import('./browser-media').then(({ BrowserMediaEngine }) => new BrowserMediaEngine());
  return browserEngine;
}

export async function getMediaLibrary(): Promise<MediaLibrary> {
  return isTauri() ? invoke('media_library') : (await browserMedia()).library();
}

/** Subscribe only while a view is mounted. Native events will be wired with the actual native service. */
export async function subscribeMediaChanges(listener: () => void): Promise<() => void> {
  return isTauri() ? () => undefined : (await browserMedia()).subscribe(listener);
}

export async function importMediaFiles(files: File[]): Promise<ImportResult> {
  // Files are browser objects, never serialized into native invoke payloads. Future native import uses an OS picker.
  return isTauri() ? invoke('media_import') : (await browserMedia()).importFiles(files);
}

export async function setMediaFavorite(id: string, favorite: boolean): Promise<MediaItem> {
  return isTauri() ? invoke('media_set_favorite', { id, favorite }) : (await browserMedia()).favorite(id, favorite);
}

export async function removeMediaItem(id: string): Promise<void> {
  if (isTauri()) return invoke('media_remove', { id });
  (await browserMedia()).remove(id);
}

export async function getMediaPlaybackSource(id: string): Promise<string> {
  return isTauri() ? invoke('media_playback_source', { id }) : (await browserMedia()).playbackSource(id);
}

export async function getDownloadJobs(): Promise<DownloadJob[]> {
  return isTauri() ? invoke('media_download_jobs') : (await browserMedia()).downloadJobs();
}

export async function enqueueMediaDownload(url: string, kind: MediaKind): Promise<DownloadJob> {
  return isTauri() ? invoke('media_enqueue_download', { url, kind }) : (await browserMedia()).enqueueDownload(url, kind);
}

export async function runDownloadDemo(id: string): Promise<DownloadJob> {
  return isTauri() ? invoke('media_run_download_demo', { id }) : (await browserMedia()).runDownloadDemo(id);
}

export async function cancelMediaDownload(id: string): Promise<DownloadJob> {
  return isTauri() ? invoke('media_cancel_download', { id }) : (await browserMedia()).cancelDownload(id);
}

let workspaceStore: import('./browser-workspace').BrowserWorkspaceStore | undefined;
let workspaceLoading: Promise<import('./browser-workspace').BrowserWorkspaceStore> | undefined;
const WORKSPACE_EVENT = 'hyden:workspace-changed';

function withWorkspace<T>(operation: (store: import('./browser-workspace').BrowserWorkspaceStore) => T, mutate = false): Promise<T> {
  const run = (store: import('./browser-workspace').BrowserWorkspaceStore) => {
    const result = operation(store);
    if (mutate) window.dispatchEvent(new Event(WORKSPACE_EVENT));
    return result;
  };
  // Once loaded, browser writes happen before returning to the input event handler.
  // This also makes the latest keystroke durable before a subsequent navigation.
  if (workspaceStore) {
    try { return Promise.resolve(run(workspaceStore)); } catch (error) { return Promise.reject(error); }
  }
  workspaceLoading ??= import('./browser-workspace').then(({ BrowserWorkspaceStore }) => {
    workspaceStore = new BrowserWorkspaceStore({
      getItem: (key) => window.localStorage.getItem(key),
      setItem: (key, value) => window.localStorage.setItem(key, value),
    });
    return workspaceStore;
  });
  return workspaceLoading.then(run);
}

export function getWorkspaceSnapshot(): Promise<WorkspaceSnapshot> {
  return isTauri() ? invoke('workspace_snapshot') : withWorkspace((store) => store.snapshot());
}

export function createWorkspaceNote(title?: string): Promise<WorkspaceNote> {
  return isTauri() ? invoke('workspace_create_note', { title }) : withWorkspace((store) => store.createNote(title), true);
}

export function saveWorkspaceNote(note: WorkspaceNote): Promise<WorkspaceNote> {
  return isTauri() ? invoke('workspace_save_note', { note }) : withWorkspace((store) => store.saveNote(note), true);
}

export function deleteWorkspaceNote(id: string, revision: number): Promise<void> {
  return isTauri() ? invoke('workspace_delete_note', { id, revision }) : withWorkspace((store) => store.deleteNote(id, revision), true);
}

export function createWorkspaceSheet(title?: string): Promise<WorkspaceSheet> {
  return isTauri() ? invoke('workspace_create_sheet', { title }) : withWorkspace((store) => store.createSheet(title), true);
}

export function saveWorkspaceSheet(sheet: WorkspaceSheet): Promise<WorkspaceSheet> {
  return isTauri() ? invoke('workspace_save_sheet', { sheet }) : withWorkspace((store) => store.saveSheet(sheet), true);
}

export function deleteWorkspaceSheet(id: string, revision: number): Promise<void> {
  return isTauri() ? invoke('workspace_delete_sheet', { id, revision }) : withWorkspace((store) => store.deleteSheet(id, revision), true);
}

export async function subscribeWorkspaceChanges(listener: () => void): Promise<() => void> {
  if (isTauri()) return () => undefined;
  const onStorage = (event: StorageEvent) => {
    if (event.key === 'hyden.workspace.v1' || event.key === null) listener();
  };
  window.addEventListener(WORKSPACE_EVENT, listener);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(WORKSPACE_EVENT, listener);
    window.removeEventListener('storage', onStorage);
  };
}

// History is genuine webview-local persistence in both hosts; only response transport is mocked.
let historyStore: import('./copilot-history').CopilotHistoryStore | undefined;
let historyLoading: Promise<import('./copilot-history').CopilotHistoryStore> | undefined;
function withCopilotHistory<T>(operation: (store: import('./copilot-history').CopilotHistoryStore) => T): Promise<T> {
  if (historyStore) {
    try { return Promise.resolve(operation(historyStore)); } catch (error) { return Promise.reject(error); }
  }
  historyLoading ??= import('./copilot-history').then(({ CopilotHistoryStore }) => {
    historyStore = new CopilotHistoryStore({ getItem: (key) => window.localStorage.getItem(key), setItem: (key, value) => window.localStorage.setItem(key, value) });
    return historyStore;
  });
  return historyLoading.then(operation);
}

export function getCopilotHistory(): Promise<CopilotSnapshot> { return withCopilotHistory((store) => store.snapshot()); }
export function saveCopilotSettings(settings: CopilotSettings): Promise<CopilotSettings> { return withCopilotHistory((store) => store.saveSettings(settings)); }
export function createCopilotSession(model?: string): Promise<ChatSession> { return withCopilotHistory((store) => store.createSession(model)); }
export function saveCopilotSession(session: ChatSession): Promise<ChatSession> { return withCopilotHistory((store) => store.saveSession(session)); }
export function setActiveCopilotSession(id: string | null): Promise<void> { return withCopilotHistory((store) => store.setActiveSession(id)); }
export function deleteCopilotSession(id: string, revision: number): Promise<void> { return withCopilotHistory((store) => store.deleteSession(id, revision)); }
export function clearCopilotHistory(): Promise<void> { return withCopilotHistory((store) => store.clearHistory()); }

let mockEngine: Promise<import('./mock-copilot').MockCopilotEngine> | undefined;
function mockCopilot() { mockEngine ??= import('./mock-copilot').then(({ MockCopilotEngine }) => new MockCopilotEngine()); return mockEngine; }

export async function checkCopilotEngine(config: EngineConfig): Promise<EngineStatus> {
  return isTauri() ? invoke('copilot_status', { config }) : (await mockCopilot()).status(config);
}
export async function listCopilotModels(config: EngineConfig): Promise<string[]> {
  return isTauri() ? invoke('copilot_models', { config }) : (await mockCopilot()).models(config);
}
export async function streamCopilotChat(request: ChatRequest, onEvent: (event: ChatStreamEvent) => void): Promise<void> {
  if (!isTauri()) return (await mockCopilot()).chat(request, onEvent);
  const channel = new Channel<ChatStreamEvent>();
  channel.onmessage = (event) => { if (event.requestId === request.requestId) onEvent(event); };
  try { await invoke<void>('copilot_chat', { request, onEvent: channel }); }
  finally { channel.onmessage = () => {}; }
}
export async function cancelCopilotChat(requestId: string): Promise<void> {
  if (isTauri()) return invoke('copilot_cancel', { requestId });
  (await mockCopilot()).cancel(requestId);
}
export async function setMockEngineOnline(online: boolean): Promise<void> {
  if (isTauri()) throw new Error('Offline simulation is available in browser preview only.');
  (await mockCopilot()).setOnline(online);
}

// Both hosts use an unprivileged bundled preview until a real native browsing profile is implemented.
let browserSession: import('./internal-browser').InternalBrowserSession | undefined;
let browserSessionLoading: Promise<import('./internal-browser').InternalBrowserSession> | undefined;
function withBrowserSession<T>(operation: (session: import('./internal-browser').InternalBrowserSession) => T): Promise<T> {
  if (browserSession) {
    try { return Promise.resolve(operation(browserSession)); } catch (error) { return Promise.reject(error); }
  }
  browserSessionLoading ??= import('./internal-browser').then(({ InternalBrowserSession }) => {
    browserSession = new InternalBrowserSession({
      getItem: (key) => window.localStorage.getItem(key),
      setItem: (key, value) => window.localStorage.setItem(key, value),
      removeItem: (key) => window.localStorage.removeItem(key),
    });
    return browserSession;
  });
  return browserSessionLoading.then(operation);
}

export function getBrowserSnapshot(): Promise<BrowserSnapshot> { return withBrowserSession((session) => session.snapshot()); }
export function navigateBrowser(url: string): Promise<BrowserSnapshot> { return withBrowserSession((session) => session.navigate(url)); }
export function goBrowserBack(): Promise<BrowserSnapshot> { return withBrowserSession((session) => session.back()); }
export function goBrowserForward(): Promise<BrowserSnapshot> { return withBrowserSession((session) => session.forward()); }
export function reloadBrowser(): Promise<BrowserSnapshot> { return withBrowserSession((session) => session.reload()); }
export function newBrowserTab(): Promise<BrowserSnapshot> { return withBrowserSession((session) => session.newTab()); }
export function closeBrowserTab(id: string): Promise<BrowserSnapshot> { return withBrowserSession((session) => session.closeTab(id)); }
export function selectBrowserTab(id: string): Promise<BrowserSnapshot> { return withBrowserSession((session) => session.selectTab(id)); }
export function setBrowserPrivateMode(privateMode: boolean): Promise<BrowserSnapshot> { return withBrowserSession((session) => session.setPrivateMode(privateMode)); }
export function setBrowserProtection(kind: 'trackers' | 'ads', enabled: boolean): Promise<BrowserSnapshot> { return withBrowserSession((session) => session.setProtection(kind, enabled)); }
export function purgeBrowserSession(): Promise<BrowserPurgeReport> { return withBrowserSession((session) => session.purge()); }
export async function getBrowserCapabilities(): Promise<BrowserCapabilities> {
  return isTauri() ? invoke('internal_browser_capabilities') : { mode: 'preview', liveBrowsing: false, cookieAccess: false, notice: 'Only bundled sandboxed pages load here. Web navigation, tracker/ad blocking, and real website cookie controls require a future native browser profile.' };
}
export function purgeNativeBrowserCookies(): Promise<void> {
  return isTauri() ? invoke('internal_browser_purge') : Promise.reject(new Error('The preview cannot access or clear real website cookies. Use Purge to reset preview navigation only.'));
}

export function getEditorCapabilities(): Promise<EditorCapabilities> {
  return isTauri() ? invoke('editor_capabilities') : Promise.resolve({ mode: 'browser', ffmpegExecution: false, nativeImageProcessing: false, notice: 'Canvas image exports are available. Trimming generates an FFmpeg plan only; no FFmpeg/OpenCV worker is started.' });
}
export async function getTrimPlan(request: EditorTrimRequest): Promise<FFmpegPlan> {
  if (isTauri()) return invoke('editor_trim_plan', { request });
  return (await import('./editor-plan')).createTrimPlan(request);
}
export function runNativeTrim(request: EditorTrimRequest): Promise<void> {
  return isTauri() ? invoke('editor_run_trim', { request }) : Promise.reject(new Error('Native FFmpeg execution is unavailable in browser preview. Copy the generated plan for use with your own local FFmpeg installation.'));
}
export function processNativeImage(request: NativeImageRequest): Promise<void> {
  return isTauri() ? invoke('editor_process_image', { request }) : Promise.reject(new Error('Native OpenCV processing is unavailable in browser preview. Use the local canvas image processor.'));
}

// Canvas is an explicit webview feature in both hosts, independent of the future OpenCV command.
export async function loadEditorImage(file: File): Promise<import('./browser-image').SourceImage> {
  return (await import('./browser-image')).loadSourceImage(file);
}
export async function exportEditorImage(source: import('./browser-image').SourceImage, settings: import('./browser-image').ImageSettings): Promise<Blob> {
  return (await import('./browser-image')).encodeImage(source, settings);
}

// Design data uses its own versioned local-profile key; Notes/Sheets schemas are unchanged.
let designStore: import('./design-store').DesignStore | undefined;
let designLoading: Promise<import('./design-store').DesignStore> | undefined;
function withDesign<T>(operation: (store: import('./design-store').DesignStore) => T): Promise<T> {
  if (designStore) {
    try { return Promise.resolve(operation(designStore)); } catch (error) { return Promise.reject(error); }
  }
  designLoading ??= import('./design-store').then(({ DesignStore }) => {
    designStore = new DesignStore({ getItem: (key) => window.localStorage.getItem(key), setItem: (key, value) => window.localStorage.setItem(key, value) });
    return designStore;
  });
  return designLoading.then(operation);
}
export function getDesignSnapshot(): Promise<DesignSnapshot> { return withDesign((store) => store.snapshot()); }
export function createDesignBookmark(title: string, url: string): Promise<FigmaBookmark> { return withDesign((store) => store.createBookmark(title, url)); }
export function renameDesignBookmark(id: string, title: string, revision: number): Promise<FigmaBookmark> { return withDesign((store) => store.renameBookmark(id, title, revision)); }
export function deleteDesignBookmark(id: string, revision: number): Promise<void> { return withDesign((store) => store.deleteBookmark(id, revision)); }
export function saveDesignScratchpad(document: ScratchpadDocument): Promise<ScratchpadDocument> { return withDesign((store) => store.saveScratchpad(document)); }
