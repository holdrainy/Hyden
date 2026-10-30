# Workspace: notes, sheets, and Design & Boards

## Scope

Workspace is a browser-local implementation behind the shared IPC boundary. It
combines canonical Markdown notes, small sparse spreadsheet grids, and a separate
Design & Boards tab. Notes, sheets, saved board bookmarks, and scratchpad geometry
are local; there is no app cloud sync, required account, LLM, Python process, or
database daemon. Optional live Figma viewing is a third-party network feature
opened explicitly, subject to the file's sharing policy. It does not upload notes
or turn a saved bookmark into an offline Figma document.
Native Rust modules describe the intended command boundary but are explicitly
unimplemented; a native host does not silently fall back to browser storage.

Create, rename, switch, and delete documents from the Workspace document list.
Editing updates a local draft; the Workspace container owns persistence and save
status. A successful browser save survives module navigation and page reloads on
the same origin. A failed save must remain visibly unsaved, retaining the draft
for retry, copy, or export. Do not force a reload or close the page while a failed
save is your only copy of the latest work.

## Notes

Markdown is the canonical source, not a hidden rich-text document format. The
editor offers Write, Preview, and Split views, plus a focus mode. Toolbar actions
insert headings, bold, italic, task-list items, and fenced code blocks into the
source. Ctrl/Cmd+B and Ctrl/Cmd+I apply bold/italic. Preview task checkboxes update
the corresponding Markdown task line.

The lightweight preview supports headings, paragraphs, simple unordered/task
lists, fenced code blocks, inline code, bold, and italic. It creates React nodes
from text; it does not inject arbitrary HTML, execute code blocks, load images, or
fetch remote content. Raw HTML and unsupported Markdown remain text. This is a
bounded subset rather than a complete CommonMark parser or a WYSIWYG editor.

Preview is bounded to 60,000 characters, 1,000 lines, and approximately 2,000 DOM
nodes to keep dense lists and formatting lightweight. The full note, up
to the note limit, remains in the source, saved document, and exports. A preview
limit notice identifies truncation. Focus mode changes the editing layout and
can be exited with Escape.

Export the current note as `.md` or `.txt`, or copy its contents. Markdown export
preserves canonical source; plain-text export/copy removes supported formatting
while preserving code text and task completion. These are portable text files rather than a hidden
rich-text document format. Export/copy does not require a successful database or
network operation; clipboard availability still depends on the browser's
permissions and context.

Autosave waits 300 milliseconds after edits and flushes on blur, document/tab
switching, and module navigation. A failed save keeps the latest draft available
for retry or export; recovery is also available if reading storage subsequently
fails. Loading the saved version discards a draft only after the read succeeds.

## Sheets

Sheets store a sparse object of raw A1-addressed strings, dimensions, and a
header-row flag. Empty cells do not occupy stored entries. The visible grid is
small by design: at most 200 rows and 26 columns (A–Z). Select/edit cells directly;
formulas retain their source while the grid and CSV export use computed values.

Supported expressions begin with `=`:

| Example | Meaning |
| --- | --- |
| `=A1+A2*2` | Arithmetic with normal multiplication/division precedence |
| `=(A1+A2)/2` | Parentheses and division |
| `=SUM(A1:A5)` | Sum a rectangular A1 range |
| `=AVERAGE(A1:A5, B1)` | Mean numeric values from ranges and arguments |

The interpreter supports `+`, `-`, `*`, `/`, unary signs, numbers, references,
parentheses, `SUM`, and `AVERAGE`. It does not evaluate JavaScript, make requests,
or expose filesystem access. It is not an Excel engine: there are no cross-sheet
references, absolute `$A$1` references, macros, arbitrary functions, or XLSX import.
Aggregates ignore ordinary text and blank cells; arithmetic with nonnumeric text
returns a value error. A reference to a blank cell acts as zero in arithmetic.

Errors remain visible in the grid: `#REF!` for invalid/deleted references,
`#CYCLE!` for circular references, `#DIV/0!`, `#VALUE!`, `#ERROR!`, and `#LIMIT!`.
Work is bounded by expression length/tokens, nesting/reference depth, and a
100,000-step evaluation budget. A limit error is a deliberate resource boundary,
not proof that a large formula is mathematically invalid.

Insert a row/column after the selected one, or delete the selected row/column.
Surviving cells move and references are rewritten. References to deleted cells
become explicit `#REF!` errors; deleting an endpoint of a referenced range does
not silently guess a different range. At least one row and column must remain.
The header toggle styles the first data row; it does not create named columns or
add a new row.

Exports have different purposes:

- **CSV:** calculated values, with quoted fields and escaped quotes/newlines.
  Formula-like text is prefixed with an apostrophe to reduce spreadsheet formula
  injection when opened in external spreadsheet software; genuine numeric values,
  including negatives, remain numbers. CSV does not preserve formulas or the
  header-style setting.
- **JSON:** versioned `hyden.sheet` data containing the title, dimensions,
  header-row flag, and raw sparse cell strings, including formulas. This is an
  export format; JSON/CSV import and XLSX compatibility are not implemented.

## Browser persistence and recovery

