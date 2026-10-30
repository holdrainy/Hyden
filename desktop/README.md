# Hyden local desktop foundation

A Tauri 2 + React/TypeScript + Tailwind foundation for a local-first personal
desktop. The existing `../index.html` remains independent.

The shell has a dashboard, registry-driven lazy navigation, collapsible and mobile
sidebars, browser history, Alt+1–6 shortcuts, and a narrow typed IPC boundary. The
**Media Engine now works in browser preview** for session-local file import,
HTML media metadata, audio/video playback, search, favorites, sorting, grid/list
views, item details, and catalog removal. Generated WAV/WebM demo samples ship
locally with the app. Imported files are never uploaded or modified.

The **Workspace works in browser preview** with Markdown notes, a formatting
toolbar and safe rendered preview, and small spreadsheet grids with arithmetic,
cell references, `SUM`, and `AVERAGE`. Notes and sheets support creating, renaming,
deleting, switching, and exporting. Workspace documents save to versioned browser
localStorage and survive reloads on the same origin. Save failures and stale
revisions are reported without silently discarding a draft or resetting storage.

Workspace's **Design & Boards** tab adds local Figma bookmarks and an offline
pen/rectangle scratchpad with actual PNG export. Saved bookmarks do not auto-load
remote content. Choosing **Open** explicitly mounts the separate Figma viewer,
which needs Internet access and permission to view the shared file. Switching to
the offline pad unmounts that viewer. Scratchpad geometry and bookmarks use a
separate local store; existing notes/sheets are not migrated or overwritten.

The **Local AI Copilot has a streaming browser mock** for offline UI development,
with session history and model/system/temperature/context settings. It is clearly
labeled as simulated and makes no model/API request. Native Rust source implements
local-only Ollama/llama.cpp HTTP streaming, model/status discovery, and cancellation;
it has not been compiled or exercised in this cloud workflow. A compatible runner
and downloaded model must be installed and started manually on a developer's
desktop. The app does not start a runner, fetch model weights, or require an API key.

**Studio has browser-local image processing and a media trim planner.** Canvas
performs crop/resize, brightness/contrast, and PNG/WebP/JPEG output on selected
images. Audio/video files can be previewed with a selected trim range and optional
MP3 extraction. The FFmpeg result is a reviewed argument/command plan; it does not
execute FFmpeg or create a trimmed media file in this preview.

**Internal browser has tabs, navigation controls, and a hardened local iframe.**
It displays only bundled local pages. Entering a remote HTTP(S) address records
navigation metadata and shows an explicit local fallback; it never loads that
remote site. Ad/tracker toggles are simulations, with no fabricated blocked-request
counts. Private mode is memory-only by default. Explicit normal mode stores a
separate navigation catalog; private addresses are never copied into it.

The download queue is an explicitly labeled **simulation**: it validates a URL and
demonstrates queue/completion/cancellation without contacting that URL or
downloading media. Completing a demo adds a bundled sample to the library, never
media fetched from the entered URL. The media
catalog and file access live only in the current page session; reloading discards
imports, favorites, and jobs. Removing an item only removes its catalog entry,
never the original file.

Rust media modules define the planned command boundary. Read-only commands report
an empty, unavailable native library/queue; media operations return structured
`NATIVE_NOT_IMPLEMENTED` errors. They do not implement native file access,
downloading, metadata extraction, playback, or persistence. Native Workspace
commands are also explicit integration stubs, not a database/file implementation.
All five feature screens now have browser implementations, with the limited
behaviors above. This remains a foundation rather than a complete desktop suite:
native media/file workflows, SQLite, Python/OpenCV, FFmpeg execution, real remote
webviews, actual ad/tracker filtering, encrypted browser profiles, external cookie
purging, and packaging remain deferred. No model or worker starts
in the background. Core UI assets/fonts are bundled and the app adds no telemetry.
The optional Figma viewer is a third-party online feature: opening it loads Figma
content/resources subject to Figma's service, sharing, cookie, and privacy rules.
It is not an offline copy of a Figma file.

