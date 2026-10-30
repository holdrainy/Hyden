# Local AI Copilot

## Browser preview and native transport are different

The Copilot UI provides conversations, incremental replies, cancellation, session
history, model selection, a system prompt, temperature, and context settings.
Browser development uses a clearly labeled **mock** transport: its replies are
canned/generated locally, chunks arrive incrementally, and cancellation stops the
local stream. It never contacts Ollama, llama.cpp, a cloud API, or an entered model
endpoint. The offline control demonstrates runner-unavailable behavior without
making a network request. Browser output is not evidence of an actual model call.

Native Rust source implements real HTTP integration with a manually started
Ollama or llama.cpp server. It is source implemented, **not compiled or verified
against a runner in this cloud environment**. Media/Workspace native stubs and
Copilot's real source adapter have different readiness states. Native failures
must remain visible; they never trigger a silent switch to mock replies.

The app does not install/start a runner, download model weights, or require a
hosted API account/key. Local models need disk space and potentially substantial
RAM/CPU despite the shell being lightweight. Start with a small quantized model
appropriate to the machine, and stop the separate runner when you no longer need
it. Cancelling a request does not promise that the runner unloads its model.

## Start a runner on your own desktop

Do this on the same desktop where the native Tauri app runs, **not as part of the
cloud Vite workflow**. A loopback URL points to that machine; it cannot reach a
runner on a different device. Install the chosen runner from its official source
and obtain a compatible model separately, checking its license and requirements.
The app never performs these installations for you.

For Ollama, start its service if it is not already running, then list installed
models:

```sh
ollama serve
# In another terminal:
ollama list
```

The usual endpoint is `http://127.0.0.1:11434`. Select an installed model in the app.
If none is installed, obtain one explicitly using the runner's tooling; this is a
one-time download requiring network access, not a recurring cloud API dependency.
Do not start a second Ollama server when the installed desktop service is already
listening.

For llama.cpp, use an existing GGUF model and start its HTTP server, for example:

```sh
llama-server -m /absolute/path/to/model.gguf --host 127.0.0.1 --port 8080 --ctx-size 4096 --parallel 1
```

Choose llama.cpp and `http://127.0.0.1:8080` in the native app. Use the model ID
reported by the server's model list; API-compatible servers can differ. No native
build or model request shown here was run in the cloud. See the README's separate
own-desktop Tauri prerequisites before attempting native use.

## Endpoint and transport boundary

Only plain HTTP loopback endpoints are accepted by the native adapter:
`127.0.0.1`, `[::1]`, and `localhost` normalized to the literal IPv4 loopback.
External hosts, embedded credentials, URL paths/queries/fragments, redirects, and
ambient proxy routing are not accepted. Requests are owned by Rust rather than made from untrusted content
or by granting the frontend unrestricted HTTP access. Keep the runner bound to
loopback; exposing it on the LAN is outside this configuration.

Ollama chat uses newline-delimited JSON from its local chat API; llama.cpp uses
the OpenAI-compatible chat-completions SSE stream. Rust incrementally decodes
bounded frames, correlates replies with the active request, and sends text chunks
through a Tauri channel. Completion requires the protocol's completion marker;
a truncated stream is an error, not a successful full answer. Invalid JSON,
invalid UTF-8, oversized frames, runner errors, or bounded-output violations fail
explicitly. Error text should not be mistaken for a model response.

The app allows one native generation at a time. Cancellation aborts that owned
request and releases its active-generation slot; failures and lost UI/channel
ownership must also clean up. The adapter does not spawn or terminate the runner.
Status/model discovery and chat have explicit timeouts and response bounds; there
is no always-running background model poller.

| Native guard | Source-level limit |
| --- | --- |
| Connect | 2 seconds |
| Status/model discovery request | 5 seconds |
| Generation | 10 minutes overall; 90 seconds between stream chunks |
| Status/model metadata | 1 MiB; model list at most 100 entries |
| Stream frame | 256 KiB |
| Decoded reply | 64 KiB UTF-8 |
| Outbound messages | At most 100; 32 KiB UTF-8 each, 128 KiB combined message content |

These are transport limits, separate from the model's tokens or stored history
length. A long Unicode message can hit a byte limit before its character limit.

## Settings and context

The selected runner/model, system prompt, temperature, and context preference are
saved as profile settings; each session also records its model. Settings are local
configuration, not credentials, and updates use last-writer-wins semantics.
A model selection does not cause its weights to be downloaded. If the selected
model is unavailable, surface the failure or choose an installed model explicitly.

For Ollama, context size is passed as the runner's `num_ctx` option. For llama.cpp,
the server's context is established when it starts (for example with `--ctx-size`).
The app cannot resize an already running llama.cpp model through that preference;
the control is informational/disabled for this provider. Adjust the server setting
separately. Hard request-size limits are independent of the context setting. The
runner remains authoritative about tokenization and its actual context/output
capacity; selecting a number in the app does not prove a conversation will fit.
Larger context allocations can increase runner memory substantially; keep them
small on low-resource hardware rather than treating the allowed maximum as a
recommended default.

