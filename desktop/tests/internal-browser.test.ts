import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BROWSER_LIMITS, BROWSER_STORAGE_KEY, InternalBrowserSession, normalizeBrowserUrl, previewPage } from '../src/lib/internal-browser.ts';

class MemoryStorage {
  values = new Map<string, string>();
  reads = 0;
  writes = 0;
  removed: string[] = [];
  getItem(key: string) { this.reads++; return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.writes++; this.values.set(key, value); }
  removeItem(key: string) { this.removed.push(key); this.values.delete(key); }
}

function current(session: InternalBrowserSession) {
  const snapshot = session.snapshot();
  const tab = snapshot.tabs.find((item) => item.id === snapshot.activeTabId)!;
  return tab.history[tab.index];
}

test('browser URL parsing rejects active schemes, credentials and paths; preview sources are fixed assets', () => {
  assert.equal(normalizeBrowserUrl('example.com/path?q=one#part'), 'https://example.com/path?q=one#part');
  assert.equal(normalizeBrowserUrl(' http://127.0.0.1:8080/ '), 'http://127.0.0.1:8080/');
  assert.equal(normalizeBrowserUrl('HYDEN://READING/'), 'hyden://reading');
  for (const input of ['javascript:alert(1)', 'data:text/html,test', 'file:///tmp/data', '/etc/passwd', 'C:\\private\\data', 'https://user:secret@example.com', 'https://example.com\n', 'hyden://unknown', '', 'a'.repeat(2049)]) {
    assert.throws(() => normalizeBrowserUrl(input));
  }
  assert.equal(previewPage('hyden://reading'), '/browser-preview/reading.html');
  assert.equal(previewPage('https://example.com/'), '/browser-preview/offline.html');
  assert.equal(previewPage('javascript:alert(1)'), '/browser-preview/offline.html');
});

test('private browsing never accesses storage and snapshots cannot mutate the session', () => {
  const storage = new MemoryStorage();
  const session = new InternalBrowserSession(storage);
  session.navigate('https://private.example/');
  session.setProtection('trackers', false);
  session.newTab();
  session.navigate('hyden://reading');
  const snapshot = session.snapshot();
  snapshot.tabs[0].history[0] = 'tampered';
  snapshot.tabs.pop();
  assert.equal(session.snapshot().tabs.length, 2);
  assert.equal(session.snapshot().tabs[0].history[0], 'hyden://start');
  assert.equal(storage.reads, 0);
  assert.equal(storage.writes, 0);
  assert.equal(session.snapshot().privateMode, true);
});

test('history branches correctly, stays bounded, and tab controls preserve an active tab', () => {
  const session = new InternalBrowserSession(new MemoryStorage());
  session.navigate('hyden://reading');
  session.navigate('hyden://privacy');
  session.back();
  assert.equal(current(session), 'hyden://reading');
  session.forward();
  assert.equal(current(session), 'hyden://privacy');
  session.back();
  session.navigate('https://new.example/');
  const tab = session.snapshot().tabs[0];
  assert.deepEqual(tab.history, ['hyden://start', 'hyden://reading', 'https://new.example/']);
  session.forward();
  assert.equal(current(session), 'https://new.example/');
  for (let index = 0; index < 60; index++) session.navigate(`https://example.com/${index}`);
  assert.equal(session.snapshot().tabs[0].history.length, BROWSER_LIMITS.history);
  assert.equal(session.snapshot().tabs[0].index, 49);
  for (let index = 1; index < BROWSER_LIMITS.tabs; index++) session.newTab();
  assert.throws(() => session.newTab(), { code: 'LIMIT_EXCEEDED' });
  const first = session.snapshot().tabs[0].id;
  session.selectTab(first);
  assert.equal(current(session), 'https://example.com/59');
  for (const open of session.snapshot().tabs) session.closeTab(open.id);
  assert.equal(session.snapshot().tabs.length, 1);
  assert.equal(current(session), 'hyden://start');
  assert.throws(() => session.selectTab('not-open'), { code: 'NOT_FOUND' });
});

