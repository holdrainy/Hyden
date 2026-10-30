import type { BrowserPurgeReport, BrowserSnapshot, BrowserTab } from './browser-types.ts';
import { BROWSER_LIMITS, BROWSER_STORAGE_KEY } from './browser-types.ts';

export { BROWSER_LIMITS, BROWSER_STORAGE_KEY } from './browser-types.ts';

interface StorageLike { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void }
interface Catalog { tabs: BrowserTab[]; activeTabId: string; trackerBlocking: boolean; adBlocking: boolean }
type ErrorCode = 'INVALID_URL' | 'LIMIT_EXCEEDED' | 'NOT_FOUND' | 'STORAGE_UNAVAILABLE' | 'CORRUPT_STORAGE';

export class BrowserSessionError extends Error {
  readonly code: ErrorCode;
  constructor(code: ErrorCode, message: string) { super(message); this.name = 'BrowserSessionError'; this.code = code; }
}

const INTERNAL = new Set(['hyden://start', 'hyden://reading', 'hyden://privacy']);

/** Navigation metadata only. The returned URL is never used as an iframe/network destination. */
export function normalizeBrowserUrl(value: string): string {
  if (typeof value !== 'string' || /[\u0000-\u001f\u007f]/.test(value)) throw new BrowserSessionError('INVALID_URL', 'Use a web address without control characters.');
  const input = value.trim();
  if (!input || input.length > BROWSER_LIMITS.urlLength) throw new BrowserSessionError('INVALID_URL', 'Enter a web address of at most 2,048 characters.');
  const internal = input.toLowerCase().replace(/\/$/, '');
  if (INTERNAL.has(internal)) return internal;
  if (/^hyden:/i.test(input)) throw new BrowserSessionError('INVALID_URL', 'Choose the Start, Reading demo, or Privacy guide page.');
  let candidate = input;
  if (!/^https?:\/\//i.test(candidate)) {
    // A bare host is convenient; filesystem paths and arbitrary schemes are not.
    const bareHost = /^(?:localhost|(?:[a-z0-9\u0080-\uffff-]+\.)+[a-z0-9\u0080-\uffff-]+|\[[0-9a-f:]+\])(?::\d+)?(?:[/?#].*)?$/i;
    if (!bareHost.test(candidate)) throw new BrowserSessionError('INVALID_URL', 'Use an HTTP or HTTPS web address, such as https://example.com.');
    candidate = `https://${candidate}`;
  }
  let url: URL;
  try { url = new URL(candidate); } catch { throw new BrowserSessionError('INVALID_URL', 'This web address is not valid.'); }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password || url.href.length > BROWSER_LIMITS.urlLength) {
    throw new BrowserSessionError('INVALID_URL', 'Use an HTTP or HTTPS address without embedded credentials.');
  }
  return url.href;
}

export function previewPage(url: string): string {
  switch (url) {
    case 'hyden://start': return '/browser-preview/start.html';
    case 'hyden://reading': return '/browser-preview/reading.html';
    case 'hyden://privacy': return '/browser-preview/privacy.html';
    default: return '/browser-preview/offline.html';
  }
}

function titleFor(url: string): string {
  return url === 'hyden://start' ? 'New tab' : url === 'hyden://reading' ? 'Reading room' : url === 'hyden://privacy' ? 'Privacy guide' : new URL(url).hostname;
}

function newTab(): BrowserTab { return { id: crypto.randomUUID(), title: 'New tab', history: ['hyden://start'], index: 0 }; }
function freshCatalog(): Catalog { const tab = newTab(); return { tabs: [tab], activeTabId: tab.id, trackerBlocking: true, adBlocking: true }; }
function copy(catalog: Catalog): Catalog { return { ...catalog, tabs: catalog.tabs.map((tab) => ({ ...tab, history: [...tab.history] })) }; }
function record(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function exactFields(value: Record<string, unknown>, fields: string[]) { if (Object.keys(value).some((key) => !fields.includes(key))) throw new Error('Unexpected stored fields'); }

/** A private catalog never enters browser storage. Normal-mode writes commit atomically to this key only. */
export class InternalBrowserSession {
  private readonly storage: StorageLike;
  private privateMode = true;
  private privateCatalog = freshCatalog();
  private normalCatalog: Catalog | null = null;

  constructor(storage: StorageLike) { this.storage = storage; }

  private current(): Catalog { return this.privateMode ? this.privateCatalog : this.normalCatalog!; }

  snapshot(): BrowserSnapshot { return { ...copy(this.current()), privateMode: this.privateMode }; }

  private commit(catalog: Catalog): BrowserSnapshot {
    if (!this.privateMode) {
      const data = JSON.stringify({ version: 1, ...catalog });
      if (data.length * 2 > BROWSER_LIMITS.storageBytes) throw new BrowserSessionError('LIMIT_EXCEEDED', 'Saved navigation reached its 1 MiB limit. Purge navigation or use private mode.');
      try { this.storage.setItem(BROWSER_STORAGE_KEY, data); }
      catch { throw new BrowserSessionError('STORAGE_UNAVAILABLE', 'Navigation could not be saved. Your previous saved navigation is unchanged; private mode does not need storage.'); }
      this.normalCatalog = catalog;
    } else this.privateCatalog = catalog;
    return this.snapshot();
  }

  navigate(value: string): BrowserSnapshot {
    const url = normalizeBrowserUrl(value);
    const next = copy(this.current());
    const tab = next.tabs.find((item) => item.id === next.activeTabId)!;
    if (tab.history[tab.index] !== url) {
      tab.history = [...tab.history.slice(0, tab.index + 1), url].slice(-BROWSER_LIMITS.history);
      tab.index = tab.history.length - 1;
    }
    tab.title = titleFor(url);
    return this.commit(next);
  }

  back(): BrowserSnapshot { return this.move(-1); }
  forward(): BrowserSnapshot { return this.move(1); }
  private move(offset: number): BrowserSnapshot {
    const next = copy(this.current());
    const tab = next.tabs.find((item) => item.id === next.activeTabId)!;
    tab.index = Math.max(0, Math.min(tab.history.length - 1, tab.index + offset));
    tab.title = titleFor(tab.history[tab.index]);
    return this.commit(next);
  }
  reload(): BrowserSnapshot { return this.snapshot(); }

  newTab(): BrowserSnapshot {
    const next = copy(this.current());
    if (next.tabs.length >= BROWSER_LIMITS.tabs) throw new BrowserSessionError('LIMIT_EXCEEDED', 'The preview supports up to 12 tabs. Close one before adding another.');
    const tab = newTab(); next.tabs.push(tab); next.activeTabId = tab.id;
    return this.commit(next);
  }

  closeTab(id: string): BrowserSnapshot {
    const next = copy(this.current());
    const index = next.tabs.findIndex((item) => item.id === id);
    if (index < 0) throw new BrowserSessionError('NOT_FOUND', 'This tab is no longer open.');
    next.tabs.splice(index, 1);
    if (!next.tabs.length) next.tabs.push(newTab());
    if (next.activeTabId === id) next.activeTabId = next.tabs[Math.min(index, next.tabs.length - 1)].id;
    return this.commit(next);
  }

  selectTab(id: string): BrowserSnapshot {
    const next = copy(this.current());
    if (!next.tabs.some((item) => item.id === id)) throw new BrowserSessionError('NOT_FOUND', 'This tab is no longer open.');
    next.activeTabId = id;
    return this.commit(next);
  }

  setPrivateMode(enabled: boolean): BrowserSnapshot {
    if (enabled === this.privateMode) return this.snapshot();
    if (enabled) { this.privateMode = true; return this.snapshot(); }
    const loaded = this.readNormal();
    const serialized = JSON.stringify({ version: 1, ...loaded });
    if (serialized.length * 2 > BROWSER_LIMITS.storageBytes) throw new BrowserSessionError('LIMIT_EXCEEDED', 'Saved navigation exceeds the 1 MiB limit. Private mode is still active.');
    // Prove that normal navigation can be retained before leaving private mode.
    try { this.storage.setItem(BROWSER_STORAGE_KEY, serialized); }
    catch { throw new BrowserSessionError('STORAGE_UNAVAILABLE', 'Saved navigation is unavailable. Private mode is still active and your private tabs were not saved.'); }
    this.normalCatalog = loaded;
    this.privateMode = false;
    return this.snapshot();
  }

  setProtection(kind: 'trackers' | 'ads', enabled: boolean): BrowserSnapshot {
    if (kind !== 'trackers' && kind !== 'ads') throw new BrowserSessionError('NOT_FOUND', 'This protection setting is unknown.');
    const next = copy(this.current());
    if (kind === 'trackers') next.trackerBlocking = enabled; else next.adBlocking = enabled;
    return this.commit(next);
  }

  purge(): BrowserPurgeReport {
    let persistedNavigationCleared = true;
    try { this.storage.removeItem(BROWSER_STORAGE_KEY); } catch { persistedNavigationCleared = false; }
    this.privateCatalog = freshCatalog(); this.normalCatalog = null; this.privateMode = true;
    return {
      sessionCleared: true, persistedNavigationCleared, cookiesCleared: false,
      notice: persistedNavigationCleared
        ? 'Preview tabs and saved navigation were purged. No external cookies were accessed or removed; this sandbox has no cookie API.'
        : 'Preview tabs were reset, but stored navigation could not be removed. No external cookies were accessed or removed. Check browser storage permissions before assuming saved navigation is gone.',
    };
  }

  private readNormal(): Catalog {
    let raw: string | null;
    try { raw = this.storage.getItem(BROWSER_STORAGE_KEY); }
    catch { throw new BrowserSessionError('STORAGE_UNAVAILABLE', 'Saved navigation cannot be read. Private mode is still available.'); }
    if (raw === null) return freshCatalog();
    try {
      if (raw.length * 2 > BROWSER_LIMITS.storageBytes) throw new Error('Oversized stored navigation');
      const value: unknown = JSON.parse(raw);
      if (!record(value)) throw new Error('Invalid stored navigation');
      exactFields(value, ['version', 'tabs', 'activeTabId', 'trackerBlocking', 'adBlocking']);
      if (value.version !== 1 || !Array.isArray(value.tabs) || value.tabs.length < 1 || value.tabs.length > BROWSER_LIMITS.tabs || typeof value.activeTabId !== 'string' || typeof value.trackerBlocking !== 'boolean' || typeof value.adBlocking !== 'boolean') throw new Error('Invalid stored navigation');
      const ids = new Set<string>();
      const tabs = value.tabs.map((item: unknown): BrowserTab => {
        if (!record(item)) throw new Error('Invalid stored tab');
        exactFields(item, ['id', 'title', 'history', 'index']);
        if (typeof item.id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(item.id) || ids.has(item.id) || typeof item.title !== 'string' || item.title.length > 256 || !Array.isArray(item.history) || !item.history.length || item.history.length > BROWSER_LIMITS.history || typeof item.index !== 'number' || !Number.isInteger(item.index) || item.index < 0 || item.index >= item.history.length) throw new Error('Invalid stored tab');
        ids.add(item.id);
        const history = item.history.map((url: unknown) => { if (typeof url !== 'string') throw new Error('Invalid stored URL'); return normalizeBrowserUrl(url); });
        return { id: item.id, title: titleFor(history[item.index]), history, index: item.index };
      });
      if (!ids.has(value.activeTabId)) throw new Error('Unknown active tab');
      return { tabs, activeTabId: value.activeTabId, trackerBlocking: value.trackerBlocking, adBlocking: value.adBlocking };
    } catch { throw new BrowserSessionError('CORRUPT_STORAGE', 'Saved navigation is unreadable or from an unsupported version. It was not reset. Continue privately, or use Purge Session & Cookies to remove only this module’s saved navigation.'); }
  }
}
