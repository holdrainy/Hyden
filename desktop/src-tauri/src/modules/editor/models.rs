use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum InputKind {
    Audio,
    Video,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditorTrimRequest {
    pub input_name: String,
    pub input_kind: InputKind,
    pub duration_seconds: f64,
    pub start_seconds: f64,
    pub end_seconds: f64,
    pub audio_only: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FFmpegPlan {
    pub program: &'static str,
    pub args: Vec<String>,
    pub display_command: String,
    pub output_name: String,
    pub mode: &'static str,
    pub notice: &'static str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EditorCapabilities {
    pub ffmpeg_execution: bool,
    pub native_image_processing: bool,
    pub mode: &'static str,
    pub notice: &'static str,
}

#[derive(Debug, Deserialize)]
pub struct ImageCrop {
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ImageFormat {
    Png,
    Webp,
    Jpeg,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeImageRequest {
    /// Future app-owned asset identity, never a frontend-supplied OS path.
    pub asset_id: String,
    pub crop: ImageCrop,
    pub width: u32,
    pub height: u32,
    pub format: ImageFormat,
    pub brightness: f64,
    pub contrast: f64,
}

#[derive(Debug, Serialize)]
pub struct EditorError {
    pub code: &'static str,
    pub message: &'static str,
}

impl EditorError {
    pub fn validation(message: &'static str) -> Self {
        Self { code: "INVALID_REQUEST", message }
    }

    pub fn unavailable(message: &'static str) -> Self {
        Self { code: "NATIVE_NOT_IMPLEMENTED", message }
    }
}
