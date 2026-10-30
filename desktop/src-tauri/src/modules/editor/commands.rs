use tauri::WebviewWindow;

use super::models::{EditorCapabilities, EditorError, EditorTrimRequest, FFmpegPlan, NativeImageRequest};
use super::plan::create_trim_plan;

fn trusted(window: &WebviewWindow) -> Result<(), EditorError> {
    if window.label() != "main" {
        return Err(EditorError { code: "FORBIDDEN", message: "Only the local main window can access editor hooks." });
    }
    Ok(())
}

#[tauri::command]
pub fn editor_capabilities(window: WebviewWindow) -> Result<EditorCapabilities, EditorError> {
    trusted(&window)?;
    Ok(EditorCapabilities {
        ffmpeg_execution: false,
        native_image_processing: false,
        mode: "native",
        notice: "FFmpeg plans are available, but native execution and OpenCV image processing need an approved local asset workflow. The canvas image processor is available in the frontend.",
    })
}

#[tauri::command]
pub fn editor_trim_plan(window: WebviewWindow, request: EditorTrimRequest) -> Result<FFmpegPlan, EditorError> {
    trusted(&window)?;
    create_trim_plan(&request)
}

#[tauri::command]
pub fn editor_run_trim(window: WebviewWindow, request: EditorTrimRequest) -> Result<(), EditorError> {
    trusted(&window)?;
    // Validate the plan, but never turn a frontend filename into unrestricted file access.
    let _ = create_trim_plan(&request)?;
    Err(EditorError::unavailable("Native FFmpeg execution is not implemented. Review/export the command plan; running it needs a trusted OS file picker, approved asset paths, and supervised jobs."))
}

#[tauri::command]
pub fn editor_process_image(window: WebviewWindow, request: NativeImageRequest) -> Result<(), EditorError> {
    trusted(&window)?;
    // The future processor must resolve asset_id through an app-owned asset registry,
    // validate dimensions/operations, and supervise an on-demand worker. No paths or bytes
    // are accessed here; the current frontend uses its local canvas implementation.
    let _ = request;
    Err(EditorError::unavailable("Native OpenCV processing is not implemented. Use the local canvas image processor in this preview."))
}
