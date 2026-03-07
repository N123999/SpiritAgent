use anyhow::{Context, Result, anyhow};
use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64_STANDARD};
use reqwest::blocking::Client;
use serde_json::{Value, json};
use std::{
    env,
    fs,
    io::{BufRead, BufReader},
    path::Path,
    sync::mpsc::Sender,
};

use crate::logging;
use crate::model_registry::{AppConfig, resolve_api_key_for_model};

const ENV_API_KEY: &str = "SPIRIT_API_KEY";
const ENV_API_BASE: &str = "SPIRIT_API_BASE";
const COMPACT_SUMMARY_PREFIX: &str = "[SPIRIT_COMPACT_SUMMARY]";
const COMPACT_MAX_ROUNDS: usize = 64;
const TOOL_AGENT_SYSTEM_PROMPT: &str = "你是 SpiritAgent 的工具调用代理。你可以通过 function calling 使用工具: run_shell_command, read_file, search_files。规则: 1) 优先使用工具获取事实，不要编造。2) run_shell_command 是高风险，用户可能拒绝；被拒绝后需给出替代方案。3) search_files 仅允许工作目录内搜索，不要请求外部搜索。4) 需要读取文件时优先工作目录路径。5) 输出要简洁、可执行。";

#[derive(Clone)]
pub struct LlmMessage {
    pub role: &'static str,
    pub content: String,
    pub image_paths: Vec<String>,
}

pub enum StreamEvent {
    ThinkingChunk(String),
    Chunk(String),
    HistoryCompacted {
        new_history: Vec<LlmMessage>,
        dropped_messages: usize,
    },
    Done,
    Error(String),
}

#[derive(Clone)]
pub struct ToolCallRequest {
    pub id: String,
    pub name: String,
    pub arguments: String,
}

pub enum ToolAgentStep {
    ToolCall(ToolCallRequest),
    FinalResponseReady,
}

pub struct ToolAgentState {
    pub messages: Vec<Value>,
    pub steps: usize,
}

pub fn start_tool_agent_state(history: &[LlmMessage], user_input: &str) -> ToolAgentState {
    let mut messages = vec![json!({
        "role": "system",
        "content": TOOL_AGENT_SYSTEM_PROMPT
    })];

    messages.extend(history.iter().map(llm_message_to_json));

    let need_append_user = messages
        .last()
        .map(|m| m.get("role").and_then(Value::as_str) != Some("user"))
        .unwrap_or(true);

    if need_append_user {
        messages.push(json!({"role": "user", "content": user_input}));
    }

    ToolAgentState { messages, steps: 0 }
}

pub fn append_tool_result_message(state: &mut ToolAgentState, tool_call_id: &str, content: &str) {
    state.messages.push(json!({
        "role": "tool",
        "tool_call_id": tool_call_id,
        "content": content
    }));
}

