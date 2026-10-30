import type { WorkspaceNote, WorkspaceSheet, WorkspaceSnapshot } from './workspace-types.ts';
import { WORKSPACE_LIMITS, WORKSPACE_STORAGE_KEY } from './workspace-types.ts';

export { WORKSPACE_LIMITS, WORKSPACE_STORAGE_KEY } from './workspace-types.ts';

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

type ErrorCode = 'CONFLICT' | 'STORAGE_UNAVAILABLE' | 'CORRUPT_STORAGE' | 'UNSUPPORTED_VERSION'
  | 'VALIDATION_ERROR' | 'LIMIT_EXCEEDED' | 'NOT_FOUND';

export class WorkspaceError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = 'WorkspaceError';
    this.code = code;
  }
}

interface StoredWorkspace {
  version: 1;
  notes: WorkspaceNote[];
  sheets: WorkspaceSheet[];
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function fail(message: string): never {
  throw new WorkspaceError('VALIDATION_ERROR', message);
}

function fields(value: Record<string, unknown>, allowed: readonly string[]) {
  if (Object.keys(value).some((key) => !allowed.includes(key))) fail('Unexpected document fields.');
}

function title(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > WORKSPACE_LIMITS.titleLength) {
    fail(`Use a document title between 1 and ${WORKSPACE_LIMITS.titleLength} characters.`);
  }
  return value.trim();
}

function id(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) fail('The document ID is invalid.');
  return value;
}

function revision(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value >= Number.MAX_SAFE_INTEGER) {
    fail('The document revision is invalid.');
  }
  return value;
}

function timestamp(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(value) || !Number.isFinite(Date.parse(value))) {
    fail('The document timestamp is invalid.');
  }
  return value;
}

function note(value: unknown): WorkspaceNote {
  if (!object(value)) fail('The note is invalid.');
  fields(value, ['id', 'title', 'markdown', 'createdAt', 'updatedAt', 'revision']);
  if (typeof value.markdown !== 'string' || value.markdown.length > WORKSPACE_LIMITS.markdownLength) {
    fail(`Notes support at most ${WORKSPACE_LIMITS.markdownLength.toLocaleString('en-US')} Markdown characters.`);
  }
  return {
    id: id(value.id), title: title(value.title), markdown: value.markdown,
    createdAt: timestamp(value.createdAt), updatedAt: timestamp(value.updatedAt), revision: revision(value.revision),
  };
}

function sheet(value: unknown): WorkspaceSheet {
  if (!object(value)) fail('The sheet is invalid.');
  fields(value, ['id', 'title', 'rows', 'columns', 'cells', 'headerRow', 'createdAt', 'updatedAt', 'revision']);
  const rows = value.rows;
  const columns = value.columns;
  if (typeof rows !== 'number' || !Number.isInteger(rows) || rows < 1 || rows > WORKSPACE_LIMITS.rows) {
    fail(`Sheets support between 1 and ${WORKSPACE_LIMITS.rows} rows.`);
  }
  if (typeof columns !== 'number' || !Number.isInteger(columns) || columns < 1 || columns > WORKSPACE_LIMITS.columns) {
    fail(`Sheets support between 1 and ${WORKSPACE_LIMITS.columns} columns (A–Z).`);
  }
  if (typeof value.headerRow !== 'boolean') fail('The sheet header setting is invalid.');
  if (!object(value.cells)) fail('Sheet cells must be a sparse A1-addressed object.');
  const cells: Record<string, string> = {};
  for (const [address, content] of Object.entries(value.cells)) {
    const match = /^([A-Z])([1-9]\d{0,2})$/.exec(address);
    if (!match || match[1].charCodeAt(0) - 64 > columns || Number(match[2]) > rows) {
      fail(`Cell ${address} is outside this sheet.`);
    }
    if (typeof content !== 'string' || content.length > WORKSPACE_LIMITS.cellLength) {
      fail(`Each cell supports at most ${WORKSPACE_LIMITS.cellLength.toLocaleString('en-US')} characters.`);
    }
    if (content !== '') cells[address] = content;
  }
  return {
    id: id(value.id), title: title(value.title), rows, columns, cells, headerRow: value.headerRow,
    createdAt: timestamp(value.createdAt), updatedAt: timestamp(value.updatedAt), revision: revision(value.revision),
  };
}

function uniqueTitle(base: string, documents: { title: string }[]): string {
  const names = new Set(documents.map((document) => document.title.toLowerCase()));
  if (!names.has(base.toLowerCase())) return base;
  let suffix = 2;
  while (names.has(`${base} (${suffix})`.toLowerCase())) suffix++;
  return `${base} (${suffix})`;
}

/**
 * Synchronous browser persistence. Every operation reads current storage, and saves
 * require the loaded revision. localStorage does not provide cross-tab transactions;
 * these revision checks detect stale sequential edits, not fully simultaneous writes.
 */
export class BrowserWorkspaceStore {
  static readonly key = WORKSPACE_STORAGE_KEY;
  private readonly storage: StorageLike;

  constructor(storage: StorageLike) {
    this.storage = storage;
  }

  snapshot(): WorkspaceSnapshot {
    const state = this.read();
    return {
      ...state,
      mode: 'browser', persistence: 'localStorage',
      notice: 'Saved in this browser on this device. Browser data clearing removes documents; export important work. Native file persistence is planned.',
    };
  }

