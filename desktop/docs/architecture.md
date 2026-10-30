# Local desktop architecture

## Current scope

Use a **modular monolith with a small kernel**: one trusted Tauri application owns
the window, settings, storage, permissions, and job lifecycle; feature modules use
those services through explicit interfaces. The frontend discovers navigation
from a typed module registry. This is a static, compiled module system, not a
third-party plugin loader with arbitrary code execution.

The current implementation includes the responsive shell and a browser-preview
Media Engine: a session-local catalog, user-selected file metadata probing and
playback, search/filter/sort/favorites, and an explicitly simulated download queue.
The browser adapter uses local Blob URLs and bundled samples; imported files are
not uploaded, copied into a database, or persisted after reload. A completed demo
queue item adds a bundled sample, not media fetched from the entered URL.

Workspace is also implemented in the browser: canonical Markdown notes with a
toolbar and safe React preview, small sparse spreadsheet grids, a bounded formula
interpreter, document management, and portable exports. Unlike the media catalog,
saved Workspace documents survive reloads in versioned localStorage. The adapter
validates saved data and revisions and reports storage failures/conflicts without
silently resetting the store. See [workspace.md](workspace.md) for precise limits
and recovery behavior.

Workspace's Design & Boards tab adds an independent local bookmark/scratchpad
store and an opt-in Figma iframe. No remote content loads from persisted bookmarks
alone: explicit Open derives a validated embed URL. The offline pen/rectangle pad
exports an actual PNG and unmounts the live viewer. Existing notes/sheets remain
under their original key; no Notes migration is involved. Figma viewing requires
network access and shared-file permission; see [design-boards.md](design-boards.md).

Local AI Copilot has a browser transport that produces cancellable mock chunks
without network access, plus native Rust source for real Ollama JSONL and
llama.cpp SSE streaming. Native compilation and runner integration have not been
performed in this cloud workflow. Session history/settings use a versioned,
bounded webview localStorage store in both transport modes; no model is downloaded
or started by the app. See [ai-copilot.md](ai-copilot.md) for the distinction,
local-runner setup, limits, and remaining desktop validation.

Studio now has real browser Canvas crop/resize/filter/format output for local
images, plus audio/video preview and a bounded FFmpeg trim/MP3 command planner.
The command is a plan, not an executed job or produced media file. The Internal
browser has tab/navigation state and a sandboxed iframe restricted to bundled
local pages. Remote URL input updates navigation metadata and shows a local
fallback; it never fetches that site. Blocking toggles are explicitly simulated.
See [media-editor.md](media-editor.md) and [internal-browser.md](internal-browser.md).

Rust Media Engine and Workspace DTOs and service/command boundaries are
source-level stubs. Native snapshots expose unavailable feature state; operations
return `NATIVE_NOT_IMPLEMENTED`. Native media handling and Workspace persistence,
actual downloads, SQLite, Python/OpenCV workers, FFmpeg execution, real remote
browsing, request filtering, encrypted browser profiles, and external cookie
purging are future work. All five feature screens have bounded browser
implementations; this does not make every feature production-complete. Copilot's real
native adapter is source implemented but unverified at runtime. No model, worker,
or remote service starts in the background. Core assets/fonts and samples are
local. Explicitly opening Figma loads third-party remote iframe resources; it is
an optional online feature, not an offline asset. The repository-root `index.html`
remains independent.

## Recommended stack

| Layer | Choice | Reason |
| --- | --- | --- |
| Desktop wrapper | Tauri 2, stable Rust | Uses the OS webview rather than shipping Chromium; explicit command permissions |
| UI | React, TypeScript, Vite, Tailwind CSS | Small static UI build, typed module contracts, build-time styles |
| Browser Workspace | Markdown source, safe React rendering, bounded formula parser, localStorage | No rich-text framework, external formula runtime, or database daemon required for this small implementation |
| Design & Boards | Validated Figma embeds, local SVG gestures, Canvas PNG export, separate localStorage | Only explicit live-view Open contacts Figma; scratchpad and bookmarks remain local |
| Native kernel | Rust services and narrowly scoped Tauri commands | Owns filesystem access, SQLite, child processes, and privileged operations |
| Local database, future | SQLite through `rusqlite` | Embedded, transactional, no database daemon; one Rust owner of writes |
| Heavy processing, future | On-demand Python sidecar | Reuses selected Python libraries without an idle Python web server |
| Media processing, future | FFmpeg/ffprobe child processes | Native streaming/batch operations; no reason to load Python for every operation |
| Copilot | Native Rust HTTP adapter for local llama.cpp/Ollama; browser mock; webview localStorage history | Only native transport contacts the user's manually started runner; no hosted model API |
| Studio | Browser Canvas images and HTML media preview; FFmpeg argv planning | Real image encoding, explicit command-only media export; native execution/OpenCV deferred |
| Internal browser | Memory/private and opt-in navigation storage; sandboxed local iframe | Bundled pages only; remote browsing/blocking/encrypted profiles unsupported |

