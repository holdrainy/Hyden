use serde::{Deserialize, Serialize};

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum MediaKind {
    Audio,
    Video,
}

#[derive(Serialize)]
#[serde(rename_all = "lowercase")]
pub enum MediaSource {
    Demo,
    Local,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaItem {
    pub id: String,
    pub title: String,
    pub creator: String,
    pub kind: MediaKind,
    pub duration_seconds: Option<f64>,
    pub size_bytes: u64,
    pub mime_type: String,
    pub added_at: String,
    pub source: MediaSource,
    pub favorite: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub width: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub height: Option<u32>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaLibrary {
    pub items: Vec<MediaItem>,
    pub mode: &'static str,
    pub import_support: &'static str,
    pub download_support: &'static str,
    pub persistence: &'static str,
    pub notice: &'static str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
    pub items: Vec<MediaItem>,
    pub skipped: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "lowercase")]
pub enum DownloadStatus {
    Queued,
    Completed,
    Cancelled,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadJob {
    pub id: String,
    pub url: String,
    pub title: String,
    pub kind: MediaKind,
    pub status: DownloadStatus,
    pub progress: f64,
    pub simulated: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub item_id: Option<String>,
}

#[derive(Serialize)]
pub struct MediaError {
    pub code: &'static str,
    pub message: String,
}
