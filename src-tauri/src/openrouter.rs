use chrono::{Duration, NaiveDate, Utc};
use reqwest::Client;
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::BTreeMap;

const ANALYTICS_URL: &str = "https://openrouter.ai/api/v1/analytics/query";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpendDay {
    pub date: String,
    pub spent: f64,
}

pub async fn fetch_daily_spend(
    api_key: &str,
    days: u32,
) -> Result<Vec<SpendDay>, String> {
    let today = Utc::now().date_naive();

    // End is tomorrow at 00:00 UTC so the current UTC day is included.
    let end_date = today + Duration::days(1);
    let start_date = end_date - Duration::days(days as i64);

    let body = json!({
        "metrics": ["total_usage"],
        "granularity": "day",
        "time_range": {
            "start": format!("{start_date}T00:00:00Z"),
            "end": format!("{end_date}T00:00:00Z")
        },
        "limit": (days + 20).max(100)
    });

    let response = Client::new()
        .post(ANALYTICS_URL)
        .bearer_auth(api_key)
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|error| format!("Could not reach OpenRouter: {error}"))?;

    let status = response.status();

    let response_text = response
        .text()
        .await
        .map_err(|error| format!("Could not read OpenRouter response: {error}"))?;

    if !status.is_success() {
        return Err(format!(
            "OpenRouter returned HTTP {}: {}",
            status.as_u16(),
            compact_error(&response_text)
        ));
    }

    let response_json: Value = serde_json::from_str(&response_text)
        .map_err(|error| format!("OpenRouter returned invalid JSON: {error}"))?;

    let rows = response_json
        .pointer("/data/data")
        .and_then(Value::as_array)
        .ok_or_else(|| {
            "OpenRouter analytics response did not contain data.data".to_string()
        })?;

    // Pre-fill every day so missing/no-spend days still appear in the graph.
    let mut totals = BTreeMap::<NaiveDate, f64>::new();

    for offset in 0..days {
        let date = start_date + Duration::days(offset as i64);
        totals.insert(date, 0.0);
    }

    for row in rows {
        let Some(object) = row.as_object() else {
            continue;
        };

        // OpenRouter can return date__<granularity> or
        // created_at__<granularity> depending on the analytics source.
        let raw_date = object.iter().find_map(|(key, value)| {
            if key.starts_with("date__") || key.starts_with("created_at__") {
                value.as_str()
            } else {
                None
            }
        });

        let Some(raw_date) = raw_date else {
            continue;
        };

        let Some(date_part) = raw_date.get(0..10) else {
            continue;
        };

        let Ok(date) = NaiveDate::parse_from_str(date_part, "%Y-%m-%d") else {
            continue;
        };

        if date < start_date || date >= end_date {
            continue;
        }

        let usage = parse_number(object.get("total_usage"))
            .unwrap_or(0.0)
            .max(0.0);

        *totals.entry(date).or_insert(0.0) += usage;
    }

    Ok(totals
        .into_iter()
        .map(|(date, spent)| SpendDay {
            date: date.format("%Y-%m-%d").to_string(),
            spent,
        })
        .collect())
}

fn parse_number(value: Option<&Value>) -> Option<f64> {
    match value {
        Some(Value::Number(number)) => number.as_f64(),
        Some(Value::String(value)) => value.parse::<f64>().ok(),
        Some(Value::Null) | None => Some(0.0),
        _ => None,
    }
}

fn compact_error(raw: &str) -> String {
    if let Ok(json) = serde_json::from_str::<Value>(raw) {
        for pointer in [
            "/error/message",
            "/message",
            "/error",
        ] {
            if let Some(value) = json.pointer(pointer) {
                if let Some(message) = value.as_str() {
                    return truncate(message, 240);
                }

                if !value.is_null() {
                    return truncate(&value.to_string(), 240);
                }
            }
        }
    }

    let trimmed = raw.trim();

    if trimmed.is_empty() {
        "No response body".to_string()
    } else {
        truncate(trimmed, 240)
    }
}

fn truncate(value: &str, max_chars: usize) -> String {
    let mut chars = value.chars();

    let result: String = chars.by_ref().take(max_chars).collect();

    if chars.next().is_some() {
        format!("{result}…")
    } else {
        result
    }
}
