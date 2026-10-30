use super::models::{Note, Sheet, WorkspaceError, WorkspaceSnapshot};
use super::service::WorkspaceService;

#[tauri::command]
pub fn workspace_snapshot() -> WorkspaceSnapshot {
    WorkspaceService::snapshot()
}

#[tauri::command]
pub fn workspace_create_note(title: Option<String>) -> Result<Note, WorkspaceError> {
    WorkspaceService::create_note(title)
}

#[tauri::command]
pub fn workspace_save_note(note: Note) -> Result<Note, WorkspaceError> {
    WorkspaceService::save_note(note)
}

#[tauri::command]
pub fn workspace_delete_note(id: String, revision: u64) -> Result<(), WorkspaceError> {
    WorkspaceService::delete_note(&id, revision)
}

#[tauri::command]
pub fn workspace_create_sheet(title: Option<String>) -> Result<Sheet, WorkspaceError> {
    WorkspaceService::create_sheet(title)
}

#[tauri::command]
pub fn workspace_save_sheet(sheet: Sheet) -> Result<Sheet, WorkspaceError> {
    WorkspaceService::save_sheet(sheet)
}

#[tauri::command]
pub fn workspace_delete_sheet(id: String, revision: u64) -> Result<(), WorkspaceError> {
    WorkspaceService::delete_sheet(&id, revision)
}
