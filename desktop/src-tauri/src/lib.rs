use serde::Serialize;
use tauri::Manager;

mod modules;

use modules::copilot::commands::{copilot_cancel, copilot_chat, copilot_models, copilot_status};
use modules::copilot::service::CopilotState;
use modules::editor::commands::{editor_capabilities, editor_process_image, editor_run_trim, editor_trim_plan};
use modules::internal_browser::commands::{internal_browser_capabilities, internal_browser_purge};

use modules::media::commands::{
    media_cancel_download, media_download_jobs, media_enqueue_download, media_import, media_library,
    media_playback_source, media_remove, media_run_download_demo, media_set_favorite,
};
use modules::workspace::commands::{
    workspace_create_note, workspace_create_sheet, workspace_delete_note, workspace_delete_sheet,
    workspace_save_note, workspace_save_sheet, workspace_snapshot,
};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ShellStatus {
    app_version: &'static str,
    host: &'static str,
    persistence: &'static str,
    worker_state: &'static str,
}

// Only inert host metadata is exposed. Add module commands explicitly and validate inputs in Rust.
#[tauri::command]
fn shell_status() -> ShellStatus {
    ShellStatus {
        app_version: env!("CARGO_PKG_VERSION"),
        host: "desktop",
        persistence: "not-configured",
        worker_state: "not-started",
    }
}

pub fn run() {
    tauri::Builder::default()
        .manage(CopilotState::default())
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::Destroyed) {
                window.app_handle().state::<CopilotState>().cancel_owner(window.label());
            }
        })
        .invoke_handler(tauri::generate_handler![
            shell_status,
            internal_browser_capabilities,
            internal_browser_purge,
            editor_capabilities,
            editor_trim_plan,
            editor_run_trim,
            editor_process_image,
            copilot_status,
            copilot_models,
            copilot_chat,
            copilot_cancel,
            media_library,
            media_import,
            media_set_favorite,
            media_remove,
            media_playback_source,
            media_enqueue_download,
            media_download_jobs,
            media_run_download_demo,
            media_cancel_download,
            workspace_snapshot,
            workspace_create_note,
            workspace_save_note,
            workspace_delete_note,
            workspace_create_sheet,
            workspace_save_sheet,
            workspace_delete_sheet,
        ])
        .run(tauri::generate_context!())
        .expect("failed to start Hyden desktop shell");
}
