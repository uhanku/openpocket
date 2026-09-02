use serde::{Deserialize, Serialize};
use std::fs;
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub openrouter_management_key: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub daily_limit: Option<f64>,
}

fn settings_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Could not resolve app data dir: {e}"))?;
    Ok(dir.join("settings.json"))
}

pub fn load_settings(app: &AppHandle) -> AppSettings {
    let path = match settings_path(app) {
        Ok(p) => p,
        Err(_) => return AppSettings::default(),
    };

    let Ok(bytes) = fs::read(&path) else {
        return AppSettings::default();
    };

    // Empty file or invalid JSON -> default
    serde_json::from_slice::<AppSettings>(&bytes).unwrap_or_default()
}

pub fn save_settings(app: &AppHandle, settings: &AppSettings) -> Result<(), String> {
    let path = settings_path(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Could not create settings dir: {e}"))?;
    }

    // Serialize without None fields
    let json = serde_json::to_string_pretty(settings)
        .map_err(|e| format!("Could not serialize settings: {e}"))?;

    // Atomic write: write to temp then rename
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, json).map_err(|e| format!("Could not write settings: {e}"))?;
    fs::rename(&tmp, &path).map_err(|e| format!("Could not finalize settings: {e}"))?;

    Ok(())
}

/// Is there a non-empty stored key?
pub fn stored_has_key(settings: &AppSettings) -> bool {
    settings
        .openrouter_management_key
        .as_deref()
        .map(|v| !v.trim().is_empty())
        .unwrap_or(false)
}

pub fn effective_daily_limit(app: &AppHandle) -> f64 {
    // Env var takes precedence for dev override, then stored, then default.
    if let Ok(raw) = std::env::var("DAILY_LIMIT") {
        if let Ok(v) = raw.trim().parse::<f64>() {
            if v.is_finite() && v > 0.0 {
                return v;
            }
        }
    }
    let s = load_settings(app);
    if let Some(v) = s.daily_limit {
        if v.is_finite() && v > 0.0 {
            return v;
        }
    }
    0.67
}

fn is_valid_env_key(raw: &str) -> bool {
    let t = raw.trim();
    if t.is_empty() || t.len() < 10 {
        return false;
    }
    let lower = t.to_ascii_lowercase();
    if lower.contains("your_key")
        || lower.contains("your_management")
        || lower.contains("example")
        || lower.contains("placeholder")
    {
        return false;
    }
    if lower == "sk-or-v1-your_key_here" || lower == "your_management_key_here" {
        return false;
    }
    if !t.starts_with("sk-") {
        return false;
    }
    true
}

pub fn effective_key(app: &AppHandle) -> Option<String> {
    // Env var precedence, but ignore placeholder/invalid values (e.g. sk-or-v1-YOUR_KEY_HERE)
    for var in ["OPENROUTER_MANAGEMENT_KEY", "OPENROUTER_API_KEY"] {
        if let Ok(raw) = std::env::var(var) {
            if !is_valid_env_key(&raw) {
                continue;
            }
            let t = raw.trim().to_owned();
            if !t.is_empty() {
                return Some(t);
            }
        }
    }
    let s = load_settings(app);
    s.openrouter_management_key
        .as_deref()
        .map(|v| v.trim().to_owned())
        .filter(|v| !v.is_empty())
}
