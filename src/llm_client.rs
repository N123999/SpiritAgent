use anyhow::{Context, Result, anyhow};
use reqwest::blocking::Client;
use serde_json::{Value, json};
use std::{
    env,
    io::{BufRead, BufReader},
    sync::mpsc::Sender,
};

use crate::model_registry::{AppConfig, resolve_api_key_for_model};

const ENV_API_KEY: &str = "SPIRIT_API_KEY";
const ENV_API_BASE: &str = "SPIRIT_API_BASE";

#[derive(Clone)]
pub struct LlmMessage {
    pub role: &'static str,
    pub content: String,
}

pub enum StreamEvent {
    Chunk(String),
    Done,
    Error(String),
}

pub fn stream_openai_compatible(
    cfg: &AppConfig,
    history: &[LlmMessage],
    user_input: &str,
    tx: &Sender<StreamEvent>,
) {
    let result = stream_openai_compatible_inner(cfg, history, user_input, tx);
    if let Err(err) = result {
        let _ = tx.send(StreamEvent::Error(err.to_string()));
    }
}

fn stream_openai_compatible_inner(
    cfg: &AppConfig,
    history: &[LlmMessage],
    user_input: &str,
    tx: &Sender<StreamEvent>,
) -> Result<()> {
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
        "messages": messages,
        "stream": true
    });

    let client = Client::new();
    let resp = client
        .post(&url)
        .bearer_auth(api_key)
        .json(&payload)
        .send()
        .with_context(|| format!("请求失败: {}", url))?;

    let status = resp.status();
    if !status.is_success() {
        let body = resp.text().unwrap_or_else(|_| "<empty body>".to_string());
        return Err(anyhow!("HTTP {}: {}", status, body));
    }

    let mut reader = BufReader::new(resp);
    let mut line = String::new();
    let mut seen_chunk = false;

    loop {
        line.clear();
        let read = reader.read_line(&mut line).context("读取流式响应失败")?;
        if read == 0 {
            break;
        }

        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let Some(data) = trimmed.strip_prefix("data:") else {
            continue;
        };
        let data = data.trim();

        if data == "[DONE]" {
            break;
        }

        let v: Value = serde_json::from_str(data).context("解析 SSE JSON 失败")?;
        if let Some(content) = v
            .pointer("/choices/0/delta/content")
            .and_then(Value::as_str)
        {
            if !content.is_empty() {
                seen_chunk = true;
                let _ = tx.send(StreamEvent::Chunk(content.to_string()));
            }
            continue;
        }

        // Compatibility fallback for providers returning message.content chunks.
        if let Some(content) = v
            .pointer("/choices/0/message/content")
            .and_then(Value::as_str)
        {
            if !content.is_empty() {
                seen_chunk = true;
                let _ = tx.send(StreamEvent::Chunk(content.to_string()));
            }
        }
    }

    if !seen_chunk {
        return Err(anyhow!("流式响应没有返回任何文本片段"));
    }

    let _ = tx.send(StreamEvent::Done);
    Ok(())
}

