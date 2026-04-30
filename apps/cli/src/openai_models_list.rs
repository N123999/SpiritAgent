//! OpenAI-compatible `GET /v1/models` listing — aligned with `packages/host-internal/src/openai-models.ts`.

use serde_json::Value;

const MODELS_PATH: &str = "/models";

pub fn normalize_openai_api_base(base_url: &str) -> String {
    base_url.trim().trim_end_matches('/').to_string()
}

pub fn openai_compatible_models_list_url(base_url: &str) -> String {
    format!("{}{}", normalize_openai_api_base(base_url), MODELS_PATH)
}

/// Parse `data[].id` from an OpenAI-style list models JSON body.
pub fn parse_openai_models_payload(json: &Value) -> Vec<String> {
    let Some(data) = json.get("data").and_then(|v| v.as_array()) else {
        return Vec::new();
    };
    let mut ids = Vec::new();
    for entry in data {
        let Some(id) = entry.get("id").and_then(|v| v.as_str()) else {
            continue;
        };
        let t = id.trim();
        if !t.is_empty() {
            ids.push(t.to_string());
        }
    }
    ids.sort();
    ids.dedup();
    ids
}

/// `GET {apiBase}/models` with Bearer auth; returns sorted unique ids.
pub fn list_openai_compatible_model_ids(api_base: &str, api_key: &str) -> Result<Vec<String>, String> {
    let key = api_key.trim();
    if key.is_empty() {
        return Err("API Key 不能为空。".to_string());
    }

    let url = openai_compatible_models_list_url(api_base);
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|e| format!("HTTP 客户端初始化失败：{e}"))?;

    let response = client
        .get(&url)
        .header("Authorization", format!("Bearer {key}"))
        .send()
        .map_err(|e| format!("列模型请求失败：{e}"))?;

    let status = response.status();
    let text = response
        .text()
        .map_err(|e| format!("列模型响应读取失败：{e}"))?;

    let json: Value = if text.trim().is_empty() {
        Value::Object(Default::default())
    } else {
        serde_json::from_str(&text).map_err(|_| {
            if status.is_success() {
                "列模型响应不是合法 JSON。".to_string()
            } else {
                format!("列模型失败（HTTP {}）。", status.as_u16())
            }
        })?
    };

    if !status.is_success() {
        let err_msg = json
            .get("error")
            .and_then(|e| e.get("message"))
            .and_then(|m| m.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty());
        return Err(match err_msg {
            Some(m) => format!("列模型失败（HTTP {}）：{}", status.as_u16(), m),
            None => format!("列模型失败（HTTP {}）。", status.as_u16()),
        });
    }

    Ok(parse_openai_models_payload(&json))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parse_openai_models_payload_reads_data_ids() {
        let body = json!({
            "data": [
                { "id": "z" },
                { "id": "a" },
                { "id": "a" },
                { "foo": "bar" }
            ]
        });
        assert_eq!(
            parse_openai_models_payload(&body),
            vec!["a".to_string(), "z".to_string()]
        );
    }

    #[test]
    fn normalize_openai_api_base_trims_slashes() {
        assert_eq!(
            normalize_openai_api_base(" https://x/v1/ "),
            "https://x/v1"
        );
    }
}
