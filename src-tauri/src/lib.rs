mod openrouter;
mod settings;

use serde::Serialize;
use std::env;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::Emitter;
use tauri::Manager;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri_plugin_autostart::MacosLauncher;
use tauri_plugin_autostart::ManagerExt;

static QUITTING: AtomicBool = AtomicBool::new(false);

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AppConfig {
    daily_limit: f64,
    has_api_key: bool,
    /// "env" | "stored" | "none"
    key_source: String,
    stored_has_key: bool,
}

fn is_valid_env_key(raw: &str) -> bool {
    let t = raw.trim();
    if t.is_empty() || t.len() < 10 {
        return false;
    }
    let lower = t.to_ascii_lowercase();
    // Reject obvious placeholder / example values that would cause 401
    if lower.contains("your_key") || lower.contains("your_management") || lower.contains("example") || lower.contains("placeholder") {
        return false;
    }
    if lower == "sk-or-v1-your_key_here" || lower == "your_management_key_here" {
        return false;
    }
    // OpenRouter keys are `sk-or-v1-…` (or at least `sk-…`); reject anything else
    if !t.starts_with("sk-") {
        return false;
    }
    true
}

fn load_dotenv() {
    // Useful during development. Packaged applications can instead receive
    // OPENROUTER_MANAGEMENT_KEY through the process environment.
    // First try standard dotenv (current dir). It does NOT overwrite existing vars,
    // so a placeholder system env would still win — we handle that via is_valid_env_key.
    let _ = dotenvy::dotenv();
    // Also try loading .env next to the executable (useful for portable installs
    // where the exe lives in D:\current\apps\openpocket and the .env is alongside).
    // This is a no-op if the file doesn't exist and does not overwrite existing vars.
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let path = dir.join(".env");
            if path.exists() {
                let _ = dotenvy::from_path(path);
            }
        }
    }
}

fn debug_log(app: Option<&tauri::AppHandle>, msg: &str) {
    let base = app
        .and_then(|a| a.path().app_data_dir().ok())
        .or_else(|| {
            std::env::var("APPDATA")
                .ok()
                .map(std::path::PathBuf::from)
                .map(|p| p.join("com.uhanku.openrouter-spend"))
        });
    if let Some(dir) = base {
        let _ = std::fs::create_dir_all(&dir);
        let path = dir.join("debug.log");
        let ts = chrono::Utc::now().format("%Y-%m-%dT%H:%M:%SZ").to_string();
        let line = format!("[{ts}] {msg}\n");
        let _ = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(path)
            .and_then(|mut f| {
                use std::io::Write;
                f.write_all(line.as_bytes())
            });
    }
    // Also eprintln for debug builds
    eprintln!("{msg}");
}

fn env_daily_limit() -> Option<f64> {
    env::var("DAILY_LIMIT")
        .ok()
        .and_then(|v| v.trim().parse::<f64>().ok())
        .filter(|v| v.is_finite() && *v > 0.0)
}

fn env_key() -> Option<String> {
    for var in ["OPENROUTER_MANAGEMENT_KEY", "OPENROUTER_API_KEY"] {
        if let Ok(raw) = env::var(var) {
            if !is_valid_env_key(&raw) {
                // Log invalid/placeholder env so user can diagnose 401 quickly
                debug_log(
                    None,
                    &format!(
                        "env_key: ignoring invalid placeholder for {} (len={}, prefix={:?})",
                        var,
                        raw.trim().len(),
                        raw.trim().chars().take(8).collect::<String>()
                    ),
                );
                continue;
            }
            let t = raw.trim().to_owned();
            if !t.is_empty() {
                return Some(t);
            }
        }
    }
    None
}

fn effective_key(app: &tauri::AppHandle) -> Option<String> {
    // Env takes precedence (dev / power-user override)
    if let Some(k) = env_key() {
        return Some(k);
    }
    settings::effective_key(app)
}

fn effective_daily_limit(app: &tauri::AppHandle) -> f64 {
    if let Some(v) = env_daily_limit() {
        return v;
    }
    settings::effective_daily_limit(app)
}

fn key_source(app: &tauri::AppHandle) -> String {
    if env_key().is_some() {
        "env".to_string()
    } else if settings::load_settings(app)
        .openrouter_management_key
        .as_deref()
        .map(|v| !v.trim().is_empty())
        .unwrap_or(false)
    {
        "stored".to_string()
    } else {
        "none".to_string()
    }
}

#[tauri::command]
fn get_app_config(app: tauri::AppHandle) -> AppConfig {
    load_dotenv();

    let daily_limit = effective_daily_limit(&app);
    let stored_has_key = settings::stored_has_key(&settings::load_settings(&app));
    let has_api_key = effective_key(&app).is_some();
    let ks = key_source(&app);

    debug_log(
        Some(&app),
        &format!(
            "get_app_config: daily_limit={} has_api_key={} key_source={} stored_has_key={}",
            daily_limit, has_api_key, ks, stored_has_key
        ),
    );

    AppConfig {
        daily_limit,
        has_api_key,
        key_source: ks,
        stored_has_key,
    }
}