  createNote(name?: string): WorkspaceNote {
    const state = this.read();
    if (state.notes.length >= WORKSPACE_LIMITS.notes) throw new WorkspaceError('LIMIT_EXCEEDED', 'This browser workspace supports up to 100 notes. Export and remove a note first.');
    const now = new Date().toISOString();
    const created: WorkspaceNote = {
      id: crypto.randomUUID(), title: name === undefined ? uniqueTitle('Untitled note', state.notes) : title(name),
      markdown: '', createdAt: now, updatedAt: now, revision: 1,
    };
    state.notes.unshift(created);
    this.write(state);
    return { ...created };
  }

  saveNote(input: WorkspaceNote): WorkspaceNote {
    const state = this.read();
    const draft = note(input);
    const index = state.notes.findIndex((document) => document.id === draft.id);
    const current = state.notes[index];
    this.assertRevision(current, draft.revision);
    const saved = { ...draft, createdAt: current.createdAt, updatedAt: new Date().toISOString(), revision: current.revision + 1 };
    state.notes[index] = saved;
    this.write(state);
    return { ...saved };
  }

  deleteNote(documentId: string, expectedRevision: number): void {
    const state = this.read();
    const current = state.notes.find((document) => document.id === id(documentId));
    this.assertRevision(current, revision(expectedRevision));
    state.notes = state.notes.filter((document) => document.id !== documentId);
    this.write(state);
  }

  createSheet(name?: string): WorkspaceSheet {
    const state = this.read();
    if (state.sheets.length >= WORKSPACE_LIMITS.sheets) throw new WorkspaceError('LIMIT_EXCEEDED', 'This browser workspace supports up to 30 sheets. Export and remove a sheet first.');
    const now = new Date().toISOString();
    const created: WorkspaceSheet = {
      id: crypto.randomUUID(), title: name === undefined ? uniqueTitle('Untitled sheet', state.sheets) : title(name),
      rows: 12, columns: 6, cells: {}, headerRow: false, createdAt: now, updatedAt: now, revision: 1,
    };
    state.sheets.unshift(created);
    this.write(state);
    return { ...created, cells: {} };
  }

  saveSheet(input: WorkspaceSheet): WorkspaceSheet {
    const state = this.read();
    const draft = sheet(input);
    const index = state.sheets.findIndex((document) => document.id === draft.id);
    const current = state.sheets[index];
    this.assertRevision(current, draft.revision);
    const saved = { ...draft, createdAt: current.createdAt, updatedAt: new Date().toISOString(), revision: current.revision + 1 };
    state.sheets[index] = saved;
    this.write(state);
    return { ...saved, cells: { ...saved.cells } };
  }

  deleteSheet(documentId: string, expectedRevision: number): void {
    const state = this.read();
    const current = state.sheets.find((document) => document.id === id(documentId));
    this.assertRevision(current, revision(expectedRevision));
    state.sheets = state.sheets.filter((document) => document.id !== documentId);
    this.write(state);
  }

  private assertRevision<T extends { revision: number }>(current: T | undefined, expected: number): asserts current is T {
    if (!current) throw new WorkspaceError('NOT_FOUND', 'This document was removed. Your unsaved text is still available to copy or export.');
    if (current.revision !== expected) {
      throw new WorkspaceError('CONFLICT', 'This document changed in another view or tab. Copy or export your draft before reloading the saved version.');
    }
  }

  private read(): StoredWorkspace {
    let raw: string | null;
    try { raw = this.storage.getItem(WORKSPACE_STORAGE_KEY); }
    catch { throw new WorkspaceError('STORAGE_UNAVAILABLE', 'Browser storage cannot be read. Allow local storage or use a browser profile where it is available.'); }
    if (raw === null) return { version: 1, notes: [], sheets: [] };
    try {
      if (raw.length * 2 > WORKSPACE_LIMITS.storageBytes) fail('The stored workspace exceeds its supported size.');
      const parsed: unknown = JSON.parse(raw);
      if (!object(parsed)) fail('The stored workspace is invalid.');
      if (parsed.version !== 1) {
        throw new WorkspaceError('UNSUPPORTED_VERSION', 'This workspace uses an unsupported storage version. Its data was preserved. Use a compatible app version or back up browser storage before making changes.');
      }
      fields(parsed, ['version', 'notes', 'sheets']);
      if (!Array.isArray(parsed.notes) || !Array.isArray(parsed.sheets)) fail('The saved document lists are invalid.');
      if (parsed.notes.length > WORKSPACE_LIMITS.notes || parsed.sheets.length > WORKSPACE_LIMITS.sheets) fail('The saved document count exceeds its supported limit.');
      const notes = parsed.notes.map(note);
      const sheets = parsed.sheets.map(sheet);
      const allIds = [...notes.map((document) => document.id), ...sheets.map((document) => document.id)];
      if (new Set(allIds).size !== allIds.length) fail('Saved document IDs are duplicated.');
      return { version: 1, notes, sheets };
    } catch (error) {
      if (error instanceof WorkspaceError && error.code === 'UNSUPPORTED_VERSION') throw error;
      throw new WorkspaceError('CORRUPT_STORAGE', 'Saved Workspace data could not be read safely. It was preserved without changes. Back up browser storage before repairing or clearing it.');
    }
  }

  private write(state: StoredWorkspace): void {
    const serialized = JSON.stringify(state);
    // Conservative UTF-16 estimate keeps the application below typical per-origin quotas.
    if (serialized.length * 2 > WORKSPACE_LIMITS.storageBytes) {
      throw new WorkspaceError('LIMIT_EXCEEDED', 'Workspace reached its 4 MiB browser storage limit. Export and remove documents before saving more.');
    }
    try { this.storage.setItem(WORKSPACE_STORAGE_KEY, serialized); }
    catch { throw new WorkspaceError('STORAGE_UNAVAILABLE', 'Browser storage could not save this change (unavailable or full). Keep your draft open and copy or export it before retrying.'); }
  }
}
