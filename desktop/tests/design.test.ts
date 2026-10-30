import assert from 'node:assert/strict';
import { test } from 'node:test';
import { defaultScratchpad, DESIGN_LIMITS, DESIGN_STORAGE_KEY, DesignStore, DesignStoreError, validateScratchpad } from '../src/lib/design-store.ts';
import type { ScratchpadDocument } from '../src/lib/design-types.ts';
import { parseFigmaUrl } from '../src/lib/figma-url.ts';

class MemoryStorage {
  values = new Map<string, string>();
  writes = 0;
  readBlocked = false;
  writeBlocked = false;
  getItem(key: string) {
    if (this.readBlocked) throw new Error('Unavailable');
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    if (this.writeBlocked) throw new Error('Quota exceeded');
    this.writes++;
    this.values.set(key, value);
  }
}

const SOURCE = 'https://www.figma.com/design/ExampleKey123/Local%20ideas?node-id=1%3A2';
const code = (expected: string) => (reason: unknown) => reason instanceof DesignStoreError && reason.code === expected;

function drawn(): ScratchpadDocument {
  return {
    ...defaultScratchpad(),
    shapes: [
      { id: 'pen-1', kind: 'pen', color: '#293329', width: 3, points: [{ x: 10, y: 20 }, { x: 100.5, y: 80 }] },
      { id: 'rect-1', kind: 'rectangle', color: '#597c66', x: 120, y: 30, width: 300, height: 100, strokeWidth: 2 },
    ],
  };
}

test('Figma normalizer accepts source/embed aliases and produces only canonical viewer origins', () => {
  const parsed = parseFigmaUrl(SOURCE + '&utm_source=external&redirect=https%3A%2F%2Fevil.example#fragment');
  assert.equal(parsed.sourceUrl, SOURCE);
  assert.equal(parsed.embedUrl, 'https://embed.figma.com/design/ExampleKey123/Local%20ideas?embed-host=share&node-id=1%3A2');
  assert.equal(parsed.fileKey, 'ExampleKey123');
  assert.equal(parsed.kind, 'design');
  const file = parseFigmaUrl(' https://figma.com:443/file/ExampleKey123/Local%20ideas?node-id=1%3A2 ');
  assert.deepEqual(file, parsed);
  assert.deepEqual(parseFigmaUrl(parsed.embedUrl), parsed);
  const legacy = `https://www.figma.com/embed?embed_host=share&url=${encodeURIComponent(SOURCE)}`;
  assert.deepEqual(parseFigmaUrl(legacy), parsed);
  assert.deepEqual(parseFigmaUrl(`https://www.figma.com/embed?url=${encodeURIComponent(legacy)}`), parsed);
  for (const kind of ['board', 'proto'] as const) {
    const result = parseFigmaUrl(`https://www.figma.com/${kind}/ExampleKey123/Sketch?scaling=scale-down&theme=dark`);
    assert.equal(result.kind, kind);
    assert.equal(new URL(result.embedUrl).hostname, 'embed.figma.com');
    assert.equal(new URL(result.embedUrl).searchParams.get('theme'), 'dark');
  }
});

test('Figma normalizer rejects active HTML, credentials, lookalike hosts, ports, unsafe paths, and nested redirects', () => {
  const bad = [
    'javascript:alert(1)', 'data:text/html,<iframe>', '<iframe src="https://www.figma.com/design/ExampleKey123/x"></iframe>',
    'http://www.figma.com/design/ExampleKey123/x', 'https://www.figma.com.evil.example/design/ExampleKey123/x',
    'https://evil.example/design/ExampleKey123/x', 'https://www.figma.com@evil.example/design/ExampleKey123/x',
    'https://user:pass@www.figma.com/design/ExampleKey123/x', 'https://www.figma.com:8080/design/ExampleKey123/x',
    'https://www.figma.com/community/file/ExampleKey123/x', 'https://www.figma.com/design/short/x',
    'https://www.figma.com/design/ExampleKey123/x%2fy', 'https://www.figma.com/design/ExampleKey123/x?node-id=%0a',
    `https://www.figma.com/embed?url=${encodeURIComponent('https://evil.example/')}`,
    `https://www.figma.com/embed?url=${encodeURIComponent(SOURCE)}&url=${encodeURIComponent(SOURCE)}`,
    SOURCE + '&node-id=3', SOURCE + '\n', '', 'https://www.figma.com/design/ExampleKey123/' + 'x'.repeat(4096),
  ];
  let nested = SOURCE;
  for (let i = 0; i < 3; i++) nested = `https://www.figma.com/embed?url=${encodeURIComponent(nested)}`;
  bad.push(nested);
  for (const input of bad) assert.throws(() => parseFigmaUrl(input), undefined, input);
});

