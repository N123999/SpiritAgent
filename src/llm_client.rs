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
const COMPACT_SUMMARY_PREFIX: &str = "[SPIRIT_COMPACT_SUMMARY]";
const COMPACT_MAX_ROUNDS: usize = 64;

#[derive(Clone)]
pub struct LlmMessage {
    pub role: &'static str,
    pub content: String,
}

pub enum StreamEvent {
    Chunk(String),
    HistoryCompacted {
        new_history: Vec<LlmMessage>,
        dropped_messages: usize,
    },
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

pub struct CompactResult {
    pub dropped_messages: usize,
    pub before_len: usize,
    pub after_len: usize,
}

pub fn compact_history_manual(cfg: &AppConfig, history: &mut Vec<LlmMessage>) -> Result<CompactResult> {
    let before = history.len();
    if history.is_empty() {
        return Ok(CompactResult {
            dropped_messages: 0,
            before_len: before,
            after_len: before,
        });
    }

    let existing_summary = extract_compact_summary(history);
    let all_non_summary = history
        .iter()
        .cloned()
        .into_iter()
        .filter(|m| !is_compact_summary_message(m))
        .collect::<Vec<_>>();

    if all_non_summary.is_empty() {
        return Ok(CompactResult {
            dropped_messages: 0,
            before_len: before,
            after_len: before,
        });
    }

    let merged_summary = summarize_messages(cfg, existing_summary.as_deref(), &all_non_summary)
        .context("手动压缩失败：无法生成摘要")?;

    let compacted = vec![compact_summary_message(merged_summary)];
    let dropped = before.saturating_sub(compacted.len());
    *history = compacted;

    Ok(CompactResult {
        dropped_messages: dropped,
        before_len: before,
        after_len: history.len(),
    })
}

pub fn compact_summary_text(history: &[LlmMessage]) -> Option<String> {
    extract_compact_summary(history)
}

fn stream_openai_compatible_inner(
    cfg: &AppConfig,
    history: &[LlmMessage],
    user_input: &str,
    tx: &Sender<StreamEvent>,
) -> Result<()> {
    let mut working_history = history.to_vec();
    let mut compact_round = 0usize;

    loop {
        match stream_once(cfg, &working_history, user_input, tx) {
            Ok(()) => {
                let _ = tx.send(StreamEvent::Done);
                return Ok(());
            }
            Err(err) => {
                let err_text = err.to_string();
                if !is_context_overflow_error(&err_text) {
                    return Err(err);
                }

                compact_round = compact_round.saturating_add(1);
                if compact_round > COMPACT_MAX_ROUNDS {
                    return Err(anyhow!(
                        "上下文压缩达到最大尝试次数({})，仍无法通过模型上下文限制",
                        COMPACT_MAX_ROUNDS
                    ));
                }

                let dropped = compact_oldest_once(cfg, &mut working_history)
                    .with_context(|| format!("第 {} 轮自动压缩失败", compact_round))?;
                if dropped == 0 {
                    return Err(anyhow!(
                        "上下文已无法继续压缩，但仍超出模型上下文窗口: {}",
                        err_text
                    ));
                }

                let _ = tx.send(StreamEvent::HistoryCompacted {
                    new_history: working_history.clone(),
                    dropped_messages: dropped,
                });
            }
        }
    }
}

fn stream_once(
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
    let payload = chat_payload(&active.name, history, user_input, true);

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

    Ok(())
}

fn compact_oldest_once(cfg: &AppConfig, history: &mut Vec<LlmMessage>) -> Result<usize> {
    let existing_summary = extract_compact_summary(history);
    let all_non_summary = history
        .iter()
        .cloned()
        .into_iter()
        .filter(|m| !is_compact_summary_message(m))
        .collect::<Vec<_>>();

    if !all_non_summary.is_empty() {
        let merged_summary = summarize_messages(cfg, existing_summary.as_deref(), &all_non_summary)
            .context("自动压缩失败：摘要模型调用失败")?;
        *history = vec![compact_summary_message(merged_summary)];
        return Ok(all_non_summary.len());
    }

    // Already summary-only. If still over context, progressively shrink summary text.
    let Some(summary) = existing_summary else {
        return Ok(0);
    };
    let shortened = shrink_summary_text(&summary);
    if shortened == summary {
        return Ok(0);
    }

    *history = vec![compact_summary_message(shortened)];
    Ok(1)
}

fn summarize_messages(
    cfg: &AppConfig,
    existing_summary: Option<&str>,
    msgs_to_merge: &[LlmMessage],
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

    let existing_part = existing_summary
        .map(|s| truncate_chars(s, 6000))
        .unwrap_or_else(|| "<none>".to_string());

    let merged_lines = msgs_to_merge
        .iter()
        .map(|m| format!("[{}]\n{}", m.role, truncate_chars(&m.content, 6000)))
        .collect::<Vec<_>>()
        .join("\n\n");

    let compact_prompt = format!(
        "你是会话上下文压缩器。目标：把旧对话压缩成后续对话可直接复用的系统提示词。\n\n输出规则（必须严格遵守）：\n1) 仅输出压缩结果，不要解释。\n2) 结构固定为两段：\n   A. <压缩摘要>：保留任务目标、关键约束、用户偏好、已确认决策、未完成 TODO。\n   B. <最近10句对话>：按时间顺序列出最近最多10句关键对话，每句格式为 `- User: ...` 或 `- Assistant: ...`。\n3) 删除寒暄和重复，保留可执行信息。\n4) 使用简洁中文，内容可直接作为系统提示词。\n5) 总长度尽量短，建议不超过 1200 中文字符。\n\n现有压缩摘要：\n{}\n\n新增待合并内容：\n{}",
        existing_part,
        merged_lines
    );

    let payload = json!({
        "model": active.name,
        "messages": [
            {"role": "system", "content": "你是严谨的上下文压缩助手。"},
            {"role": "user", "content": compact_prompt}
        ],
        "stream": false,
        "temperature": 0.2
    });

    let client = Client::new();
    let resp = client
        .post(&url)
        .bearer_auth(api_key)
        .json(&payload)
        .send()
        .with_context(|| format!("压缩请求失败: {}", url))?;

    let status = resp.status();
    let body = resp.text().context("读取压缩响应失败")?;
    if !status.is_success() {
        return Err(anyhow!("HTTP {}: {}", status, body));
    }

    let v: Value = serde_json::from_str(&body).context("解析压缩响应 JSON 失败")?;
    let summary = v
        .pointer("/choices/0/message/content")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| anyhow!("压缩响应缺少 choices[0].message.content"))?;