pub fn tool_agent_next_step(
    cfg: &AppConfig,
    state: &mut ToolAgentState,
    tools: &Value,
) -> Result<ToolAgentStep> {
    state.steps = state.steps.saturating_add(1);

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

    let payload = json!({
        "model": active.name,
        "messages": state.messages,
        "stream": false,
        "tools": tools,
        "tool_choice": "auto",
        "temperature": 0.2
    });

    let client = Client::new();
    let resp = client
        .post(&url)
        .bearer_auth(api_key)
        .json(&payload)
        .send()
        .map_err(|err| request_send_error("工具调用请求", &url, &err))?;

    let status = resp.status();
    let body = resp.text().context("读取工具调用响应失败")?;
    if !status.is_success() {
        return Err(anyhow!("HTTP {}: {}", status, body));
    }

    let v: Value = serde_json::from_str(&body).context("解析工具调用响应 JSON 失败")?;
    let message = v
        .pointer("/choices/0/message")
        .cloned()
        .ok_or_else(|| anyhow!("响应缺少 choices[0].message"))?;

    if let Some(arr) = message.get("tool_calls").and_then(Value::as_array)
        && let Some(first) = arr.first()
    {
        state.messages.push(message.clone());

        let id = first
            .get("id")
            .and_then(Value::as_str)
            .unwrap_or("tool_call")
            .to_string();
        let name = first
            .pointer("/function/name")
            .and_then(Value::as_str)
            .ok_or_else(|| anyhow!("tool call 缺少 function.name"))?
            .to_string();
        let arguments = first
            .pointer("/function/arguments")
            .and_then(Value::as_str)
            .unwrap_or("{}")
            .to_string();

        return Ok(ToolAgentStep::ToolCall(ToolCallRequest {
            id,
            name,
            arguments,
        }));
    }

    if let Some(content) = message.get("content").and_then(Value::as_str)
        && let Some(dsml_call) = parse_dsml_tool_call(content)
    {
        // Some providers emit function calls inside text tags instead of tool_calls.
        // Convert them into a canonical assistant tool_call message to keep follow-up tool
        // result messages valid in the chat history.
        state.messages.push(json!({
            "role": "assistant",
            "content": Value::Null,
            "tool_calls": [
                {
                    "id": dsml_call.id,
                    "type": "function",
                    "function": {
                        "name": dsml_call.name,
                        "arguments": dsml_call.arguments,
                    }
                }
            ]
        }));
        return Ok(ToolAgentStep::ToolCall(dsml_call));
    }

    Ok(ToolAgentStep::FinalResponseReady)
}

pub fn stream_assistant_from_messages(
    cfg: &AppConfig,
    messages: &[Value],
    tx: &Sender<StreamEvent>,
) {
    let result = stream_assistant_from_messages_inner(cfg, messages, tx);
    if let Err(err) = result {
        let _ = tx.send(StreamEvent::Error(err.to_string()));
    }
}

fn stream_assistant_from_messages_inner(
    cfg: &AppConfig,
    messages: &[Value],
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
    let stats = image_payload_stats(messages);
    logging::log_event(&format!(
        "stream request: model={} url={} messages={} image_parts={} data_urls={} file_urls={} http_urls={} max_image_url_chars={}",
        active.name,
        truncate_chars(&url, 160),
        messages.len(),
        stats.total_image_parts,
        stats.data_url_parts,
        stats.file_url_parts,
        stats.http_url_parts,
        stats.max_image_url_chars
    ));

    let payload = json!({
        "model": active.name,
        "messages": messages,
        "stream": true,
        "temperature": 0.2,
    });

    let client = Client::new();
    let resp = client
        .post(&url)
        .bearer_auth(api_key)
        .json(&payload)
        .send()
        .map_err(|err| request_send_error("流式请求", &url, &err))?;

    let status = resp.status();
    if !status.is_success() {
        let body = resp.text().unwrap_or_else(|_| "<empty body>".to_string());
        logging::log_event(&format!(
            "stream http error: status={} body_preview={}",
            status,
            truncate_chars(&body, 600)
        ));
        return Err(anyhow!("HTTP {}: {}", status, body));
    }

    let mut reader = BufReader::new(resp);
    let mut line = String::new();
    let mut seen_chunk = false;
    let mut raw_preview: Vec<String> = Vec::new();

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
        push_preview_line(&mut raw_preview, trimmed);
        let Some(data) = trimmed.strip_prefix("data:") else {
            continue;
        };
        let data = data.trim();

        if data == "[DONE]" {
            break;
        }

        let v: Value = serde_json::from_str(data)
            .with_context(|| format!("解析 SSE JSON 失败: {}", truncate_chars(data, 320)))?;

        if let Some(err_msg) = extract_provider_stream_error(&v) {
            return Err(anyhow!(err_msg));
        }

        if let Some(thinking) = extract_reasoning_delta(&v)
            && !thinking.is_empty()
        {
            let _ = tx.send(StreamEvent::ThinkingChunk(thinking));
            continue;
        }

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
        let preview = if raw_preview.is_empty() {
            "<empty stream body>".to_string()
        } else {
            raw_preview.join("\n")
        };
        logging::log_event(&format!(
            "stream no text chunks: preview={} ",
            truncate_chars(&preview, 600)
        ));
        return Err(anyhow!(
            "流式响应没有返回任何文本片段。原始响应预览:\n{}",
            preview
        ));
    }

    let _ = tx.send(StreamEvent::Done);
    Ok(())
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
        .map_err(|err| request_send_error("流式请求", &url, &err))?;

    let status = resp.status();
    if !status.is_success() {
        let body = resp.text().unwrap_or_else(|_| "<empty body>".to_string());
        return Err(anyhow!("HTTP {}: {}", status, body));
    }

    let mut reader = BufReader::new(resp);
    let mut line = String::new();
    let mut seen_chunk = false;
    let mut raw_preview: Vec<String> = Vec::new();

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
        push_preview_line(&mut raw_preview, trimmed);
        let Some(data) = trimmed.strip_prefix("data:") else {
            continue;
        };
        let data = data.trim();

        if data == "[DONE]" {
            break;
        }

        let v: Value = serde_json::from_str(data)
            .with_context(|| format!("解析 SSE JSON 失败: {}", truncate_chars(data, 320)))?;

        if let Some(err_msg) = extract_provider_stream_error(&v) {
            return Err(anyhow!(err_msg));
        }

        if let Some(thinking) = extract_reasoning_delta(&v)
            && !thinking.is_empty()
        {
            let _ = tx.send(StreamEvent::ThinkingChunk(thinking));
            continue;
        }

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
        let preview = if raw_preview.is_empty() {
            "<empty stream body>".to_string()
        } else {
            raw_preview.join("\n")
        };
        return Err(anyhow!(
            "流式响应没有返回任何文本片段。原始响应预览:\n{}",
            preview
        ));
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
        .map_err(|err| request_send_error("压缩请求", &url, &err))?;

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
    let mut messages = history.iter().map(llm_message_to_json).collect::<Vec<_>>();

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
        image_paths: vec![],
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