test('Design store starts empty without writes and keeps existing Workspace/Copilot keys independent', () => {
  const storage = new MemoryStorage();
  storage.values.set('hyden.workspace.v1', 'notes-sentinel');
  storage.values.set('hyden.copilot.v1', 'chats-sentinel');
  const store = new DesignStore(storage);
  const initial = store.snapshot();
  assert.deepEqual(initial.bookmarks, []);
  assert.deepEqual(initial.scratchpad.shapes, []);
  assert.equal(initial.scratchpad.revision, 0);
  assert.equal(initial.scratchpad.width, 1200);
  assert.equal(initial.scratchpad.height, 800);
  assert.equal(storage.writes, 0);
  store.createBookmark('Ideas', SOURCE);
  assert.equal(storage.getItem('hyden.workspace.v1'), 'notes-sentinel');
  assert.equal(storage.getItem('hyden.copilot.v1'), 'chats-sentinel');
  assert.equal(new DesignStore(storage).snapshot().bookmarks[0].url, SOURCE);
});

test('bookmarks create/rename/delete with canonical URLs, immutable results and revision conflicts', () => {
  const storage = new MemoryStorage();
  const first = new DesignStore(storage), second = new DesignStore(storage);
  const saved = first.createBookmark('  Ideas  ', SOURCE);
  assert.equal(saved.title, 'Ideas');
  assert.equal(saved.revision, 1);
  const renamed = second.renameBookmark(saved.id, '  Product sketches ', saved.revision);
  assert.equal(renamed.title, 'Product sketches');
  assert.equal(renamed.revision, 2);
  assert.equal(renamed.createdAt, saved.createdAt);
  renamed.title = 'mutated copy';
  assert.equal(first.snapshot().bookmarks[0].title, 'Product sketches');
  assert.throws(() => first.renameBookmark(saved.id, 'Stale', 1), code('CONFLICT'));
  assert.throws(() => first.deleteBookmark(saved.id, 1), code('CONFLICT'));
  const current = first.snapshot().bookmarks[0];
  first.deleteBookmark(current.id, current.revision);
  assert.deepEqual(second.snapshot().bookmarks, []);
  assert.throws(() => first.renameBookmark(saved.id, 'Gone', 2), code('NOT_FOUND'));
});

test('scratchpad persistence clones geometry, preserves bookmarks, and rejects stale edits', () => {
  const storage = new MemoryStorage();
  const first = new DesignStore(storage), second = new DesignStore(storage);
  const original = first.snapshot().scratchpad;
  const bookmark = second.createBookmark('Ideas', SOURCE);
  const input = { ...drawn(), revision: original.revision };
  const saved = first.saveScratchpad(input);
  assert.equal(saved.revision, 1);
  assert.equal(second.snapshot().bookmarks[0].id, bookmark.id);
  assert.deepEqual(second.snapshot().scratchpad.shapes, input.shapes);
  assert.throws(() => second.saveScratchpad(input), code('CONFLICT'));
  saved.shapes[0].color = '#ffffff';
  if (input.shapes[0].kind === 'pen') input.shapes[0].points[0].x = 999;
  const reloaded = new DesignStore(storage).snapshot().scratchpad;
  assert.equal(reloaded.shapes[0].color, '#293329');
  assert.equal(reloaded.shapes[0].kind === 'pen' && reloaded.shapes[0].points[0].x, 10);
  second.renameBookmark(bookmark.id, 'Renamed', bookmark.revision);
  assert.equal(first.snapshot().scratchpad.shapes.length, 2);
  const cleared = first.saveScratchpad({ ...reloaded, shapes: [] });
  assert.equal(cleared.revision, 2);
  assert.deepEqual(new DesignStore(storage).snapshot().scratchpad.shapes, []);
});

