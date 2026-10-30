# Design & Boards

Design & Boards is a Workspace tab with two deliberately separate tools: an
**optional online Figma viewer** and an **offline local scratchpad**. Bookmark
storage and drawing require no Figma account, API token, model, Python process,
or native build. Opening a live Figma document requires network access and the
file's sharing permissions. It is not a local Figma file import or an offline
implementation of Figma.

## Figma links and explicit loading

Paste a supported HTTPS Figma document link, then choose **Open live board**.
Saving a bookmark only stores the canonical source URL/title locally. Neither
saved bookmarks nor reopening the Design tab automatically mounts a remote frame.
Selecting a bookmark's explicit Open action loads that board. Rename/delete
change the local bookmark; they do not modify the Figma file.

`src/lib/figma-url.ts` performs syntax/origin validation without making requests:

- Exact hosts: `figma.com`, `www.figma.com`, or `embed.figma.com`; HTTPS only, with
  no user information, non-default port, active scheme, or arbitrary HTML.
- Supported document paths: `/file/`, `/design/`, `/proto/`, and `/board/`, with a
  bounded file key and optional safe slug. The legacy file path normalizes to
  design.
- Legacy `figma.com/embed?url=...` and `www.figma.com/embed?url=...` unwrap only a
  single validated target per wrapper, with bounded nesting. An external redirect
  target is rejected.
- Only supported view parameters survive: `node-id`, `page-id`, `viewport`,
  `scaling`, `content-scaling`, `starting-point-node-id`, `hide-ui`, and `theme`.
  Unsupported query parameters are dropped; duplicate supported values and
  invalid/control-character input are rejected.
- The source link normalizes to `https://www.figma.com/...`; the iframe URL is
  derived as `https://embed.figma.com/...` with `embed-host=share`. Stored iframe
  HTML or arbitrary `src` values are never trusted.

These checks establish a permitted URL shape, not that a document exists, is
public, or can be viewed by this user. Figma's access rules remain authoritative.
Opening a link sends that document URL to Figma; the app does not upload the saved
bookmark collection, notes, sheets, or scratchpad geometry.

## Iframe and network boundary

The cross-origin viewer mounts only after explicit Open, using:

```html
<iframe
  sandbox="allow-scripts allow-same-origin allow-popups"
  referrerpolicy="no-referrer"
  allow="fullscreen"
  ...
></iframe>
```

Figma needs scripts and its own origin behavior. This is a different permission
set from Internal browser's fully restricted bundled-page iframe. Forms, top
navigation, downloads, and popup sandbox escape are not granted. Remote origins
receive no Tauri capability/IPC permissions. The trusted main page's script,
style, image, media, and connection policies stay narrow; `frame-src` adds only
`https://embed.figma.com` and `https://www.figma.com` alongside local frames.
This allowance never turns Internal browser's typed addresses into remote frame
sources.

The frame's content/resources are third-party online content governed by Figma's
policies and browser third-party cookie/authentication restrictions. Login or
private-file access may not work inside the restricted embed; use appropriate
sharing permissions rather than loosening app privileges. No Figma API token is
required by this viewer. Fullscreen uses browser permission where available, with
an in-app expanded layout as a fallback.
Internal browser's private-mode/navigation purge does not cover Figma cookies or
service-side history. The app supplies no Figma cookie purge or encrypted profile
guarantee.

The app cannot inspect cross-origin frame contents. `onLoad` means a frame load
occurred, not that the board rendered or access was granted; even an error/access
page can trigger it. Status/help text makes this limitation explicit. A 12-second
opening timeout becomes “unconfirmed,” not a false success. If blank/blocked,
check sharing, network access, and browser restrictions, then explicitly retry.

Unloading, leaving Design & Boards, switching to the offline scratchpad, or an
offline event removes/pauses the live frame. Reconnection does not silently reload
it; Retry/Open is explicit. `navigator.onLine` is only a browser hint, not proof
that Figma is reachable. There is no remote preload, app-level network poller,
Figma file cache, or service-worker offline copy.

For a restricted cloud environment, required domain additions are `figma.com` and
`*.figma.com`, preserving existing allowed domains. A saved configuration draft
is not a runtime policy change or publication. Apply/review the relevant settings
and publish through the environment UI before treating the saved policy as
active, then retry affected access. The implementation-time cloud check received
a proxy `CONNECT` 403. No user-supplied public/shared file was available to verify
actual board visibility; neither a saved allowlist nor local UI tests prove that
an arbitrary Figma file loaded. Extra service dependencies may still require
diagnosis if Figma returns a sharing/authentication or network error.

