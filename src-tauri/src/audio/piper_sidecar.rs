// Calls the bundled piper.exe to synthesise speech.
//
// Binary: src-tauri/binaries/piper.exe
// Model:  src-tauri/binaries/voices/en_US-ryan-high.onnx
//
// Piper reads text from stdin and writes a WAV file to --output_file.
// We return the WAV bytes to the frontend to play via HTMLAudioElement.

use std::io::Write;
use std::path::PathBuf;

/// Synthesise `text` with piper and return raw WAV bytes (blocking).
pub fn speak(text: &str, model: Option<&str>) -> Result<Vec<u8>, String> {
    let (bin, model_path) = resolve_paths(model)?;

    let tmp_wav = std::env::temp_dir().join("voiceflow_tts.wav");

    let mut cmd = std::process::Command::new(&bin);
    cmd.args([
            "--model",       model_path.to_str().unwrap_or(""),
            "--output_file", tmp_wav.to_str().unwrap_or(""),
        ])
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        // DLLs live next to piper.exe
        .current_dir(bin.parent().unwrap_or_else(|| std::path::Path::new(".")));
    // Suppress the console window on Windows.
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let mut child = cmd.spawn()
        .map_err(|e| format!("spawn piper: {e}. Binary: {}", bin.display()))?;

    // Write text to stdin and close it so piper starts processing
    if let Some(stdin) = child.stdin.take() {
        let mut stdin = stdin;
        stdin.write_all(text.as_bytes()).ok();
    }

    let status = child.wait().map_err(|e| format!("piper wait: {e}"))?;
    if !status.success() {
        return Err(format!("piper exited with status {status}"));
    }

    let bytes = std::fs::read(&tmp_wav)
        .map_err(|e| format!("read piper output: {e}"))?;
    let _ = std::fs::remove_file(&tmp_wav);

    Ok(bytes)
}

fn resolve_paths(model_override: Option<&str>) -> Result<(PathBuf, PathBuf), String> {
    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|p| p.to_path_buf()));

    let cwd = std::env::current_dir().unwrap_or_default();
    let dev_dir = if cwd.join("binaries").exists() {
        Some(cwd.join("binaries"))
    } else if cwd.join("src-tauri").join("binaries").exists() {
        Some(cwd.join("src-tauri").join("binaries"))
    } else {
        None
    };

    // Find piper binary
    // Candidate order: exe_dir/binaries/ (installed bundle), exe_dir/ (flat bundle),
    //                  dev binaries/ dir, PATH fallback
    let bin = ["piper.exe", "piper"]
        .iter()
        .flat_map(|name| {
            let mut c = vec![];
            if let Some(ref d) = exe_dir {
                c.push(d.join("binaries").join(name)); // installed via NSIS
                c.push(d.join(name));                  // flat sidecar
            }
            if let Some(ref d) = dev_dir  { c.push(d.join(name)); }
            c.push(PathBuf::from(name));
            c
        })
        .find(|p| {
            p.exists()
                || matches!(
                    p.file_name().and_then(|n| n.to_str()),
                    Some("piper.exe" | "piper")
                ) && p.components().count() == 1
        })
        .unwrap_or_else(|| PathBuf::from("piper"));

    // Find model
    let model_name = model_override.unwrap_or("en_US-ryan-high.onnx");
    let model = [model_name]
        .iter()
        .flat_map(|name| {
            let mut c = vec![];
            if let Some(ref d) = exe_dir {
                c.push(d.join("binaries").join("voices").join(name)); // installed
                c.push(d.join("voices").join(name));
                c.push(d.join(name));
            }
            if let Some(ref d) = dev_dir {
                c.push(d.join("voices").join(name));
                c.push(d.join(name));
            }
            c
        })
        .find(|p| p.exists())
        .ok_or_else(|| format!("{model_name} not found in binaries/voices/"))?;

    Ok((bin, model))
}