#[tauri::command]
fn save_settings(
    app: tauri::AppHandle,
    key: Option<String>,
    daily_limit: Option<f64>,
) -> Result<AppConfig, String> {
    load_dotenv();

    let mut s = settings::load_settings(&app);

    // key semantics: None = keep existing, Some("") / Some(whitespace) = clear stored key
    if let Some(k) = key {
        let t = k.trim().to_owned();
        if t.is_empty() {
            s.openrouter_management_key = None;
        } else {
            s.openrouter_management_key = Some(t);
        }
    }

    // daily_limit semantics: None = clear stored limit (fallback to default), Some(v) = set
    // Called as `daily_limit` from JS; Tauri maps `{ daily_limit: 0.67 }`.
    if let Some(v) = daily_limit {
        if !v.is_finite() || v <= 0.0 {
            return Err("Daily limit must be a positive number.".to_string());
        }
        s.daily_limit = Some(v);
    } else {
        // JS sends `null` to clear. To keep UX simple, require explicit null to clear — but
        // our frontend always sends a number, so this path is for API/clear button.
        // We treat missing param (None) as "keep". To clear, frontend should send `null` and
        // we handle via a separate clear flow? For now, if frontend explicitly passes
        // `daily_limit: null` we clear; Tauri's Option will be None which we treat as keep.
        // So this else is actually "keep". To avoid confusion, we only update when Some.
        // No-op for None → keep existing.
    }

    // Special: if frontend wants to clear daily_limit, it can invoke with 0 or we need a
    // dedicated path. For now, expose clear via `daily_limit: null` + JS sends `0`? We keep as-is:
    // None = keep. Caller that wants to clear must call with a separate command; we avoid clearing
    // daily_limit accidentally. So we undo the else above.

    settings::save_settings(&app, &s)?;

    Ok(get_app_config(app))
}

#[tauri::command]
fn clear_daily_limit(app: tauri::AppHandle) -> Result<AppConfig, String> {
    let mut s = settings::load_settings(&app);
    s.daily_limit = None;
    settings::save_settings(&app, &s)?;
    Ok(get_app_config(app))
}

#[tauri::command]
async fn get_usage(app: tauri::AppHandle) -> Result<Vec<openrouter::SpendDay>, String> {
    load_dotenv();

    let ks = key_source(&app);
    debug_log(
        Some(&app),
        &format!("get_usage: key_source={} attempt fetch", ks),
    );

    let key = effective_key(&app).ok_or_else(|| {
        let msg = "Missing OPENROUTER_MANAGEMENT_KEY. Open Settings (gear icon) and paste your Management Key, or set it as an environment variable.";
        debug_log(Some(&app), &format!("get_usage: error={}", msg));
        msg.to_string()
    })?;

    let result = openrouter::fetch_daily_spend(&key).await;
    match &result {
        Ok(rows) => debug_log(
            Some(&app),
            &format!("get_usage: success rows={} first={:?}", rows.len(), rows.first()),
        ),
        Err(e) => debug_log(Some(&app), &format!("get_usage: fetch error={}", e)),
    }
    result
}

#[cfg(target_os = "windows")]
fn configure_window_chrome(window: &tauri::WebviewWindow) {
    use core::ffi::c_void;
    use windows::Win32::Graphics::Dwm::{
        DwmSetWindowAttribute, DWMWA_BORDER_COLOR, DWMWA_COLOR_NONE,
    };

    let _ = window.set_shadow(false);

    let Ok(hwnd) = window.hwnd() else {
        return;
    };

    let color = DWMWA_COLOR_NONE;

    unsafe {
        let _ = DwmSetWindowAttribute(
            hwnd,
            DWMWA_BORDER_COLOR,
            &color as *const u32 as *const c_void,
            core::mem::size_of::<u32>() as u32,
        );
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            None,
        ))
        .setup(|app| {
            #[cfg(target_os = "windows")]
            if let Some(window) = app.get_webview_window("main") {
                configure_window_chrome(&window);
            }
            // Hide taskbar icon in release builds — app remains accessible via tray only.
            // `tauri dev` (debug) keeps the taskbar button for easier debugging.
            #[cfg(target_os = "windows")]
            if !cfg!(debug_assertions) {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.set_skip_taskbar(true);
                }
            }

            // Enable autostart on first run (and every run — idempotent).
            // On Windows this writes HKCU\Software\Microsoft\Windows\CurrentVersion\Run.
            let _ = app.autolaunch().enable();

            // Build system tray icon + menu: Show / Refresh / Settings / Quit
            let show_item = MenuItem::with_id(app, "show", "Show window", true, None::<&str>)?;
            let refresh_item = MenuItem::with_id(app, "refresh", "Refresh", true, None::<&str>)?;
            let settings_item =
                MenuItem::with_id(app, "settings", "Settings", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(
                app,
                &[&show_item, &refresh_item, &settings_item, &quit_item],
            )?;

            let icon = app
                .default_window_icon()
                .cloned()
                .expect("default window icon missing — check bundle > icon in tauri.conf.json");

            TrayIconBuilder::with_id("openpocket-tray")
                .icon(icon)
                .tooltip("OpenRouter Spend")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.unminimize();
                            let _ = window.set_focus();
                        }
                    }
                    "refresh" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.emit("usage-refresh", ());
                            let _ = window.show();
                            let _ = window.set_focus();
                        } else {
                            let _ = app.emit("usage-refresh", ());
                        }
                    }
                    "settings" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.unminimize();
                            let _ = window.set_focus();
                            let _ = window.emit("open-settings", ());
                        } else {
                            let _ = app.emit("open-settings", ());
                        }
                    }
                    "quit" => {
                        QUITTING.store(true, Ordering::SeqCst);
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            if let Ok(visible) = window.is_visible() {
                                if visible {
                                    let _ = window.hide();
                                } else {
                                    let _ = window.show();
                                    let _ = window.set_focus();
                                }
                            }
                        }
                    }
                })
                .build(app)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if !QUITTING.load(Ordering::SeqCst) {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_app_config,
            save_settings,
            clear_daily_limit,
            get_usage
        ])
        .run(tauri::generate_context!())
        .expect("error while running OpenRouter Spend");
}
