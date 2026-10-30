//! Integration points only. Native implementations must validate inputs, enforce path scopes,
//! and keep blocking file/process work off the UI thread before these commands are enabled.

use std::path::Path;

use super::models::{DownloadJob, ImportResult, MediaError, MediaItem, MediaKind, MediaLibrary};

/// Future Rust-owned persistence boundary; the frontend never receives database access.
pub trait MediaRepository {
    fn list(&self) -> Result<Vec<MediaItem>, MediaError>;
}

/// Future metadata adapter. The caller must resolve an approved local path before probing.
pub trait MediaProbe {
    fn inspect(&self, approved_path: &Path) -> Result<MediaItem, MediaError>;
}

/// Future supervised downloader adapter; this is not a generic process execution API.
pub trait MediaDownloader {
    fn enqueue(&self, url: &str, kind: MediaKind) -> Result<DownloadJob, MediaError>;
}

pub struct MediaService;

impl MediaService {
    pub fn library() -> MediaLibrary {
        MediaLibrary {
            items: Vec::new(),
            mode: "desktop",
            import_support: "unavailable",
            download_support: "unavailable",
            persistence: "session",
            notice: "Native Media Engine integration is planned. Local import, persistent library storage, metadata probing, playback sources, and downloading are not implemented in this shell.",
        }
    }

    pub fn import() -> Result<ImportResult, MediaError> {
        unavailable("Local file import")
    }

    pub fn set_favorite(_id: &str, _favorite: bool) -> Result<MediaItem, MediaError> {
        unavailable("Updating favorites")
    }

    pub fn remove(_id: &str) -> Result<(), MediaError> {
        unavailable("Removing library items")
    }

    pub fn playback_source(_id: &str) -> Result<String, MediaError> {
        unavailable("Resolving a local playback source")
    }

    pub fn enqueue_download(_url: &str, _kind: MediaKind) -> Result<DownloadJob, MediaError> {
        unavailable("Downloading media")
    }

    pub fn download_jobs() -> Vec<DownloadJob> {
        Vec::new()
    }

    pub fn run_download_demo(_id: &str) -> Result<DownloadJob, MediaError> {
        unavailable("Download simulation in the native host")
    }

    pub fn cancel_download(_id: &str) -> Result<DownloadJob, MediaError> {
        unavailable("Cancelling downloads")
    }
}

fn unavailable<T>(operation: &str) -> Result<T, MediaError> {
    Err(MediaError {
        code: "NATIVE_NOT_IMPLEMENTED",
        message: format!("{operation} is not implemented in the native Media Engine yet."),
    })
}
