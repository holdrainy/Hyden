import type { DownloadJob, ImportResult, MediaItem, MediaKind, MediaLibrary } from './media-types.ts';

const AUDIO_SAMPLE = '/media/quiet-interval.wav';
const VIDEO_SAMPLE = '/media/color-study.webm';
const MAX_IMPORT_FILES = 20;
const MAX_FILE_BYTES = 512 * 1024 * 1024;
const MAX_ITEMS = 500;
const MAX_JOBS = 50;

interface ProbedMetadata {
  durationSeconds: number | null;
  width?: number;
  height?: number;
}

type MetadataProbe = (file: File, url: string, kind: MediaKind) => Promise<ProbedMetadata>;

export function inferMediaKind(file: Pick<File, 'name' | 'type'>): MediaKind | null {
  if (file.type.startsWith('audio/')) return 'audio';
  if (file.type.startsWith('video/')) return 'video';
  // Some OS file pickers omit MIME types. Unknown non-empty types aren't accepted.
  if (file.type && file.type !== 'application/octet-stream') return null;
  if (/\.(mp3|wav|ogg|oga|m4a|aac|flac|opus)$/i.test(file.name)) return 'audio';
  if (/\.(mp4|m4v|webm|ogv|mov|mkv)$/i.test(file.name)) return 'video';
  return null;
}

export function validateDownloadUrl(input: string): URL {
  let url: URL;
  try { url = new URL(input.trim()); } catch { throw new Error('Enter a valid HTTPS media URL.'); }
  if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) {
    throw new Error('Use an HTTPS URL without embedded credentials.');
  }
  if (url.href.length > 2048) throw new Error('The URL is too long (maximum 2,048 characters).');
  url.hash = '';
  return url;
}

/** A single detached element probes a local Blob; it never plays or fetches a remote URL. */
export const probeBrowserMetadata: MetadataProbe = (_file, url, kind) => new Promise((resolve, reject) => {
  const element = document.createElement(kind);
  element.preload = 'metadata';
  const finish = (error?: Error) => {
    const metadata: ProbedMetadata = {
      durationSeconds: Number.isFinite(element.duration) ? Math.max(0, element.duration) : null,
    };
    if (element instanceof HTMLVideoElement && element.videoWidth > 0) {
      metadata.width = element.videoWidth;
      metadata.height = element.videoHeight;
    }
    clearTimeout(timeout);
    element.onloadedmetadata = null;
    element.onerror = null;
    element.pause();
    element.removeAttribute('src');
    element.load();
    if (error) reject(error); else resolve(metadata);
  };
  const timeout = setTimeout(() => finish(new Error('Metadata could not be read within 8 seconds.')), 8000);
  element.onloadedmetadata = () => finish();
  element.onerror = () => finish(new Error('The file is damaged or its format is unsupported by this browser.'));
  element.src = url;
});

/** Browser-only, session-scoped catalog. Blob bytes are never copied to JSON or uploaded. */
export class BrowserMediaEngine {
  private items: MediaItem[];
  private jobs: DownloadJob[] = [];
  private sources = new Map<string, string>();
  private fingerprints = new Map<string, string>();
  private importQueue: Promise<unknown> = Promise.resolve();
  private readonly probe: MetadataProbe;
  private listeners = new Set<() => void>();

  constructor(probe: MetadataProbe = probeBrowserMetadata) {
    this.probe = probe;
    const addedAt = new Date().toISOString();
    this.items = [
      { id: 'demo-audio', title: 'Quiet interval', creator: 'Hyden · generated audio', kind: 'audio', durationSeconds: 6, sizeBytes: 192044, mimeType: 'audio/wav', addedAt, source: 'demo', favorite: false },
      { id: 'demo-video', title: 'Color study', creator: 'Hyden · generated video', kind: 'video', durationSeconds: 6, sizeBytes: 77060, mimeType: 'video/webm', addedAt, source: 'demo', favorite: false, width: 320, height: 180 },
    ];
  }

  library(): MediaLibrary {
    return {
      items: this.items.map((item) => ({ ...item })),
      mode: 'browser-preview', importSupport: 'browser-files', downloadSupport: 'simulation', persistence: 'session',
      notice: 'Browser preview · files stay on this device and in this session. Reloading clears imports, favorites, and the demo queue. Downloads are simulated.',
    };
  }

  importFiles(files: File[]): Promise<ImportResult> {
    // Serializes separate import batches too; only one metadata decoder is active.
    const run = this.importQueue.then(() => this.importBatch(files));
    this.importQueue = run.catch(() => undefined);
    return run;
  }

