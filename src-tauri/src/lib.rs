mod openrouter;

use serde::Serialize;
use std::env;
use tauri::Manager;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AppConfig {
    daily_limit: f64,
    display_days: u32,
    has_api_key: bool,
}

fn load_dotenv() {
    // Useful during development. Packaged applications can instead receive
    // OPENROUTER_MANAGEMENT_KEY through the process environment.
    let _ = dotenvy::dotenv();
}

fn configured_daily_limit() -> f64 {
    env::var("DAILY_LIMIT")
        .ok()
        .and_then(|value| value.parse::<f64>().ok())
        .filter(|value| value.is_finite() && *value > 0.0)
        .unwrap_or(0.67)
}

fn configured_display_days() -> u32 {
    env::var("DISPLAY_DAYS")
        .ok()
        .and_then(|value| value.parse::<u32>().ok())
        .map(|value| value.clamp(1, 366))
        .unwrap_or(14)
}

fn openrouter_key() -> Result<String, String> {
    env::var("OPENROUTER_MANAGEMENT_KEY")
        .or_else(|_| env::var("OPENROUTER_API_KEY"))
        .map(|value| value.trim().to_owned())
        .ok()
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            "Missing OPENROUTER_MANAGEMENT_KEY (or OPENROUTER_API_KEY). \
             Add it to .env during development or provide it as an environment variable."
                .to_string()
        })
}

#[tauri::command]
fn get_app_config() -> AppConfig {
    load_dotenv();

    AppConfig {
        daily_limit: configured_daily_limit(),
        display_days: configured_display_days(),
        has_api_key: openrouter_key().is_ok(),
    }
}

#[tauri::command]
async fn get_usage(days: Option<u32>) -> Result<Vec<openrouter::SpendDay>, String> {
    load_dotenv();

    let key = openrouter_key()?;
    let days = days
        .unwrap_or_else(configured_display_days)
        .clamp(1, 366);

    openrouter::fetch_daily_spend(&key, days).await
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
        .setup(|app| {
            #[cfg(target_os = "windows")]
            if let Some(window) = app.get_webview_window("main") {
                configure_window_chrome(&window);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_app_config,
            get_usage
        ])
        .run(tauri::generate_context!())
        .expect("error while running OpenRouter Spend");
}
