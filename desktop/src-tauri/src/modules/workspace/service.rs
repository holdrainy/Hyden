//! Native extension points only. A future Rust-owned SQLite repository must use
//! transactions and revision checks for mutations; the UI never receives database access.

use super::models::{Note, Sheet, WorkspaceError, WorkspaceSnapshot};

pub trait WorkspaceRepository {
    fn notes(&self) -> Result<Vec<Note>, WorkspaceError>;
    fn sheets(&self) -> Result<Vec<Sheet>, WorkspaceError>;
}

pub struct WorkspaceService;

impl WorkspaceService {
    pub fn snapshot() -> WorkspaceSnapshot {
        WorkspaceSnapshot {
            version: 1,
            notes: Vec::new(),
            sheets: Vec::new(),
            mode: "desktop",
            persistence: "unavailable",
            notice: "Native Workspace persistence is planned. Note and sheet mutations are unavailable until the Rust-owned repository is implemented; browser storage is not used as a desktop fallback.",
        }
    }

    pub fn create_note(_title: Option<String>) -> Result<Note, WorkspaceError> {
        unavailable("Creating notes")
    }

    pub fn save_note(_note: Note) -> Result<Note, WorkspaceError> {
        unavailable("Saving notes")
    }

    pub fn delete_note(_id: &str, _revision: u64) -> Result<(), WorkspaceError> {
        unavailable("Deleting notes")
    }

    pub fn create_sheet(_title: Option<String>) -> Result<Sheet, WorkspaceError> {
        unavailable("Creating sheets")
    }

    pub fn save_sheet(_sheet: Sheet) -> Result<Sheet, WorkspaceError> {
        unavailable("Saving sheets")
    }

    pub fn delete_sheet(_id: &str, _revision: u64) -> Result<(), WorkspaceError> {
        unavailable("Deleting sheets")
    }
}

fn unavailable<T>(operation: &str) -> Result<T, WorkspaceError> {
    Err(WorkspaceError {
        code: "NATIVE_NOT_IMPLEMENTED",
        message: format!("{operation} is not implemented in the native Workspace yet."),
    })
}
