pub mod audio;
pub mod config;
pub mod hotkey;
pub mod insertion;
pub mod llm_server;
pub mod tray;
pub mod window;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // ── Plugins ────────────────────────────────────────────────────────
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec![]),
        ))
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_shell::init())
        // ── Managed state ─────────────────────────────────────────────────
        .manage(crate::window::FocusState {
            previous_hwnd: std::sync::Mutex::new(None),
        })
        .manage(crate::llm_server::LlmServerState::new())
        // ── Setup ──────────────────────────────────────────────────────────
        .setup(|app| {
            hotkey::register_hotkey(app)?;
            tray::setup_tray(app)?;

            // macOS: WKWebView renders a white background by default even when
            // the OS-level window has transparent:true.  Force the native
            // webview layer to be fully transparent so the rounded pill corners
            // show the desktop instead of white.
            #[cfg(target_os = "macos")]
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_background_color(None);
            }

            Ok(())
        })
        // ── Commands ───────────────────────────────────────────────────────
        .invoke_handler(tauri::generate_handler![
            // WS1: window management
            window::show_overlay,
            window::hide_overlay,
            window::request_hide,
            window::get_previous_hwnd,
            window::set_window_size,
            window::get_foreground_app_name,
            // WS1: hotkey management
            hotkey::set_hotkey,
            // WS3: audio (stubs — WS3 replaces with real implementations)
            audio::start_audio_capture,
            audio::stop_audio_capture_and_transcribe,
            audio::speak_text,
            audio::stop_speaking,
            audio::transcribe_audio,
            audio::speak_with_piper,
            // WS5: text insertion (stub — WS5 replaces with real implementation)
            insertion::insert_at_cursor,
            // Bundled LLM (llama.cpp server)
            llm_server::start_bundled_llm,
            llm_server::stop_bundled_llm,
            llm_server::bundled_llm_available,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
