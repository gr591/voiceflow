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

    let bin_dir = bin.parent().unwrap_or_else(|| std::path::Path::new(".")).to_path_buf();

    let mut cmd = std::process::Command::new(&bin);
    cmd.args([
            "--model",       model_path.to_str().unwrap_or(""),
            "--output_file", tmp_wav.to_str().unwrap_or(""),
        ])
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::piped()) // capture for error reporting
        // DLLs / dylibs and espeak-ng-data live next to the piper binary
        .current_dir(&bin_dir);

    // macOS: current_dir alone does NOT help the dynamic linker find sibling
    // dylibs (libpiper_phonemize.dylib, etc.).  Prepend to DYLD_LIBRARY_PATH.
    // Also set ESPEAK_DATA so piper finds the phoneme data for the bundled
    // espeak-ng-data/ directory (silently fails without it).
    #[cfg(target_os = "macos")]
    {
        let existing = std::env::var("DYLD_LIBRARY_PATH").unwrap_or_default();
        let new_val = if existing.is_empty() {
            bin_dir.to_string_lossy().to_string()
        } else {
            format!("{}:{}", bin_dir.display(), existing)
        };
        cmd.env("DYLD_LIBRARY_PATH", new_val);
        let espeak = bin_dir.join("espeak-ng-data");
        if espeak.exists() {
            cmd.env("ESPEAK_DATA", espeak);
        }
    }

    // Suppress the console window on Windows.
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let mut child = cmd.spawn()
        .map_err(|e| format!("spawn piper: {e}. Binary: {}", bin.display()))?;

    // Write text to stdin then drop it (closes pipe) so piper starts processing
    if let Some(mut stdin) = child.stdin.take() {
        stdin.write_all(text.as_bytes()).ok();
    }

    // Collect exit status + stderr now that stdin is closed
    let output = child.wait_with_output().map_err(|e| format!("piper wait: {e}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        eprintln!("[piper] Error: exit={} stderr={stderr}", output.status);
        return Err(format!("piper exited with status {}. stderr: {stderr}", output.status));
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

    // On macOS, Tauri bundles resources into Contents/Resources/ while the
    // executable lives in Contents/MacOS/.
    #[cfg(target_os = "macos")]
    let resource_dir = exe_dir.as_ref().and_then(|d| {
        d.parent().map(|contents| contents.join("Resources"))
    });
    #[cfg(not(target_os = "macos"))]
    let resource_dir: Option<PathBuf> = None;

    let cwd = std::env::current_dir().unwrap_or_default();
    let dev_dir = if cwd.join("binaries").exists() {
        Some(cwd.join("binaries"))
    } else if cwd.join("src-tauri").join("binaries").exists() {
        Some(cwd.join("src-tauri").join("binaries"))
    } else {
        None
    };

    // Find piper binary
    let bin = ["piper.exe", "piper"]
        .iter()
        .flat_map(|name| {
            let mut c = vec![];
            if let Some(ref d) = resource_dir {
                c.push(d.join("binaries").join(name)); // macOS bundle
            }
            if let Some(ref d) = exe_dir {
                c.push(d.join("binaries").join(name)); // installed via NSIS
                c.push(d.join(name));                  // flat sidecar
            }
            if let Some(ref d) = dev_dir  { c.push(d.join(name)); }
            c.push(PathBuf::from(name));               // PATH fallback
            c
        })
        .find(|p| p.exists() || p.components().count() == 1)
        .unwrap_or_else(|| PathBuf::from("piper"));

    // Find model
    let model_name = model_override.unwrap_or("en_US-ryan-high.onnx");
    let model = [model_name]
        .iter()
        .flat_map(|name| {
            let mut c = vec![];
            if let Some(ref d) = resource_dir {
                c.push(d.join("binaries").join("voices").join(name)); // macOS bundle
            }
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