    Ok(summary.to_string())
}

fn chat_payload(model: &str, history: &[LlmMessage], user_input: &str, stream: bool) -> Value {
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

    json!({
        "model": model,
        "messages": messages,
        "stream": stream
    })
}

fn compact_summary_message(summary: String) -> LlmMessage {
    LlmMessage {
        role: "system",
        content: format!("{}\n{}", COMPACT_SUMMARY_PREFIX, summary.trim()),
    }
}

fn extract_compact_summary(history: &[LlmMessage]) -> Option<String> {
    history
        .iter()
        .find(|m| is_compact_summary_message(m))
        .map(|m| {
            m.content
                .strip_prefix(COMPACT_SUMMARY_PREFIX)
                .map(str::trim)
                .unwrap_or("")
                .to_string()
        })
        .filter(|s| !s.is_empty())
}

fn is_compact_summary_message(msg: &LlmMessage) -> bool {
    msg.role == "system" && msg.content.starts_with(COMPACT_SUMMARY_PREFIX)
}

fn truncate_chars(text: &str, max_chars: usize) -> String {
    let mut out = String::new();
    for (i, ch) in text.chars().enumerate() {
        if i >= max_chars {
            out.push_str("...<truncated>");
            break;
        }
        out.push(ch);
    }
    out
}

fn shrink_summary_text(summary: &str) -> String {
    let min_chars = 200;
    let current_len = summary.chars().count();
    if current_len <= min_chars {
        return summary.to_string();
    }

    let target = (current_len * 7) / 10;
    truncate_chars(summary, target.max(min_chars))
}

pub fn is_context_overflow_error(err: &str) -> bool {
    let lower = err.to_lowercase();
    let hints = [
        "context_length_exceeded",
        "maximum context length",
        "too many tokens",
        "context window",
        "prompt is too long",
        "max context",
    ];
    hints.iter().any(|h| lower.contains(h))
}

