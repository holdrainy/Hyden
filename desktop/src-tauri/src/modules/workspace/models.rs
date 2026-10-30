use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Note {
    pub id: String,
    pub title: String,
    pub markdown: String,
    pub created_at: String,
    pub updated_at: String,
    pub revision: u64,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Sheet {
    pub id: String,
    pub title: String,
    pub rows: u32,
    pub columns: u32,
    pub cells: BTreeMap<String, String>,
    pub header_row: bool,
    pub created_at: String,
    pub updated_at: String,
    pub revision: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSnapshot {
    pub version: u8,
    pub notes: Vec<Note>,
    pub sheets: Vec<Sheet>,
    pub mode: &'static str,
    pub persistence: &'static str,
    pub notice: &'static str,
}

#[derive(Serialize)]
pub struct WorkspaceError {
    pub code: &'static str,
    pub message: String,
}
