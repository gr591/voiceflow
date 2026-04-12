// WS3 owns this directory.

pub mod piper_sidecar;
pub mod whisper_sidecar;

/// Speak text using the platform's native TTS.
/// On Windows: PowerShell + System.Speech (SAPI). On macOS: the `say` command.
/// Synchronous: blocks until speech completes.
#[tauri::command]
pub async fn speak_text(text: String, _provider: Option<String>) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        // Single-quoted PS string — no variable/backtick interpolation; only '' escaping needed.
        let escaped = text.replace('\'', "''");
        let script = format!(
            "Add-Type -AssemblyName System.Speech; \
             $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; \
             $s.Speak('{escaped}')"
        );
        let mut cmd = std::process::Command::new("powershell");
        cmd.args(["-NoProfile", "-NonInteractive", "-Command", &script]);
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
        cmd.output().map_err(|e| e.to_string())?;
    }

    #[cfg(target_os = "macos")]
    {
        // macOS `say` is always available; no shell injection risk as we pass text as a separate arg.
        std::process::Command::new("say")
            .arg(&text)
            .output()
            .map_err(|e| format!("say command failed: {e}"))?;
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        let _ = text; // TTS not supported on this platform
    }

    Ok(())
}

/// Stop any in-progress TTS playback.
#[tauri::command]
pub async fn stop_speaking() -> Result<(), String> {
    Ok(())
}

/// Transcribe WAV audio bytes using the bundled whisper.cpp binary.
/// The frontend captures 16 kHz mono PCM and encodes it as WAV before calling this.
#[tauri::command]
pub async fn transcribe_audio(audio: Vec<u8>) -> Result<String, String> {
    // std::process::Command is blocking; run on the blocking thread pool.
    tokio::task::spawn_blocking(move || whisper_sidecar::transcribe(audio))
        .await
        .map_err(|e| e.to_string())?
}

/// Synthesise `text` with the bundled piper binary.
/// Returns raw WAV bytes the frontend plays via HTMLAudioElement.
#[tauri::command]
pub async fn speak_with_piper(text: String, model: Option<String>) -> Result<Vec<u8>, String> {
    tokio::task::spawn_blocking(move || {
        piper_sidecar::speak(&text, model.as_deref())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// STUB: Start mic capture (reserved for future cpal-based path).
#[tauri::command]
pub async fn start_audio_capture() -> Result<(), String> {
    Ok(())
}

/// STUB: Stop capture and transcribe (reserved for future cpal-based path).
#[tauri::command]
pub async fn stop_audio_capture_and_transcribe() -> Result<String, String> {
    Ok("Use transcribe_audio instead".to_string())
}
