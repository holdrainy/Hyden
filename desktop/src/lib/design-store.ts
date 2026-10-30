import type { DesignPoint, DesignShape, DesignSnapshot, FigmaBookmark, ScratchpadDocument } from './design-types.ts';
import { defaultScratchpad, DESIGN_LIMITS, DESIGN_STORAGE_KEY } from './design-types.ts';
import { parseFigmaUrl } from './figma-url.ts';

export { defaultScratchpad, DESIGN_LIMITS, DESIGN_STORAGE_KEY } from './design-types.ts';

export interface StorageLike { getItem(key: string): string | null; setItem(key: string, value: string): void }

type ErrorCode = 'VALIDATION_ERROR' | 'LIMIT_EXCEEDED' | 'STORAGE_UNAVAILABLE' | 'CORRUPT_STORAGE'
  | 'UNSUPPORTED_VERSION' | 'NOT_FOUND' | 'CONFLICT';

export class DesignStoreError extends Error {
  readonly code: ErrorCode;
  constructor(code: ErrorCode, message: string) { super(message); this.name = 'DesignStoreError'; this.code = code; }
}

interface StoredDesign { version: 1; bookmarks: FigmaBookmark[]; scratchpad: ScratchpadDocument }

function object(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function invalid(message: string): never { throw new DesignStoreError('VALIDATION_ERROR', message); }
function limit(message: string): never { throw new DesignStoreError('LIMIT_EXCEEDED', message); }
function fields(value: Record<string, unknown>, allowed: readonly string[]) {
  if (Object.keys(value).some((field) => !allowed.includes(field))) invalid('Unexpected Design document fields.');
}
function identifier(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) invalid('The board or shape identifier is invalid.');
  return value;
}
function title(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > DESIGN_LIMITS.titleLength) invalid('Give the bookmark a title between 1 and 100 characters.');
  return value.trim();
}
function revision(value: unknown, allowZero = false): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < (allowZero ? 0 : 1) || value >= Number.MAX_SAFE_INTEGER) invalid('The saved revision is invalid.');
  return value;
}
function timestamp(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(value) || !Number.isFinite(Date.parse(value))) invalid('The document timestamp is invalid.');
  return value;
}
function color(value: unknown): string {
  if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value)) invalid('Choose a six-digit hexadecimal drawing color.');
  return value.toLowerCase();
}
function finite(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) invalid('Drawing coordinates must be finite numbers.');
  return value;
}
function stroke(value: unknown): number {
  const result = finite(value);
  if (result < DESIGN_LIMITS.minStrokeWidth || result > DESIGN_LIMITS.maxStrokeWidth) invalid('Stroke width must be between 1 and 24 pixels.');
  return result;
}
function point(value: unknown, width: number, height: number): DesignPoint {
  if (!object(value)) invalid('A pen point is invalid.');
  fields(value, ['x', 'y']);
  const x = finite(value.x), y = finite(value.y);
  if (x < 0 || y < 0 || x > width || y > height) invalid('Keep drawing points within the scratchpad.');
  return { x, y };
}

