import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BrowserWorkspaceStore, WorkspaceError, WORKSPACE_STORAGE_KEY } from '../src/lib/browser-workspace.ts';
import type { StorageLike } from '../src/lib/browser-workspace.ts';
import type { WorkspaceSheet } from '../src/lib/workspace-types.ts';

class MemoryStorage implements StorageLike {
  values = new Map<string, string>();
  writes = 0;
  readBlocked = false;
  writeBlocked = false;
  getItem(key: string) {
    if (this.readBlocked) throw new Error('disabled');
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    if (this.writeBlocked) throw new Error('quota');
    this.writes++;
    this.values.set(key, value);
  }
}

function hasCode(code: string) {
  return (error: unknown) => error instanceof WorkspaceError && error.code === code;
}

test('workspace creates independent persisted notes and sheets without seeding or mutating snapshots', () => {
  const storage = new MemoryStorage();
  const store = new BrowserWorkspaceStore(storage);
  assert.deepEqual(store.snapshot().notes, []);
  assert.equal(storage.writes, 0);
  const note = store.createNote();
  const second = store.createNote();
  const sheet = store.createSheet();
  assert.equal(note.title, 'Untitled note');
  assert.equal(second.title, 'Untitled note (2)');
  assert.equal(sheet.rows, 12);
  assert.equal(sheet.columns, 6);
  assert.equal(sheet.headerRow, false);
  const reloaded = new BrowserWorkspaceStore(storage).snapshot();
  assert.equal(reloaded.notes.length, 2);
  assert.equal(reloaded.sheets.length, 1);
  assert.equal(reloaded.persistence, 'localStorage');
  note.title = 'not saved';
  reloaded.notes[0].markdown = 'not saved';
  reloaded.sheets[0].cells.A1 = 'not saved';
  assert.equal(store.snapshot().notes.find((document) => document.id === note.id)?.title, 'Untitled note');
  assert.deepEqual(store.snapshot().sheets[0].cells, {});
});

test('workspace saves Markdown and renames notes with revision checks, preserving creation metadata', () => {
  const storage = new MemoryStorage();
  const firstTab = new BrowserWorkspaceStore(storage);
  const secondTab = new BrowserWorkspaceStore(storage);
  const original = firstTab.createNote('Reading');
  const newer = secondTab.saveNote({ ...original, title: '  Reading list  ', markdown: '# Books\n- [ ] Read\n\n**Bold** and *italic*', createdAt: '2000-01-01T00:00:00.000Z' });
  assert.equal(newer.title, 'Reading list');
  assert.equal(newer.revision, 2);
  assert.equal(newer.createdAt, original.createdAt);
  assert.equal(firstTab.snapshot().notes[0].markdown, newer.markdown);
  assert.throws(() => firstTab.saveNote({ ...original, markdown: 'stale' }), hasCode('CONFLICT'));
  assert.throws(() => firstTab.deleteNote(original.id, original.revision), hasCode('CONFLICT'));
  assert.equal(firstTab.snapshot().notes[0].markdown, newer.markdown);
  firstTab.deleteNote(newer.id, newer.revision);
  assert.equal(secondTab.snapshot().notes.length, 0);
  assert.throws(() => secondTab.saveNote(newer), hasCode('NOT_FOUND'));
});

test('workspace reads latest state before edits so unrelated documents are retained', () => {
  const storage = new MemoryStorage();
  const tabA = new BrowserWorkspaceStore(storage);
  const tabB = new BrowserWorkspaceStore(storage);
  const first = tabA.createNote('First');
  tabB.createNote('Second');
  const sheet = tabB.createSheet('Budget');
  tabA.saveNote({ ...first, markdown: 'a retained edit' });
  assert.equal(tabB.snapshot().notes.length, 2);
  assert.equal(tabA.snapshot().sheets[0].id, sheet.id);
});

test('workspace sheet edits persist sparse source cells, formatting and structural changes', () => {
  const storage = new MemoryStorage();
  const store = new BrowserWorkspaceStore(storage);
  const original = store.createSheet('Numbers');
  const updated = store.saveSheet({ ...original, title: '  Budget  ', rows: 20, columns: 8, headerRow: true, cells: { A1: 'Item', B1: 'Amount', B2: '4', B3: '6', B4: '=SUM(B2:B3)', A2: '' } });
  assert.equal(updated.revision, 2);
  assert.equal(updated.title, 'Budget');
  assert.equal(updated.cells.B4, '=SUM(B2:B3)');
  assert.equal(updated.cells.A2, undefined, 'blank cells stay sparse');
  updated.cells.B2 = 'unsaved';
  const saved = new BrowserWorkspaceStore(storage).snapshot().sheets[0];
  assert.equal(saved.cells.B2, '4');
  assert.equal(saved.rows, 20);
  assert.equal(saved.columns, 8);
  assert.equal(saved.headerRow, true);
  assert.throws(() => store.deleteSheet(original.id, original.revision), hasCode('CONFLICT'));
  store.deleteSheet(saved.id, saved.revision);
  assert.deepEqual(store.snapshot().sheets, []);
});