Tauri reduces the shipped runtime relative to Electron, but total RAM depends on
the OS webview, open documents, media, and model. Measure before setting footprint
claims. Do not preload every module, decode videos into JavaScript arrays, or
load an LLM at startup. Use one heavy job at a time by default, bounded queues,
virtualized long lists, explicit worker thread limits, and no idle polling.

“Zero recurring dependencies” means no subscriptions, cloud API requirement, or
service bill. Development tools, OS webview packages, optional model downloads,
FFmpeg binaries, and occasional dependency/security updates are still needed.
Future real media downloads/remote browsing require network access when used.
Current live Figma viewing is also online and subject to Figma sharing; bookmarks
are not cached files. Core local features and scratchpad remain available offline.

## Directory structure

Unmarked paths are implemented in this slice; `(stub)` paths define future native
integration without executing it. `(future)` paths remain proposed extension
points, not implementations supplied by this slice.

```text
Hyden/
├── index.html                         existing standalone app, preserved
└── desktop/
    ├── package.json
    ├── package-lock.json
    ├── index.html                     Vite entry
    ├── vite.config.ts
    ├── public/media/                  generated local WAV/WebM samples
    ├── tests/media.test.ts            browser-adapter unit tests
    ├── tests/workspace.test.ts        versioned storage and conflict tests
    ├── tests/formulas.test.ts         formula limits and structural edits
    ├── tests/markdown.test.ts         formatting and preview budgets
    ├── tests/workspace_smoke.py       editing, exports and persistence in Chromium
    ├── tests/copilot-history.test.ts  bounded sessions, revisions and storage errors
    ├── tests/copilot-mock.test.ts     offline mock streaming and cancellation
    ├── tests/editor-plan.test.ts      trim validation and command quoting
    ├── tests/image-settings.test.ts   image headers, limits and pixel adjustments
    ├── tests/internal-browser.test.ts private/normal catalogs and purge scope
    ├── tests/design.test.ts           validated Figma URLs and separate local store
    ├── tests/drawing.test.ts          scaled pointer geometry and drawing/export helpers
    ├── tests/design_smoke.py          opt-in frame lifecycle and offline drawing in Chromium
    ├── src/
    │   ├── app/                       shell and app composition
    │   ├── components/                shared dashboard/navigation components
    │   ├── modules/                   typed registry + lazy screens
    │   │   ├── media/
    │   │   │   ├── MediaScreen.tsx    browser library/player/queue UI
    │   │   │   └── media.css          Media Engine styles
    │   │   ├── MediaEditor/           image processor and audio/video trim planner
    │   │   ├── AICopilot/             streaming chat, sessions, settings, safe code display
    │   │   ├── Workspace/
    │   │   │   ├── Workspace.tsx      document management and save/recovery flow
    │   │   │   ├── Notes.tsx          Markdown toolbar and preview
    │   │   │   ├── Sheets.tsx         grid and export UI
    │   │   │   ├── Design/            opt-in Figma viewer and offline scratchpad
    │   │   │   ├── markdown.tsx       safe, bounded React preview
    │   │   │   ├── markdown-helpers.ts formatting and Markdown helpers
    │   │   │   ├── formulas.ts        bounded evaluator and structural edits
    │   │   │   └── *.css              Workspace styles
    │   │   └── InternalBrowser/       local navigation and hardened preview iframe
    │   └── lib/
    │       ├── ipc.ts                 typed dispatch to native or browser adapter
    │       ├── media-types.ts         shared frontend media DTOs
    │       ├── browser-media.ts       session catalog, metadata, demo jobs
    │       ├── workspace-types.ts     versioned documents and limits
    │       ├── browser-workspace.ts   validated browser persistence
    │       ├── copilot-types.ts       transport and history DTOs, settings/limits
    │       ├── mock-copilot.ts        cancellable browser-only response chunks
    │       ├── copilot-history.ts     validated webview localStorage persistence
    │       ├── editor-types.ts        trim/image/capability contracts
    │       ├── editor-plan.ts         safe basename/FFmpeg argument planning
    │       ├── browser-image.ts       bounded Canvas decode/render/encode
    │       ├── design-types.ts        bookmark/scratchpad contracts and limits
    │       ├── design-store.ts        separate versioned local profile store
    │       ├── figma-url.ts           strict Figma URL normalization/embedding
    │       ├── browser-types.ts       navigation/capability/purge contracts
    │       └── internal-browser.ts    separate private/normal navigation catalogs
    ├── src-tauri/
    │   ├── Cargo.toml
    │   ├── tauri.conf.json
    │   ├── capabilities/default.json  permissions for the trusted shell only
    │   └── src/
    │       ├── main.rs
    │       ├── lib.rs                 Tauri setup and command registration
    │       ├── kernel/                (future) jobs, storage, paths, configuration
    │       └── modules/
    │           ├── media/             (stub) models, service, commands
    │           ├── workspace/         (stub) models, service, commands
    │           ├── copilot/           local-only HTTP/stream adapter; native uncompiled
    │           ├── editor/            planner source; execution/OpenCV hooks unavailable
    │           └── internal_browser/  capabilities/source hooks; live browsing unavailable
    ├── sidecar/                       (future) Python worker package and protocol
    └── docs/
        ├── architecture.md
        ├── media-engine.md
        ├── workspace.md
        ├── ai-copilot.md
        ├── media-editor.md
        ├── internal-browser.md
        └── design-boards.md
```