/** Strict validation also clones geometry, keeping caller drafts independent from saved state. */
export function validateScratchpad(value: unknown): ScratchpadDocument {
  if (!object(value)) invalid('The scratchpad is invalid.');
  fields(value, ['width', 'height', 'background', 'shapes', 'revision', 'updatedAt']);
  const width = finite(value.width), height = finite(value.height);
  if (![width, height].every((side) => Number.isInteger(side) && side >= DESIGN_LIMITS.minDimension && side <= DESIGN_LIMITS.maxDimension) || width * height > DESIGN_LIMITS.pixels) invalid('Scratchpad dimensions must be 64–2,048 pixels per side and at most four megapixels.');
  if (!Array.isArray(value.shapes)) invalid('Scratchpad shapes must be a list.');
  if (value.shapes.length > DESIGN_LIMITS.shapes) limit('The scratchpad supports up to 250 shapes. Clear or simplify the board before continuing.');
  let points = 0;
  const ids = new Set<string>();
  const shapes: DesignShape[] = value.shapes.map((input) => {
    if (!object(input)) invalid('A drawing shape is invalid.');
    const id = identifier(input.id);
    if (ids.has(id)) invalid('Drawing shape identifiers must be unique.');
    ids.add(id);
    if (input.kind === 'pen') {
      fields(input, ['id', 'kind', 'points', 'color', 'width']);
      if (!Array.isArray(input.points) || input.points.length < 1) invalid('A pen stroke needs at least one point.');
      points += input.points.length;
      if (input.points.length > DESIGN_LIMITS.pointsPerPen || points > DESIGN_LIMITS.points) limit('Keep pen strokes to 2,500 points each and the scratchpad to 30,000 total points.');
      return { id, kind: 'pen', points: input.points.map((item) => point(item, width, height)), color: color(input.color), width: stroke(input.width) };
    }
    if (input.kind === 'rectangle') {
      fields(input, ['id', 'kind', 'x', 'y', 'width', 'height', 'color', 'strokeWidth']);
      const x = finite(input.x), y = finite(input.y), shapeWidth = finite(input.width), shapeHeight = finite(input.height);
      if (x < 0 || y < 0 || shapeWidth < 1 || shapeHeight < 1 || x + shapeWidth > width || y + shapeHeight > height) invalid('Keep rectangles inside the scratchpad, with positive width and height.');
      return { id, kind: 'rectangle', x, y, width: shapeWidth, height: shapeHeight, color: color(input.color), strokeWidth: stroke(input.strokeWidth) };
    }
    return invalid('Choose a pen stroke or rectangle.');
  });
  return { width, height, background: color(value.background), shapes, revision: revision(value.revision, true), updatedAt: timestamp(value.updatedAt) };
}

function bookmark(value: unknown): FigmaBookmark {
  if (!object(value)) invalid('The Figma bookmark is invalid.');
  fields(value, ['id', 'title', 'url', 'createdAt', 'updatedAt', 'revision']);
  if (typeof value.url !== 'string') invalid('The Figma bookmark URL is invalid.');
  let url: string;
  try { url = parseFigmaUrl(value.url).sourceUrl; }
  catch { return invalid('A saved bookmark must point to a supported HTTPS Figma document.'); }
  return { id: identifier(value.id), title: title(value.title), url, createdAt: timestamp(value.createdAt), updatedAt: timestamp(value.updatedAt), revision: revision(value.revision) };
}

function clonePad(document: ScratchpadDocument): ScratchpadDocument {
  return { ...document, shapes: document.shapes.map((shape) => shape.kind === 'pen' ? { ...shape, points: shape.points.map((item) => ({ ...item })) } : { ...shape }) };
}

/** Per-document revisions protect stale sequential edits, not simultaneous cross-tab transactions. */
export class DesignStore {
  static readonly key = DESIGN_STORAGE_KEY;
  private readonly storage: StorageLike;
  constructor(storage: StorageLike) { this.storage = storage; }

  snapshot(): DesignSnapshot { return { ...this.read(), persistence: 'localStorage' }; }

  createBookmark(name: string, input: string): FigmaBookmark {
    const state = this.read();
    if (state.bookmarks.length >= DESIGN_LIMITS.bookmarks) limit('This profile supports up to 50 board bookmarks. Remove one before adding another.');
    let url: string;
    try { url = parseFigmaUrl(input).sourceUrl; } catch (reason) { return invalid(reason instanceof Error ? reason.message : 'The Figma URL is invalid.'); }
    const now = new Date().toISOString();
    const created: FigmaBookmark = { id: crypto.randomUUID(), title: title(name), url, createdAt: now, updatedAt: now, revision: 1 };
    state.bookmarks.unshift(created);
    this.write(state);
    return { ...created };
  }

