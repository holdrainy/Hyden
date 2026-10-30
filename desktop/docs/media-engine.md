# Media Engine: browser implementation and native boundary

## What works now

Open **Media library** in the browser preview. The Media Engine supports:

- A session-local library with two generated, bundled samples: a WAV audio clip
  and a WebM video clip. No external media host is used.
- Importing user-selected audio/video files with the browser file picker. File
  contents remain on the device; there is no upload or filesystem mutation.
- Reading duration and, for supported video files, dimensions through a detached
  HTML media element. Filename, byte size, MIME type, and import date accompany
  those fields. This is browser metadata probing, not FFmpeg tag extraction.
- Audio/video playback through the browser's media controls using local Blob URLs
  or bundled sample paths. Supported formats depend on installed browser codecs.
- Library search, audio/video/favorite filters, sorting, grid/list display,
  favorites, item details, and removing catalog entries.
- A URL download queue **simulation** with queued, completed, and cancelled states.
  It makes no request to the entered URL. Running a demo immediately completes the
  job and adds a bundled sample labeled as a simulation to the library. It does
  not fetch, decode, or save the referenced remote media.

Workspace, Copilot, Studio, and Internal browser also have their own browser
implementations. Their limits are described in the corresponding module documents.
The Media Engine starts no Python worker, FFmpeg/yt-dlp subprocess, local model,
database daemon, or background downloader.

## Session and file lifecycle

The browser adapter is a lazily created singleton shared across Media Engine view
remounts. Switching modules preserves the session catalog. A full page reload ends
the session and resets imports, favorites, and demo jobs. There is no durable
catalog, IndexedDB Blob store, or persisted OS file permission. The generated demo
samples are available again after reload because they are app assets.

The mounted screen subscribes to adapter changes and unsubscribes when it leaves.
An import that finishes after navigation refreshes the newly mounted library,
without polling or retaining a reference to the old screen.

Only object URL references are retained for imported files; file bytes are not
base64-encoded or copied into JSON. Successful imports retain their URLs until
catalog removal or browser-session teardown. Failed probes revoke their URLs.
Catalog removal never deletes or changes the original disk file. A removed item
must be imported again to regain access.

Current resource limits are explicit:

| Operation | Limit |
| --- | --- |
| Import batch | 20 selected files |
| File size | 512 MiB per file |
| Session library | 500 items, including samples |
| Demo queue | 50 jobs per session |
| Metadata probing | One active probe; 8-second timeout per file |
| URL input | HTTPS only, no embedded credentials; maximum 2,048 characters |

Imports are serialized even when separate batches overlap. Metadata probes request
metadata only, detach their media element afterward, and stop on unsupported or
malformed files. Files with the same name/size/last-modified fingerprint are
skipped as duplicates within the session. This fingerprint is a convenience, not a
cryptographic content hash. MIME/extension recognition selects a decoder; it does
not prove a file is safe or decodable. Keep the browser and OS media stack patched.

The queue has no polling or progress timer. Its progress values describe explicit
user-driven demo transitions, not bytes downloaded. Cancelling is supported only
while a demo job is queued; completed/cancelled jobs cannot run again.

## UI and adapter boundary

```text
MediaScreen.tsx
    │ calls public media functions
    ▼
src/lib/ipc.ts
    ├── browser ── lazy BrowserMediaEngine ── File/Blob + HTML media element
    │                                      └── local generated sample assets
    └── Tauri ──── operation-specific Rust invoke ── explicit native stubs
```

`src/lib/media-types.ts` defines the shared frontend DTOs. UI components never
import or call the browser engine directly. The `ipc.ts` boundary chooses its host
using Tauri detection; native errors are surfaced rather than converted into a
successful browser demonstration. Selected browser `File` objects are never
serialized to Rust. Native file import is reserved for a future trusted OS picker
and approved-path workflow.

| Frontend operation | Native command | Native implementation now |
| --- | --- | --- |
| `getMediaLibrary` | `media_library` | Empty library, unavailable features, explanatory notice |
| `importMediaFiles` | `media_import` | `NATIVE_NOT_IMPLEMENTED` |
| `setMediaFavorite` | `media_set_favorite` | `NATIVE_NOT_IMPLEMENTED` |
| `removeMediaItem` | `media_remove` | `NATIVE_NOT_IMPLEMENTED` |
| `getMediaPlaybackSource` | `media_playback_source` | `NATIVE_NOT_IMPLEMENTED` |
| `getDownloadJobs` | `media_download_jobs` | Empty queue |
| `enqueueMediaDownload` | `media_enqueue_download` | `NATIVE_NOT_IMPLEMENTED` |
| `runDownloadDemo` | `media_run_download_demo` | `NATIVE_NOT_IMPLEMENTED` |
| `cancelMediaDownload` | `media_cancel_download` | `NATIVE_NOT_IMPLEMENTED` |

Native DTOs and command handlers live under `src-tauri/src/modules/media/`, split
into `models.rs`, `commands.rs`, and `service.rs`. Error responses use
`{ code, message }`. The service defines future `MediaRepository`, `MediaProbe`,
and `MediaDownloader` boundaries; there is no implementation behind those traits.
Permissions grant only the named commands to the local main window. No generic
subprocess runner, arbitrary read/write API, or remote-content privilege is added.

## Remaining native work

Implement the following in a separate native-development milestone, validated on a
developer's desktop rather than compiled in this cloud workflow:

1. A trusted file-picker flow and approved media path registry, including revoked
   access, external-disk removal, and path canonicalization/error handling.
2. SQLite schema/migrations and repository implementations for durable catalog
   metadata, favorites, and jobs; define which source files are referenced versus
   copied. Do not silently duplicate large media collections.
3. A supervised ffprobe/FFmpeg metadata adapter and a constrained local playback
   source mechanism. Validate formats, bounded output, timeouts, and safe paths.
4. A real yt-dlp downloader adapter with explicit user initiation, URL/destination
   validation, bounded concurrency, cancellation, tool verification, and failures.
   Never interpolate URL or path input into a shell command. A simulated success
   must not be reused as proof of network download support.
5. Platform codec and packaging tests, license review for the exact FFmpeg build,
   resource measurement, and lifecycle tests for app exit and interrupted jobs.

No API key or recurring service is required for the browser preview. A real
network downloader requires Internet access at the time of downloading; downloads
and external site compatibility do not become offline features simply because the
library itself is local.

## Frontend validation

From `desktop/`, use Node 24 and run `npm ci`, `npm run dev`, `npm run check`,
`npm run build`, and `npm test`. The unit suite exercises browser-adapter behavior
with controlled metadata probing; it does not establish actual codec decoding or
native IPC. Use the README's browser smoke workflow for real local file decoding,
audio/video playback, catalog operations, demo job states, and responsive UI.

Do not run Tauri or Cargo in the cloud. The existence of Rust source, generated
permissions, or a passing frontend build is not evidence that native commands,
packaging, file persistence, or downloader behavior work.
