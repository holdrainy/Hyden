use super::models::{DownloadJob, ImportResult, MediaError, MediaItem, MediaKind, MediaLibrary};
use super::service::MediaService;

#[tauri::command]
pub fn media_library() -> MediaLibrary {
    MediaService::library()
}

// No frontend-supplied path or executable is accepted by this placeholder command.
#[tauri::command]
pub fn media_import() -> Result<ImportResult, MediaError> {
    MediaService::import()
}

#[tauri::command]
pub fn media_set_favorite(id: String, favorite: bool) -> Result<MediaItem, MediaError> {
    MediaService::set_favorite(&id, favorite)
}

#[tauri::command]
pub fn media_remove(id: String) -> Result<(), MediaError> {
    MediaService::remove(&id)
}

#[tauri::command]
pub fn media_playback_source(id: String) -> Result<String, MediaError> {
    MediaService::playback_source(&id)
}

#[tauri::command]
pub fn media_enqueue_download(url: String, kind: MediaKind) -> Result<DownloadJob, MediaError> {
    MediaService::enqueue_download(&url, kind)
}

#[tauri::command]
pub fn media_download_jobs() -> Vec<DownloadJob> {
    MediaService::download_jobs()
}

#[tauri::command]
pub fn media_run_download_demo(id: String) -> Result<DownloadJob, MediaError> {
    MediaService::run_download_demo(&id)
}

#[tauri::command]
pub fn media_cancel_download(id: String) -> Result<DownloadJob, MediaError> {
    MediaService::cancel_download(&id)
}