test('geometry, colors, shape IDs, point counts and coordinate limits validate before writes', () => {
  const storage = new MemoryStorage();
  const store = new DesignStore(storage);
  const pad = drawn();
  const invalid: ScratchpadDocument[] = [
    { ...pad, width: 4096 }, { ...pad, height: 0 }, { ...pad, width: 64.5 }, { ...pad, background: 'url(https://evil.example)' },
    { ...pad, shapes: [{ ...pad.shapes[0], id: '../unsafe' }] }, { ...pad, shapes: [pad.shapes[0], pad.shapes[0]] },
    { ...pad, shapes: [{ id: 'pen', kind: 'pen', color: '#000000', width: 2, points: [{ x: Number.NaN, y: 0 }] }] },
    { ...pad, shapes: [{ id: 'pen', kind: 'pen', color: '#000000', width: 25, points: [{ x: 0, y: 0 }] }] },
    { ...pad, shapes: [{ id: 'pen', kind: 'pen', color: '#000000', width: 2, points: [{ x: 1201, y: 0 }] }] },
    { ...pad, shapes: [{ id: 'rect', kind: 'rectangle', color: '#000000', x: 1199, y: 0, width: 10, height: 10, strokeWidth: 2 }] },
    { ...pad, shapes: [{ id: 'rect', kind: 'rectangle', color: '#000000', x: 0, y: 0, width: 0, height: 10, strokeWidth: 2 }] },
  ];
  for (const item of invalid) assert.throws(() => store.saveScratchpad(item), code('VALIDATION_ERROR'));
  assert.throws(() => store.saveScratchpad({ ...pad, shapes: Array.from({ length: 251 }, (_, index) => ({ id: `rect-${index}`, kind: 'rectangle', x: 0, y: 0, width: 10, height: 10, color: '#000000', strokeWidth: 1 })) }), code('LIMIT_EXCEEDED'));
  const stroke = { id: 'long', kind: 'pen' as const, color: '#000000', width: 2, points: Array.from({ length: 2501 }, () => ({ x: 1, y: 1 })) };
  assert.throws(() => store.saveScratchpad({ ...pad, shapes: [stroke] }), code('LIMIT_EXCEEDED'));
  const dots = validateScratchpad({ ...pad, shapes: [{ ...stroke, points: [{ x: 0, y: 0 }] }] });
  assert.equal(dots.shapes.length, 1, 'tap strokes can be represented');
  assert.equal(storage.writes, 0);
});

test('corrupt, unsupported, forged bookmark and unreadable Design storage is preserved, not reset', () => {
  const storage = new MemoryStorage();
  const store = new DesignStore(storage);
  const valid = { version: 1, bookmarks: [], scratchpad: defaultScratchpad() };
  const forged = { id: 'one', title: 'Forged', url: 'javascript:alert(1)', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), revision: 1 };
  for (const raw of ['not json', JSON.stringify({ ...valid, unexpected: true }), JSON.stringify({ ...valid, bookmarks: [forged] }), JSON.stringify({ ...valid, bookmarks: [{ ...forged, url: SOURCE, embedUrl: 'https://evil.example/' }] })]) {
    storage.values.set(DESIGN_STORAGE_KEY, raw);
    assert.throws(() => store.snapshot(), code('CORRUPT_STORAGE'));
    assert.throws(() => store.createBookmark('New', SOURCE), code('CORRUPT_STORAGE'));
    assert.equal(storage.getItem(DESIGN_STORAGE_KEY), raw);
  }
  storage.values.set(DESIGN_STORAGE_KEY, JSON.stringify({ ...valid, version: 2 }));
  assert.throws(() => store.snapshot(), code('UNSUPPORTED_VERSION'));
  storage.readBlocked = true;
  assert.throws(() => store.snapshot(), code('STORAGE_UNAVAILABLE'));
  assert.equal(storage.writes, 0);
});

test('quota failures preserve bookmark and scratchpad revisions for an explicit retry', () => {
  const storage = new MemoryStorage();
  const store = new DesignStore(storage);
  const bookmark = store.createBookmark('Keep', SOURCE);
  const before = storage.getItem(DESIGN_STORAGE_KEY);
  storage.writeBlocked = true;
  assert.throws(() => store.renameBookmark(bookmark.id, 'Not saved', bookmark.revision), code('STORAGE_UNAVAILABLE'));
  assert.throws(() => store.deleteBookmark(bookmark.id, bookmark.revision), code('STORAGE_UNAVAILABLE'));
  assert.throws(() => store.saveScratchpad(drawn()), code('STORAGE_UNAVAILABLE'));
  assert.equal(storage.getItem(DESIGN_STORAGE_KEY), before);
  assert.equal(store.snapshot().scratchpad.revision, 0);
  storage.writeBlocked = false;
  assert.equal(store.saveScratchpad(drawn()).revision, 1);
});

test('bookmark and serialized scratchpad budgets reject growth without advancing stored data', () => {
  const storage = new MemoryStorage();
  const store = new DesignStore(storage);
  for (let index = 0; index < DESIGN_LIMITS.bookmarks; index++) store.createBookmark(`Board ${index}`, SOURCE);
  assert.throws(() => store.createBookmark('One too many', SOURCE), code('LIMIT_EXCEEDED'));
  const before = storage.getItem(DESIGN_STORAGE_KEY);
  const manyPoints: ScratchpadDocument = {
    ...defaultScratchpad(), shapes: Array.from({ length: 12 }, (_, index) => ({ id: `pen-${index}`, kind: 'pen', color: '#000000', width: 1, points: Array.from({ length: 2500 }, () => ({ x: 100.12345678901234, y: 200.12345678901234 })) })),
  };
  assert.throws(() => store.saveScratchpad(manyPoints), code('LIMIT_EXCEEDED'));
  assert.equal(storage.getItem(DESIGN_STORAGE_KEY), before);
  assert.equal(store.snapshot().scratchpad.revision, 0);
});
