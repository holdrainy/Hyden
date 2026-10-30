export type MediaKind = 'audio' | 'video';

export interface MediaItem {
  id: string;
  title: string;
  creator: string;
  kind: MediaKind;
  durationSeconds: number | null;
  sizeBytes: number;
  mimeType: string;
  addedAt: string;
  source: 'demo' | 'local';
  favorite: boolean;
  width?: number;
  height?: number;
}

export interface MediaLibrary {
  items: MediaItem[];
  mode: 'browser-preview' | 'desktop';
  importSupport: 'browser-files' | 'unavailable';
  downloadSupport: 'simulation' | 'unavailable';
  persistence: 'session';
  notice: string;
}

export interface ImportResult {
  items: MediaItem[];
  skipped: string[];
}

export interface DownloadJob {
  id: string;
  url: string;
  title: string;
  kind: MediaKind;
  status: 'queued' | 'completed' | 'cancelled';
  progress: number;
  simulated: boolean;
  itemId?: string;
}

export interface MediaError {
  code: string;
  message: string;
}
