# Studio: image outputs and media command plans

## What is implemented

Studio has two local tools with different output behavior:

- **Image Processor** actually decodes a user-selected PNG, WebP, or JPEG, renders
  crop/resize and brightness/contrast adjustments, and encodes a downloadable local
  image. No upload, hosted service, OpenCV process, or Python runtime is used.
- **Audio/Video Trimmer** previews a selected local media file, accepts start/end
  trim positions and an MP3 extraction option, and produces a validated FFmpeg
  argument/command plan. It does not run FFmpeg or produce a trimmed audio/video
  file in the browser.

Native Rust contains an actual pure command planner and explicit unavailable
execution/OpenCV hooks. This source has not been compiled or run in the cloud.
The browser foundation does not claim batch processing, a timeline editor, effects
composition, arbitrary codec support, or a completed native processing pipeline.

## Image Processor

Choose one supported raster file. Before decoding, the helper reads at most the
first 256 KiB to identify PNG/JPEG/WebP dimensions and reject unknown formats,
SVG, or oversized sources. Successful decode is checked again against the size
limits. A malformed file or unsupported browser decoder reports an error.
Exports are still images; any animation in PNG/WebP inputs is not preserved.

Crop uses whole-pixel X/Y/width/height coordinates inside the decoded source.
Resize specifies output width/height, with optional preservation of the crop's
aspect ratio. Brightness and contrast range from 0–200%, with 100% as neutral.
The same bounded pixel adjustment is used by preview and export.

Preview rendering is debounced and scaled to at most 1,024 pixels on the longest
side. Moving sliders does not repeatedly encode a full-size output. **Export
image** explicitly renders the requested full output dimensions and encodes a Blob:
PNG is lossless, WebP/JPEG expose quality, and JPEG transparency is flattened onto
white. If the browser cannot encode the requested MIME format, export fails
instead of silently downloading another format with the wrong extension.

| Bound | Value |
| --- | --- |
| Input file | More than 0 bytes; at most 20 MiB |
| Header inspection | At most 256 KiB |
| Decoded source side | At most 8,192 pixels |
| Source/output pixel budget | 16,777,216 pixels (UI: 16 megapixels) |
| Output side | 1–4,096 pixels |
| Preview side | At most 1,024 pixels |
| Decode timeout | 8 seconds |
| Lossy quality | 10–100%; default 90% |

These limits bound work but do not guarantee a fixed RAM footprint: decoded
bitmaps, canvases, and encoding can require several copies of pixel data. Preview
is lower resolution than export, so fine resampling details can differ. Canvas
output is a new still image; no promise is made to preserve animation, original
EXIF/ICC metadata, or archival color fidelity.

The original file is never changed. The browser downloads a new `-edited` file;
that result is not automatically inserted into the Media Engine catalog. Editing
state is not a persistent project. Replacing a source or leaving the tool releases
its bitmap/object URL; stale asynchronous decodes are disposed instead of applied
to a newer selection. Export canvases are released and temporary download URLs are
revoked. Re-select the source to start another editing session.

## Audio/video preview and trim selection

Select a local audio/video file supported by the browser's HTML media decoder.
The tool reads media metadata, uses a local object URL for playback, and exposes
two range controls for start and end. File contents are not uploaded. Decoder/
codec errors are separate from the validity of an FFmpeg plan: a browser may not
play a format that an appropriately built FFmpeg supports, and vice versa.

A valid plan requires a finite positive duration no longer than 24 hours, a
selection within that duration, and at least 0.05 seconds selected. Times are
quantized to milliseconds for the command. Audio input or the audio-only option
produces an MP3 extraction plan; video output is an MP4 trim/transcode plan.
Playback/selection does not modify the source file.

## FFmpeg plan contract

The plan includes `program`, `args`, `displayCommand`, `outputName`, `mode:
"plan-only"`, and an explanatory notice. It accepts a local basename, never a URL,
path, or shell fragment. Names containing path separators, colons, control
characters, or invalid special basenames are rejected. Input/output arguments
are prefixed with `./`; output stems are sanitized.

Shared flags are:

```text
-nostdin -n -ss START -i ./INPUT -t SELECTED_DURATION
```

`-nostdin` disables interactive input and `-n` prevents overwriting an existing
output. MP3 plans add `-vn -c:a libmp3lame -q:a 2` and a `-audio.mp3` output. Video
plans map the first available video/audio streams and use `libx264`, `veryfast`,
CRF 23, AAC, and `+faststart` with a `-trimmed.mp4` output. These are explicit
transcode presets rather than lossless stream-copy promises.

The displayed/copied command quotes every argument for a **POSIX shell**. It is
not a generally portable Windows CMD/PowerShell command. To use it manually,
review it on your own computer beside the input file, with the required FFmpeg
build/codecs installed. The app does not install FFmpeg or execute the command in
the cloud. A future executor must pass `args` directly to a supervised process,
not execute `displayCommand` through a shell. Basename validation is not a
substitute for an approved native file-asset registry.

A displayed plan is not evidence of successful encoding. Missing codecs,
unreadable/missing sources, unsupported streams, or existing output files can
still prevent a manual run. No resulting audio/video file is claimed until an
actual separate executor succeeds.

## Source and native boundaries

UI lives under `src/modules/MediaEditor/`: `MediaEditor.tsx`, `Trimmer.tsx`, and
`ImageProcessor.tsx`, with their styles. Pure browser image helpers are in
`src/lib/browser-image.ts`; shared contracts/planning are in `editor-types.ts` and
`editor-plan.ts`. UI calls `loadEditorImage`/`exportEditorImage` through
`src/lib/ipc.ts`; these perform actual local Canvas work in either browser or
native webview. Native operations use that boundary's separate typed hooks.

Rust source lives under `src-tauri/src/modules/editor/`:

| Native command | Current behavior |
| --- | --- |
| `editor_capabilities` | Reports FFmpeg execution and native image processing unavailable |
| `editor_trim_plan` | Validates input and returns the pure FFmpeg argument/POSIX display plan |
| `editor_run_trim` | Validates the plan, then returns `NATIVE_NOT_IMPLEMENTED` |
| `editor_process_image` | Returns `NATIVE_NOT_IMPLEMENTED`; performs no path/process access |

The image hook accepts a typed asset ID and transformation request for a future
OpenCV adapter; there is no generic path, script, or executable command. A future
native milestone must add a trusted OS file-picker/asset registry, validate crop/
resize and decode budgets, supervise tools/workers with timeouts/cancellation and
bounded concurrency, preserve verification, and test platform codecs. Review the
exact FFmpeg distribution's LGPL/GPL options, codec licensing, and packaging
requirements before shipping.

## Validation scope

Use the frontend-only cloud workflow in the README. Check actual encoded image
MIME/dimensions/pixel behavior, invalid headers/bounds, reset/replacement/cleanup,
responsive controls, local media playback, trim validation, MP3 toggling, and exact
argument/display quoting. A downloaded image should exist; a trim action should
produce only an explicitly labeled plan. No source file should be modified.

Unit tests and browser checks can validate these frontend behaviors and inspect
source-level contracts. Native planner/executor/OpenCV startup, process
cancellation, real transcoding, OS permissions, memory budgets, and packaging
remain separate own-desktop work. Do not run Tauri, Cargo, native builds, or media
subprocesses in the cloud to imply those paths were verified.
