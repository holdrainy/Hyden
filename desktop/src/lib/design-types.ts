/** Versioned, serializable Design & Boards contracts for local profile persistence. */
export interface DesignPoint { x: number; y: number }

export interface PenShape {
  id: string;
  kind: 'pen';
  points: DesignPoint[];
  color: string;
  width: number;
}

export interface RectShape {
  id: string;
  kind: 'rectangle';
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  strokeWidth: number;
}

export type DesignShape = PenShape | RectShape;

export interface ScratchpadDocument {
  width: number;
  height: number;
  background: string;
  shapes: DesignShape[];
  revision: number;
  updatedAt: string;
}

export interface FigmaBookmark {
  id: string;
  title: string;
  /** Canonical Figma source URL. Embed URLs are derived rather than trusted from storage. */
  url: string;
  createdAt: string;
  updatedAt: string;
  revision: number;
}

export interface DesignSnapshot {
  version: 1;
  bookmarks: FigmaBookmark[];
  scratchpad: ScratchpadDocument;
  persistence: 'localStorage';
}

export interface ParsedFigmaUrl {
  sourceUrl: string;
  embedUrl: string;
  fileKey: string;
  kind: 'design' | 'proto' | 'board';
}

export const DESIGN_STORAGE_KEY = 'hyden.design.v1';
export const DESIGN_LIMITS = {
  bookmarks: 50,
  titleLength: 100,
  urlLength: 4096,
  minDimension: 64,
  maxDimension: 2048,
  pixels: 4 * 1024 * 1024,
  shapes: 250,
  pointsPerPen: 2500,
  points: 30000,
  minStrokeWidth: 1,
  maxStrokeWidth: 24,
  storageBytes: 2 * 1024 * 1024,
} as const;

export function defaultScratchpad(): ScratchpadDocument {
  return { width: 1200, height: 800, background: '#f4f0e7', shapes: [], revision: 0, updatedAt: new Date().toISOString() };
}
