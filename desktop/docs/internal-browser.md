# Internal browser: local sandbox preview

## Implemented behavior

Internal browser provides tabs, an address bar, Back/Forward/Reload, private mode,
ad/tracker controls, and a purge action. It is a **local preview, not a live remote
browser**. Capabilities report `liveBrowsing: false` and `cookieAccess: false`.
No user-entered HTTP(S) URL is fetched or assigned to an iframe.

These internal addresses map to bundled same-origin HTML assets:

| Address | Local page |
| --- | --- |
| `hyden://start` | Start page |
| `hyden://reading` | Reading-room example |
| `hyden://privacy` | Privacy guide |
| Any accepted HTTP(S) address | Explicit local offline/unavailable fallback |

For a remote address, the address bar/history retain the requested navigation
metadata while the iframe displays the local fallback. Seeing an address in a tab
is not evidence that its site loaded. A bare host may be normalized to HTTPS;
unsupported schemes, paths presented as local files, credentials, control
characters, and overly long URLs are rejected. This does not bypass websites'
CSP or `X-Frame-Options`: the preview never attempts to embed those websites.

Ad/tracker toggles retain a **simulation setting** only. They do not inspect or
intercept network requests, maintain blocklists, or invent blocked-request counts.
All examples remain local whether those toggles are on or off.

## Iframe boundary

The iframe's source comes exclusively from the fixed `previewPage` mapping, never
from the user-entered URL. It uses:

```html
<iframe sandbox="" referrerpolicy="no-referrer" ...></iframe>
```

The empty sandbox grants no script execution, same-origin authority, form
submission, popup creation, downloads, or privileged top navigation. Bundled pages
contain no active remote content. The parent CSP also has a narrow Figma-origin
allowance for the separate Workspace Design viewer; Internal browser still maps
only to its fixed same-origin bundled pages and never uses that allowance for a
typed URL. The child receives no Tauri capabilities or app
IPC bridge. No source change should add `allow-scripts` or `allow-same-origin`
merely to make external websites work.

This is a useful constrained local-view boundary, not an implemented OS browser
profile or proof that untrusted websites can safely be loaded. It does not create
an isolated system cookie jar, encrypt history, or change the user's external
browser settings.

## Private versus normal navigation

Private mode starts enabled. The session constructor does not read saved browser
navigation, and private tabs, history, and protection settings remain in memory.
They survive switching app modules while the session exists but are discarded
on a full app/page reload. This mode controls the app's navigation metadata, not
OS/webview cookies or disk encryption.

Normal mode is an explicit opt-in to navigation persistence. It reads/writes only
`hyden.browser.v1`, a version-1 normal-mode catalog. Private and normal catalogs
are separate: turning private mode off restores the normal catalog rather than
copying private URLs into storage. Turning it on restores the private catalog;
reload defaults back to a fresh private session. Re-enter normal mode explicitly
to restore its saved navigation. Normal-mode settings/history are not encrypted.

Saved navigation is validated and size-bounded. Corrupt or unsupported storage is
preserved with an error instead of silently replaced. A normal-mode write failure
leaves the previous saved catalog intact; failure to enable normal mode leaves
private mode active. Other browser tabs can edit this storage key independently;
there is no transactional multi-tab merge or guaranteed last-edit recovery.

| Limit | Value |
| --- | --- |
| Tabs | 12 |
| Entries per tab history | 50 |
| URL length | 2,048 characters |
| Saved normal navigation | 1 MiB conservative UTF-16 estimate, subject to browser quota |

Closing the last tab leaves a fresh Start tab. A new navigation discards the
current tab's forward branch. Reload re-renders the mapped local page; it never
starts a remote request for the displayed address.

## Purge scope and truthful results

The UI action may be labeled **Purge Session & Cookies**, but its preview result
explicitly states that external cookies were not cleared. It resets both browser
navigation catalogs in memory, returns to private mode, and attempts to remove
only `hyden.browser.v1`. It does not clear Workspace notes/sheets, Copilot history,
media catalog data, unrelated localStorage, or external browser profiles.

The returned report distinguishes outcomes:

```json
{
  "sessionCleared": true,
  "persistedNavigationCleared": true,
  "cookiesCleared": false,
  "notice": "..."
}
```

If storage removal fails, `persistedNavigationCleared` is false and the notice
warns that saved navigation may still exist. Memory reset alone is not evidence
that disk-backed navigation disappeared. `cookiesCleared` remains false in every
preview outcome. No claim is made to purge caches, HTTP authentication, third-party
cookies, engine session files, DNS, or OS artifacts.

## Files and future native work

`src/lib/internal-browser.ts` owns navigation and persistence;
`browser-types.ts` owns DTOs/capability limits. The UI is under
`src/modules/InternalBrowser/`. Local assets live under `public/browser-preview/`
with Start, Reading, Privacy, and Offline pages. UI operations go through the
shared `src/lib/ipc.ts` boundary. Native browser hooks report unsupported live
browsing/cookie capabilities; their presence does not turn this iframe into a
native browser.

Native source under `src-tauri/src/modules/internal_browser/` exposes
`internal_browser_capabilities` (`mode: "preview"`, `liveBrowsing: false`,
`cookieAccess: false`). `internal_browser_purge` returns
`NATIVE_NOT_IMPLEMENTED`; it never deletes the trusted main webview's cookies.
Frontend navigation purge is a separate operation with the limited report above.
These native sources have not been compiled in the cloud.

Real external browsing requires a separate platform milestone: separate
unprivileged OS webviews/profiles; navigation/download/device permission policy;
engine-specific request blocking and maintained local blocklists; explicit cookie
and cache-store APIs; encrypted-session design and key management; and crash/
shutdown recovery. Windows WebView2, macOS WKWebView, and Linux WebKitGTK differ.
A dedicated profile alone does not guarantee encryption or cookie erasure. Until
these capabilities are implemented and tested per platform, keep them disabled
and identify them as unsupported rather than promising private live browsing.

## Frontend validation

Use the README's frontend-only cloud workflow; do not run Tauri/Cargo or native
builds in the cloud. Browser checks should exercise tabs/history, local pages,
remote-address fallback with no remote requests, denied active iframe behavior,
private-mode zero writes, separate normal-mode reload persistence, malformed/
quota storage errors, and purge reports including failed removal. Verify that
notes/chats survive a browser purge. Testing this local preview does not validate
real remote browsing, ad/tracker blocking, encrypted profiles, or actual cookie
purging on any operating system.