  renameBookmark(documentId: string, name: string, expectedRevision: number): FigmaBookmark {
    const state = this.read();
    const id = identifier(documentId);
    const index = state.bookmarks.findIndex((item) => item.id === id);
    const current = state.bookmarks[index];
    this.assertRevision(current, revision(expectedRevision));
    const updated = { ...current, title: title(name), revision: current.revision + 1, updatedAt: new Date().toISOString() };
    state.bookmarks[index] = updated;
    this.write(state);
    return { ...updated };
  }

  deleteBookmark(documentId: string, expectedRevision: number): void {
    const state = this.read();
    const id = identifier(documentId);
    this.assertRevision(state.bookmarks.find((item) => item.id === id), revision(expectedRevision));
    state.bookmarks = state.bookmarks.filter((item) => item.id !== id);
    this.write(state);
  }

  saveScratchpad(input: ScratchpadDocument): ScratchpadDocument {
    const state = this.read();
    const draft = validateScratchpad(input);
    this.assertRevision(state.scratchpad, draft.revision);
    const saved = { ...draft, revision: state.scratchpad.revision + 1, updatedAt: new Date().toISOString() };
    state.scratchpad = saved;
    this.write(state);
    return clonePad(saved);
  }

  private assertRevision(current: { revision: number } | undefined, expected: number): asserts current is { revision: number } {
    if (!current) throw new DesignStoreError('NOT_FOUND', 'This board bookmark was removed in another view. Refresh the list to continue.');
    if (current.revision !== expected) throw new DesignStoreError('CONFLICT', 'This design document changed in another view or tab. Export your scratchpad before loading its saved version.');
  }

  private read(): StoredDesign {
    let raw: string | null;
    try { raw = this.storage.getItem(DESIGN_STORAGE_KEY); }
    catch { throw new DesignStoreError('STORAGE_UNAVAILABLE', 'Design storage cannot be read. Allow browser storage or export your scratchpad to preserve it.'); }
    if (raw === null) return { version: 1, bookmarks: [], scratchpad: defaultScratchpad() };
    try {
      if (raw.length * 2 > DESIGN_LIMITS.storageBytes) invalid('Saved Design data exceeds the supported size.');
      const parsed: unknown = JSON.parse(raw);
      if (!object(parsed)) invalid('Saved Design data is not an object.');
      if (parsed.version !== 1) throw new DesignStoreError('UNSUPPORTED_VERSION', 'This Design data uses an unsupported version. Preserve the stored data before updating the application.');
      fields(parsed, ['version', 'bookmarks', 'scratchpad']);
      if (!Array.isArray(parsed.bookmarks) || parsed.bookmarks.length > DESIGN_LIMITS.bookmarks) invalid('The saved bookmark list is invalid.');
      const bookmarks = parsed.bookmarks.map(bookmark);
      if (new Set(bookmarks.map((item) => item.id)).size !== bookmarks.length) invalid('Saved board bookmark identifiers must be unique.');
      return { version: 1, bookmarks, scratchpad: validateScratchpad(parsed.scratchpad) };
    } catch (reason) {
      if (reason instanceof DesignStoreError && reason.code === 'UNSUPPORTED_VERSION') throw reason;
      throw new DesignStoreError('CORRUPT_STORAGE', 'Saved Design data is invalid and was left untouched. Preserve it before repairing storage; an unsaved scratchpad can still be exported.');
    }
  }

  private write(state: StoredDesign): void {
    const raw = JSON.stringify(state);
    if (raw.length * 2 > DESIGN_LIMITS.storageBytes) limit('Design storage reached its 2 MiB limit. Export the scratchpad and simplify its shapes or remove unused bookmarks.');
    try { this.storage.setItem(DESIGN_STORAGE_KEY, raw); }
    catch { throw new DesignStoreError('STORAGE_UNAVAILABLE', 'Design changes were not saved. Browser storage may be full or disabled. Keep this page open and export your scratchpad before leaving.'); }
  }
}
