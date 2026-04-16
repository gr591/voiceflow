// WS5 owns this file.
// Full implementation: save clipboard → write text → hide overlay → restore focus → Ctrl+V → restore clipboard.

use std::time::Duration;
use tauri::{AppHandle, Manager};

/// Insert text at the cursor in the previously-focused window.
/// Flow: save clipboard → write text → hide overlay → restore window focus → Ctrl+V → restore clipboard
#[tauri::command]
pub async fn insert_at_cursor(app: AppHandle, text: String) -> Result<(), String> {
    #[cfg(not(target_os = "macos"))]
    use enigo::{Direction, Enigo, Key, Keyboard, Settings};

    // 1. Copy the saved HWND out before any await points.
    let previous_hwnd: Option<isize> =
        *app.state::<crate::window::FocusState>()
            .previous_hwnd
            .lock()
            .unwrap();

    // 2. Save current clipboard content
    let original_clipboard = get_clipboard_text();

    // 3. Write our text to clipboard
    set_clipboard_text(&text)?;

    // 4. Hide the overlay window
    if let Some(win) = app.get_webview_window("main") {
        win.hide().map_err(|e| e.to_string())?;
    }

    // 5. Wait briefly for window to hide and system to settle
    tokio::time::sleep(Duration::from_millis(150)).await;

    // 6. Restore focus to the previous window
    if let Some(hwnd) = previous_hwnd {
        restore_focus(hwnd);
        tokio::time::sleep(Duration::from_millis(100)).await;
    }

    // 7. Simulate paste.
    #[cfg(not(target_os = "macos"))]
    {
        // Windows/Linux: enigo Ctrl+V. Enigo is not Send on some platforms,
        // so create, use, and drop before any await.
        let mut enigo = Enigo::new(&Settings::default()).map_err(|e| e.to_string())?;
        enigo.key(Key::Control, Direction::Press).map_err(|e| e.to_string())?;
        enigo.key(Key::Unicode('v'), Direction::Click).map_err(|e| e.to_string())?;
        enigo.key(Key::Control, Direction::Release).map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "macos")]
    {
        // macOS: require Accessibility permission, then post CGEvents directly.
        // Without Accessibility, CGEventPost silently drops events. Check first
        // so we can give the user an actionable error.
        if !is_accessibility_trusted(true) {
            return Err(
                "VoiceFlow needs Accessibility permission to paste. \
                 Enable it in System Settings → Privacy & Security → Accessibility, \
                 then quit and reopen VoiceFlow."
                    .to_string(),
            );
        }

        use core_graphics::event::{CGEvent, CGEventFlags, CGEventTapLocation};
        use core_graphics::event_source::{CGEventSource, CGEventSourceStateID};

        let source = CGEventSource::new(CGEventSourceStateID::HIDSystemState)
            .map_err(|_| "CGEventSource::new failed".to_string())?;
        // V key = virtual keycode 9 on macOS (ANSI layout).
        const KEY_V: u16 = 9;
        let key_down = CGEvent::new_keyboard_event(source.clone(), KEY_V, true)
            .map_err(|_| "CGEvent keydown failed".to_string())?;
        key_down.set_flags(CGEventFlags::CGEventFlagCommand);
        key_down.post(CGEventTapLocation::HID);
        let key_up = CGEvent::new_keyboard_event(source, KEY_V, false)
            .map_err(|_| "CGEvent keyup failed".to_string())?;
        key_up.set_flags(CGEventFlags::CGEventFlagCommand);
        key_up.post(CGEventTapLocation::HID);
    }

    // 8. Wait for paste to complete, then restore original clipboard
    tokio::time::sleep(Duration::from_millis(200)).await;
    if let Some(original) = original_clipboard {
        let _ = set_clipboard_text(&original);
    }

    Ok(())
}

// ---------------------------------------------------------------------------
// Win32 clipboard helpers — no subprocess, no console windows
// ---------------------------------------------------------------------------

#[cfg(target_os = "windows")]
fn get_clipboard_text() -> Option<String> {
    use windows::Win32::Foundation::{HANDLE, HGLOBAL, HWND};
    use windows::Win32::System::DataExchange::{CloseClipboard, GetClipboardData, OpenClipboard};
    use windows::Win32::System::Memory::{GlobalLock, GlobalUnlock};

    const CF_UNICODETEXT: u32 = 13;

    unsafe {
        if OpenClipboard(HWND(0)).is_err() {
            return None;
        }

        let result = GetClipboardData(CF_UNICODETEXT)
            .ok()
            .and_then(|h: HANDLE| {
                // HANDLE(isize) → HGLOBAL(*mut c_void)
                let hmem = HGLOBAL(h.0 as *mut std::ffi::c_void);
                let ptr = GlobalLock(hmem) as *const u16;
                if ptr.is_null() {
                    return None;
                }
                let mut len = 0usize;
                while *ptr.add(len) != 0 {
                    len += 1;
                }
                let s = String::from_utf16_lossy(std::slice::from_raw_parts(ptr, len));
                let _ = GlobalUnlock(hmem);
                Some(s)
            });

        let _ = CloseClipboard();
        result
    }
}

