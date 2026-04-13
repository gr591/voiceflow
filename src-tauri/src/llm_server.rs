// Manages the bundled llama-server.exe process.
//
// llama.cpp exposes an OpenAI-compatible HTTP API on localhost:{PORT}.
// The frontend uses the same LocalProvider path to talk to it.
//
// Binary layout (dev + installed):
//   binaries/llama/llama-server.exe  (+ sibling DLLs)
//   binaries/models/LFM2.5-350M-Q8_0.gguf
//
// The child process is killed when LlmServerState is dropped (app exit).

use std::path::PathBuf;
use std::sync::Mutex;

pub const LLAMA_PORT: u16 = 8765;
pub const LLAMA_HOST: &str = "127.0.0.1";
pub const MODEL_NAME: &str = "LFM2.5-350M-Q8_0.gguf";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

pub struct LlmServerState {
    child: Mutex<Option<std::process::Child>>,
}

impl LlmServerState {
    pub fn new() -> Self {
        Self { child: Mutex::new(None) }
    }
}

impl Drop for LlmServerState {
    fn drop(&mut self) {
        if let Ok(mut guard) = self.child.lock() {
            if let Some(mut child) = guard.take() {
                let _ = child.kill();
                let _ = child.wait(); // reap so no zombie
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Path resolution  (same pattern as whisper_sidecar.rs)
// ---------------------------------------------------------------------------

fn resolve_paths() -> Option<(PathBuf, PathBuf)> {
    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|p| p.to_path_buf()));

    // On macOS, Tauri bundles resources into Contents/Resources/ while the
    // executable lives in Contents/MacOS/.  Compute the resource dir so we
    // can find the bundled binaries at runtime.
    #[cfg(target_os = "macos")]
    let resource_dir = exe_dir.as_ref().and_then(|d| {
        d.parent().map(|contents| contents.join("Resources"))
    });
    #[cfg(not(target_os = "macos"))]
    let resource_dir: Option<PathBuf> = None;

    let cwd = std::env::current_dir().unwrap_or_default();

    // Try dev-mode binary dirs
    let dev_llama = if cwd.join("binaries").join("llama").exists() {
        Some(cwd.join("binaries").join("llama"))
    } else if cwd.join("src-tauri").join("binaries").join("llama").exists() {
        Some(cwd.join("src-tauri").join("binaries").join("llama"))
    } else {
        None
    };

    // llama-server.exe — check installed first, then dev
    let server = ["llama-server.exe", "llama-server"]
        .iter()
        .flat_map(|name| {
            let mut c: Vec<PathBuf> = vec![];
            // macOS resource bundle (Contents/Resources/binaries/llama/...)
            if let Some(ref d) = resource_dir {
                c.push(d.join("binaries").join("llama").join(name));
                c.push(d.join("llama").join(name));
            }
            if let Some(ref d) = exe_dir {
                c.push(d.join("binaries").join("llama").join(name)); // installed (Windows)
                c.push(d.join("llama").join(name));
            }
            if let Some(ref d) = dev_llama {
                c.push(d.join(name));
            }
            c
        })
        .find(|p| p.exists())?;

    // Model GGUF
    let model = {
        let mut candidates: Vec<PathBuf> = vec![];
        // macOS resource bundle
        if let Some(ref d) = resource_dir {
            candidates.push(d.join("binaries").join("models").join(MODEL_NAME));
            candidates.push(d.join("models").join(MODEL_NAME));
        }
        if let Some(ref d) = exe_dir {
            candidates.push(d.join("binaries").join("models").join(MODEL_NAME));
            candidates.push(d.join("models").join(MODEL_NAME));
        }
        candidates.push(cwd.join("binaries").join("models").join(MODEL_NAME));
        candidates.push(cwd.join("src-tauri").join("binaries").join("models").join(MODEL_NAME));
        candidates.into_iter().find(|p| p.exists())?
    };

    Some((server, model))
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

/// Start the bundled llama-server if not already running.
/// Returns the port the server is listening on.
/// Safe to call multiple times — is a no-op if server is already up.
#[tauri::command]
pub fn start_bundled_llm(state: tauri::State<LlmServerState>) -> Result<u16, String> {
    let mut guard = state.child.lock().unwrap();

    // Already running?
    if let Some(ref mut child) = *guard {
        if child.try_wait().map(|s| s.is_none()).unwrap_or(false) {
            return Ok(LLAMA_PORT);
        }
        *guard = None; // process died, clear it
    }

    let (bin, model) = resolve_paths().ok_or_else(|| {
        format!(
            "llama-server.exe or {MODEL_NAME} not found. \
             Run scripts/download-llama.ps1 to download them."
        )
    })?;

    let bin_dir = bin.parent().unwrap_or_else(|| std::path::Path::new(".")).to_path_buf();

    eprintln!("[llm_server] Starting llama-server on port {LLAMA_PORT}...");
    eprintln!("[llm_server] Binary: {}", bin.display());
    eprintln!("[llm_server] Model:  {}", model.display());

    let mut cmd = std::process::Command::new(&bin);
    cmd.args([
            "-m",     model.to_str().unwrap_or(""),
            "--port", &LLAMA_PORT.to_string(),
            "--host", LLAMA_HOST,
            "-c",     "2048",   // context window — enough for formatting tasks
            "-t",     "4",      // CPU threads
            "-ngl",   "0",      // no GPU layers (CPU only, no CUDA needed)
            "--log-disable",
        ])
        .current_dir(&bin_dir) // so it finds sibling DLLs (llama.dll etc.)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());

    // macOS: current_dir alone does NOT help the dynamic linker find sibling
    // dylibs (ggml-base.dylib, etc.).  Prepend to DYLD_LIBRARY_PATH so any
    // existing paths from the calling environment are preserved.
    #[cfg(target_os = "macos")]
    {
        let existing = std::env::var("DYLD_LIBRARY_PATH").unwrap_or_default();
        let new_val = if existing.is_empty() {
            bin_dir.to_string_lossy().to_string()
        } else {
            format!("{}:{}", bin_dir.display(), existing)
        };
        cmd.env("DYLD_LIBRARY_PATH", new_val);
    }

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let child = cmd.spawn()
        .map_err(|e| format!("Failed to spawn llama-server: {e}"))?;
    *guard = Some(child);

    eprintln!("[llm_server] Process spawned, waiting for model to load...");
    Ok(LLAMA_PORT)
}

/// Kill the bundled llama-server (called on app exit or when user disables it).
#[tauri::command]
pub fn stop_bundled_llm(state: tauri::State<LlmServerState>) -> Result<(), String> {
    let mut guard = state.child.lock().unwrap();
    if let Some(mut child) = guard.take() {
        let _ = child.kill();
        let _ = child.wait();
        eprintln!("[llm_server] Stopped.");
    }
    Ok(())
}

/// True if llama-server was found on disk (user has downloaded the binaries).
#[tauri::command]
pub fn bundled_llm_available() -> bool {
    resolve_paths().is_some()
}