fn llm_message_to_json(msg: &LlmMessage) -> Value {
    if msg.role == "user" && !msg.image_paths.is_empty() {
        logging::log_event(&format!(
            "building multimodal payload: role=user images={} text_chars={}",
            msg.image_paths.len(),
            msg.content.chars().count()
        ));

        let mut parts = Vec::new();
        if !msg.content.trim().is_empty() {
            parts.push(json!({ "type": "text", "text": msg.content }));
        }

        for path in &msg.image_paths {
            let image_url = path_to_image_url(path);
            parts.push(json!({
                "type": "image_url",
                "image_url": { "url": image_url }
            }));
        }

        if parts.is_empty() {
            return json!({ "role": msg.role, "content": "" });
        }

        return json!({ "role": msg.role, "content": parts });
    }

    json!({ "role": msg.role, "content": msg.content })
}

fn path_to_image_url(path: &str) -> String {
    let normalized = path.trim();
    if normalized.starts_with("http://") || normalized.starts_with("https://") {
        logging::log_event(&format!("image source passthrough: {}", truncate_chars(normalized, 180)));
        return normalized.to_string();
    }

    if normalized.starts_with("data:") {
        logging::log_event(&format!("image source already data URL: {}", truncate_chars(normalized, 80)));
        return normalized.to_string();
    }

    if normalized.starts_with("file://") {
        logging::log_event(&format!(
            "image source is file:// URI (passthrough): {}",
            truncate_chars(normalized, 180)
        ));
        return normalized.to_string();
    }

    let base = Path::new(normalized);
    let abs = if base.is_absolute() {
        base.to_path_buf()
    } else {
        env::current_dir()
            .map(|cwd| cwd.join(base))
            .unwrap_or_else(|_| base.to_path_buf())
    };

    let abs_display = abs.to_string_lossy().to_string();
    let mime = guess_image_mime_from_path(&abs);

    match fs::read(&abs) {
        Ok(bytes) => {
            let encoded = BASE64_STANDARD.encode(&bytes);
            let prefix = bytes_prefix_hex(&bytes, 12);
            logging::log_event(&format!(
                "image encode ok: path={} mime={} bytes={} b64_chars={} header_hex={}",
                truncate_chars(&abs_display, 220),
                mime,
                bytes.len(),
                encoded.len(),
                prefix
            ));
            format!("data:{};base64,{}", mime, encoded)
        }
        Err(err) => {
            let fallback = to_file_url(&abs);
            logging::log_event(&format!(
                "image encode failed: path={} mime={} err={} -> fallback={}",
                truncate_chars(&abs_display, 220),
                mime,
                err,
                truncate_chars(&fallback, 180)
            ));
            fallback
        }
    }
}

