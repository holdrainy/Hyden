/** Versioned, serializable Workspace DTOs shared by browser and future native adapters. */
export interface WorkspaceNote {
  id: string;
  title: string;
  markdown: string;
  createdAt: string;
  updatedAt: string;
  revision: number;
}

export interface WorkspaceSheet {
  id: string;
  title: string;
  rows: number;
  columns: number;
  /** Sparse A1-addressed source values, including formulas beginning with '='. */
  cells: Record<string, string>;
  headerRow: boolean;
  createdAt: string;
  updatedAt: string;
  revision: number;
}

export interface WorkspaceSnapshot {
  version: 1;
  notes: WorkspaceNote[];
  sheets: WorkspaceSheet[];
  mode: 'browser' | 'desktop';
  persistence: 'localStorage' | 'unavailable';
  notice: string;
}

export interface WorkspaceErrorData {
  code: string;
  message: string;
}

export const WORKSPACE_STORAGE_KEY = 'hyden.workspace.v1';

export const WORKSPACE_LIMITS = {
  notes: 100,
  sheets: 30,
  titleLength: 100,
  markdownLength: 200_000,
  rows: 200,
  columns: 26,
  cellLength: 2_000,
  storageBytes: 4 * 1024 * 1024,
} as const;
