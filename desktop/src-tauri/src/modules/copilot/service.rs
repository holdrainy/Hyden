use std::collections::{BTreeSet, VecDeque};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use futures_util::StreamExt;
use reqwest::{redirect::Policy, Client, Response, Url};
use serde_json::{json, Value};
use tauri::ipc::Channel;
use tokio::sync::watch;

use super::models::{ChatRequest, ChatRole, ChatStreamEvent, CopilotError, EngineConfig, EngineStatus, Provider};
use super::protocol::{StreamDecoder, StreamPiece};

const MAX_METADATA: usize = 1024 * 1024;
const MAX_CHAT_TIME: Duration = Duration::from_secs(600);
const MAX_IDLE_TIME: Duration = Duration::from_secs(90);

struct ActiveGeneration {
    id: String,
    owner: String,
    cancel: watch::Sender<bool>,
}

/// One generation per app, with cancellation tied to the owning local window.
#[derive(Clone, Default)]
pub struct CopilotState {
    active: Arc<Mutex<Option<ActiveGeneration>>>,
    // A stop IPC may arrive before its chat IPC starts. Keep a small bounded
    // tombstone queue so that race cannot start an abandoned HTTP generation.
    pre_cancelled: Arc<Mutex<VecDeque<(String, String)>>>,
}

struct GenerationGuard {
    state: CopilotState,
    id: String,
}

impl Drop for GenerationGuard {
    fn drop(&mut self) {
        // Cleanup is infallible during unwinding; no mutex guard lives across an await.
        let mut active = self.state.active.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        if active.as_ref().is_some_and(|request| request.id == self.id) { *active = None; }
    }
}

impl CopilotState {
    fn begin(&self, owner: &str, id: &str) -> Result<(GenerationGuard, watch::Receiver<bool>), CopilotError> {
        let mut active = self.active.lock().map_err(|_| CopilotError::new("INTERNAL", "Copilot state is unavailable. Restart the application."))?;
        if active.is_some() { return Err(CopilotError::new("BUSY", "Another response is running. Stop it before sending another message.")); }
        let mut cancelled = self.pre_cancelled.lock().map_err(|_| CopilotError::new("INTERNAL", "Copilot cancellation state is unavailable."))?;
        let position = cancelled.iter().position(|(window, request)| window == owner && request == id);
        let already_cancelled = position.and_then(|position| cancelled.remove(position)).is_some();
        let (cancel, receiver) = watch::channel(already_cancelled);
        *active = Some(ActiveGeneration { id: id.to_owned(), owner: owner.to_owned(), cancel });
        Ok((GenerationGuard { state: self.clone(), id: id.to_owned() }, receiver))
    }

    pub fn cancel(&self, owner: &str, id: &str) -> Result<(), CopilotError> {
        validate_id(id)?;
        let active = self.active.lock().map_err(|_| CopilotError::new("INTERNAL", "Copilot state is unavailable."))?;
        if let Some(request) = active.as_ref().filter(|request| request.owner == owner && request.id == id) {
            let _ = request.cancel.send(true);
        } else {
            let mut pending = self.pre_cancelled.lock().map_err(|_| CopilotError::new("INTERNAL", "Copilot cancellation state is unavailable."))?;
            if !pending.iter().any(|(window, request)| window == owner && request == id) {
                if pending.len() >= 32 { pending.pop_front(); }
                pending.push_back((owner.to_owned(), id.to_owned()));
            }
        }
        // Idempotent: stopping a response that just finished is harmless.
        Ok(())
    }

    pub fn cancel_owner(&self, owner: &str) {
        let active = self.active.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        if let Some(request) = active.as_ref().filter(|request| request.owner == owner) {
            let _ = request.cancel.send(true);
        }
    }
}

fn validate_id(id: &str) -> Result<(), CopilotError> {
    if id.is_empty() || id.len() > 80 || !id.bytes().all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_') {
        return Err(CopilotError::new("INVALID_REQUEST", "The response request ID is invalid."));
    }
    Ok(())
}

