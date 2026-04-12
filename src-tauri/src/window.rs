// WS1 owns this file.
// Handles overlay show/hide and positioning on screen.

use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};

#[cfg(target_os = "windows")]
use windows::Win32::Foundation::{HWND, POINT};
#[cfg(target_os = "windows")]
use windows::Win32::UI::WindowsAndMessaging::{
    FindWindowW, GetCursorPos, GetForegroundWindow, GetGUIThreadInfo, GetWindowLongW,
    GetWindowThreadProcessId, SetWindowLongW, GWL_EXSTYLE, GUITHREADINFO, WS_EX_NOACTIVATE,
};
#[cfg(target_os = "windows")]
use windows::Win32::Graphics::Gdi::ClientToScreen;
#[cfg(target_os = "windows")]
use windows::core::{w, PCWSTR};

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/// Holds the HWND of the window that was focused before the overlay opened.
/// WS5 reads this to restore focus and paste text.
pub struct FocusState {
    pub previous_hwnd: Mutex<Option<isize>>,
}

// ---------------------------------------------------------------------------
// Win32 helpers (Windows-only)
// ---------------------------------------------------------------------------

/// Returns the HWND of our own overlay window by title lookup.
/// The title "VoiceFlow" is set in tauri.conf.json.
#[cfg(target_os = "windows")]
fn get_own_hwnd() -> HWND {
    unsafe { FindWindowW(PCWSTR::null(), w!("VoiceFlow")) }
}

/// Try to get the screen position of the text caret in the given foreground window.
/// Returns `(caret_center_x, caret_bottom_y)` in screen coordinates, or `None` if
/// the window doesn't use a Win32 caret (e.g. some Electron/browser apps).
#[cfg(target_os = "windows")]
fn get_caret_screen_pos(fg_hwnd: HWND) -> Option<(i32, i32)> {
    if fg_hwnd.0 == 0 {
        return None;
    }

    let thread_id = unsafe { GetWindowThreadProcessId(fg_hwnd, None) };
    if thread_id == 0 {
        return None;
    }

    // SAFETY: zeroed GUITHREADINFO is valid when cbSize is set correctly.
    let mut info: GUITHREADINFO = unsafe { std::mem::zeroed() };
    info.cbSize = std::mem::size_of::<GUITHREADINFO>() as u32;

    unsafe {
        if GetGUIThreadInfo(thread_id, &mut info).is_err() {
            return None;
        }
        if info.hwndCaret.0 == 0 {
            return None;
        }

        // rcCaret is in client coords of hwndCaret; convert bottom-left to screen.
        let mut pt = POINT {
            x: (info.rcCaret.left + info.rcCaret.right) / 2, // horizontal center of caret
            y: info.rcCaret.bottom,
        };
        let _ = ClientToScreen(info.hwndCaret, &mut pt);
        Some((pt.x, pt.y))
    }
}

/// Get the current mouse cursor position as a fallback when no caret is available.
#[cfg(target_os = "windows")]
fn get_cursor_pos() -> Option<(i32, i32)> {
    let mut pt = POINT { x: 0, y: 0 };
    unsafe { GetCursorPos(&mut pt).ok().map(|_| (pt.x, pt.y)) }
}

/// Set `WS_EX_NOACTIVATE` on `hwnd` so mouse clicks don't steal keyboard focus
/// from the underlying application.
#[cfg(target_os = "windows")]
fn set_no_activate(hwnd: HWND) {
    if hwnd.0 == 0 {
        return;
    }
    unsafe {
        let ex_style = GetWindowLongW(hwnd, GWL_EXSTYLE);
        SetWindowLongW(hwnd, GWL_EXSTYLE, ex_style | WS_EX_NOACTIVATE.0 as i32);
    }
}


// ---------------------------------------------------------------------------
// Positioning
// ---------------------------------------------------------------------------

