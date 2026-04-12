// Calls the bundled whisper.cpp binary to transcribe a WAV buffer.
//
// Binary resolution order:
//   1. <exe dir>/whisper.exe          — production bundle (Tauri sidecar)
//   2. src-tauri/binaries/whisper.exe — dev mode (relative to CWD)
//   3. "whisper" in PATH              — system-wide install
//
// Model resolution:
//   <exe dir>/ggml-base.bin, then src-tauri/binaries/ggml-base.bin
//
// To download the model:
//   curl -L -o src-tauri/binaries/ggml-base.bin \
//     https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin

use std::path::PathBuf;

/// Transcribe raw WAV bytes using whisper.cpp (blocking).
pub fn transcribe(wav_bytes: Vec<u8>) -> Result<String, String> {
    let (bin, model) = resolve_paths()?;

    // Write WAV to a temp file
    let tmp_wav = std::env::temp_dir().join("voiceflow_in.wav");
    let tmp_txt = std::env::temp_dir().join("voiceflow_in.wav.txt");
    std::fs::write(&tmp_wav, &wav_bytes).map_err(|e| format!("write temp wav: {e}"))?;

    // Run whisper.cpp: -m <model> -f <wav> --output-txt -nt -np -l en
    // Set cwd to bin's directory so Windows can resolve the sibling DLLs.
    let mut cmd = std::process::Command::new(&bin);
    if let Some(bin_dir) = bin.parent() {
        cmd.current_dir(bin_dir);
    }
    // Suppress the console window on Windows.
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let output = cmd.args([
            "-m", model.to_str().unwrap_or("ggml-base.bin"),
            "-f", tmp_wav.to_str().unwrap_or(""),
            "--output-txt",
            "-nt",   // no timestamps
            "-np",   // no progress output
            "-l", "en",
        ])
        .output()
        .map_err(|e| format!("run whisper: {e}. Binary: {}", bin.display()))?;

    let _ = std::fs::remove_file(&tmp_wav);

    // whisper.cpp writes to <wav>.txt; fall back to stdout
    let text = if tmp_txt.exists() {
        let t = std::fs::read_to_string(&tmp_txt)
            .map_err(|e| format!("read transcript: {e}"))?;
        let _ = std::fs::remove_file(&tmp_txt);
        t
    } else {
        String::from_utf8_lossy(&output.stdout).to_string()
    };

    let trimmed = text.trim().to_string();
    if trimmed.is_empty() {
        // Surface stderr for debugging
        let err = String::from_utf8_lossy(&output.stderr);
        Err(format!("whisper returned empty output. stderr: {err}"))
    } else {
        Ok(trimmed)
    }
}

fn resolve_paths() -> Result<(PathBuf, PathBuf), String> {
    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|p| p.to_path_buf()));

    // On macOS, Tauri bundles resources into Contents/Resources/ while the
    // executable lives in Contents/MacOS/.  Derive the resource dir so we
    // can find bundled binaries at runtime.
    #[cfg(target_os = "macos")]
    let resource_dir = exe_dir.as_ref().and_then(|d| {
        d.parent().map(|contents| contents.join("Resources"))
    });
    #[cfg(not(target_os = "macos"))]
    let resource_dir: Option<PathBuf> = None;

    // In `cargo tauri dev` the cwd is src-tauri/; in a plain cargo run it may be
    // the project root. Check both so we find binaries/ in either case.
    let cwd = std::env::current_dir().unwrap_or_default();
    let dev_dir = if cwd.join("binaries").exists() {
        Some(cwd.join("binaries"))                      // cwd = src-tauri/
    } else if cwd.join("src-tauri").join("binaries").exists() {
        Some(cwd.join("src-tauri").join("binaries"))    // cwd = project root
    } else {
        None
    };

    // Find whisper binary
    // Candidate order: macOS resource bundle, exe_dir/binaries/ (installed NSIS),
    //                  exe_dir/ (flat sidecar), dev binaries/ dir, PATH fallback.
    // "whisper-cli" is the name in newer whisper.cpp macOS/Linux releases;
    // "whisper.exe" / "whisper" are used on Windows / older builds.
    let bin = ["whisper-cli", "whisper.exe", "whisper"]
        .iter()
        .flat_map(|name| {
            let mut candidates = vec![];
            if let Some(ref d) = resource_dir {
                candidates.push(d.join("binaries").join(name)); // macOS bundle
            }
            if let Some(ref d) = exe_dir {
                candidates.push(d.join("binaries").join(name)); // installed via NSIS
                candidates.push(d.join(name));                  // flat sidecar
            }
            if let Some(ref d) = dev_dir  { candidates.push(d.join(name)); }
            candidates.push(PathBuf::from(name));               // PATH fallback
            candidates
        })
        .find(|p| p.exists() || p.components().count() == 1)
        .unwrap_or_else(|| PathBuf::from("whisper-cli"));

    // Find model
    let model = ["ggml-base.bin"]
        .iter()
        .flat_map(|name| {
            let mut candidates = vec![];
            if let Some(ref d) = resource_dir {
                candidates.push(d.join("binaries").join(name)); // macOS bundle
            }
            if let Some(ref d) = exe_dir {
                candidates.push(d.join("binaries").join(name)); // installed
                candidates.push(d.join(name));
            }
            if let Some(ref d) = dev_dir  { candidates.push(d.join(name)); }
            candidates
        })
        .find(|p| p.exists())
        .ok_or_else(|| {
            "ggml-base.bin not found. Download it from huggingface.co/ggerganov/whisper.cpp and place it in src-tauri/binaries/".to_string()
        })?;

    Ok((bin, model))
}