test('workspace rejects invalid bounds and cells before writing', () => {
  const storage = new MemoryStorage();
  const store = new BrowserWorkspaceStore(storage);
  const note = store.createNote('A note');
  const sheet = store.createSheet();
  const writes = storage.writes;
  assert.throws(() => store.saveNote({ ...note, title: ' ' }), hasCode('VALIDATION_ERROR'));
  assert.throws(() => store.saveNote({ ...note, markdown: 'a'.repeat(200_001) }), hasCode('VALIDATION_ERROR'));
  const invalid: Partial<WorkspaceSheet>[] = [
    { rows: 0 }, { rows: 201 }, { rows: 1.5 }, { columns: 27 }, { columns: 0 },
    { cells: { A13: 'outside' } }, { cells: { G1: 'outside' } }, { cells: { a1: 'lowercase' } },
    { cells: { A0: 'invalid' } }, { cells: { A1: 'x'.repeat(2001) } },
  ];
  for (const change of invalid) assert.throws(() => store.saveSheet({ ...sheet, ...change }), hasCode('VALIDATION_ERROR'));
  assert.equal(storage.writes, writes);
  assert.equal(store.snapshot().notes[0].revision, 1);
});

test('workspace preserves corrupt, unsupported, and unreadable storage instead of resetting it', () => {
  const storage = new MemoryStorage();
  const store = new BrowserWorkspaceStore(storage);
  for (const raw of ['not json', '{"version":1,"notes":[],"sheets":[{}]}', '{"version":1,"notes":[],"sheets":[],"unexpected":true}']) {
    storage.values.set(WORKSPACE_STORAGE_KEY, raw);
    assert.throws(() => store.snapshot(), hasCode('CORRUPT_STORAGE'));
    assert.throws(() => store.createNote(), hasCode('CORRUPT_STORAGE'));
    assert.equal(storage.getItem(WORKSPACE_STORAGE_KEY), raw);
  }
  storage.values.set(WORKSPACE_STORAGE_KEY, '{"version":2,"notes":[],"sheets":[]}');
  assert.throws(() => store.snapshot(), hasCode('UNSUPPORTED_VERSION'));
  storage.readBlocked = true;
  assert.throws(() => store.createNote(), hasCode('STORAGE_UNAVAILABLE'));
  assert.equal(storage.writes, 0);
});

test('failed browser writes preserve previous contents and revisions for retry/export', () => {
  const storage = new MemoryStorage();
  const store = new BrowserWorkspaceStore(storage);
  const original = store.createNote('Keep me');
  const saved = storage.getItem(WORKSPACE_STORAGE_KEY);
  storage.writeBlocked = true;
  assert.throws(() => store.saveNote({ ...original, markdown: 'unsaved draft' }), hasCode('STORAGE_UNAVAILABLE'));
  assert.throws(() => store.deleteNote(original.id, original.revision), hasCode('STORAGE_UNAVAILABLE'));
  assert.equal(storage.getItem(WORKSPACE_STORAGE_KEY), saved);
  assert.equal(store.snapshot().notes[0].revision, original.revision);
  storage.writeBlocked = false;
  assert.equal(store.saveNote({ ...original, markdown: 'retry succeeds' }).revision, 2);
});

test('workspace enforces its storage budget without committing oversized state', () => {
  const storage = new MemoryStorage();
  const store = new BrowserWorkspaceStore(storage);
  const original = store.createSheet('Large sheet');
  const cells: Record<string, string> = {};
  for (let row = 1; row <= 200; row++) for (let col = 0; col < 26; col++) cells[`${String.fromCharCode(65 + col)}${row}`] = 'x'.repeat(500);
  assert.throws(() => store.saveSheet({ ...original, rows: 200, columns: 26, cells }), hasCode('LIMIT_EXCEEDED'));
  assert.deepEqual(store.snapshot().sheets[0].cells, {});
  assert.equal(storage.writes, 1);
});