/// Position the overlay below the active text caret, falling back to cursor
/// position, then top-center if neither is available.
///
/// Crucially, the monitor bounds are derived from the *anchor point* (caret or
/// cursor), not from whichever monitor the overlay window currently lives on.
/// This allows the overlay to follow the user to any monitor.
fn position_below_input(window: &tauri::WebviewWindow) -> Result<(), String> {
    let win_size = window.outer_size().map_err(|e| e.to_string())?;

    #[cfg(target_os = "windows")]
    {
        use windows::Win32::Graphics::Gdi::{
            GetMonitorInfoW, MonitorFromPoint, MONITORINFO, MONITOR_DEFAULTTONEAREST,
        };

        // 1. Resolve the anchor point (caret → cursor fallback).
        let fg = unsafe { GetForegroundWindow() };
        let anchor = get_caret_screen_pos(fg)
            .or_else(|| get_cursor_pos().map(|(x, y)| (x, y + 20)));

        let (anchor_x, anchor_y) = match anchor {
            Some(pt) => pt,
            None => {
                // No anchor at all — fall back to the window's current monitor, top-center.
                let monitor = window
                    .current_monitor()
                    .ok()
                    .flatten()
                    .ok_or("no monitor found")?;
                let mp = monitor.position();
                let ms = monitor.size();
                let x = mp.x + (ms.width as i32 - win_size.width as i32) / 2;
                let y = mp.y + ms.height as i32 / 5;
                return window
                    .set_position(tauri::PhysicalPosition::new(x, y))
                    .map_err(|e| e.to_string());
            }
        };

        // 2. Find which monitor contains the anchor point.
        let anchor_pt = POINT { x: anchor_x, y: anchor_y };
        let hmon = unsafe { MonitorFromPoint(anchor_pt, MONITOR_DEFAULTTONEAREST) };

        let mut mi: MONITORINFO = unsafe { std::mem::zeroed() };
        mi.cbSize = std::mem::size_of::<MONITORINFO>() as u32;
        unsafe { let _ = GetMonitorInfoW(hmon, &mut mi); }

        // Use the work area (excludes taskbar) for clamping.
        let mx = mi.rcWork.left;
        let my = mi.rcWork.top;
        let mw = mi.rcWork.right  - mi.rcWork.left;
        let mh = mi.rcWork.bottom - mi.rcWork.top;

        // 3. Place the overlay centred on the anchor, 8 px below.
        let x = anchor_x - (win_size.width as i32 / 2);
        let y = anchor_y + 8;
        let max_x = mx + mw - win_size.width  as i32;
        let max_y = my + mh - win_size.height as i32;
        let x = x.clamp(mx, max_x);
        let y = y.clamp(my, max_y);

        window
            .set_position(tauri::PhysicalPosition::new(x, y))
            .map_err(|e| e.to_string())?;
    }

    #[cfg(not(target_os = "windows"))]
    {
        // Non-Windows: best-effort top-center on current monitor.
        let monitor = window
            .current_monitor()
            .map_err(|e| e.to_string())?
            .ok_or("no monitor found")?;
        let mp = monitor.position();
        let ms = monitor.size();
        let x = mp.x + (ms.width as i32 - win_size.width as i32) / 2;
        let y = mp.y + ms.height as i32 / 5;
        window
            .set_position(tauri::PhysicalPosition::new(x, y))
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}

/// Position the overlay at a named location (for explicit user choice or large mode).
/// Uses the monitor that contains the current cursor/foreground window so it
/// follows the user to any display.
fn position_overlay(window: &tauri::WebviewWindow, position: &str) -> Result<(), String> {
    let win_size = window.outer_size().map_err(|e| e.to_string())?;

    // Derive monitor bounds from the cursor position so this works on any monitor.
    #[cfg(target_os = "windows")]
    let (mx, my, mw, mh) = {
        use windows::Win32::Graphics::Gdi::{
            GetMonitorInfoW, MonitorFromPoint, MONITORINFO, MONITOR_DEFAULTTONEAREST,
        };
        let mut pt = POINT { x: 0, y: 0 };
        unsafe { let _ = GetCursorPos(&mut pt); }
        let hmon = unsafe { MonitorFromPoint(pt, MONITOR_DEFAULTTONEAREST) };
        let mut mi: MONITORINFO = unsafe { std::mem::zeroed() };
        mi.cbSize = std::mem::size_of::<MONITORINFO>() as u32;
        unsafe { let _ = GetMonitorInfoW(hmon, &mut mi); }
        (
            mi.rcWork.left,
            mi.rcWork.top,
            mi.rcWork.right  - mi.rcWork.left,
            mi.rcWork.bottom - mi.rcWork.top,
        )
    };

    #[cfg(not(target_os = "windows"))]
    let (mx, my, mw, mh) = {
        let monitor = window
            .current_monitor()
            .map_err(|e| e.to_string())?
            .ok_or("no monitor found")?;
        let mp = monitor.position();
        let ms = monitor.size();
        (mp.x, mp.y, ms.width as i32, ms.height as i32)
    };

    let (target_x, target_y) = match position {
        "center" => (
            mx + (mw - win_size.width  as i32) / 2,
            my + (mh - win_size.height as i32) / 2,
        ),
        _ => (
            mx + (mw - win_size.width as i32) / 2,
            my + mh / 5,
        ),
    };

    window
        .set_position(tauri::PhysicalPosition::new(target_x, target_y))
        .map_err(|e| e.to_string())?;

    Ok(())
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/// Show the overlay window.
///
/// Positions it below the active text caret (or mouse cursor as fallback),
/// and shows it WITHOUT stealing keyboard focus from the underlying app.
/// The previously-focused HWND is recorded in `FocusState` for WS5's paste flow.
#[tauri::command]
pub fn show_overlay(app: AppHandle, position: Option<String>) -> Result<(), String> {
    // 1. Capture the currently-focused window BEFORE our window becomes visible.
    //    Must happen first so we record the right HWND for insert_at_cursor.
    #[cfg(target_os = "windows")]
    let _fg_hwnd = {
        let hwnd = unsafe { GetForegroundWindow() };
        let raw = hwnd.0 as isize;
        if let Some(state) = app.try_state::<FocusState>() {
            *state.previous_hwnd.lock().unwrap() = if raw != 0 { Some(raw) } else { None };
        }
        hwnd
    };

    let window = app
        .get_webview_window("main")
        .ok_or("main window not found")?;

    // 2. Position the overlay.
    //    Default: below the active caret/cursor.
    //    Callers can pass "center" or "top-center" to override.
    match position.as_deref() {
        Some("center") | Some("top-center") => {
            let _ = position_overlay(&window, position.as_deref().unwrap_or("top-center"));
        }
        _ => {
            // "below-caret" (default) — uses fg_hwnd captured above.
            let _ = position_below_input(&window);
        }
    }

    // 3. Mark the window as no-activate so button-clicks won't steal keyboard focus.
    //    Then show via Tauri (updates internal visibility state so hide() works later),
    //    and immediately restore focus to the previous window — the delay is < 1 frame,
    //    imperceptible to the user.
    #[cfg(target_os = "windows")]
    {
        use windows::Win32::UI::WindowsAndMessaging::SetForegroundWindow;

        let own_hwnd = get_own_hwnd();
        set_no_activate(own_hwnd); // prevent click-activation permanently

        // Tauri's show() is needed so is_visible() / hide() work correctly.
        window.show().map_err(|e| e.to_string())?;

        // Immediately return focus to whatever the user was typing in.
        if let Some(state) = app.try_state::<FocusState>() {
            if let Some(raw) = *state.previous_hwnd.lock().unwrap() {
                unsafe { let _ = SetForegroundWindow(HWND(raw)); }
            }
        }
    }
    #[cfg(not(target_os = "windows"))]
    window.show().map_err(|e| e.to_string())?;

    // 4. Notify the frontend.
    app.emit("overlay://show", Option::<()>::None)
        .map_err(|e| e.to_string())?;

    Ok(())
}

/// Hide the overlay window.
#[tauri::command]
pub fn hide_overlay(app: AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or("main window not found")?;
    app.emit("overlay://hide", Option::<()>::None)
        .map_err(|e| e.to_string())?;
    window.hide().map_err(|e| e.to_string())?;
    Ok(())
}

/// Semantic alias for `hide_overlay`; called by the frontend on Escape.
#[tauri::command]
pub fn request_hide(app: AppHandle) -> Result<(), String> {
    hide_overlay(app)
}

/// Returns the HWND stored before the overlay was last shown.
/// WS5 uses this to restore focus before pasting text.
#[tauri::command]
pub fn get_previous_hwnd(state: tauri::State<FocusState>) -> Option<isize> {
    *state.previous_hwnd.lock().unwrap()
}

/// Returns the executable name (lowercase, no extension) of the app that held
/// focus before the overlay opened. Used by the frontend for context-aware
/// tone / vocabulary post-processing.
///
/// Example return values: "slack", "outlook", "code", "chrome", "discord"
#[tauri::command]
pub fn get_foreground_app_name(state: tauri::State<FocusState>) -> Option<String> {
    #[cfg(target_os = "windows")]
    {
        use windows::Win32::Foundation::{CloseHandle, BOOL};
        use windows::Win32::System::Threading::{
            OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_FORMAT,
            PROCESS_QUERY_LIMITED_INFORMATION,
        };
        use windows::core::PWSTR;

        let raw = (*state.previous_hwnd.lock().unwrap())?;
        let hwnd = HWND(raw);

        let mut pid: u32 = 0;
        unsafe { GetWindowThreadProcessId(hwnd, Some(&mut pid)); }
        if pid == 0 { return None; }

        unsafe {
            let hproc = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, BOOL(0), pid).ok()?;
            let mut buf = [0u16; 260];
            let mut size = 260u32;
            let ok = QueryFullProcessImageNameW(
                hproc,
                PROCESS_NAME_FORMAT(0), // 0 = PROCESS_NAME_WIN32
                PWSTR(buf.as_mut_ptr()),
                &mut size,
            ).is_ok();
            let _ = CloseHandle(hproc);
            if !ok || size == 0 { return None; }
            let path = String::from_utf16_lossy(&buf[..size as usize]);
            std::path::Path::new(&path)
                .file_stem()
                .and_then(|s| s.to_str())
                .map(|s| s.to_lowercase())
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = state;
        None
    }
}

/// Resize the overlay window.
///
/// Pass `position = Some("top-center")` to also recentre the window (e.g. when
/// switching to large mode). Otherwise the window stays where it was positioned
/// and grows in-place (useful for the small-mode text-area expansion).
#[tauri::command]
pub fn set_window_size(
    app: AppHandle,
    width: u32,
    height: u32,
    position: Option<String>,
) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or("main window not found")?;

    // Use LogicalSize so the frontend constants (which are CSS/logical pixels)
    // map correctly — PhysicalSize would halve the window on 2x Retina displays.
    window
        .set_size(tauri::LogicalSize::new(width as f64, height as f64))
        .map_err(|e| e.to_string())?;

    // Reposition only when explicitly requested (e.g. switching to large mode).
    if let Some(pos) = position.as_deref() {
        let _ = position_overlay(&window, pos);
    }

    Ok(())
}
