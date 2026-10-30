import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { EditorTrimRequest } from '../src/lib/editor-types.ts';
import { createTrimPlan, shellQuote } from '../src/lib/editor-plan.ts';

const request = (patch: Partial<EditorTrimRequest> = {}): EditorTrimRequest => ({ inputName: 'holiday clip.webm', inputKind: 'video', durationSeconds: 60, startSeconds: 5, endSeconds: 15.25, audioOnly: false, ...patch });

test('FFmpeg plan uses exact timing, bounded re-encoding and non-overwriting argument arrays', () => {
  const plan = createTrimPlan(request());
  assert.equal(plan.mode, 'plan-only');
  assert.equal(plan.outputName, 'holiday clip-trimmed.mp4');
  assert.deepEqual(plan.args, ['-nostdin', '-n', '-ss', '5.000', '-i', './holiday clip.webm', '-t', '10.250', '-map', '0:v:0?', '-map', '0:a:0?', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-c:a', 'aac', '-movflags', '+faststart', './holiday clip-trimmed.mp4']);
  assert.ok(!plan.args.includes('-y'));
  assert.ok(!plan.args.includes('copy'), 'video trim re-encodes rather than claiming keyframe-inexact stream-copy trimming');
  assert.match(plan.notice, /No media has been processed/);
  assert.equal(createTrimPlan(request({ startSeconds: 1.0625 })).args[3], '1.063');
});

test('audio extraction uses MP3 and audio input always selects an audio output', () => {
  for (const patch of [{ audioOnly: true }, { inputKind: 'audio' as const, audioOnly: false, inputName: 'recording.wav' }]) {
    const plan = createTrimPlan(request(patch));
    assert.match(plan.outputName, /-audio\.mp3$/);
    assert.deepEqual(plan.args.slice(8), ['-vn', '-c:a', 'libmp3lame', '-q:a', '2', `./${plan.outputName}`]);
  }
});

test('display shell quoting contains metacharacters and the argv retains exact local names', () => {
  assert.equal(shellQuote("a'b"), "'a'\\''b'");
  assert.deepEqual([...shellQuote("a'b")].map((character) => character.charCodeAt(0)), [39, 97, 39, 92, 39, 39, 98, 39]);
  const name = "-a'b $(touch BAD);`id`.webm";
  const plan = createTrimPlan(request({ inputName: name }));
  assert.equal(plan.args[5], `./${name}`);
  assert.ok(plan.displayCommand.startsWith("'ffmpeg' '-nostdin' '-n'"));
  assert.ok(plan.displayCommand.includes("'./-a'\\''b $(touch BAD);`id`.webm'"));
  assert.equal(plan.outputName, '-a_b __touch BAD___id_-trimmed.mp4');
});

test('non-local filenames, invalid bounds and nonfinite values cannot produce a plan', () => {
  for (const inputName of ['', ' ', '.', '..', '../clip.mp4', 'C:\\clip.mp4', 'https://example.com/video', 'clip\n.mp4', 'x'.repeat(201)]) {
    assert.throws(() => createTrimPlan(request({ inputName })));
  }
  for (const patch of [
    { durationSeconds: 0 }, { durationSeconds: 86401 }, { durationSeconds: Infinity },
    { startSeconds: NaN }, { startSeconds: -1 }, { startSeconds: 16 }, { endSeconds: 61 },
    { startSeconds: 5, endSeconds: 5.01 }, { endSeconds: Number.NEGATIVE_INFINITY },
  ]) assert.throws(() => createTrimPlan(request(patch)));
  assert.doesNotThrow(() => createTrimPlan(request({ startSeconds: 1, endSeconds: 1.05 })));
});