The browser Media Engine keeps metadata and object URL references in memory, shared
across Media Engine remounts. Reloading resets the session; removing an entry
revokes its Blob URL and does not delete the original file. It has no SQLite,
IndexedDB, localStorage catalog, or persistent file permission.

Workspace uses a separate `hyden.workspace.v1` localStorage entry. Its note/sheet
revisions detect stale sequential edits, including changes from another tab, but
localStorage read-check-write operations are not atomic cross-tab transactions.
Browser storage is scoped to origin (scheme, hostname, and port), subject to
quota/eviction/site-data clearing, and not encrypted by the app. Export important
work. It is unrelated to the media session catalog or future encrypted browser
session storage.

Design data uses `hyden.design.v1`: up to 50 Figma bookmarks and one bounded
scratchpad, protected by validation, per-document revisions, and a 2 MiB storage
budget. It is independent of `hyden.workspace.v1`, with no migration of existing
Notes/Sheets data. Like other localStorage, it is origin/profile scoped, subject
to quota/clearing, and neither encrypted nor an atomic cross-tab transaction store.
It stores links and geometry, not Figma file contents or login credentials.

Copilot uses `hyden.copilot.v1` localStorage history in browser and native webview
modes, independent of the request transport. It has revision validation and
bounded sessions/messages/serialized size, but is not an encrypted database or
cross-tab transaction system. Browser/webview profile clearing can remove it.
LocalStorage history is not silently imported into future native SQLite.

Internal browser private state remains in memory. Opt-in normal-mode navigation
uses only `hyden.browser.v1`, kept separate from private tabs/history. Its purge
clears its own memory and navigation key, leaves Workspace/Copilot data alone,
and reports `cookiesCleared: false`. It does not access real browser cookies or
encrypted OS profiles. Local iframe contents receive an empty sandbox permission
set and never receive the entered remote URL as their source.

For native persistence, keep application data under Tauri's platform-specific
app-data directory, outside the checkout. Future structure: `library.sqlite`, `documents/`, `cache/`,
`thumbnails/`, and a separate browser profile. Store references to user-selected
media rather than silently copying large libraries. Put credentials in a suitable
OS credential store, not configuration JSON or the SQLite database. Browser profile
separation does not itself provide encryption.

## IPC and process ownership

```text
Trusted React shell
    │ typed invoke(command, validated DTO)
    ▼
Tauri/Rust kernel ── SQLite / OS dialogs / approved filesystem operations
    │
    ├── subprocess argv ── FFmpeg / ffprobe          (future)
    ├── private stdin/stdout JSONL ── Python worker  (future, on demand)
    └── constrained loopback HTTP ── local LLM       (source implemented; desktop validation pending)

Local bundled browser pages ── sandboxed same-origin iframe (no scripts/privileges)
Remote browser content ── separate OS webview/profile (future, no kernel IPC)
Explicit Figma view ── allowlisted cross-origin iframe (network/sharing required; no native IPC)
```

