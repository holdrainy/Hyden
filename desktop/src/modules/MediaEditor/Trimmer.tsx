import { useEffect, useRef, useState } from 'react';
import { AudioLines, Check, Copy, FileCode2, Film, FolderOpen, Info, Play, Scissors, Square, Upload } from 'lucide-react';
import { getEditorCapabilities, getTrimPlan, runNativeTrim } from '../../lib/ipc';
import type { EditorCapabilities, EditorTrimRequest, FFmpegPlan } from '../../lib/editor-types';
import './trimmer.css';

interface TrimAsset { id: string; name: string; kind: 'audio' | 'video'; url: string; duration: number; size: number }

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : error && typeof error === 'object' && 'message' in error ? String(error.message) : 'This action could not finish.';
}

function mediaKind(file: File): 'audio' | 'video' | null {
  if (file.type.startsWith('audio/')) return 'audio';
  if (file.type.startsWith('video/')) return 'video';
  if (file.type && file.type !== 'application/octet-stream') return null;
  if (/\.(mp3|wav|ogg|oga|flac|m4a|aac|opus)$/i.test(file.name)) return 'audio';
  if (/\.(mp4|m4v|webm|mov|mkv|ogv)$/i.test(file.name)) return 'video';
  return null;
}

function probe(url: string, kind: 'audio' | 'video', signal: AbortSignal): Promise<number> {
  return new Promise((resolve, reject) => {
    const element = document.createElement(kind);
    element.preload = 'metadata';
    let finished = false;
    const finish = (error?: Error) => {
      if (finished) return;
      finished = true;
      const value = element.duration;
      clearTimeout(timer);
      signal.removeEventListener('abort', aborted);
      element.onloadedmetadata = null; element.onerror = null;
      element.pause(); element.removeAttribute('src'); element.load();
      if (error) reject(error);
      else if (!Number.isFinite(value) || value <= 0 || value > 86400) reject(new Error('Choose media with a known duration of up to 24 hours.'));
      else resolve(value);
    };
    const aborted = () => finish(new Error('File selection changed.'));
    const timer = setTimeout(() => finish(new Error('Metadata could not be read within 8 seconds.')), 8000);
    signal.addEventListener('abort', aborted, { once: true });
    if (signal.aborted) { aborted(); return; }
    element.onloadedmetadata = () => finish();
    element.onerror = () => finish(new Error('This file is damaged or uses a codec unsupported by the browser.'));
    element.src = url;
  });
}

function clock(seconds: number): string {
  const ticks = Math.round(Math.max(0, Number.isFinite(seconds) ? seconds : 0) * 100);
  const hours = Math.floor(ticks / 360000);
  const minutes = Math.floor(ticks / 6000) % 60;
  const rest = ((ticks % 6000) / 100).toFixed(2).padStart(5, '0');
  return `${hours ? `${hours}:` : ''}${hours ? String(minutes).padStart(2, '0') : minutes}:${rest}`;
}

