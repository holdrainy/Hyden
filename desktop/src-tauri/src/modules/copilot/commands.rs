use tauri::{ipc::Channel, State, WebviewWindow};

use super::models::{ChatRequest, ChatStreamEvent, CopilotError, EngineConfig, EngineStatus};
use super::service::{self, CopilotState};

fn trusted(window: &WebviewWindow) -> Result<(), CopilotError> {
    if window.label() != "main" {
        return Err(CopilotError::new("FORBIDDEN", "Only the local main window can use the Copilot."));
    }
    Ok(())
}

#[tauri::command]
pub async fn copilot_status(window: WebviewWindow, config: EngineConfig) -> Result<EngineStatus, CopilotError> {
    trusted(&window)?;
    service::status(config).await
}

#[tauri::command]
pub async fn copilot_models(window: WebviewWindow, config: EngineConfig) -> Result<Vec<String>, CopilotError> {
    trusted(&window)?;
    service::models(config).await
}

#[tauri::command]
pub async fn copilot_chat(
    window: WebviewWindow,
    state: State<'_, CopilotState>,
    request: ChatRequest,
    on_event: Channel<ChatStreamEvent>,
) -> Result<(), CopilotError> {
    trusted(&window)?;
    service::chat(state.inner(), window.label(), request, on_event).await
}

#[tauri::command]
pub fn copilot_cancel(window: WebviewWindow, state: State<'_, CopilotState>, request_id: String) -> Result<(), CopilotError> {
    trusted(&window)?;
    state.cancel(window.label(), &request_id)
}