pub fn endpoint(config: &EngineConfig) -> Result<Url, CopilotError> {
    let invalid = || CopilotError::new("INVALID_ENDPOINT", "Use an HTTP loopback origin such as http://127.0.0.1:11434 or http://[::1]:8080, with no path, credentials, query, or fragment.");
    if config.base_url.len() > 512 || config.base_url.split("://").nth(1).is_some_and(|rest| rest.contains('@')) { return Err(invalid()); }
    let mut url = Url::parse(config.base_url.trim()).map_err(|_| invalid())?;
    if url.scheme() != "http" || !url.username().is_empty() || url.password().is_some()
        || url.path() != "/" || url.query().is_some() || url.fragment().is_some() || url.port() == Some(0) {
        return Err(invalid());
    }
    match url.host_str() {
        Some("127.0.0.1") | Some("[::1]") | Some("::1") => {},
        Some("localhost") => { url.set_host(Some("127.0.0.1")).map_err(|_| invalid())?; },
        _ => return Err(invalid()),
    }
    Ok(url)
}

fn client() -> Result<Client, CopilotError> {
    Client::builder()
        .no_proxy()
        .redirect(Policy::none())
        .connect_timeout(Duration::from_secs(2))
        .timeout(MAX_CHAT_TIME)
        .pool_max_idle_per_host(0)
        .build()
        .map_err(|_| CopilotError::new("INTERNAL", "The local HTTP client could not be initialized."))
}

fn route(base: &Url, path: &str) -> Result<Url, CopilotError> {
    base.join(path).map_err(|_| CopilotError::new("INVALID_ENDPOINT", "The local engine endpoint is invalid."))
}

fn connection_instructions(provider: Provider) -> &'static str {
    match provider {
        Provider::Ollama => "Ollama is not responding. On your own computer, start Ollama (ollama serve), install a model explicitly, then check the loopback endpoint and try again.",
        Provider::Llamacpp => "The llama.cpp server is not responding. On your own computer, start llama-server with a local GGUF model, a loopback host, and the configured port, then try again.",
    }
}

async fn bounded_json(response: Response) -> Result<Value, CopilotError> {
    if !response.status().is_success() {
        return Err(CopilotError::new("HTTP_ERROR", format!("The local runner returned HTTP {}. Check the selected provider, model, and server configuration.", response.status().as_u16())));
    }
    if response.content_length().is_some_and(|length| length > MAX_METADATA as u64) {
        return Err(CopilotError::new("RESPONSE_LIMIT", "The local engine metadata exceeds the 1 MiB limit."));
    }
    let mut bytes = Vec::new();
    let mut chunks = response.bytes_stream();
    while let Some(chunk) = chunks.next().await {
        let chunk = chunk.map_err(|_| CopilotError::new("OFFLINE", "The local engine connection ended while reading metadata."))?;
        if bytes.len() + chunk.len() > MAX_METADATA { return Err(CopilotError::new("RESPONSE_LIMIT", "The local engine metadata exceeds the 1 MiB limit.")); }
        bytes.extend_from_slice(&chunk);
    }
    serde_json::from_slice(&bytes).map_err(|_| CopilotError::new("PROTOCOL_ERROR", "The selected endpoint did not return valid local-runner JSON."))
}

pub async fn status(config: EngineConfig) -> Result<EngineStatus, CopilotError> {
    let base = endpoint(&config)?;
    let path = match config.provider { Provider::Ollama => "/api/version", Provider::Llamacpp => "/health" };
    let result = async {
        let response = client()?.get(route(&base, path)?).timeout(Duration::from_secs(5)).send().await
            .map_err(|_| CopilotError::new("OFFLINE", connection_instructions(config.provider)))?;
        let body = bounded_json(response).await?;
        let valid = match config.provider { Provider::Ollama => body.get("version").and_then(Value::as_str).is_some(), Provider::Llamacpp => body.get("status").and_then(Value::as_str) == Some("ok") };
        if !valid { return Err(CopilotError::new("PROTOCOL_ERROR", "This endpoint did not identify itself as a ready instance of the selected runner.")); }
        Ok::<(), CopilotError>(())
    }.await;
    Ok(EngineStatus {
        online: result.is_ok(), mode: "native", provider: config.provider, endpoint: base.to_string(),
        detail: match result { Ok(()) => "Local engine is ready. This app does not start a runner or download models.".to_owned(), Err(error) => error.message },
    })
}

