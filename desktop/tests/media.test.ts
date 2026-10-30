import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BrowserMediaEngine, inferMediaKind, validateDownloadUrl } from '../src/lib/browser-media.ts';

test('accepts media and validates download URLs without requesting them', () => {
  assert.equal(inferMediaKind({ name: 'song.WAV', type: '' }), 'audio');
  assert.equal(inferMediaKind({ name: 'clip.webm', type: 'video/webm' }), 'video');
  assert.equal(inferMediaKind({ name: 'image.png', type: 'image/png' }), null);
  assert.equal(inferMediaKind({ name: 'script.mp4', type: 'text/javascript' }), null);
  assert.equal(validateDownloadUrl(' https://example.com/watch?v=1#t=4 ').href, 'https://example.com/watch?v=1');
  for (const url of ['javascript:alert(1)', 'file:///etc/passwd', 'http://example.com/a', 'https://name:password@example.com', 'not a url']) {
    assert.throws(() => validateDownloadUrl(url));
  }
});

test('imports files, rejects duplicates and invalid inputs, and revokes owned URLs', async (t) => {
  const created: string[] = [];
  const revoked: string[] = [];
  t.mock.method(URL, 'createObjectURL', () => {
    const url = `blob:fixture-${created.length}`;
    created.push(url);
    return url;
  });
  t.mock.method(URL, 'revokeObjectURL', (url: string) => revoked.push(url));
  const engine = new BrowserMediaEngine(async () => ({ durationSeconds: 12, width: 640, height: 360 }));
  const clip = new File(['video'], 'clip.webm', { type: 'video/webm', lastModified: 10 });
  const result = await engine.importFiles([clip, clip, new File(['image'], 'cover.png', { type: 'image/png' }), new File([], 'empty.wav', { type: 'audio/wav' })]);
  assert.equal(result.items.length, 1);
  assert.equal(result.skipped.length, 3);
  assert.equal(created.length, 1, 'duplicates and invalid files never allocate URLs');
  const item = result.items[0];
  assert.equal(item.title, 'clip');
  assert.equal(item.width, 640);
  assert.equal(engine.playbackSource(item.id), created[0]);
  assert.equal(engine.favorite(item.id, true).favorite, true);
  const copy = engine.library();
  copy.items[0].title = 'tampered';
  assert.equal(engine.library().items[0].title, 'clip', 'UI cannot mutate the internal catalog');
  engine.remove(item.id);
  assert.deepEqual(revoked, [created[0]]);
  assert.throws(() => engine.playbackSource(item.id), /no longer/);
  assert.equal((await engine.importFiles([clip])).items.length, 1, 'removed file can be reimported');
  engine.dispose();
  assert.deepEqual(revoked, created);
});

test('failed metadata releases the Blob and does not poison the import queue', async (t) => {
  let attempts = 0;
  const revoked: string[] = [];
  t.mock.method(URL, 'createObjectURL', () => 'blob:probe');
  t.mock.method(URL, 'revokeObjectURL', (url: string) => revoked.push(url));
  const engine = new BrowserMediaEngine(async () => {
    attempts++;
    if (attempts === 1) throw new Error('Unsupported codec');
    return { durationSeconds: 3 };
  });
  const file = new File(['data'], 'sample.wav', { type: 'audio/wav' });
  const rejected = await engine.importFiles([file]);
  assert.match(rejected.skipped[0], /Unsupported codec/);
  assert.deepEqual(revoked, ['blob:probe']);
  assert.equal(engine.library().items.length, 2);
  assert.equal((await engine.importFiles([file])).items.length, 1);
  engine.dispose();
});

test('serializes metadata decoding across concurrent batches and enforces limits', async () => {
  let active = 0;
  let peak = 0;
  const engine = new BrowserMediaEngine(async () => {
    active++; peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active--;
    return { durationSeconds: 1 };
  });
  const file = new File(['data'], 'one.wav', { type: 'audio/wav', lastModified: 1 });
  const results = await Promise.all([engine.importFiles([file]), engine.importFiles([file])]);
  assert.equal(peak, 1);
  assert.equal(results[0].items.length, 1);
  assert.equal(results[1].skipped.length, 1);
  await assert.rejects(engine.importFiles(Array(21).fill(file)), /at most 20/);
  const large = new File(['data'], 'large.wav', { type: 'audio/wav' });
  Object.defineProperty(large, 'size', { value: 513 * 1024 * 1024 });
  assert.match((await engine.importFiles([large])).skipped[0], /512 MB/);
  engine.dispose();
});

test('download simulation has explicit terminal states and uses bundled samples only', (t) => {
  t.mock.method(globalThis, 'fetch', () => { throw new Error('Simulation must never access the network'); });
  const engine = new BrowserMediaEngine();
  const job = engine.enqueueDownload('https://example.com/video', 'video');
  assert.equal(job.status, 'queued');
  assert.equal(job.simulated, true);
  assert.equal(engine.library().items.length, 2);
  const completed = engine.runDownloadDemo(job.id);
  assert.equal(completed.progress, 100);
  assert.equal(completed.status, 'completed');
  const item = engine.library().items.find((entry) => entry.id === completed.itemId)!;
  assert.equal(item.source, 'demo');
  assert.equal(engine.playbackSource(item.id), '/media/color-study.webm');
  assert.throws(() => engine.runDownloadDemo(job.id), /Only queued/);
  assert.throws(() => engine.cancelDownload(job.id), /Only queued/);
  const cancelled = engine.enqueueDownload('https://example.com/audio', 'audio');
  assert.equal(engine.cancelDownload(cancelled.id).status, 'cancelled');
  assert.throws(() => engine.runDownloadDemo(cancelled.id), /Only queued/);
  for (let i = 2; i < 50; i++) engine.enqueueDownload('https://example.com/audio', 'audio');
  assert.throws(() => engine.enqueueDownload('https://example.com/audio', 'audio'), /limited to 50/);
  engine.dispose();
});

test('notifies a newly mounted view when an earlier view’s import completes', async () => {
  let finishProbe: (value: { durationSeconds: number }) => void = () => {};
  const engine = new BrowserMediaEngine(() => new Promise((resolve) => { finishProbe = resolve; }));
  let oldViewNotifications = 0;
  const leaveOldView = engine.subscribe(() => oldViewNotifications++);
  const pendingImport = engine.importFiles([new File(['data'], 'pending.wav', { type: 'audio/wav' })]);
  // Let the queued import enter its async probe before unmounting the old view.
  await Promise.resolve();
  leaveOldView();
  let visibleCount = engine.library().items.length;
  const leaveNewView = engine.subscribe(() => { visibleCount = engine.library().items.length; });
  finishProbe({ durationSeconds: 5 });
  await pendingImport;
  assert.equal(oldViewNotifications, 0);
  assert.equal(visibleCount, 3, 'new view receives the completed import without polling/remounting');
  leaveNewView();
  engine.dispose();
});