test('normal and private navigation stay separate across mode switches and page reloads', () => {
  const storage = new MemoryStorage();
  const session = new InternalBrowserSession(storage);
  session.navigate('https://private.example/secret');
  session.setProtection('ads', false);
  session.setPrivateMode(false);
  assert.equal(current(session), 'hyden://start');
  assert.equal(session.snapshot().adBlocking, true);
  assert.ok(!storage.values.get(BROWSER_STORAGE_KEY)!.includes('private.example'));
  session.navigate('hyden://reading');
  session.setProtection('trackers', false);
  session.setPrivateMode(true);
  assert.equal(current(session), 'https://private.example/secret');
  assert.equal(session.snapshot().adBlocking, false);
  assert.ok(!storage.values.get(BROWSER_STORAGE_KEY)!.includes('private.example'));
  const reloaded = new InternalBrowserSession(storage);
  assert.equal(reloaded.snapshot().privateMode, true);
  assert.equal(current(reloaded), 'hyden://start');
  reloaded.setPrivateMode(false);
  assert.equal(current(reloaded), 'hyden://reading');
  assert.equal(reloaded.snapshot().trackerBlocking, false);
});

test('purge removes this module only, resets private navigation, and does not claim cookie deletion', () => {
  const storage = new MemoryStorage();
  storage.values.set('hyden.workspace.v1', 'notes');
  storage.values.set('hyden.copilot.v1', 'conversations');
  const session = new InternalBrowserSession(storage);
  session.setPrivateMode(false);
  session.navigate('https://saved.example/');
  session.setPrivateMode(true);
  session.navigate('https://private.example/');
  const report = session.purge();
  assert.equal(report.sessionCleared, true);
  assert.equal(report.persistedNavigationCleared, true);
  assert.equal(report.cookiesCleared, false);
  assert.equal(storage.values.get(BROWSER_STORAGE_KEY), undefined);
  assert.equal(storage.values.get('hyden.workspace.v1'), 'notes');
  assert.equal(storage.values.get('hyden.copilot.v1'), 'conversations');
  assert.deepEqual(storage.removed, [BROWSER_STORAGE_KEY]);
  assert.equal(current(session), 'hyden://start');
  assert.equal(session.snapshot().privateMode, true);
});

test('failed persistent writes preserve previous state, and corrupt storage is never reset implicitly', () => {
  const storage = new MemoryStorage();
  const session = new InternalBrowserSession(storage);
  session.setPrivateMode(false);
  session.navigate('hyden://reading');
  const original = storage.values.get(BROWSER_STORAGE_KEY);
  storage.setItem = () => { throw new Error('Quota'); };
  assert.throws(() => session.navigate('hyden://privacy'), { code: 'STORAGE_UNAVAILABLE' });
  assert.equal(current(session), 'hyden://reading');
  assert.equal(storage.values.get(BROWSER_STORAGE_KEY), original);
  session.setPrivateMode(true);
  session.navigate('https://private.example/');
  assert.equal(current(session), 'https://private.example/');
  storage.values.set(BROWSER_STORAGE_KEY, '{broken');
  assert.throws(() => session.setPrivateMode(false), { code: 'CORRUPT_STORAGE' });
  assert.equal(storage.values.get(BROWSER_STORAGE_KEY), '{broken');
  assert.equal(session.snapshot().privateMode, true);
  assert.equal(current(session), 'https://private.example/');
});

test('purge reports partial cleanup if storage cannot be removed, without accessing other storage', () => {
  const storage = new MemoryStorage();
  storage.values.set(BROWSER_STORAGE_KEY, 'unreadable');
  storage.removeItem = () => { throw new Error('Denied'); };
  storage.getItem = () => { throw new Error('Denied'); };
  const session = new InternalBrowserSession(storage);
  session.navigate('https://private.example/');
  const report = session.purge();
  assert.equal(report.sessionCleared, true);
  assert.equal(report.persistedNavigationCleared, false);
  assert.equal(report.cookiesCleared, false);
  assert.match(report.notice, /could not be removed/);
  assert.equal(current(session), 'hyden://start');
  assert.equal(storage.values.get(BROWSER_STORAGE_KEY), 'unreadable');
});

test('invalid saved schema and unsafe stored URLs remain untouched', () => {
  const storage = new MemoryStorage();
  const raw = JSON.stringify({ version: 1, tabs: [{ id: 'one', title: 'Bad', history: ['javascript:alert(1)'], index: 0 }], activeTabId: 'one', trackerBlocking: true, adBlocking: true });
  storage.values.set(BROWSER_STORAGE_KEY, raw);
  const session = new InternalBrowserSession(storage);
  assert.throws(() => session.setPrivateMode(false), { code: 'CORRUPT_STORAGE' });
  assert.equal(storage.values.get(BROWSER_STORAGE_KEY), raw);
  assert.equal(session.snapshot().privateMode, true);
});