See [architecture.md](docs/architecture.md) for the stack and process model and
[media-engine.md](docs/media-engine.md), [workspace.md](docs/workspace.md), and
[ai-copilot.md](docs/ai-copilot.md), [media-editor.md](docs/media-editor.md), and
[internal-browser.md](docs/internal-browser.md), plus
[design-boards.md](docs/design-boards.md), for browser behavior, adapter
boundaries, runner setup, and remaining native validation.

## Cloud development: frontend only

Use Node.js 22.12+ (Node 24 LTS recommended) and npm. From `desktop/`:

```sh
npm ci
npm run dev
```

Use the browser preview for development in this cloud workspace. **Do not run
Tauri or Cargo commands in the cloud.** Native Rust/system-webview compilation is
outside this workflow; no Rust installation or Linux desktop headers are needed.
The existing Tauri CLI development dependency does not start or build Tauri during
`npm ci`, `npm run dev`, or the frontend checks below.

```sh
npm run check
npm run build
npm test
```

`build` checks TypeScript and generates only frontend assets in `dist/`. `npm test`
runs frontend unit tests through Node 24's built-in TypeScript support; use
Node 24 for this command. Optional
`npm run preview` serves that frontend build. The first dependency installation
needs package-registry access; core features, bundled media, and the scratchpad
work offline. The opt-in live Figma viewer requires network access and file sharing.

An optional end-to-end smoke test uses Python Playwright and `/usr/bin/chromium`
(already available in this cloud workspace):

```sh
# With npm run dev already running:
python3 tests/media_smoke.py
python3 tests/workspace_smoke.py
python3 tests/copilot_smoke.py
python3 tests/browser_smoke.py
python3 tests/editor_smoke.py
python3 tests/design_smoke.py
# For offline testing, serve npm run preview -- --port 1421 in another terminal:
python3 tests/media_smoke.py http://127.0.0.1:1421 --offline
```

The production preview avoids Vite HMR's expected reconnect requests while offline.

## Frontend behavior to validate

With the UI running:

1. Open all five modules from the sidebar/dashboard; check shell Back/Forward and
   Alt+1–6. Distinguish each module's actual browser behavior from its explicit
   simulations, plans, and native limitations.
2. Open the bundled samples and play both audio and video. Check that playback
   controls and metadata appear; media decoding depends on the browser's codecs.
3. Import a small local audio/video file. Check its size/type/duration and video
   dimensions when available, then search, filter, sort, and favorite it. Switch
   modules and return; session state should remain available.
4. Remove an imported catalog entry; verify the original disk file is unaffected.
   Reload the page; imported entries and session changes should be gone.
5. Try an invalid URL in the demo downloader, then queue a valid HTTPS URL.
   Verify the simulation label, cancel behavior, and completed-demo state. Confirm
   no request is sent to the URL and no downloaded file is claimed.
6. Check mobile navigation, grid/list layouts, and the browser console for errors.

For Workspace, create and rename a note, apply toolbar formatting, check the
rendered preview, save, switch documents/modules, and reload. Export Markdown/text
and test copying. In a sheet, enter `2` in A1, `3` in A2, and `=SUM(A1:A2)` in B1;
verify `5`. Check arithmetic, cycle/reference errors, structural row/column edits,
header-row styling, CSV calculated values, and JSON raw formulas. Reload to check
saved data. Test a rejected save without closing the draft; recovery must allow
retry or export. See [workspace.md](docs/workspace.md) for storage limits and
conflict/backup considerations.

For Design & Boards, add a supported Figma bookmark and reload; no remote frame
should appear until explicit **Open**. Frame load signals cannot prove that a
cross-origin board rendered or that sharing was granted. Switch to the offline
pad to unmount Figma, draw a pen stroke and rectangle at different display sizes,
reload to verify saved geometry, and export a 1,200 × 800 PNG. Check storage errors
without resetting notes/sheets. Real shared-file viewing remains a separate
network/sharing check; see [design-boards.md](docs/design-boards.md).