The frontend calls explicit commands through `src/lib/ipc.ts`. The supplied
`shell_status` command reports native shell metadata. The adapter selects Tauri
invoke in the desktop host and lazy-loads the browser media/Workspace adapters
only when needed. Each UI uses the shared IPC functions rather than importing a
browser store directly; browser change subscriptions refresh mounted views.
Copilot separates transport from history: its native commands stream through a
Tauri channel, while browser mode uses a clearly labeled local mock. Chat history
uses the same validated webview localStorage store in either host. Native HTTP
errors are surfaced, never silently replaced with mock output.
Canvas image processing and the local browser navigation catalog also remain
frontend implementations in both hosts; this does not enable native OpenCV,
remote browsing, or cookie access. Native capability hooks keep those operations
explicitly unavailable.
It never catches native errors and silently substitutes browser success. Browser
File objects remain in the browser; they are not serialized through invoke.
The preview implements local media operations and clearly labeled demo downloads,
not native services. Rust command parameters and return values are serialized
DTOs; TypeScript types improve ergonomics but do not validate untrusted runtime
input. Rust must validate inputs at every privileged command boundary.

The build manifest generates operation-specific permissions for `shell_status`
and the Media Engine/Workspace/Copilot/Editor/Browser commands, granted only to the
local `main` window. New commands
must also be registered in that manifest and explicitly granted. Production CSP
allows bundled assets, local Blob images/media, same-origin frames, the IPC
transport, and only the named Figma embed/view origins for Design & Boards. It
does not allow arbitrary remote frame/media destinations. The
Internal browser iframe additionally has `sandbox=""` and no-referrer policy.
The separate Figma viewer uses a limited cross-origin sandbox allowing scripts,
same-origin authority within Figma, and popups, while denying forms, top
navigation, downloads, and native IPC capabilities. It is never pointed at
user-supplied arbitrary HTML or arbitrary origins. Switching to the offline pad
unmounts it; frame load is not proof of visible shared-board content.
A separate development CSP permits Vite's loopback websocket
and inline development refresh/styles; those allowances do not reach production.

Future commands should describe user operations, such as `enqueue_media_import`,
`cancel_job`, and `load_note`; never expose generic `exec`, unrestricted SQL, or
arbitrary filesystem read/write commands. Long work returns a `jobId` promptly.
Rust emits job-scoped progress events and exposes a status query so an event lost
during remount does not lose the job. Unsubscribe when views unmount. Throttle
progress updates; do not push raw media buffers through invoke or events.

### Proposed Python worker protocol

Launch an application-owned executable with `std::process::Command` or an async
equivalent, explicit argument arrays, a controlled working directory, and a
minimal environment. Never interpolate shell commands. The worker listens on
private pipes, not a network port. Reserve stdout exclusively for newline-delimited
JSON; send diagnostic logs to bounded stderr capture. JSON strings escape embedded
newlines, so one physical line is one frame.

```json
{"v":1,"id":"req-42","op":"image.batch","params":{"jobId":"job-7","inputIds":["asset-1"],"preset":"thumbnail"}}
{"v":1,"id":"req-42","type":"progress","progress":0.5}
{"v":1,"id":"req-42","type":"result","result":{"outputIds":["asset-2"]}}
```

Use one final `result` or structured `error` per request. Version the envelope;
validate allowed operation names, parameter schemas, correlation IDs, and result
types on both ends. Start with a 256 KiB maximum frame, bounded request and output
queues, and a configured maximum stderr capture. Transfer large outputs through
kernel-approved files, referenced by opaque IDs. A malformed, oversized, or
unexpected frame is a protocol failure, not something to eval or silently trust.

Rust owns job states (`queued`, `running`, `succeeded`, `failed`, `cancelled`),
deadlines, and worker handles. Use a cooperative cancel operation first, then a
bounded grace period and termination of the owned process tree (Unix process
group / Windows Job Object). Drain pipes to avoid deadlocks and reap children.
Enforce concurrency in Rust and constrain OpenCV/FFmpeg threads. Launch Python only
when needed, import heavy packages only for the requested operation, and stop the
worker after completion or a short idle timeout. Distinguish cancellation from
failure; redact paths or sensitive payloads in UI-facing errors. Queueing a job
must not imply automatic retry of destructive operations.

Bundle a per-platform worker executable/interpreter and selected tools for a
future distributable; do not rely on the end user's Python installation or run
`pip install` on application startup. Verify packaged artifacts and signatures.

## Feature boundaries and likely components

