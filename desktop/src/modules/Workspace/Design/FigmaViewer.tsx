import { useCallback, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { Bookmark, Check, Copy, PanelsTopLeft as Figma, Globe2, Info, Maximize2, Minimize2, Pencil, Play, RefreshCw, Trash2, WifiOff, X } from 'lucide-react';
import {
  createDesignBookmark, deleteDesignBookmark, getDesignSnapshot, renameDesignBookmark,
} from '../../../lib/ipc';
import type { FigmaBookmark } from '../../../lib/ipc';
import { parseFigmaUrl } from '../../../lib/figma-url';
import type { ParsedFigmaUrl } from '../../../lib/design-types';

type FrameState = 'idle' | 'loading' | 'opened' | 'unconfirmed' | 'offline' | 'failed';

function errorText(reason: unknown): string {
  return reason instanceof Error ? reason.message : reason && typeof reason === 'object' && 'message' in reason ? String(reason.message) : 'The board could not be opened or saved.';
}

function defaultTitle(link: ParsedFigmaUrl): string {
  try {
    const slug = new URL(link.sourceUrl).pathname.split('/').filter(Boolean).at(-1) ?? '';
    const title = decodeURIComponent(slug).replace(/[-_]+/g, ' ').trim();
    return (title && title !== link.fileKey ? title : 'Figma board').slice(0, 100);
  } catch { return 'Figma board'; }
}

export default function FigmaViewer() {
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [bookmarks, setBookmarks] = useState<FigmaBookmark[]>([]);
  const [active, setActive] = useState<ParsedFigmaUrl | null>(null);
  const [frameEnabled, setFrameEnabled] = useState(false);
  const [frameVersion, setFrameVersion] = useState(0);
  const [frameState, setFrameState] = useState<FrameState>('idle');
  const [online, setOnline] = useState(navigator.onLine);
  const [loading, setLoading] = useState(true);
  const [storageReady, setStorageReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameTitle, setRenameTitle] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const mounted = useRef(true);
  const actionLock = useRef(false);
  const viewer = useRef<HTMLElement>(null);
  const frameToken = useRef(0);

  const refresh = useCallback(async () => {
    const snapshot = await getDesignSnapshot();
    if (mounted.current) { setBookmarks(snapshot.bookmarks); setStorageReady(true); }
  }, []);

  useEffect(() => {
    mounted.current = true;
    let disposed = false;
    void refresh().catch((reason) => {
      if (!disposed) { setStorageReady(false); setError(`Saved boards are unavailable. ${errorText(reason)}`); }
    }).finally(() => { if (!disposed) setLoading(false); });
    const updateOnline = () => {
      setOnline(navigator.onLine);
      if (!navigator.onLine) { frameToken.current++; setFrameEnabled(false); setFrameState('offline'); }
      else setFrameState((previous) => previous === 'offline' ? 'unconfirmed' : previous);
    };
    const fullscreenChange = () => setFullscreen(document.fullscreenElement === viewer.current && viewer.current !== null);
    window.addEventListener('online', updateOnline);
    window.addEventListener('offline', updateOnline);
    document.addEventListener('fullscreenchange', fullscreenChange);
    return () => {
      disposed = true; mounted.current = false; frameToken.current++;
      window.removeEventListener('online', updateOnline);
      window.removeEventListener('offline', updateOnline);
      document.removeEventListener('fullscreenchange', fullscreenChange);
      if (viewer.current && document.fullscreenElement === viewer.current) void document.exitFullscreen().catch(() => undefined);
    };
  }, [refresh]);

  useEffect(() => {
    if (!frameEnabled || frameState !== 'loading') return;
    const token = frameToken.current;
    const timeout = setTimeout(() => {
      if (mounted.current && token === frameToken.current) setFrameState('unconfirmed');
    }, 12000);
    return () => clearTimeout(timeout);
  }, [frameEnabled, frameState, frameVersion]);

  const open = (input = url) => {
    try {
      const parsed = parseFigmaUrl(input);
      frameToken.current++; setFrameVersion(frameToken.current);
      setActive(parsed); setUrl(parsed.sourceUrl); setError(''); setNotice('');
      setFrameEnabled(navigator.onLine); setFrameState(navigator.onLine ? 'loading' : 'offline');
    } catch (reason) { setError(errorText(reason)); }
  };

  const unload = () => {
    frameToken.current++; setFrameEnabled(false); setFrameState('idle'); setActive(null); setExpanded(false);
    if (document.fullscreenElement === viewer.current) void document.exitFullscreen().catch(() => undefined);
  };

  const mutate = async (operation: () => Promise<void>) => {
    if (actionLock.current) return;
    actionLock.current = true; setBusy(true); setError(''); setNotice('');
    try { await operation(); await refresh(); }
    catch (reason) { if (mounted.current) setError(errorText(reason)); }
    finally { actionLock.current = false; if (mounted.current) setBusy(false); }
  };

  const saveBookmark = () => void mutate(async () => {
    const parsed = parseFigmaUrl(url);
    await createDesignBookmark(title.trim() || defaultTitle(parsed), parsed.sourceUrl);
    if (mounted.current) { setTitle(''); setNotice('Board bookmark saved locally. Saving does not load Figma.'); }
  });

  const rename = (bookmark: FigmaBookmark) => void mutate(async () => {
    await renameDesignBookmark(bookmark.id, renameTitle, bookmark.revision);
    if (mounted.current) { setRenaming(null); setNotice('Bookmark renamed.'); }
  });

  const remove = (bookmark: FigmaBookmark) => {
    if (!window.confirm(`Delete the “${bookmark.title}” bookmark? The Figma file itself is not changed.`)) return;
    void mutate(async () => {
      await deleteDesignBookmark(bookmark.id, bookmark.revision);
      if (mounted.current) { if (renaming === bookmark.id) setRenaming(null); setNotice('Bookmark deleted.'); }
    });
  };

  const copyLink = async () => {
    if (!active) return;
    try { await navigator.clipboard.writeText(active.sourceUrl); setNotice('Figma link copied.'); }
    catch { setError('Clipboard access is unavailable. Select and copy the URL above instead.'); }
  };

  const toggleFullscreen = async () => {
    if (document.fullscreenElement === viewer.current) { await document.exitFullscreen().catch(() => undefined); return; }
    if (expanded) { setExpanded(false); return; }
    if (viewer.current?.requestFullscreen) {
      try { await viewer.current.requestFullscreen(); return; }
      catch { /* An in-app expanded view remains available when the host denies fullscreen. */ }
    }
    if (mounted.current) setExpanded(true);
  };

  const fullscreenKey = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape' && expanded) { event.preventDefault(); setExpanded(false); }
    if (!(expanded || fullscreen) || event.key !== 'Tab') return;
    const controls = [...(viewer.current?.querySelectorAll<HTMLElement>('button:not(:disabled),iframe') ?? [])].filter((element) => element.getClientRects().length > 0);
    const first = controls[0], last = controls.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  };

  const frameStatus = frameState === 'loading' ? 'Opening Figma frame…' : frameState === 'opened' ? 'Frame opened · access is controlled by Figma' : frameState === 'unconfirmed' ? 'Preview could not be confirmed' : frameState === 'offline' ? 'Offline · live viewer paused' : frameState === 'failed' ? 'Figma frame could not be opened' : 'Choose a board when you’re ready';
  const activeToken = frameVersion;

  return (
    <div className="design-figma">
      <div className="design-network-note"><Globe2 size={16} /><div><strong>Figma is an optional online viewer.</strong><p>Opening a board contacts Figma and requires its sharing permissions. Bookmarks and scratchpad drawings are saved on this device; they are not sent to Figma.</p></div></div>
      {error && <div className="design-feedback design-error" role="alert"><span>{error}</span><button className="icon-button" aria-label="Dismiss board error" onClick={() => setError('')}><X size={14} /></button></div>}
      {notice && <div className="design-feedback" role="status"><Check size={14} /><span>{notice}</span><button className="icon-button" aria-label="Dismiss board notification" onClick={() => setNotice('')}><X size={14} /></button></div>}
      <form className="design-url-form" onSubmit={(event) => { event.preventDefault(); open(); }}>
        <label className="design-url-field"><span>Public or shared Figma link</span><input type="url" aria-label="Figma board URL" value={url} maxLength={4096} placeholder="https://www.figma.com/design/…" required onChange={(event) => setUrl(event.target.value)} /></label>
        <button className="primary-button" type="submit"><Play size={13} />Open live board</button>
        <label className="design-title-field"><span>Bookmark title <small>optional</small></span><input aria-label="Board title" value={title} maxLength={100} placeholder="A name to come back to" onChange={(event) => setTitle(event.target.value)} /></label>
        <button className="secondary-button" type="button" disabled={busy || !storageReady || !url.trim()} onClick={saveBookmark}><Bookmark size={13} />Save board bookmark</button>
      </form>
      <div className="design-board-layout">
        <aside className="design-bookmarks" aria-label="Saved Figma boards"><div className="design-bookmark-heading"><span>SAVED BOARDS <b>{bookmarks.length}</b></span><button className="icon-button" aria-label="Refresh saved boards" disabled={busy} onClick={() => void mutate(async () => undefined)}><RefreshCw size={13} /></button></div>
          {loading ? <p className="design-list-empty" role="status">Opening bookmarks…</p> : !bookmarks.length ? <div className="design-list-empty"><Bookmark size={23} strokeWidth={1.3} /><p>A useful reference, kept close.<br />Save a board link to find it here.</p></div> : <div className="design-bookmark-list">{bookmarks.map((bookmark) => <article className="design-bookmark" key={bookmark.id}>
            {renaming === bookmark.id ? <form className="design-rename-form" onSubmit={(event) => { event.preventDefault(); rename(bookmark); }}><input aria-label={`Rename bookmark ${bookmark.title}`} value={renameTitle} maxLength={100} onChange={(event) => setRenameTitle(event.target.value)} disabled={busy} autoFocus /><div><button type="submit" disabled={busy || !renameTitle.trim()}>Save</button><button type="button" disabled={busy} onClick={() => setRenaming(null)}>Cancel</button></div></form> : <><button className="design-bookmark-open" aria-label={`Open board ${bookmark.title}`} onClick={() => open(bookmark.url)}><Figma size={15} /><span><strong>{bookmark.title}</strong><small>{new URL(bookmark.url).pathname.split('/')[1] || 'board'} · Figma</small></span></button><div className="design-bookmark-actions"><button className="icon-button" aria-label={`Rename bookmark ${bookmark.title}`} disabled={busy} onClick={() => { setRenaming(bookmark.id); setRenameTitle(bookmark.title); }}><Pencil size={12} /></button><button className="icon-button" aria-label={`Delete bookmark ${bookmark.title}`} disabled={busy} onClick={() => remove(bookmark)}><Trash2 size={12} /></button></div></>}
          </article>)}</div>}
          {!loading && !storageReady && <p className="design-bookmark-note">Saved boards cannot be read. They have not been reset. Refresh saved boards to retry; the live viewer remains available.</p>}
          <p className="design-bookmark-note">Saved links do not open automatically. Clearing browser data removes bookmarks.</p>
        </aside>
        <section ref={viewer} className={`design-viewer ${expanded ? 'design-viewer-expanded' : ''}`} aria-label="Figma board preview" role={expanded ? 'dialog' : undefined} aria-modal={expanded || undefined} onKeyDown={fullscreenKey}>
          <div className="design-viewer-toolbar"><div><Figma size={15} /><span>{active ? defaultTitle(active) : 'YOUR LIVE BOARD'}</span></div><div><button className="icon-button" aria-label="Reload Figma board" disabled={!active} onClick={() => active && open(active.sourceUrl)}><RefreshCw size={14} /></button><button className="icon-button" aria-label="Copy Figma link" disabled={!active} onClick={() => void copyLink()}><Copy size={14} /></button><button className="icon-button" aria-label={expanded || fullscreen ? 'Exit full screen' : 'Toggle full screen'} aria-pressed={expanded || fullscreen} disabled={!active} onClick={() => void toggleFullscreen()}>{expanded || fullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}</button><button className="icon-button" aria-label="Unload Figma board" disabled={!active} onClick={unload}><X size={15} /></button></div></div>
          <div className="design-frame-status" role="status">{frameState === 'offline' ? <WifiOff size={12} /> : <span className="status-dot" />}<span>{frameStatus}</span></div>
          <div className="design-frame-container">{active && frameEnabled && online ? <iframe key={frameVersion} title="Figma live viewer" src={active.embedUrl} sandbox="allow-scripts allow-same-origin allow-popups" referrerPolicy="no-referrer" allow="fullscreen" allowFullScreen onLoad={() => { if (activeToken === frameToken.current) setFrameState('opened'); }} onError={() => { if (activeToken === frameToken.current) setFrameState('failed'); }} /> : <div className="design-viewer-empty"><Figma size={40} strokeWidth={1.2} /><h3>{active ? 'Your board needs a connection.' : 'Bring a useful reference into view.'}</h3><p>{active ? 'The live frame is paused. Reconnect, then retry. Your saved links and offline scratchpad remain available.' : 'Paste a shared Figma link and choose Open live board. The app will not contact Figma until you open a board.'}</p>{active && <button className="secondary-button" disabled={!online} onClick={() => open(active.sourceUrl)}><RefreshCw size={13} />Retry Figma board</button>}</div>}</div>
          <div className="design-frame-help"><Info size={13} /><p>Figma content is cross-origin, so this app cannot verify whether a board is visible. If the frame is blank, blocked, or asks for access, check its sharing settings and your network, then reload. No Figma API token is required here.</p></div>
        </section>
      </div>
    </div>
  );
}