  private async importBatch(files: File[]): Promise<ImportResult> {
    if (files.length > MAX_IMPORT_FILES) throw new Error('Select at most 20 files per import.');
    const result: ImportResult = { items: [], skipped: [] };
    for (const file of files) {
      const kind = inferMediaKind(file);
      const fingerprint = JSON.stringify([file.name, file.size, file.lastModified]);
      const reason = !kind ? 'Choose an audio or video file.'
        : file.size === 0 ? 'The file is empty.'
        : file.size > MAX_FILE_BYTES ? 'The browser preview limit is 512 MB per file.'
        : this.items.length >= MAX_ITEMS ? 'The preview library limit is 500 items.'
        : [...this.fingerprints.values()].includes(fingerprint) ? 'Already in this session’s library.' : null;
      if (reason || !kind) { result.skipped.push(`${file.name}: ${reason}`); continue; }
      const url = URL.createObjectURL(file);
      try {
        const metadata = await this.probe(file, url, kind);
        const item: MediaItem = {
          id: crypto.randomUUID(), title: file.name.replace(/\.[^.]+$/, '') || file.name,
          creator: 'Local file', kind, durationSeconds: metadata.durationSeconds,
          sizeBytes: file.size, mimeType: file.type || 'application/octet-stream',
          addedAt: new Date().toISOString(), source: 'local', favorite: false,
          ...(metadata.width ? { width: metadata.width, height: metadata.height } : {}),
        };
        this.items.unshift(item);
        this.sources.set(item.id, url);
        this.fingerprints.set(item.id, fingerprint);
        result.items.push({ ...item });
      } catch (error) {
        URL.revokeObjectURL(url);
        result.skipped.push(`${file.name}: ${error instanceof Error ? error.message : 'Metadata could not be read.'}`);
      }
    }
    if (result.items.length) this.notify();
    return result;
  }

  favorite(id: string, favorite: boolean): MediaItem {
    const item = this.requireItem(id);
    item.favorite = favorite;
    this.notify();
    return { ...item };
  }

  remove(id: string): void {
    this.requireItem(id);
    const source = this.sources.get(id);
    if (source) URL.revokeObjectURL(source);
    this.sources.delete(id);
    this.fingerprints.delete(id);
    this.items = this.items.filter((item) => item.id !== id);
    this.notify();
  }

  playbackSource(id: string): string {
    const item = this.requireItem(id);
    if (item.source === 'demo') return item.kind === 'audio' ? AUDIO_SAMPLE : VIDEO_SAMPLE;
    const url = this.sources.get(id);
    if (!url) throw new Error('This file is no longer available. Import it again.');
    return url;
  }

  downloadJobs(): DownloadJob[] { return this.jobs.map((job) => ({ ...job })); }

  enqueueDownload(input: string, kind: MediaKind): DownloadJob {
    const url = validateDownloadUrl(input);
    if (kind !== 'audio' && kind !== 'video') throw new Error('Choose audio or video.');
    if (this.jobs.length >= MAX_JOBS) throw new Error('The preview queue is limited to 50 jobs. Reload to clear this session.');
    // Parse only. No request, subprocess, remote metadata lookup, or background timer.
    const job: DownloadJob = {
      id: crypto.randomUUID(), url: url.href,
      title: `${url.hostname} · ${kind} demo`, kind, status: 'queued', progress: 0, simulated: true,
    };
    this.jobs.unshift(job);
    this.notify();
    return { ...job };
  }

  runDownloadDemo(id: string): DownloadJob {
    const job = this.requireQueuedJob(id);
    if (this.items.length >= MAX_ITEMS) throw new Error('The preview library limit is 500 items.');
    const item: MediaItem = {
      id: crypto.randomUUID(), title: job.title, creator: 'Simulated import · bundled sample',
      kind: job.kind, durationSeconds: 6, sizeBytes: job.kind === 'audio' ? 192044 : 77060,
      mimeType: job.kind === 'audio' ? 'audio/wav' : 'video/webm', addedAt: new Date().toISOString(),
      source: 'demo', favorite: false, ...(job.kind === 'video' ? { width: 320, height: 180 } : {}),
    };
    this.items.unshift(item);
    job.status = 'completed'; job.progress = 100; job.itemId = item.id;
    this.notify();
    return { ...job };
  }

  cancelDownload(id: string): DownloadJob {
    const job = this.requireQueuedJob(id);
    job.status = 'cancelled';
    this.notify();
    return { ...job };
  }

  private requireItem(id: string): MediaItem {
    const item = this.items.find((entry) => entry.id === id);
    if (!item) throw new Error('This item is no longer in the library.');
    return item;
  }

  private requireQueuedJob(id: string): DownloadJob {
    const job = this.jobs.find((entry) => entry.id === id);
    if (!job) throw new Error('This demo job was not found.');
    if (job.status !== 'queued') throw new Error('Only queued demo jobs can be run or cancelled.');
    return job;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }

  dispose(): void {
    for (const source of this.sources.values()) URL.revokeObjectURL(source);
    this.sources.clear(); this.fingerprints.clear(); this.items = []; this.jobs = [];
    this.listeners.clear();
  }
}