fn to_file_url(abs: &Path) -> String {
    let normalized_abs = abs.to_string_lossy().replace('\\', "/");
    if normalized_abs.starts_with('/') {
        format!("file://{}", normalized_abs)
    } else {
        format!("file:///{}", normalized_abs)
    }
}

fn guess_image_mime_from_path(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|s| s.to_str())
        .map(|s| s.to_ascii_lowercase())
        .as_deref()
    {
        Some("png") => "image/png",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("webp") => "image/webp",
        Some("gif") => "image/gif",
        Some("bmp") => "image/bmp",
        _ => "application/octet-stream",
    }
}

fn bytes_prefix_hex(bytes: &[u8], max_len: usize) -> String {
    let mut out = String::new();
    for b in bytes.iter().take(max_len) {
        out.push_str(&format!("{:02X}", b));
    }
    out
}

#[derive(Default)]
struct ImagePayloadStats {
    total_image_parts: usize,
    data_url_parts: usize,
    file_url_parts: usize,
    http_url_parts: usize,
    max_image_url_chars: usize,
}

fn image_payload_stats(messages: &[Value]) -> ImagePayloadStats {
    let mut stats = ImagePayloadStats::default();

    for message in messages {
        let Some(parts) = message.get("content").and_then(Value::as_array) else {
            continue;
        };

        for part in parts {
            if part.get("type").and_then(Value::as_str) != Some("image_url") {
                continue;
            }

            let Some(url) = part
                .get("image_url")
                .and_then(|v| v.get("url"))
                .and_then(Value::as_str)
            else {
                continue;
            };

            stats.total_image_parts = stats.total_image_parts.saturating_add(1);
            stats.max_image_url_chars = stats.max_image_url_chars.max(url.chars().count());

            if url.starts_with("data:") {
                stats.data_url_parts = stats.data_url_parts.saturating_add(1);
            } else if url.starts_with("file://") {
                stats.file_url_parts = stats.file_url_parts.saturating_add(1);
            } else if url.starts_with("http://") || url.starts_with("https://") {
                stats.http_url_parts = stats.http_url_parts.saturating_add(1);
            }
        }
    }

    stats
}

