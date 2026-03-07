use anyhow::{Context, Result, anyhow};
use reqwest::blocking::Client;
use serde_json::{Value, json};
use std::env;

use crate::model_registry::{AppConfig, resolve_api_key_for_model};

const ENV_API_KEY: &str = "SPIRIT_API_KEY";
const ENV_API_BASE: &str = "SPIRIT_API_BASE";

#[derive(Clone)]
pub struct LlmMessage {
    pub role: &'static str,
    pub content: String,
}

pub fn query_openai_compatible(
    cfg: &AppConfig,
    history: &[LlmMessage],
    user_input: &str,
) -> Result<String> {
    let active = cfg
        .active_model_profile()
        .ok_or_else(|| anyhow!("当前模型不存在，请先配置模型"))?;

    let api_key = resolve_api_key_for_model(&active.name).with_context(|| {
        format!(
            "未检测到模型 {} 的 API Key。可执行 `spirit-agent model add {} --api-base <url> --key <api_key>` 或设置环境变量 {}",
            active.name,
            active.name,
            ENV_API_KEY
        )
    })?;

    let base = env::var(ENV_API_BASE).unwrap_or_else(|_| active.api_base.clone());
    let url = format!("{}/chat/completions", base.trim_end_matches('/'));

    let mut messages = history
        .iter()
        .map(|m| json!({ "role": m.role, "content": m.content }))
        .collect::<Vec<_>>();

    if messages.is_empty()
        || messages
            .last()
            .and_then(|v| v.get("content"))
            .and_then(Value::as_str)
            != Some(user_input)
    {
        messages.push(json!({ "role": "user", "content": user_input }));
    }

    let payload = json!({
        "model": active.name,
        "messages": messages
    });

    let client = Client::new();
    let resp = client
        .post(&url)
        .bearer_auth(api_key)
        .json(&payload)
        .send()
        .with_context(|| format!("请求失败: {}", url))?;

    let status = resp.status();
    let body = resp.text().context("读取响应失败")?;

    if !status.is_success() {
        return Err(anyhow!("HTTP {}: {}", status, body));
    }

    let v: Value = serde_json::from_str(&body).context("解析响应 JSON 失败")?;
    let content = v
        .get("choices")
        .and_then(Value::as_array)
        .and_then(|arr| arr.first())
        .and_then(|first| first.get("message"))
        .and_then(|msg| msg.get("content"))
        .and_then(Value::as_str)
        .ok_or_else(|| anyhow!("响应中缺少 choices[0].message.content"))?;

    Ok(content.to_string())
}
