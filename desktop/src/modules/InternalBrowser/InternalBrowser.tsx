import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { ArrowLeft, ArrowRight, Check, EyeOff, Globe2, Home, Info, LockKeyhole, Plus, RotateCw, ShieldCheck, Trash2, X } from 'lucide-react';
import {
  closeBrowserTab, getBrowserCapabilities, getBrowserSnapshot, goBrowserBack, goBrowserForward,
  navigateBrowser, newBrowserTab, purgeBrowserSession, reloadBrowser, selectBrowserTab,
  setBrowserPrivateMode, setBrowserProtection,
} from '../../lib/ipc';
import type { BrowserCapabilities, BrowserSnapshot } from '../../lib/browser-types';
import { previewPage } from '../../lib/internal-browser';
import './browser.css';

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : error && typeof error === 'object' && 'message' in error ? String(error.message) : 'The browser preview could not finish this action.';
}

export default function InternalBrowser() {
  const [snapshot, setSnapshot] = useState<BrowserSnapshot | null>(null);
  const [capabilities, setCapabilities] = useState<BrowserCapabilities | null>(null);
  const [address, setAddress] = useState('hyden://start');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [frameVersion, setFrameVersion] = useState(0);
  const [online, setOnline] = useState(navigator.onLine);
  const mounted = useRef(true);
  const actionLock = useRef(false);
  const active = snapshot?.tabs.find((tab) => tab.id === snapshot.activeTabId);
  const url = active?.history[active.index] ?? 'hyden://start';
  const remote = /^https?:/.test(url);

  useEffect(() => {
    mounted.current = true;
    let disposed = false;
    Promise.all([getBrowserSnapshot(), getBrowserCapabilities()]).then(([next, support]) => {
      if (!disposed) { setSnapshot(next); setCapabilities(support); }
    }).catch((reason) => { if (!disposed) setError(errorText(reason)); });
    const updateOnline = () => setOnline(navigator.onLine);
    window.addEventListener('online', updateOnline);
    window.addEventListener('offline', updateOnline);
    return () => {
      disposed = true; mounted.current = false;
      window.removeEventListener('online', updateOnline); window.removeEventListener('offline', updateOnline);
    };
  }, []);

  useEffect(() => { setAddress(url); }, [url, active?.id]);

  const act = async (operation: () => Promise<BrowserSnapshot>, remount = true) => {
    if (actionLock.current) return;
    actionLock.current = true; setBusy(true); setError(''); setNotice('');
    try {
      const next = await operation();
      if (mounted.current) { setSnapshot(next); if (remount) setFrameVersion((value) => value + 1); }
    } catch (reason) { if (mounted.current) setError(errorText(reason)); }
    finally { actionLock.current = false; if (mounted.current) setBusy(false); }
  };

  const navigate = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); void act(() => navigateBrowser(address)); };
  const purge = async () => {
    if (actionLock.current) return;
    actionLock.current = true; setBusy(true); setError(''); setNotice('');
    try {
      const report = await purgeBrowserSession();
      const next = await getBrowserSnapshot();
      if (mounted.current) {
        setSnapshot(next); setFrameVersion((value) => value + 1);
        if (report.persistedNavigationCleared) setNotice(report.notice); else setError(report.notice);
      }
    } catch (reason) { if (mounted.current) setError(errorText(reason)); }
    finally { actionLock.current = false; if (mounted.current) setBusy(false); }
  };

  return (
    <div className="page ib-page">
      <div className="ib-heading"><div className="page-heading"><div className="eyebrow"><span className="tiny-line" /> YOUR TOOLKIT / INTERNAL BROWSER</div><h1>A quieter corner of the web.</h1><p>A separate space to explore, with privacy you can understand.</p></div><span className="ib-preview-label"><ShieldCheck size={14} />Sandbox preview</span></div>
      <div className="ib-preview-banner"><Info size={16} /><div><strong>Local preview · remote browsing is unavailable</strong><p>{capabilities?.notice ?? 'Navigation uses bundled demonstration pages. No external website is loaded.'} Blocking toggles demonstrate controls; they do not filter real web traffic.</p></div></div>
      {error && <div className="ib-feedback ib-error" role="alert"><span>{error}</span><button className="icon-button" aria-label="Dismiss browser error" onClick={() => setError('')}><X size={14} /></button></div>}
      {notice && <div className="ib-feedback" role="status"><Check size={14} /><span>{notice}</span><button className="icon-button" aria-label="Dismiss browser notification" onClick={() => setNotice('')}><X size={14} /></button></div>}
      <section className="ib-browser" aria-label="Internal browser preview">
        <div className="ib-tabs" role="tablist" aria-label="Browser tabs">{snapshot?.tabs.map((tab) => <div className={`ib-tab ${active?.id === tab.id ? 'ib-tab-active' : ''}`} key={tab.id}><button role="tab" aria-label={`Select tab ${tab.title}`} aria-selected={active?.id === tab.id} aria-controls="ib-page-container" disabled={busy} onClick={() => void act(() => selectBrowserTab(tab.id))}><Globe2 size={12} /><span>{tab.title}</span></button><button className="ib-close-tab" aria-label={`Close tab ${tab.title}`} disabled={busy} onClick={() => void act(() => closeBrowserTab(tab.id))}><X size={12} /></button></div>)}<button className="ib-new-tab" aria-label="New browser tab" title="New tab" disabled={!snapshot || busy || snapshot.tabs.length >= 12} onClick={() => void act(newBrowserTab)}><Plus size={16} /></button></div>
        <div className="ib-navigation"><div className="ib-navigation-buttons"><button className="icon-button" aria-label="Browser back" title="Back" disabled={!active || busy || active.index === 0} onClick={() => void act(goBrowserBack)}><ArrowLeft size={16} /></button><button className="icon-button" aria-label="Browser forward" title="Forward" disabled={!active || busy || active.index === active.history.length - 1} onClick={() => void act(goBrowserForward)}><ArrowRight size={16} /></button><button className="icon-button" aria-label="Reload browser page" title="Reload" disabled={!snapshot || busy} onClick={() => void act(reloadBrowser)}><RotateCw size={15} /></button></div><form className="ib-address-form" onSubmit={navigate}><LockKeyhole size={13} /><input type="text" inputMode="url" spellCheck={false} autoComplete="off" aria-label="Browser address" value={address} disabled={!snapshot || busy} maxLength={2048} onChange={(event) => setAddress(event.target.value)} /><button type="submit" disabled={!snapshot || busy}>Go</button></form><button className="ib-home-button icon-button" aria-label="Browser home" title="Start page" disabled={!snapshot || busy} onClick={() => void act(() => navigateBrowser('hyden://start'))}><Home size={16} /></button></div>
        <div className="ib-privacy-controls"><div><label><input type="checkbox" aria-label="Simulate tracker blocking" checked={snapshot?.trackerBlocking ?? true} disabled={!snapshot || busy} onChange={(event) => void act(() => setBrowserProtection('trackers', event.target.checked), false)} /><ShieldCheck size={13} />Trackers<span>SIMULATED</span></label><label><input type="checkbox" aria-label="Simulate ad blocking" checked={snapshot?.adBlocking ?? true} disabled={!snapshot || busy} onChange={(event) => void act(() => setBrowserProtection('ads', event.target.checked), false)} />Ads<span>SIMULATED</span></label><label className="ib-private-control"><input type="checkbox" aria-label="Private session mode" checked={snapshot?.privateMode ?? true} disabled={!snapshot || busy} onChange={(event) => void act(() => setBrowserPrivateMode(event.target.checked))} /><EyeOff size={13} />Private session</label></div><button className="ib-purge" disabled={!snapshot || busy} onClick={() => void purge()}><Trash2 size={13} />Purge Session &amp; Cookies</button></div>
        <div className="ib-session-note"><span className="status-dot" /><span>{snapshot?.privateMode ? 'Private preview: navigation stays in memory for this page session.' : 'Remembered preview: navigation is saved in this browser. Private tabs are kept separate.'}</span><span className="ib-cookie-note">External cookies: no access</span></div>
        <div className="ib-local-shortcuts" role="group" aria-label="Bundled browser pages"><span>EXPLORE THE PREVIEW</span><button disabled={!snapshot || busy} onClick={() => void act(() => navigateBrowser('hyden://reading'))}>Reading demo <ArrowRight size={11} /></button><button disabled={!snapshot || busy} onClick={() => void act(() => navigateBrowser('hyden://privacy'))}>Privacy guide <ArrowRight size={11} /></button></div>
        {remote && <div className="ib-remote-fallback" role="status"><Globe2 size={15} /><div><strong>Remote browsing unavailable in preview</strong><p>{url}</p><span>This address was added to preview history. It was not contacted or loaded.</span></div></div>}
        {!online && <div className="ib-offline-notice" role="status">Your browser reports an offline connection. Only bundled preview content is supported; loading a new page still requires access to the app assets.</div>}
        <div id="ib-page-container" className="ib-page-container" role="tabpanel" aria-label="Sandboxed page container">{snapshot ? <iframe key={`${active?.id}-${frameVersion}`} title="Sandboxed browser page" src={previewPage(url)} sandbox="" referrerPolicy="no-referrer" /> : <p className="ib-loading" role="status">Opening a separate space…</p>}</div>
        <div className="ib-browser-footer"><span>Opaque-origin sandbox · scripts, forms, popups, downloads, and parent access disabled</span><span>{snapshot?.tabs.length ?? 0} / 12 tabs</span></div>
      </section>
      <p className="page-footnote">Preview isolation is not a complete browser sandbox or an encrypted session store. Real webview filtering and cookie purging need native integration.</p>
    </div>
  );
}
