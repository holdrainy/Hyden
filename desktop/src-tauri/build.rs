fn main() {
    let attributes = tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "shell_status",
            "internal_browser_capabilities",
            "internal_browser_purge",
            "editor_capabilities",
            "editor_trim_plan",
            "editor_run_trim",
            "editor_process_image",
            "copilot_status",
            "copilot_models",
            "copilot_chat",
            "copilot_cancel",
            "media_library",
            "media_import",
            "media_set_favorite",
            "media_remove",
            "media_playback_source",
            "media_enqueue_download",
            "media_download_jobs",
            "media_run_download_demo",
            "media_cancel_download",
            "workspace_snapshot",
            "workspace_create_note",
            "workspace_save_note",
            "workspace_delete_note",
            "workspace_create_sheet",
            "workspace_save_sheet",
            "workspace_delete_sheet",
        ]),
    );
    tauri_build::try_build(attributes).expect("failed to generate Tauri command permissions");
}