For Copilot, confirm the browser mock label, send a message, observe incremental
chunks, stop a generation, and verify an offline state can be exercised without
requests to a model endpoint. Create/switch sessions, change settings, reload, and
check saved history. Code blocks/Markdown must remain safe text/rendered React
nodes. Test storage failure without losing access to the conversation. These
browser checks do not validate native HTTP streaming or an installed local model;
see [ai-copilot.md](docs/ai-copilot.md).

For Studio, import a small raster image, adjust crop/resize/filter controls, and
explicitly encode/download a local output. Check that output dimensions/format
match the requested values. Select a local audio/video file, adjust both trim
handles, toggle MP3 extraction, and inspect the FFmpeg plan. The copied command is
for a POSIX shell and must not be advertised as a Windows command or executed by
the preview. No generated audio/video output should be claimed.

For Internal browser, check tabs, Back/Forward/Reload, bundled local pages, and
the remote-address fallback without external requests. Confirm private navigation
does not write storage; explicitly enable normal mode to retain its separate
catalog across reloads. Purge resets only this module's catalogs/storage key and
reports that external cookies were not cleared. Verify notes/chats remain intact.
See the module documents for the sandbox, quota, and partial-purge limitations.

These are reproducible validation steps, not a claim that native features or every
browser/codec combination have passed. Native startup, actual media commands,
RAM/CPU budgets, OS file access, native persistence, real local-model requests, downloader integration, and
packaging require separate implementation and tests on a developer's desktop.

## Native development: your own desktop only

This section is for a developer's Windows, macOS, or Linux desktop, **not the cloud
workspace**. Install stable Rust 1.90+ and the platform's
[Tauri prerequisites](https://v2.tauri.app/start/prerequisites/): WebView2 and C++
Build Tools on Windows; Xcode command-line tools on macOS; GTK 3, WebKitGTK 4.1,
and related development libraries on Linux. Tailwind 4 needs a modern webview
(Safari 16.4+ equivalent); define supported OS versions before distribution.

```sh
# Only on your own desktop, from desktop/ after npm ci:
npm run tauri dev
```

Tauri starts Vite itself; do not start a second server on port 1420. Native media
and Workspace operations currently fail explicitly with `NATIVE_NOT_IMPLEMENTED`; the browser
adapter is deliberately not a silent fallback for native failures. The `shell_status`
command remains a separate inert host-metadata operation.

Copilot uses its dedicated local-only native HTTP adapter instead of these stubs.
Its Rust source and protocol fixtures are not evidence of a successful native
build or runner request; validate that path on your own desktop. Browser fallback
is an explicitly chosen host mode, never recovery from a failed native request.
Copilot history currently lives in webview localStorage in either transport mode,
not in SQLite or native files.

Editor native source can plan FFmpeg arguments, but execution and OpenCV hooks
remain `NATIVE_NOT_IMPLEMENTED`. Browser capability reporting keeps `liveBrowsing: false`;
there is no OS webview/profile integration behind the local iframe. None of these
new native sources has been compiled in this cloud workflow.

Capabilities apply only to the local `main` window. No arbitrary filesystem,
HTTP, shell execution, or remote-content permissions are granted. Copilot's native
HTTP is limited inside Rust to validated loopback runner endpoints; browser CSP
does not grant arbitrary network access. Production CSP
allows local assets, local image/media blobs, same-origin local frames, IPC, and
only the named Figma frame origins for Design & Boards. This does not widen
Internal browser's fixed local-page mapping or grant remote content native
commands. The development policy also permits
Vite's loopback HMR and refresh/style injection. Packaging is disabled until icons,
signing, dependencies, and distribution choices are settled.

## Extend a module

Add a typed descriptor to `src/modules/registry.ts`; the sidebar and overview
derive from it. Keep real views lazy-loaded and route operations through
`src/lib/ipc.ts`. Browser behavior belongs in a browser adapter; native behavior
belongs in operation-specific Rust commands with validated DTOs and explicit
permissions. Register commands in both the handler and build manifest. Never add
a generic shell executor or unrestricted path/SQL API.

This is a trusted build-time module registry, not an untrusted plugin loader.
Future native jobs should outlive view changes, release resources when cancelled,
and run heavy tools only on demand.