export default function Trimmer() {
  const [asset, setAsset] = useState<TrimAsset | null>(null);
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(0);
  const [audioOnly, setAudioOnly] = useState(false);
  const [loading, setLoading] = useState(false);
  const [planning, setPlanning] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [plan, setPlan] = useState<FFmpegPlan | null>(null);
  const [capabilities, setCapabilities] = useState<EditorCapabilities | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const player = useRef<HTMLMediaElement | null>(null);
  const mounted = useRef(true);
  const loadId = useRef(0);
  const planId = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const ownedUrls = useRef(new Set<string>());

  const release = (url: string) => { if (ownedUrls.current.delete(url)) URL.revokeObjectURL(url); };

  useEffect(() => {
    mounted.current = true;
    let stopped = false;
    void getEditorCapabilities().then((value) => { if (!stopped) setCapabilities(value); }).catch((reason) => { if (!stopped) setError(errorText(reason)); });
    return () => {
      stopped = true; mounted.current = false; loadId.current++; planId.current++;
      controller.current?.abort();
      const activePlayer = player.current;
      activePlayer?.pause(); activePlayer?.removeAttribute('src'); activePlayer?.load();
      for (const url of [...ownedUrls.current]) release(url);
    };
  }, []);

  useEffect(() => {
    if (!asset) return;
    const element = player.current;
    return () => { element?.pause(); element?.removeAttribute('src'); element?.load(); release(asset.url); };
  }, [asset?.id]);

  const invalidatePlan = () => { planId.current++; setPlan(null); setPlanning(false); setNotice(''); };
  const selectFile = async (file: File | undefined) => {
    if (!file) return;
    const id = ++loadId.current;
    controller.current?.abort();
    const nextController = new AbortController(); controller.current = nextController;
    setLoading(true); setError(''); invalidatePlan();
    let url: string | undefined;
    try {
      const kind = mediaKind(file);
      if (!kind) throw new Error('Choose an audio or video file.');
      if (!file.size || file.size > 512 * 1024 * 1024) throw new Error('Choose a non-empty file up to 512 MiB for this preview.');
      url = URL.createObjectURL(file); ownedUrls.current.add(url);
      const duration = await probe(url, kind, nextController.signal);
      if (!mounted.current || id !== loadId.current) { release(url); return; }
      setAsset({ id: crypto.randomUUID(), name: file.name, kind, url, duration, size: file.size });
      setStart(0); setEnd(duration); setAudioOnly(kind === 'audio'); setPlaying(false);
    } catch (reason) {
      if (url) release(url);
      if (mounted.current && id === loadId.current && !nextController.signal.aborted) setError(errorText(reason));
    } finally { if (mounted.current && id === loadId.current) setLoading(false); }
  };

  const validRange = Boolean(asset && Number.isFinite(start) && Number.isFinite(end) && start >= 0 && end <= asset.duration && end - start + 1e-9 >= 0.05);
  const changeRange = (position: 'start' | 'end', value: number) => { if (position === 'start') setStart(value); else setEnd(value); invalidatePlan(); setError(''); };
  const request = (): EditorTrimRequest => ({ inputName: asset!.name, inputKind: asset!.kind, durationSeconds: asset!.duration, startSeconds: start, endSeconds: end, audioOnly });

  const generate = async () => {
    if (!asset || !validRange || planning) return;
    const id = ++planId.current;
    setPlanning(true); setError(''); setNotice('');
    try { const next = await getTrimPlan(request()); if (mounted.current && id === planId.current) { setPlan(next); setNotice('Command plan ready. No media file was produced.'); } }
    catch (reason) { if (mounted.current && id === planId.current) setError(errorText(reason)); }
    finally { if (mounted.current && id === planId.current) setPlanning(false); }
  };

  const preview = async () => {
    if (!player.current || !validRange) return;
    setError('');
    player.current.currentTime = start;
    try { await player.current.play(); }
    catch { setError('Playback could not start. Try the media controls or choose a file supported by this browser.'); }
  };

  const mediaEvents = {
    onPlay: () => setPlaying(true), onPause: () => setPlaying(false), onEnded: () => setPlaying(false),
    onTimeUpdate: () => { if (player.current && player.current.currentTime >= end) player.current.pause(); },
    onError: () => { setPlaying(false); setError('The preview could not play this file. Its codec may not be supported.'); },
  };

  return (
    <div className="me-trimmer">
      <input ref={fileInput} type="file" className="me-hidden-file" aria-label="Import trim media" accept="audio/*,video/*,.wav,.mp3,.m4a,.aac,.flac,.ogg,.opus,.mp4,.webm,.mov,.mkv" onChange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; void selectFile(file); }} />
      <div className="me-trim-intro"><div className="me-tool-icon"><Scissors size={21} strokeWidth={1.5} /></div><div><h2>Keep the part that matters.</h2><p>Preview a local file and prepare a precise FFmpeg trim.</p></div><button className="secondary-button" disabled={loading || planning} onClick={() => fileInput.current?.click()}><Upload size={13} />{loading ? 'Reading media…' : asset ? 'Replace media' : 'Choose media'}</button></div>
      <div className="me-trim-banner"><Info size={15} /><p>Preview playback is local. Trimming and MP3 extraction generate a command plan; they do not transcode files in this browser.</p></div>
      {error && <p className="me-trim-message me-trim-error" role="alert">{error}</p>}
      {notice && <p className="me-trim-message" role="status"><Check size={13} />{notice}</p>}
      {asset ? <div className="me-trim-layout"><section className="me-media-preview" aria-label="Selected trim media"><div className="me-preview-title">{asset.kind === 'video' ? <Film size={14} /> : <AudioLines size={14} />}<span>{asset.name}</span><small>{(asset.size / (1024 * 1024)).toFixed(2)} MiB</small></div>{asset.kind === 'video' ? <video key={asset.id} ref={(element) => { player.current = element; }} src={asset.url} controls playsInline preload="metadata" aria-label="Trimmer video preview" {...mediaEvents} /> : <div className="me-audio-preview"><AudioLines size={50} strokeWidth={1} /><audio key={asset.id} ref={(element) => { player.current = element; }} src={asset.url} controls preload="metadata" aria-label="Trimmer audio preview" {...mediaEvents} /></div>}<div className="me-preview-footer"><span>Duration <strong>{clock(asset.duration)}</strong></span><button className="me-quiet-button" disabled={!validRange || loading} onClick={() => { if (playing) player.current?.pause(); else void preview(); }}>{playing ? <><Square size={12} />Pause preview</> : <><Play size={12} />Preview selection</>}</button></div></section><section className="me-range-panel" aria-label="Trim selection"><div className="me-range-heading"><span>YOUR SELECTION</span><strong>{validRange ? `${(end - start).toFixed(2)} seconds` : 'Adjust the range'}</strong></div><label className="me-range-label"><span>Start <b>{clock(start)}</b></span><input type="range" aria-label="Trim start" min="0" max={asset.duration} step="0.01" value={start} disabled={loading || planning} onChange={(event) => changeRange('start', Number(event.target.value))} /></label><label className="me-range-label"><span>End <b>{clock(end)}</b></span><input type="range" aria-label="Trim end" min="0" max={asset.duration} step="0.01" value={end} disabled={loading || planning} onChange={(event) => changeRange('end', Number(event.target.value))} /></label><div className="me-time-fields"><label>Start seconds<input aria-label="Start seconds" type="number" min="0" max={asset.duration} step="0.01" value={start} disabled={loading || planning} onChange={(event) => changeRange('start', Number(event.target.value))} /></label><label>End seconds<input aria-label="End seconds" type="number" min="0" max={asset.duration} step="0.01" value={end} disabled={loading || planning} onChange={(event) => changeRange('end', Number(event.target.value))} /></label></div>{!validRange && <p className="me-range-warning">Keep at least 0.05 seconds, with start before end and both inside the media duration.</p>}<label className="me-audio-toggle"><input type="checkbox" aria-label="Extract audio as MP3" checked={audioOnly} disabled={asset.kind === 'audio' || planning || loading} onChange={(event) => { setAudioOnly(event.target.checked); invalidatePlan(); }} /><span>Extract audio only <strong>MP3</strong></span></label><p className="me-codec-note">{audioOnly ? 'MP3 audio uses libmp3lame. Audio input always produces audio only.' : 'Video is re-encoded as H.264 + AAC MP4 for accurate trim boundaries.'}</p><button className="primary-button" disabled={!validRange || planning || loading} onClick={() => void generate()}><FileCode2 size={14} />{planning ? 'Preparing plan…' : 'Generate FFmpeg plan'}</button></section></div> : <div className="me-trim-empty"><FolderOpen size={35} strokeWidth={1.1} /><h3>A little less footage.</h3><p>Choose a local audio or video file to inspect its duration and select the section to keep. Files stay untouched.</p><button className="primary-button" disabled={loading} onClick={() => fileInput.current?.click()}><Upload size={14} />Choose audio or video</button><span>Up to 512 MiB · Browser-supported codecs · Maximum 24 hours</span></div>}
      {plan && <section className="me-command-panel" aria-labelledby="me-command-title"><div className="me-command-heading"><div><h3 id="me-command-title">Your FFmpeg plan</h3><p>POSIX shell example · Native execution uses an argument array</p></div><button className="me-quiet-button" onClick={() => void navigator.clipboard.writeText(plan.displayCommand).then(() => setNotice('FFmpeg command copied. Review it before running it.')).catch(() => setError('Clipboard access is unavailable. Select and copy the command text instead.'))}><Copy size={13} />Copy FFmpeg command</button></div><pre aria-label="FFmpeg command"><code>{plan.displayCommand}</code></pre><div className="me-command-output"><span>Planned output</span><code>{plan.outputName}</code><span>No output file has been created.</span></div><p className="me-codec-note">{plan.notice}</p><button className="secondary-button" disabled={!capabilities?.ffmpegExecution} onClick={() => void runNativeTrim(request()).catch((reason) => setError(errorText(reason)))}>Run native FFmpeg</button><p className="me-native-note">{capabilities?.notice ?? 'Native execution is not connected. A trusted file-selection and output workflow must be added before commands can run.'}</p></section>}
    </div>
  );
}