fn request_send_error(stage: &str, url: &str, err: &reqwest::Error) -> anyhow::Error {
    let kind = if err.is_timeout() {
        "timeout"
    } else if err.is_connect() {
        "connect"
    } else if err.is_request() {
        "request"
    } else if err.is_body() {
        "body"
    } else if err.is_decode() {
        "decode"
    } else {
        "network"
    };

    let message = format!(
        "{}失败: {} (kind={}; detail={})",
        stage,
        truncate_chars(url, 180),
        kind,
        truncate_chars(&err.to_string(), 500)
    );
    logging::log_event(&format!("{}", message));
    anyhow!(message)
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

fn push_preview_line(preview: &mut Vec<String>, line: &str) {
    const MAX_LINES: usize = 12;
    const MAX_LINE_CHARS: usize = 280;

    preview.push(truncate_chars(line, MAX_LINE_CHARS));
    if preview.len() > MAX_LINES {
        let overflow = preview.len() - MAX_LINES;
        preview.drain(0..overflow);
    }
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

fn extract_provider_stream_error(v: &Value) -> Option<String> {
    let has_error_node = v.get("error").is_some();
    let type_tag = v.get("type").and_then(Value::as_str).unwrap_or("");
    if !has_error_node && type_tag != "error" {
        return None;
    }

    let err_type = v
        .pointer("/error/type")
        .and_then(Value::as_str)
        .unwrap_or("provider_error");
    let err_message = v
        .pointer("/error/message")
        .and_then(Value::as_str)
        .unwrap_or("unknown provider error");
    let http_code = v
        .pointer("/error/http_code")
        .and_then(Value::as_str)
        .unwrap_or("unknown");
    let request_id = v
        .get("request_id")
        .and_then(Value::as_str)
        .unwrap_or("unknown");

    let readable = match err_type {
        "insufficient_balance_error" => "余额不足，请充值或切换有余额的模型/账号。",
        "rate_limit_error" => "触发限流，请稍后重试或降低并发。",
        _ => "模型服务返回错误。",
    };

    Some(format!(
        "{} type={} http_code={} request_id={} message={}",
        readable, err_type, http_code, request_id, err_message
    ))
}

fn extract_reasoning_delta(v: &Value) -> Option<String> {
    if let Some(s) = v
        .pointer("/choices/0/delta/reasoning_content")
        .and_then(Value::as_str)
    {
        return Some(s.to_string());
    }

    if let Some(s) = v
        .pointer("/choices/0/delta/reasoning")
        .and_then(Value::as_str)
    {
        return Some(s.to_string());
    }

    if let Some(s) = v
        .pointer("/choices/0/message/reasoning_content")
        .and_then(Value::as_str)
    {
        return Some(s.to_string());
    }

    None
}

fn parse_dsml_tool_call(content: &str) -> Option<ToolCallRequest> {
    let normalized = content.replace('｜', "|");
    let invoke_tag = "<|DSML|invoke";
    let invoke_start = normalized.find(invoke_tag)?;
    let invoke_end_rel = normalized[invoke_start..].find("</|DSML|invoke>")?;
    let invoke_end = invoke_start + invoke_end_rel + "</|DSML|invoke>".len();
    let invoke_block = &normalized[invoke_start..invoke_end];

    let name = extract_attr_value(invoke_block, "name")?;

    let mut params = serde_json::Map::new();
    let mut cursor = 0usize;
    let param_open = "<|DSML|parameter";
    let param_close = "</|DSML|parameter>";
    while let Some(open_rel) = invoke_block[cursor..].find(param_open) {
        let open = cursor + open_rel;
        let close_rel = invoke_block[open..].find(param_close)?;
        let close = open + close_rel + param_close.len();
        let block = &invoke_block[open..close];

        let key = extract_attr_value(block, "name")?;
        let is_string = extract_attr_value(block, "string")
            .map(|v| v != "false")
            .unwrap_or(true);
        let value = extract_inner_text(block).trim().to_string();

        let json_value = if is_string {
            Value::String(value)
        } else if let Ok(v) = value.parse::<i64>() {
            json!(v)
        } else if let Ok(v) = value.parse::<f64>() {
            json!(v)
        } else if value.eq_ignore_ascii_case("true") || value.eq_ignore_ascii_case("false") {
            json!(value.eq_ignore_ascii_case("true"))
        } else {
            Value::String(value)
        };

        params.insert(key, json_value);
        cursor = close;
    }

    Some(ToolCallRequest {
        id: format!("dsml_{}", name),
        name,
        arguments: Value::Object(params).to_string(),
    })
}

fn extract_attr_value(block: &str, key: &str) -> Option<String> {
    let pattern = format!("{}=\"", key);
    let start = block.find(&pattern)? + pattern.len();
    let rest = &block[start..];
    let end = rest.find('"')?;
    Some(rest[..end].to_string())
}

fn extract_inner_text(block: &str) -> String {
    let start = block.find('>').map(|i| i + 1).unwrap_or(0);
    let end = block.rfind("</").unwrap_or(block.len());
    block[start..end].to_string()
}

