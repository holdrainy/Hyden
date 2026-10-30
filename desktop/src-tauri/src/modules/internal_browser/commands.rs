use tauri::WebviewWindow;

use super::models::{BrowserCapabilities, BrowserError};

fn trusted(window: &WebviewWindow) -> Result<(), BrowserError> {
    if window.label() != "main" {
        return Err(BrowserError {
            code: "FORBIDDEN",
            message: "Only the local main window can inspect browser preview capabilities.",
        });
    }
    Ok(())
}

#[tauri::command]
pub fn internal_browser_capabilities(window: WebviewWindow) -> Result<BrowserCapabilities, BrowserError> {
    trusted(&window)?;
    Ok(BrowserCapabilities {
        mode: "preview",
        live_browsing: false,
        cookie_access: false,
        notice: "Only sandboxed bundled previews are available; no native browsing profile or cookie control is implemented yet.",
    })
}

#[tauri::command]
pub fn internal_browser_purge(window: WebviewWindow) -> Result<(), BrowserError> {
    trusted(&window)?;
    // Never clear the main webview's data: it owns Workspace and Copilot storage.
    // A future implementation must target a distinct browsing profile only.
    Err(BrowserError {
        code: "NATIVE_NOT_IMPLEMENTED",
        message: "A native browsing profile is not implemented. Only the browser preview's own navigation can be purged; real website cookies were not accessed or cleared.",
    })
}
