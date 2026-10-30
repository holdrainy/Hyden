use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Provider {
    Ollama,
    Llamacpp,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineConfig {
    pub provider: Provider,
    pub base_url: String,
}

#[derive(Serialize)]
pub struct EngineStatus {
    pub online: bool,
    pub mode: &'static str,
    pub provider: Provider,
    pub endpoint: String,
    pub detail: String,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ChatRole {
    User,
    Assistant,
}

#[derive(Deserialize, Serialize)]
pub struct ChatTurn {
    pub role: ChatRole,
    pub content: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatParameters {
    pub system_prompt: String,
    pub temperature: f64,
    pub context_window: u32,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatRequest {
    pub request_id: String,
    pub config: EngineConfig,
    pub model: String,
    pub messages: Vec<ChatTurn>,
    pub parameters: ChatParameters,
}

#[derive(Clone, Debug, Serialize)]
pub struct CopilotError {
    pub code: String,
    pub message: String,
}

impl CopilotError {
    pub fn new(code: &str, message: impl Into<String>) -> Self {
        Self { code: code.to_owned(), message: message.into() }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatStreamEvent {
    pub request_id: String,
    #[serde(rename = "type")]
    pub kind: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub delta: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<CopilotError>,
}

impl ChatStreamEvent {
    pub fn terminal(request_id: &str, kind: &'static str) -> Self {
        Self { request_id: request_id.to_owned(), kind, delta: None, error: None }
    }

    pub fn delta(request_id: &str, delta: String) -> Self {
        Self { request_id: request_id.to_owned(), kind: "delta", delta: Some(delta), error: None }
    }

    pub fn error(request_id: &str, error: CopilotError) -> Self {
        Self { request_id: request_id.to_owned(), kind: "error", delta: None, error: Some(error) }
    }
}
