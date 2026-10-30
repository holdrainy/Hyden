export interface BrowserTab {
  id: string;
  title: string;
  history: string[];
  index: number;
}

export interface BrowserSnapshot {
  tabs: BrowserTab[];
  activeTabId: string;
  privateMode: boolean;
  trackerBlocking: boolean;
  adBlocking: boolean;
}

export interface BrowserPurgeReport {
  sessionCleared: boolean;
  persistedNavigationCleared: boolean;
  cookiesCleared: false;
  notice: string;
}

export interface BrowserCapabilities {
  mode: 'preview';
  liveBrowsing: false;
  cookieAccess: false;
  notice: string;
}

export const BROWSER_STORAGE_KEY = 'hyden.browser.v1';
export const BROWSER_LIMITS = { tabs: 12, history: 50, urlLength: 2048, storageBytes: 1024 * 1024 } as const;
