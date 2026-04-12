// WS1 owns this file.
// Registers the global hotkey that toggles the overlay.

use tauri::{App, AppHandle, Manager};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

pub fn register_hotkey(app: &mut App) -> Result<(), Box<dyn std::error::Error>> {
    // Ctrl+Alt+Space — avoids the Ctrl+Shift+Space conflict with Windows IME.
    let shortcut = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::Space);

    eprintln!("[hotkey] Registering Ctrl+Alt+Space...");
    match app.global_shortcut().on_shortcut(shortcut, |app_handle, _shortcut, event| {
        eprintln!("[hotkey] Fired! state={:?}", event.state());
        if event.state() == ShortcutState::Pressed {
            if let Some(win) = app_handle.get_webview_window("main") {
                let is_visible = win.is_visible().unwrap_or(false);
                eprintln!("[hotkey] is_visible={}", is_visible);
                if is_visible {
                    let _ = crate::window::hide_overlay(app_handle.clone());
                } else {
                    // Use the default position when triggered via hotkey.
                    let _ = crate::window::show_overlay(app_handle.clone(), None);
                }
            }
        }
    }) {
        Ok(_) => eprintln!("[hotkey] Registered OK."),
        Err(e) => eprintln!("[hotkey] WARNING: Could not register Ctrl+Alt+Space (already in use?): {e}. \
            Open Settings to choose a different hotkey."),
    }

    Ok(())
}

/// Parse a human-readable accelerator string into a `Shortcut`.
///
/// Supported modifier tokens (case-insensitive):
///   `Ctrl`, `Control`, `CmdOrCtrl`, `Alt`, `Shift`, `Meta`, `Super`
/// Supported key tokens: any single letter A–Z, digit, or named key like
///   `Space`, `F1`–`F12`, `Tab`, `Enter`, etc.
fn parse_accelerator(accelerator: &str) -> Result<Shortcut, String> {
    let mut modifiers = Modifiers::empty();
    let mut key_code: Option<Code> = None;

    for token in accelerator.split('+') {
        match token.trim().to_lowercase().as_str() {
            "ctrl" | "control" | "cmdorctrl" | "commandorcontrol" => {
                modifiers |= Modifiers::CONTROL;
            }
            "alt" | "option" => {
                modifiers |= Modifiers::ALT;
            }
            "shift" => {
                modifiers |= Modifiers::SHIFT;
            }
            "meta" | "super" | "cmd" | "command" | "win" => {
                modifiers |= Modifiers::META;
            }
            // Named keys
            "space" => key_code = Some(Code::Space),
            "tab" => key_code = Some(Code::Tab),
            "enter" | "return" => key_code = Some(Code::Enter),
            "escape" | "esc" => key_code = Some(Code::Escape),
            "backspace" => key_code = Some(Code::Backspace),
            "delete" | "del" => key_code = Some(Code::Delete),
            "insert" => key_code = Some(Code::Insert),
            "home" => key_code = Some(Code::Home),
            "end" => key_code = Some(Code::End),
            "pageup" => key_code = Some(Code::PageUp),
            "pagedown" => key_code = Some(Code::PageDown),
            "arrowup" | "up" => key_code = Some(Code::ArrowUp),
            "arrowdown" | "down" => key_code = Some(Code::ArrowDown),
            "arrowleft" | "left" => key_code = Some(Code::ArrowLeft),
            "arrowright" | "right" => key_code = Some(Code::ArrowRight),
            // F-keys
            "f1" => key_code = Some(Code::F1),
            "f2" => key_code = Some(Code::F2),
            "f3" => key_code = Some(Code::F3),
            "f4" => key_code = Some(Code::F4),
            "f5" => key_code = Some(Code::F5),
            "f6" => key_code = Some(Code::F6),
            "f7" => key_code = Some(Code::F7),
            "f8" => key_code = Some(Code::F8),
            "f9" => key_code = Some(Code::F9),
            "f10" => key_code = Some(Code::F10),
            "f11" => key_code = Some(Code::F11),
            "f12" => key_code = Some(Code::F12),
            // Digits
            "0" => key_code = Some(Code::Digit0),
            "1" => key_code = Some(Code::Digit1),
            "2" => key_code = Some(Code::Digit2),
            "3" => key_code = Some(Code::Digit3),
            "4" => key_code = Some(Code::Digit4),
            "5" => key_code = Some(Code::Digit5),
            "6" => key_code = Some(Code::Digit6),
            "7" => key_code = Some(Code::Digit7),
            "8" => key_code = Some(Code::Digit8),
            "9" => key_code = Some(Code::Digit9),
            // Single letters A–Z
            s if s.len() == 1 => {
                let c = s.chars().next().unwrap();
                let code = match c {
                    'a' => Code::KeyA, 'b' => Code::KeyB, 'c' => Code::KeyC,
                    'd' => Code::KeyD, 'e' => Code::KeyE, 'f' => Code::KeyF,
                    'g' => Code::KeyG, 'h' => Code::KeyH, 'i' => Code::KeyI,
                    'j' => Code::KeyJ, 'k' => Code::KeyK, 'l' => Code::KeyL,
                    'm' => Code::KeyM, 'n' => Code::KeyN, 'o' => Code::KeyO,
                    'p' => Code::KeyP, 'q' => Code::KeyQ, 'r' => Code::KeyR,
                    's' => Code::KeyS, 't' => Code::KeyT, 'u' => Code::KeyU,
                    'v' => Code::KeyV, 'w' => Code::KeyW, 'x' => Code::KeyX,
                    'y' => Code::KeyY, 'z' => Code::KeyZ,
                    _ => return Err(format!("Unsupported key character: '{c}'")),
                };
                key_code = Some(code);
            }
            other => return Err(format!("Unrecognised accelerator token: '{other}'")),
        }
    }

    let code = key_code.ok_or_else(|| "No key code found in accelerator string".to_string())?;
    let mods = if modifiers.is_empty() { None } else { Some(modifiers) };
    Ok(Shortcut::new(mods, code))
}

/// Re-register the global hotkey with a new accelerator string.
///
/// Example accelerator strings: `"CmdOrCtrl+Shift+Space"`, `"Alt+F9"`.
#[tauri::command]
pub fn set_hotkey(app: AppHandle, accelerator: String) -> Result<(), String> {
    let shortcut = parse_accelerator(&accelerator)?;

    // Unregister all existing shortcuts, then re-register the new one.
    app.global_shortcut()
        .unregister_all()
        .map_err(|e| e.to_string())?;

    app.global_shortcut()
        .on_shortcut(shortcut, |app_handle, _shortcut, event| {
            if event.state() == ShortcutState::Pressed {
                if let Some(win) = app_handle.get_webview_window("main") {
                    let is_visible = win.is_visible().unwrap_or(false);
                    if is_visible {
                        let _ = crate::window::hide_overlay(app_handle.clone());
                    } else {
                        let _ = crate::window::show_overlay(app_handle.clone(), None);
                    }
                }
            }
        })
        .map_err(|e| e.to_string())?;

    Ok(())
}