pub async fn models(config: EngineConfig) -> Result<Vec<String>, CopilotError> {
    let base = endpoint(&config)?;
    let path = match config.provider { Provider::Ollama => "/api/tags", Provider::Llamacpp => "/v1/models" };
    let response = client()?.get(route(&base, path)?).timeout(Duration::from_secs(5)).send().await
        .map_err(|_| CopilotError::new("OFFLINE", connection_instructions(config.provider)))?;
    let body = bounded_json(response).await?;
    let entries = match config.provider { Provider::Ollama => body.get("models"), Provider::Llamacpp => body.get("data") }
        .and_then(Value::as_array).ok_or_else(|| CopilotError::new("PROTOCOL_ERROR", "The selected endpoint did not return a model list."))?;
    if entries.len() > 100 { return Err(CopilotError::new("RESPONSE_LIMIT", "The local model list exceeds the 100-model limit. Use a custom model name.")); }
    let mut names = BTreeSet::new();
    for entry in entries {
        let name = match config.provider { Provider::Ollama => entry.get("name").or_else(|| entry.get("model")), Provider::Llamacpp => entry.get("id") }
            .and_then(Value::as_str).filter(|value| !value.trim().is_empty() && value.len() <= 200 && !value.chars().any(char::is_control))
            .ok_or_else(|| CopilotError::new("PROTOCOL_ERROR", "The local runner returned an invalid model identifier."))?;
        names.insert(name.to_owned());
    }
    Ok(names.into_iter().collect())
}

fn validate_request(request: &ChatRequest) -> Result<(), CopilotError> {
    validate_id(&request.request_id)?;
    let parameters = &request.parameters;
    if request.model.trim().is_empty() || request.model.len() > 200 || request.model.chars().any(char::is_control)
        || !parameters.temperature.is_finite() || !(0.0..=2.0).contains(&parameters.temperature)
        || !(512..=32768).contains(&parameters.context_window) || parameters.system_prompt.len() > 8000
        || request.messages.is_empty() || request.messages.len() > 100
        || !matches!(request.messages.last().map(|turn| &turn.role), Some(ChatRole::User)) {
        return Err(CopilotError::new("INVALID_REQUEST", "Choose a model, a valid temperature/context size, and a conversation ending in a user message."));
    }
    if request.messages.iter().any(|message| message.content.trim().is_empty() || message.content.len() > 32768)
        || request.parameters.system_prompt.len()
            + request.messages.iter().map(|message| message.content.len()).sum::<usize>() > 131072 {
        return Err(CopilotError::new("REQUEST_LIMIT", "This conversation exceeds the local request limit. Start a new chat or shorten the messages."));
    }
    Ok(())
}

fn request_body(request: &ChatRequest) -> Value {
    let mut messages = Vec::new();
    if !request.parameters.system_prompt.trim().is_empty() { messages.push(json!({ "role": "system", "content": request.parameters.system_prompt })); }
    messages.extend(request.messages.iter().map(|turn| json!({ "role": turn.role, "content": turn.content })));
    match request.config.provider {
        Provider::Ollama => json!({ "model": request.model.trim(), "messages": messages, "stream": true, "options": { "temperature": request.parameters.temperature, "num_ctx": request.parameters.context_window } }),
        // llama.cpp context allocation is a server launch setting; do not invent an API control.
        Provider::Llamacpp => json!({ "model": request.model.trim(), "messages": messages, "stream": true, "temperature": request.parameters.temperature }),
    }
}

async fn cancelled(receiver: &mut watch::Receiver<bool>) {
    loop {
        if *receiver.borrow() { return; }
        if receiver.changed().await.is_err() { return; }
    }
}

fn send(channel: &Channel<ChatStreamEvent>, event: ChatStreamEvent) -> Result<(), CopilotError> {
    channel.send(event).map_err(|_| CopilotError::new("CHANNEL_CLOSED", "The chat view closed before the response finished."))
}