| Module | Future implementation candidates | Boundary and limitations |
| --- | --- | --- |
| Media | yt-dlp for supported downloads; ffprobe metadata; HTML media playback | Download only on user request. Codec availability differs across OS webviews. Evaluate a native player only if required formats cannot play; do not promise universal codec support. |
| Editor | Current: Canvas image processing, HTML media preview, FFmpeg argv plan. Future: supervised FFmpeg/OpenCV jobs | Image outputs are actual local blobs; media export is a plan only. Native execution must use approved assets, direct argv, bounded jobs, and codec/license checks. |
| Copilot | Rust adapter to explicitly selected loopback llama.cpp/Ollama; browser mock; local history | No auto-started model or remote fallback. Native source restricts endpoints, proxies, redirects, timeouts, frames, and output; compile/runtime/real-runner validation remains pending. |
| Workspace | Current: Markdown textarea/toolbar, React preview, bounded small-grid formula parser. Optional future: CodeMirror/Tiptap or larger-grid virtualization | Canonical Markdown and sparse cell strings are exportable. This is not a full WYSIWYG editor or Excel-compatible engine; native storage/import fidelity remain future work. |
| Browser | Current: isolated local iframe and private/normal navigation catalogs. Future: native webview/profile | No user-supplied remote URL is loaded. Blocking toggles are simulations; real cookie purge and encrypted profiles remain unsupported pending platform-specific work. |

Prefer community/open-source features; paid Tiptap extensions and commercial grid
packages are not required. Review exact dependency licenses and the FFmpeg build's
LGPL/GPL options before distribution. Codec patent/distribution constraints and
model weight licenses are separate from the app's license. Some downloading tools
need updates as external sites change, even without a subscription.

## Browser security and encryption feasibility

The implemented preview loads only allowlisted bundled HTML pages into an iframe
with `sandbox=""` and `referrerPolicy="no-referrer"`. It grants no scripts,
same-origin authority, forms, popups, downloads, or top-navigation privilege to
the child. No live remote page is embedded, so this preview is not a demonstration
that arbitrary sites can be framed safely or will permit framing. Browser
capabilities report `liveBrowsing: false`; ad/tracker controls do not imply actual
request interception, and purging navigation does not imply cookie deletion.

An embedded webview is not automatically a fully hardened general-purpose browser.
Tauri uses WebView2 on Windows, WKWebView on macOS, and WebKitGTK on Linux; their
request interception, profile, cookie-store, and sandbox APIs differ. Test each
supported OS. Do not disable the engine sandbox or relax the trusted shell's CSP
to make remote pages load.

Give remote webviews distinct labels and no Tauri command capabilities. Do not
enable remote URLs on the trusted shell's capability. Restrict navigation and new
windows, deny filesystem/OS access, and require explicit user approval for downloads,
microphone, camera, or other device access. A separate profile isolates browser
sessions from the dashboard, but is not a separate OS security boundary by itself.
Keep the OS webview patched.

Ad/tracker blocking needs a maintained local rule set and engine-supported request
filtering (or a deliberately designed constrained proxy). Browser extensions are
not uniformly supported. A frontend script injected after page load cannot promise
complete blocking. Blocklist updates can be manual or explicitly enabled, without
a required paid service.

The OS may encrypt some cookies but does not guarantee that every session artifact,
cache, token, or history record is encrypted. A complete encrypted-session claim
requires a separately designed, tested storage strategy on each OS, key management,
and crash recovery. Options include OS-backed encrypted storage or an encrypted
profile container mounted only while unlocked; copying an active profile into an
encrypted archive on exit leaves crash/plaintext risks. If the platform cannot
provide the guarantee, expose ephemeral browsing or disable persistent sessions
rather than claiming encryption. Never store encryption keys beside the ciphertext.

## Validation milestones

Cloud validation is frontend-only: `npm ci`, `npm run dev`, `npm run check`,
`npm run build`, and `npm test` (Node 24). Do not run Tauri or Cargo, install Rust,
or attempt native/system-webview builds in the cloud. Rust includes Media/Workspace
stubs, Editor/Browser source hooks, and the Copilot HTTP adapter; none is a native
validation result. See the README for the browser smoke
workflow and developer-owned-desktop prerequisites.

A browser preview can validate local imports, metadata, playback, catalog actions,
demo jobs, note/grid editing, browser reload persistence, safe exports, Copilot mock
stream/cancel/offline behavior, Canvas outputs, FFmpeg plans, sandboxed local
navigation/private-storage behavior, and storage failure recovery; it cannot establish
native model inference, native startup/IPC correctness, package size,
native RAM usage, downloader integration, or cross-platform codec support. Native
work must be implemented and tested on a developer's desktop. Later milestones
should separately prove worker cancellation, persistence/migrations, actual media
downloads, loopback AI limits, and browser isolation/encryption before labeling
those capabilities implemented. No validation command listed here implies it has
already passed for an arbitrary checkout or platform.