## Offline scratchpad

The scratchpad uses a local SVG view with pen strokes and outlined rectangles.
Its default logical canvas is **1,200 × 800**. Pointer positions are mapped from
viewport coordinates into the logical board and clamped to its bounds, so drawing
coordinates do not change with responsive display size.

Choose a pen/rectangle, palette color, stroke width, and paper background. A pen
click creates a dot; dragging records sampled points. Dragging a rectangle in any
direction normalizes its positive bounds. Tiny invalid rectangles are discarded.
Completed pointer gestures commit geometry; moving a pointer does not write
localStorage continuously. Escape/pointer cancellation discards the unfinished
gesture. Clear requests confirmation. Undo retains the last 10 completed changes
in the current view, including drawing/background/clear edits; undo history itself
is not persisted.

**Export PNG** actually redraws the retained geometry/background into a bounded
Canvas and encodes `image/png`. It uses logical board dimensions rather than
screen size. No SVG/HTML string is parsed and no remote image is fetched. The
export canvas and temporary download URL are released. Export does not change the
saved vector shapes or insert a file into the Media Engine. PNG is a visual
export, not an implemented round-trip vector import/backup format.

There are no idle drawing timers or always-on worker. An unfinished gesture is
not promised to survive navigation/reload. Completed geometry saves locally;
storage failure keeps an unsaved sketch available for retry or PNG export.

## Storage, conflicts, and limits

`hyden.design.v1` contains `{ version: 1, bookmarks, scratchpad }`. It is independent
of `hyden.workspace.v1`, `hyden.copilot.v1`, and `hyden.browser.v1`. No existing
Notes/Sheets data is migrated, rewritten, or reset. This actual localStorage
implementation is used in both browser and native webview profiles; it does not
rely on the unimplemented native Notes/Sheets SQLite commands.

| Bound | Limit |
| --- | --- |
| Bookmarks | 50 |
| Bookmark title | 100 characters |
| Figma URL | 4,096 characters |
| Saved drawing | One scratchpad |
| Shapes | 250 |
| Points in one pen stroke | 2,500 |
| Total pen points | 30,000 |
| Valid stored board side | 64–2,048 pixels |
| Board pixel budget | 4,194,304 pixels |
| Stored stroke width | 1–24; current UI choices 2, 3, 6, 12 |
| Entire serialized Design store | 2 MiB conservative UTF-16 estimate, subject to quota |

Strict schema, bounded geometry, colors, timestamps, and document revisions are
validated before writes. Fresh reads preserve unrelated bookmarks when saving a
sketch. Stale sequential edits fail with `CONFLICT`; localStorage is not an atomic
multi-tab transaction system. Use one editing view and export before resolving
conflicts. A failed quota/unavailable write does not pretend that the sketch saved
or commit a new revision. Corrupt/unsupported stored data remains untouched,
with an actionable error rather than an automatic reset.

An unsaved sketch remains available for Retry or Export, including in-page
recovery across tool remounts. Loading the saved version requires confirmation
and discards the draft only after a successful read. Forced page closure can
still lose in-memory recovery. LocalStorage is origin/profile-scoped, subject to
clearing/eviction, and not encrypted by the app. A different port/browser/native
profile does not automatically share the same bookmarks or drawing.

## Files and frontend validation

Implementation is under `src/modules/Workspace/Design/`: `DesignBoards.tsx`,
`FigmaViewer.tsx`, `Scratchpad.tsx`, `drawing.ts`, and local styles. Contracts,
strict storage, and URL handling live in `src/lib/design-types.ts`,
`design-store.ts`, and `figma-url.ts`; persistent UI operations use the shared
`src/lib/ipc.ts` boundary. No native command or compilation was added for this
browser/webview feature.

Use Node 24 and the README's `npm ci`, `npm run dev`, `npm run check`,
`npm run build`, and `npm test` workflow. Unit coverage includes URL validation,
store/geometry limits, revision/quota behavior, and drawing helpers. With Vite
running, the reproducible UI smoke command is:

```sh
python3 tests/design_smoke.py
```

Check bookmark create/rename/delete/reload without automatic frames, explicit Open
with the exact sandbox, live-view unmount on offline-pad selection, scaled drawing
coordinates, pen/rectangle/undo/clear, actual PNG MIME/dimensions, and storage
failure/recovery without affecting notes. A local smoke test may intercept the
Figma frame to validate UI behavior; that does not prove real network/file access.
Listed checks are instructions, not a native or real-Figma validation claim. Do
not run Tauri/Cargo or native builds in the cloud.
