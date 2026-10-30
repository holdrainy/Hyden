import type { EditorTrimRequest, FFmpegPlan } from './editor-types.ts';

/** POSIX display/copy only. A native executor must pass the argument array directly. */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function createTrimPlan(request: EditorTrimRequest): FFmpegPlan {
  const { inputName, inputKind, durationSeconds, startSeconds, endSeconds } = request;
  if (typeof inputName !== 'string' || !inputName.trim() || inputName.length > 200
    || ['.', '..'].includes(inputName.trim()) || /[\\/:\u0000-\u001f\u007f]/.test(inputName)) {
    throw new Error('Choose a local file with a basename of at most 200 characters, without path separators, colons, or control characters.');
  }
  if (inputKind !== 'audio' && inputKind !== 'video') throw new Error('Choose an audio or video file.');
  if (typeof request.audioOnly !== 'boolean') throw new Error('Choose whether to extract audio only.');
  if (![durationSeconds, startSeconds, endSeconds].every((value) => typeof value === 'number' && Number.isFinite(value))
    || durationSeconds <= 0 || durationSeconds > 86400 || startSeconds < 0 || endSeconds > durationSeconds
    || endSeconds - startSeconds + 1e-9 < 0.05) {
    throw new Error('Choose a range of at least 0.05 seconds within the media duration (maximum 24 hours).');
  }
  const audioOnly = request.audioOnly || inputKind === 'audio';
  const stem = inputName.replace(/\.[^.]*$/, '').replace(/[^A-Za-z0-9._ -]/gu, '_').replace(/^[. ]+|[. ]+$/g, '').slice(0, 120) || 'media';
  const outputName = `${stem}${audioOnly ? '-audio.mp3' : '-trimmed.mp4'}`;
  const seconds = (value: number) => (Math.round(value * 1000) / 1000).toFixed(3);
  const args = ['-nostdin', '-n', '-ss', seconds(startSeconds), '-i', `./${inputName}`, '-t', seconds(endSeconds - startSeconds)];
  if (audioOnly) args.push('-vn', '-c:a', 'libmp3lame', '-q:a', '2', `./${outputName}`);
  else args.push('-map', '0:v:0?', '-map', '0:a:0?', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-c:a', 'aac', '-movflags', '+faststart', `./${outputName}`);
  return {
    program: 'ffmpeg', args, displayCommand: ['ffmpeg', ...args].map(shellQuote).join(' '), outputName, mode: 'plan-only',
    notice: 'Command plan only. No media has been processed. Run the reviewed command beside your input file on a computer with the required FFmpeg codecs; native execution needs an approved local file workflow.',
  };
}