The key `hyden.workspace.v1` contains a version-1 JSON object with notes and sheets.
Each document has an ID, title, creation/update timestamps, and revision. The store
reads and validates current storage before every operation; save/delete requires
an expected revision. Stale sequential edits return `CONFLICT` rather than silently
overwriting a newer revision. Same-window change events and cross-tab `storage`
events notify active views.

localStorage does not provide an atomic read-check-write transaction across tabs.
Revisions detect stale sequential operations, not perfectly simultaneous writers.
Use one editing tab for important work; export drafts before resolving conflicts.
Storage is scoped to scheme, hostname, and port: the Vite development origin and
a production preview on a different port have separate Workspaces.

The store rejects malformed data, unsupported versions, duplicates, out-of-bounds
cells, invalid revisions, and oversized content. Corrupt or unsupported saved
contents are preserved without automatic reset. Read failures, quota errors,
conflicts, and rejected writes produce errors; a failed write does not commit a
new revision. Keep the draft available to retry/export. If saved storage itself
is corrupt, back it up before repairing or clearing it; the app does not invent
replacement documents or silently migrate an unknown schema.

| Limit | Browser implementation |
| --- | --- |
| Notes | 100 |
| Sheets | 30 |
| Document title | 100 characters |
| Note Markdown | 200,000 characters |
| Preview | First 60,000 characters |
| Sheet dimensions | 1–200 rows; 1–26 columns |
| Cell source | 2,000 characters |
| Entire serialized store | 4 MiB conservative UTF-16 estimate, subject to browser quota |

Browser storage can be unavailable, cleared, evicted, or removed with a private
profile. It is not an encrypted vault, system-file backup, or durable native
filesystem guarantee. Do not put secrets into documents expecting app-level
at-rest encryption. Export important work and protect the browser/device profile.
Unsaved drafts are in memory until a successful save or export.

## Design & Boards

The Design tab stores Figma bookmarks and one offline scratchpad under the separate
version-1 key `hyden.design.v1`. Adding/opening a bookmark does not migrate,
rewrite, or delete `hyden.workspace.v1` notes/sheets. The Design store is actual
webview/browser localStorage in either host, independent of the still-planned
native Notes/Sheets database commands.

Bookmarks accept validated HTTPS Figma document links and derive a canonical
Figma embed URL. They never accept pasted iframe HTML, arbitrary hosts, or active
schemes. Saved bookmarks alone cause no network request; **Open** mounts the
cross-origin viewer explicitly. Public/shared access and Internet connectivity
are still required, and a frame load event cannot establish that the board is
visible. Choosing the offline pad removes the live frame.

The local SVG scratchpad supports pen strokes, rectangles, clear, and a real PNG
export. Its default 1,200 × 800 coordinate space is independent of displayed size;
completed gestures save local geometry rather than remote assets. It has bounded
shape/point counts and storage errors/revision conflicts, not an infinite canvas,
full design editor, or Figma-offline implementation. See
[design-boards.md](design-boards.md) for limits, persistence/recovery, iframe
permissions, network configuration, and validation.

## Adapter and future native contract

Views live under `src/modules/Workspace/`: `Workspace.tsx` owns document management
and save/recovery flow, `Notes.tsx` owns Markdown editing, and `Sheets.tsx` owns the
grid. Markdown and formula helpers are pure/bounded. Views call only the functions
in `src/lib/ipc.ts`; `browser-workspace.ts` owns validated browser storage, and
`workspace-types.ts` owns shared DTOs and limits.

| Frontend function | Tauri command |
| --- | --- |
| `getWorkspaceSnapshot` | `workspace_snapshot` |
| `createWorkspaceNote` | `workspace_create_note` |
| `saveWorkspaceNote` | `workspace_save_note` |
| `deleteWorkspaceNote` | `workspace_delete_note` |
| `createWorkspaceSheet` | `workspace_create_sheet` |
| `saveWorkspaceSheet` | `workspace_save_sheet` |
| `deleteWorkspaceSheet` | `workspace_delete_sheet` |

`subscribeWorkspaceChanges` subscribes to browser changes while a view is mounted;
it returns an unsubscribe function. Future native events will need their own
implementation. Native source under `src-tauri/src/modules/workspace/` contains
models, commands, service stubs, and a repository extension point. The snapshot
currently reports empty documents with persistence unavailable; all six mutations
return `NATIVE_NOT_IMPLEMENTED`. Permissions cover only explicit commands for the
local main window. There is no generic SQL or filesystem command.

A future native milestone must implement SQLite transactions/migrations,
OS-appropriate app-data storage and export permissions, revision conflict handling,
recovery/backups, and desktop tests. Browser localStorage data is not automatically
migrated into native SQLite. No native capabilities should be advertised as working
because the frontend builds.

## Validation

In this cloud workspace, use the frontend workflow from `README.md`: `npm ci`,
`npm run dev`, `npm run check`, `npm run build`, and `npm test` using Node 24.
Unit suites cover store validation/revisions/failures and bounded formula/structure
helpers; browser smoke testing must additionally check the editor, playback-free
Workspace behavior, reload persistence, exports, safe preview, and visible
unsaved-state recovery. Listed checks are instructions, not claims that every
platform/codec/native path was tested. Do not run Tauri, Cargo, or native builds in
the cloud; native verification belongs on a developer's desktop.
