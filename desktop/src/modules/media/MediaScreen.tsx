import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { AudioLines, Check, ChevronRight, Download, FileAudio, Film, FolderOpen, Grid2X2, Heart, Info, List, LoaderCircle, Music2, Play, Search, Trash2, Upload, X } from 'lucide-react';
import {
  cancelMediaDownload, enqueueMediaDownload, getDownloadJobs, getMediaLibrary,
  getMediaPlaybackSource, importMediaFiles, removeMediaItem, runDownloadDemo,
  setMediaFavorite,
  subscribeMediaChanges,
} from '../../lib/ipc';
import type { DownloadJob, MediaItem, MediaKind, MediaLibrary } from '../../lib/ipc';
import './media.css';

type Filter = 'all' | 'audio' | 'video' | 'favorites';

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') return error.message;
  return 'This action couldn’t finish. Please try again.';
}

function duration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return 'Unknown';
  const value = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor(value / 60) % 60;
  const secs = String(value % 60).padStart(2, '0');
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${secs}` : `${minutes}:${secs}`;
}

function fileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '—';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function Artwork({ item, small = false }: { item: MediaItem; small?: boolean }) {
  return (
    <div className={`media-artwork ${small ? 'media-artwork-small' : ''}`} data-kind={item.kind} aria-hidden="true">
      <div className="media-art-ring" />
      {item.kind === 'audio' ? <AudioLines size={small ? 21 : 40} strokeWidth={1.15} /> : <Film size={small ? 21 : 40} strokeWidth={1.15} />}
      {!small && <span className="media-art-word">{item.kind === 'audio' ? 'LISTEN CLOSELY' : 'A MOMENT IN MOTION'}</span>}
    </div>
  );
}

function PlayerPanel({ item, playToken, close, busy, favorite, remove }: {
  item: MediaItem;
  playToken: number;
  close: () => void;
  busy: boolean;
  favorite: () => void;
  remove: () => void;
}) {
  const [source, setSource] = useState('');
  const [error, setError] = useState('');
  const [playing, setPlaying] = useState(false);
  const playerRef = useRef<HTMLMediaElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    getMediaPlaybackSource(item.id).then((url) => {
      if (!cancelled) setSource(url);
    }).catch((reason: unknown) => {
      if (!cancelled) setError(errorMessage(reason));
    });
    return () => { cancelled = true; };
  }, [item.id]);

  useEffect(() => {
    if (!source || playToken === 0 || !playerRef.current) return;
    let cancelled = false;
    playerRef.current.play().catch(() => {
      if (!cancelled) setError('Playback could not start. Try the player controls; this format may not be supported by your browser.');
    });
    return () => { cancelled = true; };
  }, [source, playToken]);

  useEffect(() => {
    const player = playerRef.current;
    return () => {
      if (!player) return;
      player.pause();
      player.removeAttribute('src');
      player.load();
    };
  }, [source]);

  const playerEvents = {
    onPlay: () => { setPlaying(true); setError(''); },
    onPause: () => setPlaying(false),
    onEnded: () => setPlaying(false),
    onError: () => { setPlaying(false); setError('This file could not be played. Your browser may not support its codec, or the file may be damaged.'); },
  };

  return (
    <section id="media-inspector" className="media-inspector" aria-labelledby="media-now-playing">
      <div className="media-panel-heading"><span className="media-overline">{playing ? 'NOW PLAYING' : 'READY TO PLAY'}</span><button className="icon-button" onClick={close} aria-label="Close media details"><X size={16} /></button></div>
      {item.kind === 'audio' && <Artwork item={item} />}
      {item.kind === 'video' && !source && <Artwork item={item} />}
      {source && (item.kind === 'audio'
        ? <audio ref={(element) => { playerRef.current = element; }} src={source} controls preload="metadata" aria-label={`Audio player for ${item.title}`} {...playerEvents} />
        : <video ref={(element) => { playerRef.current = element; }} src={source} controls preload="metadata" playsInline aria-label={`Video player for ${item.title}`} {...playerEvents} />)}
      <div className="media-track-heading"><h2 id="media-now-playing">{item.title}</h2><p>{item.creator}</p></div>
      {!source && !error && <p className="media-player-status" role="status">Preparing playback…</p>}
      {error && <p className="media-inline-error" role="alert">{error}</p>}
      <div className="media-detail-actions"><button className={`media-subtle-button ${item.favorite ? 'media-is-favorite' : ''}`} aria-pressed={item.favorite} disabled={busy} onClick={favorite}><Heart size={14} fill={item.favorite ? 'currentColor' : 'none'} />{item.favorite ? 'Favorited' : 'Add to favorites'}</button></div>
      <dl className="media-metadata">
        <div><dt>Type</dt><dd>{item.kind === 'audio' ? 'Audio' : 'Video'}</dd></div>
        <div><dt>Duration</dt><dd>{duration(item.durationSeconds)}</dd></div>
        <div><dt>File size</dt><dd>{fileSize(item.sizeBytes)}</dd></div>
        <div><dt>Format</dt><dd>{item.mimeType || 'Unknown'}</dd></div>
        {item.width !== undefined && item.height !== undefined && <div><dt>Dimensions</dt><dd>{item.width} × {item.height}</dd></div>}
        <div><dt>Source</dt><dd>{item.source === 'demo' ? 'Bundled demo' : 'Local file'}</dd></div>
      </dl>
      <p className="media-detail-note">{item.source === 'demo' ? 'A small bundled sample for exploring playback. No streaming service is used.' : 'This file stays on your device. Re-import it after reloading this preview.'}</p>
      <button className="media-remove-button" onClick={remove} disabled={busy}><Trash2 size={13} /> Remove from library</button>
      <p className="media-remove-note">Your original file is never deleted.</p>
    </section>
  );
}

export default function MediaScreen() {
  const [library, setLibrary] = useState<MediaLibrary | null>(null);
  const [jobs, setJobs] = useState<DownloadJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [sort, setSort] = useState<'recent' | 'title'>('recent');
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [playRequest, setPlayRequest] = useState({ itemId: '', token: 0 });
  const [downloadUrl, setDownloadUrl] = useState('');
  const [downloadKind, setDownloadKind] = useState<MediaKind>('audio');
  const inputRef = useRef<HTMLInputElement>(null);
  const mountedRef = useRef(true);
  const operationRef = useRef(false);

  const refresh = useCallback(async () => {
    const [nextLibrary, nextJobs] = await Promise.all([getMediaLibrary(), getDownloadJobs()]);
    if (!mountedRef.current) return;
    setLibrary(nextLibrary);
    setJobs(nextJobs);
  }, []);

  useEffect(() => {
    let stopped = false;
    let unsubscribe = () => {};
    mountedRef.current = true;
    const update = () => {
      if (stopped) return;
      void refresh().catch((reason: unknown) => {
        if (!stopped) setError(errorMessage(reason));
      }).finally(() => {
        if (!stopped) setLoading(false);
      });
    };
    // Subscribe before taking the initial snapshot so an in-flight import cannot be missed.
    subscribeMediaChanges(update).then((unlisten) => {
      if (stopped) { unlisten(); return; }
      unsubscribe = unlisten;
      update();
    }).catch((reason: unknown) => {
      if (!stopped) { setError(errorMessage(reason)); setLoading(false); }
    });
    return () => { stopped = true; mountedRef.current = false; unsubscribe(); };
  }, [refresh]);

  const act = async (key: string, operation: () => Promise<void>) => {
    if (operationRef.current) return;
    operationRef.current = true;
    setBusy(key);
    setError('');
    setNotice('');
    try { await operation(); }
    catch (reason) { if (mountedRef.current) setError(errorMessage(reason)); }
    finally {
      operationRef.current = false;
      if (mountedRef.current) setBusy(null);
    }
  };

  const importFiles = async (files: File[]) => {
    if (!files.length) return;
    await act('import', async () => {
      const result = await importMediaFiles(files);
      await refresh();
      if (!mountedRef.current) return;
      setNotice(`${result.items.length} ${result.items.length === 1 ? 'file' : 'files'} imported.${result.skipped.length ? ` ${result.skipped.join(' ')}` : ''}`);
      if (result.items.length) { setSelectedId(result.items[0].id); setPlayRequest({ itemId: '', token: 0 }); }
    });
  };

  const favorite = (item: MediaItem) => void act(`favorite-${item.id}`, async () => {
    await setMediaFavorite(item.id, !item.favorite);
    await refresh();
  });

  const remove = (item: MediaItem) => void act(`remove-${item.id}`, async () => {
    if (selectedId === item.id) setSelectedId(null);
    await removeMediaItem(item.id);
    await refresh();
    if (mountedRef.current) setNotice(`“${item.title}” removed from the library. Your original file was not deleted.`);
  });

  const open = (item: MediaItem, play = false) => {
    setSelectedId(item.id);
    setPlayRequest((previous) => ({ itemId: item.id, token: play ? previous.token + 1 : 0 }));
  };

  const enqueue = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void act('enqueue', async () => {
      await enqueueMediaDownload(downloadUrl, downloadKind);
      await refresh();
      if (mountedRef.current) { setDownloadUrl(''); setNotice('Demo queued. Run it below to add a bundled sample; no website will be contacted.'); }
    });
  };

  const selected = library?.items.find((item) => item.id === selectedId);
  const items = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return (library?.items ?? []).filter((item) =>
      (filter === 'all' || filter === 'favorites' ? filter !== 'favorites' || item.favorite : item.kind === filter)
      && (!query || `${item.title} ${item.creator} ${item.mimeType}`.toLocaleLowerCase().includes(query)),
    ).sort((a, b) => sort === 'title' ? a.title.localeCompare(b.title) : b.addedAt.localeCompare(a.addedAt));
  }, [library, search, filter, sort]);

  const canImport = library?.importSupport === 'browser-files';
  const canDownload = library?.downloadSupport === 'simulation';

  return (
    <div className="page media-page">
      <div className="media-heading-row"><div className="page-heading"><div className="eyebrow"><span className="tiny-line" /> YOUR TOOLKIT / MEDIA ENGINE</div><h1>Media library</h1><p>Keep what you love. Play it on your own terms.</p></div><button className="primary-button media-import-button" disabled={!canImport || busy !== null} onClick={() => inputRef.current?.click()}>{busy === 'import' ? <LoaderCircle size={15} /> : <Upload size={15} />}{busy === 'import' ? 'Reading files…' : 'Import files'}</button></div>
      <input ref={inputRef} className="media-file-input" type="file" aria-label="Import local media files" accept="audio/*,video/*,.wav,.mp3,.ogg,.flac,.m4a,.aac,.mp4,.webm,.mov,.mkv,.opus" multiple onChange={(event) => { const files = Array.from(event.target.files ?? []); event.target.value = ''; void importFiles(files); }} />

      <div className="media-session-banner"><Info size={15} /><div><strong>{library?.mode === 'desktop' ? 'Native media integration is planned' : 'Browser preview · session library'}</strong><p>{library?.notice ?? 'Preparing your local media preview…'}</p></div><span className="media-session-tag">NO UPLOADS</span></div>
      {error && <div className="media-feedback media-feedback-error" role="alert"><span>{error}</span><button className="icon-button" aria-label="Dismiss error" onClick={() => setError('')}><X size={14} /></button></div>}
      {notice && <div className="media-feedback" role="status"><Check size={14} /><span>{notice}</span><button className="icon-button" aria-label="Dismiss notification" onClick={() => setNotice('')}><X size={14} /></button></div>}

      <div className="media-toolbar"><div className="media-filters" role="group" aria-label="Filter library">{(['all', 'audio', 'video', 'favorites'] as const).map((value) => <button key={value} aria-pressed={filter === value} className={filter === value ? 'media-filter-active' : ''} onClick={() => setFilter(value)}>{value === 'all' ? 'All media' : value === 'favorites' ? <><Heart size={12} />Favorites</> : value === 'audio' ? 'Audio' : 'Video'}</button>)}</div><span className="media-item-count">{library ? `${library.items.length} items` : 'Loading…'}</span></div>
      <div className="media-search-row"><label className="media-search"><Search size={15} /><input aria-label="Search your library" placeholder="Search your library" value={search} onChange={(event) => setSearch(event.target.value)} />{search && <button className="icon-button" onClick={() => setSearch('')} aria-label="Clear search"><X size={13} /></button>}</label><label className="media-sort-label"><span>Sort</span><select aria-label="Sort media" value={sort} onChange={(event) => setSort(event.target.value as 'recent' | 'title')}><option value="recent">Recently added</option><option value="title">Title A–Z</option></select></label><div className="media-view-switch" role="group" aria-label="Library layout"><button aria-label="Grid view" aria-pressed={view === 'grid'} onClick={() => setView('grid')}><Grid2X2 size={15} /></button><button aria-label="List view" aria-pressed={view === 'list'} onClick={() => setView('list')}><List size={16} /></button></div></div>

      <div className="media-content-grid">
        <section className="media-library" aria-label="Media items" aria-busy={loading}>
          {loading ? <div className="media-empty" role="status"><LoaderCircle size={27} /><h2>Opening your library…</h2></div> : items.length === 0 ? <div className="media-empty"><FolderOpen size={32} strokeWidth={1.3} /><h2>{search || filter !== 'all' ? 'No matches here yet.' : 'Make this space your own.'}</h2><p>{search || filter !== 'all' ? 'Try another search or filter to find your media.' : 'Import an audio or video file to start your session library.'}</p>{(search || filter !== 'all') && <button className="media-subtle-button" onClick={() => { setSearch(''); setFilter('all'); }}>Show all media <ChevronRight size={13} /></button>}</div> : <div className={`media-items media-items-${view}`}>{items.map((item) => <article className={`media-card ${selectedId === item.id ? 'media-card-selected' : ''}`} key={item.id}><button className="media-card-select" aria-label={`Open ${item.title}`} onClick={() => open(item)}><Artwork item={item} small={view === 'list'} /><div className="media-card-copy"><span className="media-card-kind">{item.kind === 'audio' ? <FileAudio size={10} /> : <Film size={10} />}{item.kind.toUpperCase()}</span><h2>{item.title}</h2><p>{item.creator}</p></div></button><div className="media-card-bottom"><span className="media-source-tag">{item.source === 'demo' ? 'Demo' : 'Local file'}</span><span className="media-duration">{duration(item.durationSeconds)}</span><button className={`icon-button media-card-favorite ${item.favorite ? 'media-is-favorite' : ''}`} aria-label={`${item.favorite ? 'Unfavorite' : 'Favorite'} ${item.title}`} aria-pressed={item.favorite} disabled={busy !== null} onClick={() => favorite(item)}><Heart size={14} fill={item.favorite ? 'currentColor' : 'none'} /></button><button className="media-play-button" aria-label={`Play ${item.title}`} onClick={() => open(item, true)}><Play size={12} fill="currentColor" /></button></div></article>)}</div>}
          {!loading && library && <p className="media-library-note">{items.length} of {library.items.length} items · Demo labels identify bundled samples. Imported files stay in this session.</p>}
        </section>

        {selected ? <PlayerPanel key={selected.id} item={selected} playToken={playRequest.itemId === selected.id ? playRequest.token : 0} close={() => setSelectedId(null)} busy={busy !== null} favorite={() => favorite(selected)} remove={() => remove(selected)} /> : <aside className="media-inspector media-inspector-empty"><div className="media-empty-player-icon"><Music2 size={32} strokeWidth={1.2} /></div><span className="media-overline">A LITTLE MORE LISTENING</span><h2>Something worth replaying.</h2><p>Choose a track or video to play it, see its details, or add it to your favorites.</p><div className="media-inspector-rule" /><span className="media-small-note"><AudioLines size={14} /> Playback begins only when you choose.</span></aside>}
      </div>

      <section className="media-download-panel" aria-labelledby="media-download-title"><div className="media-download-heading"><div className="media-download-icon"><Download size={19} strokeWidth={1.5} /></div><div><h2 id="media-download-title">Download queue</h2><p>Try the workflow with a local demo.</p></div><span className="pill neutral-pill">SIMULATION ONLY</span></div><p className="media-download-explanation">URLs aren’t fetched in this preview. Running a demo adds a bundled sample to your session library; it does not download the requested media.</p><form className="media-download-form" onSubmit={enqueue}><label><span>Media URL</span><input aria-label="Media URL" type="url" placeholder="https://example.com/media" value={downloadUrl} onChange={(event) => setDownloadUrl(event.target.value)} required disabled={!canDownload || busy !== null} /></label><label className="media-download-kind"><span>Save as</span><select aria-label="Download media type" value={downloadKind} onChange={(event) => setDownloadKind(event.target.value as MediaKind)} disabled={!canDownload || busy !== null}><option value="audio">Audio</option><option value="video">Video</option></select></label><button className="secondary-button" type="submit" disabled={!canDownload || busy !== null}><Download size={13} /> Queue demo</button></form>{!canDownload && !loading && <p className="media-small-note">Native downloading will be connected in a later desktop implementation.</p>}
        <div className="media-jobs" aria-live="polite">{jobs.length === 0 ? <div className="media-queue-empty"><span className="media-queue-dot" />Nothing in the queue. Your connection can take a break.</div> : jobs.map((job) => <article className="media-job" key={job.id}><div className="media-job-icon">{job.kind === 'audio' ? <FileAudio size={18} /> : <Film size={18} />}</div><div className="media-job-copy"><h3>{job.title}</h3><p>{job.url}</p><span className={`media-job-status media-job-${job.status}`}>{job.status === 'completed' ? 'Complete' : job.status === 'cancelled' ? 'Cancelled' : 'Queued'} · {job.simulated ? 'demo' : 'native'}</span></div><div className="media-job-actions">{job.status === 'queued' ? <><button className="media-subtle-button" disabled={busy !== null} onClick={() => void act(`run-${job.id}`, async () => { await runDownloadDemo(job.id); await refresh(); if (mountedRef.current) setNotice('Demo complete. A bundled sample was added; the URL was not downloaded.'); })}><Play size={12} /> Run demo</button><button className="icon-button" aria-label={`Cancel ${job.title}`} disabled={busy !== null} onClick={() => void act(`cancel-${job.id}`, async () => { await cancelMediaDownload(job.id); await refresh(); })}><X size={15} /></button></> : job.status === 'completed' && job.itemId && library?.items.some((item) => item.id === job.itemId) ? <button className="media-subtle-button" onClick={() => { const item = library?.items.find((entry) => entry.id === job.itemId); if (item) open(item); }}>Open sample <ChevronRight size={13} /></button> : null}</div></article>)}</div>
      </section>
      <p className="page-footnote">{library?.mode === 'desktop' ? 'Native media services are planned. No worker is running.' : 'Your files stay with you. The preview runs without a native desktop process.'}</p>
    </div>
  );
}