Only the conversation/system content chosen for the request is sent to the local
runner. There is no automatic reading of notes, media files, browser sessions, or
other app data. Generated code is displayed as text; it is never automatically
executed. A local model can still give incorrect instructions or reveal content
included in a prompt, so review its output before using it.

## History, storage, and errors

History uses the `hyden.copilot.v1` webview/browser localStorage entry **in both browser mock
and native transport modes**. It is not SQLite and does not become native-file
storage because the request transport is native. Sessions, their settings, and
messages survive reloads on the same origin/profile after a successful save.
Development and production previews on different ports have separate histories;
regular browsers and native webview profiles are separate stores as well.

The store validates schema/revisions and enforces these bounds:

| Limit | Value |
| --- | --- |
| Saved sessions | 40 |
| Messages per session | 100 |
| Message length | 64,000 characters |
| Model name | 200 characters |
| System prompt | 8,000 characters |
| Session title | 100 characters |
| Context preference | 512–32,768 |
| Temperature | 0–2 |
| Serialized history | 2 MiB conservative storage estimate, subject to browser quota |
| Native decoded reply | 64 KiB UTF-8 output |
| Native stream frame | 256 KiB |

Corrupt/unsupported saved data is preserved without a silent reset. Unavailable
storage, quota limits, or stale revision conflicts produce visible errors rather
than pretending the latest reply was saved. Keep an unsaved conversation available
for recovery/export before reloading. Revision checks do not turn localStorage
into an atomic multi-tab transaction system; prefer one editing tab.

On opening history, unfinished messages can be marked as interrupted in the view
while preserving their partial text. This display recovery does not prove an
engine crashed and must not automatically overwrite storage: another tab could
still own an active stream. Persisting a recovered draft is an explicit operation
subject to the same revision checks.

History is not encrypted by the app. Browser site-data clearing, profile removal,
private browsing, quota/eviction, or native webview-profile changes can remove it.
Export important conversations; no cloud backup or automatic SQLite migration is
provided. Model runner logs and model memory are outside this history store.

## Markdown and code display

Assistant text renders through a bounded React Markdown/code view rather than
arbitrary HTML injection. Code highlighting is presentation only: code is not
evaluated, remote images are not loaded, and links/content cannot acquire native
IPC permissions. Preview/highlighting limits keep a very large response from
expanding into unbounded UI work; raw text/history/export must remain available.
`ChatMarkdown.tsx` shares the bounded Markdown parser with Workspace: at most
64,000 displayed characters, 1,200 lines, and 2,000 base preview nodes per message.
`highlight.ts` adds at most 1,500 colored spans across all code blocks in that
message, with unhighlighted remainder text preserved. Highlighting uses no worker
or external syntax-highlighting runtime.
This is a small supported Markdown subset, not a browser for model-generated HTML
or a full code-editor runtime.

## Implementation and validation scope

With Vite running, `python3 tests/copilot_smoke.py` exercises a fresh browser
profile: mock streaming/cancellation, code/copy/export, settings/models, offline
guidance, session persistence, quota recovery, and mobile layout. `npm test` covers
the pure history, validation, streaming, and highlighting helpers. These checks
exercise browser behavior; they do not call a local runner or compile Rust.

UI and transport calls go through `src/lib/ipc.ts`. Request transport, message
DTOs, browser mock behavior, and history persistence have separate modules so a
native request failure cannot accidentally become a browser mock success. Rust
Copilot code lives under `src-tauri/src/modules/copilot/` with its commands,
validated local endpoint/service, DTOs, and JSONL/SSE decoding. Its specific
permissions apply only to the trusted local main window.

| Native command | Responsibility |
| --- | --- |
| `copilot_status` | Check the selected runner's local readiness endpoint |
| `copilot_models` | Read a bounded installed-model list |
| `copilot_chat` | Validate one chat request and stream correlated events through a channel |
| `copilot_cancel` | Cancel the matching active request owned by the main window |

Cloud work remains frontend-only: `npm ci`, `npm run dev`, `npm run check`,
`npm run build`, and `npm test` using Node 24. Browser smoke checks should cover
incremental replies, stop/cancel, offline behavior, session switching/history,
settings, safe rendering, storage failure, and reload persistence without any
runner request. Unit/static fixtures can exercise frontend logic and inspect
protocol contracts; they do not establish that native Rust compiled or real HTTP
streaming worked. Do not run Cargo, Tauri, or native builds in the cloud.

Required own-desktop checks remain: compile/start the native shell, connect to each
actual runner, enumerate models, stream Unicode/chunked output, handle completion
and malformed/truncated streams, cancel/retry, reject non-loopback endpoints and
redirects, recover from timeouts, and measure memory/idle CPU. No readiness claim
for those native paths follows from the browser mock or passing frontend tests.