#[cfg(target_os = "macos")]
fn get_clipboard_text() -> Option<String> {
    std::process::Command::new("pbpaste")
        .output()
        .ok()
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .filter(|s| !s.is_empty())
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
fn get_clipboard_text() -> Option<String> {
    None
}

#[cfg(target_os = "windows")]
fn set_clipboard_text(text: &str) -> Result<(), String> {
    use windows::Win32::Foundation::{HANDLE, HWND};
    use windows::Win32::System::DataExchange::{
        CloseClipboard, EmptyClipboard, OpenClipboard, SetClipboardData,
    };
    use windows::Win32::System::Memory::{GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE};

    const CF_UNICODETEXT: u32 = 13;

    let wide: Vec<u16> = text.encode_utf16().chain(std::iter::once(0u16)).collect();
    let byte_size = wide.len() * std::mem::size_of::<u16>();

    unsafe {
        OpenClipboard(HWND(0)).map_err(|e| format!("OpenClipboard: {e}"))?;
        EmptyClipboard().map_err(|e| {
            let _ = CloseClipboard();
            format!("EmptyClipboard: {e}")
        })?;

        let hmem = GlobalAlloc(GMEM_MOVEABLE, byte_size).map_err(|e| {
            let _ = CloseClipboard();
            format!("GlobalAlloc: {e}")
        })?;

        let ptr = GlobalLock(hmem) as *mut u16;
        if ptr.is_null() {
            let _ = CloseClipboard();
            return Err("GlobalLock returned null".to_string());
        }
        std::ptr::copy_nonoverlapping(wide.as_ptr(), ptr, wide.len());
        let _ = GlobalUnlock(hmem);

        // HGLOBAL(*mut c_void) → HANDLE(isize)
        SetClipboardData(CF_UNICODETEXT, HANDLE(hmem.0 as isize)).map_err(|e| {
            let _ = CloseClipboard();
            format!("SetClipboardData: {e}")
        })?;

        CloseClipboard().map_err(|e| format!("CloseClipboard: {e}"))?;
    }

    Ok(())
}

#[cfg(target_os = "macos")]
fn set_clipboard_text(text: &str) -> Result<(), String> {
    use std::io::Write;
    let mut child = std::process::Command::new("pbcopy")
        .stdin(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("pbcopy: {e}"))?;
    if let Some(mut stdin) = child.stdin.take() {
        stdin.write_all(text.as_bytes()).ok();
    }
    child.wait().map_err(|e| format!("pbcopy wait: {e}"))?;
    Ok(())
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
fn set_clipboard_text(_text: &str) -> Result<(), String> {
    Err("Clipboard not supported on this platform".to_string())
}

/// Check whether VoiceFlow has Accessibility permission (macOS only).
/// When `prompt` is true, macOS will open System Settings → Privacy &
/// Security → Accessibility if the app isn't already trusted.
#[cfg(target_os = "macos")]
fn is_accessibility_trusted(prompt: bool) -> bool {
    use core_foundation::base::TCFType;
    use core_foundation::boolean::CFBoolean;
    use core_foundation::dictionary::{CFDictionary, CFDictionaryRef};
    use core_foundation::string::CFString;

    #[link(name = "ApplicationServices", kind = "framework")]
    extern "C" {
        fn AXIsProcessTrustedWithOptions(options: CFDictionaryRef) -> bool;
    }

    let key = CFString::new("AXTrustedCheckOptionPrompt");
    let value = if prompt {
        CFBoolean::true_value()
    } else {
        CFBoolean::false_value()
    };
    let dict = CFDictionary::from_CFType_pairs(&[(key, value)]);
    unsafe { AXIsProcessTrustedWithOptions(dict.as_concrete_TypeRef()) }
}

/// Diagnostic: report Accessibility permission status and (on macOS)
/// open the Accessibility settings pane so the user can grant it.
#[tauri::command]
pub async fn check_accessibility_permission(prompt: bool) -> Result<bool, String> {
    #[cfg(target_os = "macos")]
    {
        Ok(is_accessibility_trusted(prompt))
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = prompt;
        Ok(true)
    }
}

/// Restore keyboard focus to the window with the given HWND.
fn restore_focus(hwnd: isize) {
    #[cfg(target_os = "windows")]
    unsafe {
        use windows::Win32::Foundation::HWND;
        use windows::Win32::UI::WindowsAndMessaging::SetForegroundWindow;
        let _ = SetForegroundWindow(HWND(hwnd));
    }
    #[cfg(not(target_os = "windows"))]
    let _ = hwnd;
}