pub async fn chat(state: &CopilotState, owner: &str, request: ChatRequest, channel: Channel<ChatStreamEvent>) -> Result<(), CopilotError> {
    validate_request(&request)?;
    let base = endpoint(&request.config)?;
    let (_guard, mut receiver) = state.begin(owner, &request.request_id)?;
    let generation = async {
        let path = match request.config.provider { Provider::Ollama => "/api/chat", Provider::Llamacpp => "/v1/chat/completions" };
        let response = tokio::time::timeout(
            MAX_IDLE_TIME,
            client()?.post(route(&base, path)?).json(&request_body(&request)).send(),
        ).await
            .map_err(|_| CopilotError::new("TIMEOUT", "The local runner sent no response headers for 90 seconds. Check its loading progress or choose a smaller model."))?
            .map_err(|_| CopilotError::new("OFFLINE", connection_instructions(request.config.provider)))?;
        if !response.status().is_success() {
            return Err(CopilotError::new("HTTP_ERROR", format!("The local runner returned HTTP {}. Check that the selected model is installed and the runner is ready.", response.status().as_u16())));
        }
        let mut decoder = StreamDecoder::new(request.config.provider);
        let mut chunks = response.bytes_stream();
        loop {
            let chunk = tokio::time::timeout(MAX_IDLE_TIME, chunks.next()).await
                .map_err(|_| CopilotError::new("TIMEOUT", "The local model sent no response data for 90 seconds. Stop other workloads or choose a smaller model."))?;
            let pieces = match chunk {
                Some(Ok(bytes)) => decoder.push(&bytes)?,
                Some(Err(_)) => return Err(CopilotError::new("OFFLINE", "The local runner connection ended while generating the reply.")),
                None => decoder.finish()?,
            };
            for piece in pieces {
                match piece {
                    StreamPiece::Delta(delta) => send(&channel, ChatStreamEvent::delta(&request.request_id, delta))?,
                    StreamPiece::Done => { send(&channel, ChatStreamEvent::terminal(&request.request_id, "done"))?; return Ok(()); },
                }
            }
        }
    };
    let result = tokio::select! {
        biased;
        _ = cancelled(&mut receiver) => send(&channel, ChatStreamEvent::terminal(&request.request_id, "cancelled")),
        result = tokio::time::timeout(MAX_CHAT_TIME, generation) => result.unwrap_or_else(|_| Err(CopilotError::new("TIMEOUT", "The local response exceeded the 10-minute generation limit. Try a smaller context or model."))),
    };
    if let Err(error) = &result { let _ = channel.send(ChatStreamEvent::error(&request.request_id, error.clone())); }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_fixed_loopback_origins_are_accepted() {
        for value in ["http://127.0.0.1:11434", "http://[::1]:8080/", "http://localhost:8080"] {
            assert!(endpoint(&EngineConfig { provider: Provider::Ollama, base_url: value.to_owned() }).is_ok());
        }
        for value in ["https://127.0.0.1:11434", "http://example.com", "http://127.0.0.1:0", "http://127.0.0.1/api", "http://user:secret@127.0.0.1", "http://127.0.0.1?x=1", "http://127.0.0.1#fragment", "http://127.0.0.2:8080"] {
            assert!(endpoint(&EngineConfig { provider: Provider::Ollama, base_url: value.to_owned() }).is_err());
        }
    }

    #[test]
    fn cancellation_is_owned_and_generation_guard_releases_busy_state() {
        let state = CopilotState::default();
        let (guard, receiver) = state.begin("main", "request-1").unwrap();
        assert!(state.begin("main", "request-2").is_err());
        state.cancel("other", "request-1").unwrap();
        assert!(!*receiver.borrow());
        state.cancel("main", "request-1").unwrap();
        assert!(*receiver.borrow());
        drop(guard);
        assert!(state.begin("main", "request-2").is_ok());
    }

    #[test]
    fn stop_arriving_before_chat_prevents_network_generation() {
        let state = CopilotState::default();
        state.cancel("main", "early-stop").unwrap();
        let (_guard, receiver) = state.begin("main", "early-stop").unwrap();
        assert!(*receiver.borrow());
    }
}
