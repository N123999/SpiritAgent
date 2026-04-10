use anyhow::{Context, Result, anyhow};
use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64_STANDARD};
use reqwest::blocking::Client;
use serde_json::{Value, json};
use std::{
    collections::BTreeMap,
    fs,
    io::{BufRead, BufReader},
    path::{Path, PathBuf},
    sync::mpsc::Sender,
};

use crate::ports::Telemetry;

const COMPACT_SUMMARY_PREFIX: &str = "[SPIRIT_COMPACT_SUMMARY]";
const COMPACT_MAX_ROUNDS: usize = 64;
/// 工具定义随每轮请求的 `tools` 下发；此处仅固定身份与原则约束，不枚举具体工具名。
const TOOL_AGENT_SYSTEM_PROMPT: &str = concat!(
    "你是 Spirit Agent 代理。\n\n",
    "本回合可用的工具以 API 请求中的 tools 字段为准；仅能通过 function calling 调用其中已声明的函数。",
    "当用户未明确要求时（例如 「请帮我改个代码」、「请读取文件」等），不要主动使用工具。",
    "不要在自然语言回复中捏造或声称本请求未提供的工具名或能力（例如「联网搜索」「上传 PDF」等）。",
);
const FINAL_RESPONSE_SYSTEM_PROMPT: &str = "你是 Spirit Agent 代理。";

#[derive(Clone)]
pub struct LlmMessage {
    pub role: &'static str,
    pub content: String,
    pub image_paths: Vec<String>,
}

#[derive(Clone)]
pub struct ResolvedLlmConfig {
    pub model: String,
    pub api_base: String,
    pub api_key: String,
    pub workspace_root: PathBuf,
}

pub enum StreamEvent {
    ThinkingChunk(String),
    ToolProgress(String),
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

#[derive(Clone)]
pub struct ToolAgentState {
    pub messages: Vec<Value>,
    pub steps: usize,
}

pub fn start_tool_agent_state(
    history: &[LlmMessage],
    user_input: &str,
    asset_root: &Path,
) -> ToolAgentState {
    let mut messages = vec![json!({
        "role": "system",
        "content": TOOL_AGENT_SYSTEM_PROMPT
    })];

    messages.extend(
        history
            .iter()
            .map(|msg| llm_message_to_json(msg, asset_root)),
    );

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

fn append_redundant_lookup_result(state: &mut ToolAgentState, tool_call_id: &str) {
    append_tool_result_message(
        state,
        tool_call_id,
        "[duplicate lookup suppressed] 同参数 read/search 已在本轮出现。请直接复用已有结果并继续，不要再次读取。",
    );
}

/// 供 `/log` 导出：两条固定 system 文案（与各请求里 `messages` 中 system 一致）。
pub fn llm_system_prompts_for_export() -> Value {
    json!({
        "tool_agent": TOOL_AGENT_SYSTEM_PROMPT,
        "final_response": FINAL_RESPONSE_SYSTEM_PROMPT,
    })
}

#[derive(Default)]
struct ToolCallStreamAccumulator {
    /// OpenAI 流式 tool_calls 按 index 槽位合并
    slots: BTreeMap<u64, serde_json::Map<String, Value>>,
}

impl ToolCallStreamAccumulator {
    fn apply_deltas(&mut self, deltas: &[Value]) {
        for part in deltas {
            let idx = part.get("index").and_then(|v| v.as_u64()).unwrap_or(0);
            let slot = self.slots.entry(idx).or_default();
            if let Some(id) = part.get("id").and_then(Value::as_str) {
                slot.insert("id".to_string(), json!(id));
            }
            if let Some(t) = part.get("type").and_then(Value::as_str) {
                slot.insert("type".to_string(), json!(t));
            }
            if let Some(df) = part.get("function").and_then(|v| v.as_object()) {
                let func = slot
                    .entry("function".to_string())
                    .or_insert_with(|| json!({}))
                    .as_object_mut()
                    .expect("function map");
                if let Some(name) = df.get("name").and_then(Value::as_str) {
                    func.insert("name".to_string(), json!(name));
                }
                if let Some(Value::String(piece)) = df.get("arguments") {
                    let cur = func
                        .get("arguments")
                        .and_then(|a| a.as_str())
                        .unwrap_or("")
                        .to_string();
                    func.insert(
                        "arguments".to_string(),
                        Value::String(format!("{cur}{piece}")),
                    );
                } else if let Some(arg) = df.get("arguments") {
                    func.insert("arguments".to_string(), arg.clone());
                }
            }
        }
    }

    fn as_tool_calls_array(&self) -> Option<Vec<Value>> {
        if self.slots.is_empty() {
            return None;
        }
        let mut out: Vec<(u64, Value)> = self
            .slots
            .iter()
            .map(|(i, m)| (*i, Value::Object(m.clone())))
            .collect();
        out.sort_by_key(|(i, _)| *i);
        let arr: Vec<Value> = out.into_iter().map(|(_, v)| v).collect();
        if arr.is_empty() { None } else { Some(arr) }
    }
}

/// 将一轮 chat/completions 的 assistant `message` 并入 state，并解析下一步（工具 / 结束）。
fn apply_tool_agent_assistant_message(
    state: &mut ToolAgentState,
    message: Value,
) -> Result<ToolAgentStep> {
    if let Some(arr) = message.get("tool_calls").and_then(Value::as_array)
        && let Some(first) = arr.first()
    {
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

        let is_redundant = is_redundant_lookup_call(&state.messages, &name, &arguments);
        state.messages.push(message.clone());

        if is_redundant {
            append_redundant_lookup_result(&mut *state, &id);
            return Ok(ToolAgentStep::FinalResponseReady);
        }

        return Ok(ToolAgentStep::ToolCall(ToolCallRequest {
            id,
            name,
            arguments,
        }));
    }

    if let Some(content) = message.get("content").and_then(Value::as_str)
        && let Some(dsml_call) = parse_dsml_tool_call(content)
    {
        if is_redundant_lookup_call(&state.messages, &dsml_call.name, &dsml_call.arguments) {
            let tool_call_id = dsml_call.id.clone();
            let tool_name = dsml_call.name.clone();
            let tool_arguments = dsml_call.arguments.clone();
            state.messages.push(json!({
                "role": "assistant",
                "content": Value::Null,
                "reasoning_content": "",
                "tool_calls": [
                    {
                        "id": tool_call_id,
                        "type": "function",
                        "function": {
                            "name": tool_name,
                            "arguments": tool_arguments,
                        }
                    }
                ]
            }));
            append_redundant_lookup_result(&mut *state, &dsml_call.id);
            return Ok(ToolAgentStep::FinalResponseReady);
        }

        state.messages.push(json!({
            "role": "assistant",
            "content": Value::Null,
            "reasoning_content": "",
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

    let has_tool_calls = message
        .get("tool_calls")
        .and_then(Value::as_array)
        .map(|a| !a.is_empty())
        .unwrap_or(false);
    if !has_tool_calls {
        if let Some(Value::String(s)) = message.get("content") {
            if !s.trim().is_empty() {
                state.messages.push(message);
                return Ok(ToolAgentStep::FinalResponseReady);
            }
        }
    }

    Ok(ToolAgentStep::FinalResponseReady)
}

fn build_assistant_message_from_stream_buffers(
    content_buf: &str,
    reasoning_buf: &str,
    tool_acc: &ToolCallStreamAccumulator,
) -> Result<Value> {
    if let Some(tc) = tool_acc.as_tool_calls_array() {
        let content_val = if content_buf.trim().is_empty() {
            Value::Null
        } else {
            Value::String(content_buf.to_string())
        };
        return Ok(with_reasoning_content_if_needed(
            json!({
                "role": "assistant",
                "content": content_val,
                "tool_calls": tc,
            }),
            reasoning_buf,
        ));
    }
    if !content_buf.trim().is_empty() {
        return Ok(with_reasoning_content_if_needed(
            json!({
                "role": "assistant",
                "content": content_buf,
            }),
            reasoning_buf,
        ));
    }
    Err(anyhow!(
        "流式响应结束：无文本片段且无 tool_calls，无法继续本轮"
    ))
}

fn with_reasoning_content_if_needed(mut message: Value, reasoning_buf: &str) -> Value {
    let has_tool_calls = message
        .get("tool_calls")
        .and_then(Value::as_array)
        .map(|arr| !arr.is_empty())
        .unwrap_or(false);

    let Some(object) = message.as_object_mut() else {
        return message;
    };

    if object.contains_key("reasoning_content") {
        return message;
    }

    if !reasoning_buf.is_empty() {
        object.insert(
            "reasoning_content".to_string(),
            Value::String(reasoning_buf.to_string()),
        );
    } else if has_tool_calls {
        object.insert(
            "reasoning_content".to_string(),
            Value::String(String::new()),
        );
    }

    message
}

/// 工具代理单轮：**一次** `stream=true` 的 chat/completions（含 tools），真实 SSE 输出到 `stream_tx`。
pub fn stream_tool_agent_round(
    cfg: &ResolvedLlmConfig,
    telemetry: &dyn Telemetry,
    state: &mut ToolAgentState,
    tools: &Value,
    stream_tx: &Sender<StreamEvent>,
    request_trace: Option<&mut Vec<Value>>,
) -> Result<ToolAgentStep> {
    state.steps = state.steps.saturating_add(1);
    let url = format!("{}/chat/completions", cfg.api_base.trim_end_matches('/'));

    if let Some(t) = request_trace {
        t.push(json!({
            "kind": "tool_agent_chat_completions",
            "step_index": state.steps,
            "stream": true,
            "model": cfg.model,
            "temperature": 0.2,
            "tool_choice": "auto",
            "messages": state.messages.clone(),
            "tools": tools.clone(),
        }));
    }

    let stats = image_payload_stats(&state.messages);
    telemetry.log_event(&format!(
        "tool_agent stream: model={} url={} messages={} image_parts={}",
        cfg.model,
        truncate_chars(&url, 160),
        state.messages.len(),
        stats.total_image_parts,
    ));

    let payload = json!({
        "model": cfg.model,
        "messages": &state.messages,
        "stream": true,
        "tools": tools,
        "tool_choice": "auto",
        "temperature": 0.2
    });

    telemetry.log_json_http_body("POST_chat_completions_tool_agent_stream", &payload);

    let client = Client::new();
    let resp = client
        .post(&url)
        .bearer_auth(&cfg.api_key)
        .json(&payload)
        .send()
        .map_err(|err| request_send_error("工具流式请求", &url, telemetry, &err))?;

    let status = resp.status();
    if !status.is_success() {
        let body = resp.text().unwrap_or_else(|_| "<empty body>".to_string());
        return Err(anyhow!("HTTP {}: {}", status, body));
    }

    let mut reader = BufReader::new(resp);
    let mut line = String::new();
    let mut content_buf = String::new();
    let mut reasoning_buf = String::new();
    let mut tool_acc = ToolCallStreamAccumulator::default();
    let mut saw_model_output = false;
    let mut raw_preview: Vec<String> = Vec::new();
    let mut last_finish_message: Option<Value> = None;
    let mut last_tool_progress: Option<String> = None;

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
            reasoning_buf.push_str(&thinking);
            let _ = stream_tx.send(StreamEvent::ThinkingChunk(thinking));
        }

        if let Some(content) = v
            .pointer("/choices/0/delta/content")
            .and_then(Value::as_str)
        {
            if !content.is_empty() {
                saw_model_output = true;
                content_buf.push_str(content);
                let _ = stream_tx.send(StreamEvent::Chunk(content.to_string()));
            }
        }

        if let Some(tc_arr) = v
            .pointer("/choices/0/delta/tool_calls")
            .and_then(Value::as_array)
        {
            tool_acc.apply_deltas(tc_arr.as_slice());
            saw_model_output = true;
            if let Some(progress) = tool_progress_preview(&tool_acc)
                && last_tool_progress.as_deref() != Some(progress.as_str())
            {
                last_tool_progress = Some(progress.clone());
                let _ = stream_tx.send(StreamEvent::ToolProgress(progress));
            }
        }

        if let Some(msg) = v.pointer("/choices/0/message").cloned() {
            let msg = with_reasoning_content_if_needed(msg, &reasoning_buf);
            let has_tc = msg
                .get("tool_calls")
                .and_then(Value::as_array)
                .map(|a| !a.is_empty())
                .unwrap_or(false);
            let has_txt = msg
                .get("content")
                .and_then(|c| c.as_str())
                .map(|s| !s.trim().is_empty())
                .unwrap_or(false);
            if has_tc || has_txt {
                last_finish_message = Some(msg);
                saw_model_output = true;
            }
        }
    }

    if !saw_model_output {
        let preview = if raw_preview.is_empty() {
            "<empty stream body>".to_string()
        } else {
            raw_preview.join("\n")
        };
        return Err(anyhow!(
            "流式响应无任何 delta（无 content / tool_calls）。预览:\n{}",
            truncate_chars(&preview, 600)
        ));
    }

    let message = if let Some(m) = last_finish_message {
        m
    } else {
        build_assistant_message_from_stream_buffers(&content_buf, &reasoning_buf, &tool_acc)?
    };
    apply_tool_agent_assistant_message(state, message)
}

pub fn stream_openai_compatible(
    cfg: &ResolvedLlmConfig,
    telemetry: &dyn Telemetry,
    history: &[LlmMessage],
    user_input: &str,
    tx: &Sender<StreamEvent>,
) {
    let result = stream_openai_compatible_inner(cfg, telemetry, history, user_input, tx);
    if let Err(err) = result {
        let _ = tx.send(StreamEvent::Error(err.to_string()));
    }
}

pub struct CompactResult {
    pub dropped_messages: usize,
    pub before_len: usize,
    pub after_len: usize,
}

pub fn compact_history_manual(
    cfg: &ResolvedLlmConfig,
    telemetry: &dyn Telemetry,
    history: &mut Vec<LlmMessage>,
    progress_tx: Option<&Sender<String>>,
) -> Result<CompactResult> {
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

    let merged_summary = summarize_messages(
        cfg,
        telemetry,
        existing_summary.as_deref(),
        &all_non_summary,
        progress_tx,
    )
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
    cfg: &ResolvedLlmConfig,
    telemetry: &dyn Telemetry,
    history: &[LlmMessage],
    user_input: &str,
    tx: &Sender<StreamEvent>,
) -> Result<()> {
    let mut working_history = history.to_vec();
    let mut compact_round = 0usize;

    loop {
        match stream_once(cfg, telemetry, &working_history, user_input, tx) {
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

                let dropped = compact_oldest_once(cfg, telemetry, &mut working_history)
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
    cfg: &ResolvedLlmConfig,
    telemetry: &dyn Telemetry,
    history: &[LlmMessage],
    user_input: &str,
    tx: &Sender<StreamEvent>,
) -> Result<()> {
    let url = format!("{}/chat/completions", cfg.api_base.trim_end_matches('/'));
    let payload = chat_payload(&cfg.model, &cfg.workspace_root, history, user_input, true);

    let client = Client::new();
    let resp = client
        .post(&url)
        .bearer_auth(&cfg.api_key)
        .json(&payload)
        .send()
        .map_err(|err| request_send_error("流式请求", &url, telemetry, &err))?;

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

fn compact_oldest_once(
    cfg: &ResolvedLlmConfig,
    telemetry: &dyn Telemetry,
    history: &mut Vec<LlmMessage>,
) -> Result<usize> {
    let existing_summary = extract_compact_summary(history);
    let all_non_summary = history
        .iter()
        .cloned()
        .into_iter()
        .filter(|m| !is_compact_summary_message(m))
        .collect::<Vec<_>>();

    if !all_non_summary.is_empty() {
        let merged_summary = summarize_messages(
            cfg,
            telemetry,
            existing_summary.as_deref(),
            &all_non_summary,
            None,
        )
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
    cfg: &ResolvedLlmConfig,
    telemetry: &dyn Telemetry,
    existing_summary: Option<&str>,
    msgs_to_merge: &[LlmMessage],
    progress_tx: Option<&Sender<String>>,
) -> Result<String> {
    let url = format!("{}/chat/completions", cfg.api_base.trim_end_matches('/'));

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
        existing_part, merged_lines
    );

    let payload = json!({
        "model": cfg.model,
        "messages": [
            {"role": "system", "content": "你是严谨的上下文压缩助手。"},
            {"role": "user", "content": compact_prompt}
        ],
        "stream": progress_tx.is_some(),
        "temperature": 0.2
    });

    let client = Client::new();
    let resp = client
        .post(&url)
        .bearer_auth(&cfg.api_key)
        .json(&payload)
        .send()
        .map_err(|err| request_send_error("压缩请求", &url, telemetry, &err))?;

    let status = resp.status();
    if !status.is_success() {
        let body = resp.text().context("读取压缩响应失败")?;
        return Err(anyhow!("HTTP {}: {}", status, body));
    }

    if let Some(progress_tx) = progress_tx {
        let mut reader = BufReader::new(resp);
        let mut line = String::new();
        let mut summary = String::new();
        let mut raw_preview: Vec<String> = Vec::new();

        loop {
            line.clear();
            let read = reader.read_line(&mut line).context("读取压缩流失败")?;
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

            let v: Value = serde_json::from_str(data).with_context(|| {
                format!("解析压缩 SSE JSON 失败: {}", truncate_chars(data, 320))
            })?;

            if let Some(err_msg) = extract_provider_stream_error(&v) {
                return Err(anyhow!(err_msg));
            }

            if let Some(content) = v
                .pointer("/choices/0/delta/content")
                .and_then(Value::as_str)
            {
                if !content.is_empty() {
                    summary.push_str(content);
                    let _ = progress_tx.send(content.to_string());
                }
                continue;
            }

            if let Some(content) = v
                .pointer("/choices/0/message/content")
                .and_then(Value::as_str)
            {
                if !content.is_empty() {
                    summary.push_str(content);
                    let _ = progress_tx.send(content.to_string());
                }
            }
        }

        let trimmed = summary.trim();
        if trimmed.is_empty() {
            let preview = if raw_preview.is_empty() {
                "<empty stream body>".to_string()
            } else {
                raw_preview.join("\n")
            };
            return Err(anyhow!(
                "压缩流没有返回任何摘要文本。原始响应预览:\n{}",
                truncate_chars(&preview, 600)
            ));
        }

        return Ok(trimmed.to_string());
    }

    let body = resp.text().context("读取压缩响应失败")?;

    let v: Value = serde_json::from_str(&body).context("解析压缩响应 JSON 失败")?;
    let summary = v
        .pointer("/choices/0/message/content")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| anyhow!("压缩响应缺少 choices[0].message.content"))?;

    Ok(summary.to_string())
}

fn chat_payload(
    model: &str,
    asset_root: &Path,
    history: &[LlmMessage],
    user_input: &str,
    stream: bool,
) -> Value {
    let mut messages = history
        .iter()
        .map(|msg| llm_message_to_json(msg, asset_root))
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

/// 将当前会话的 `llm_history` 转为与发往 LLM 的工具轮请求中「历史部分」一致的
/// OpenAI Chat `messages` 元素（由 `llm_message_to_json` 生成；多模态用户消息含 data URL）。
pub fn llm_history_as_api_messages(history: &[LlmMessage], asset_root: &Path) -> Vec<Value> {
    history
        .iter()
        .map(|msg| llm_message_to_json(msg, asset_root))
        .collect()
}

fn llm_message_to_json(msg: &LlmMessage, asset_root: &Path) -> Value {
    if msg.role == "user" && !msg.image_paths.is_empty() {
        let mut parts = Vec::new();
        if !msg.content.trim().is_empty() {
            parts.push(json!({ "type": "text", "text": msg.content }));
        }

        for path in &msg.image_paths {
            let image_url = path_to_image_url(path, asset_root);
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

fn path_to_image_url(path: &str, asset_root: &Path) -> String {
    let normalized = path.trim();
    if normalized.starts_with("http://") || normalized.starts_with("https://") {
        return normalized.to_string();
    }

    if normalized.starts_with("data:") {
        return normalized.to_string();
    }

    if normalized.starts_with("file://") {
        return normalized.to_string();
    }

    let base = Path::new(normalized);
    let abs = if base.is_absolute() {
        base.to_path_buf()
    } else {
        asset_root.join(base)
    };

    let mime = guess_image_mime_from_path(&abs);

    match fs::read(&abs) {
        Ok(bytes) => {
            let encoded = BASE64_STANDARD.encode(&bytes);
            format!("data:{};base64,{}", mime, encoded)
        }
        Err(_) => to_file_url(&abs),
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

fn request_send_error(
    stage: &str,
    url: &str,
    telemetry: &dyn Telemetry,
    err: &reqwest::Error,
) -> anyhow::Error {
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
    telemetry.log_event(&message);
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

fn tool_progress_preview(tool_acc: &ToolCallStreamAccumulator) -> Option<String> {
    let first = tool_acc.as_tool_calls_array()?.into_iter().next()?;
    let name = first.pointer("/function/name").and_then(Value::as_str)?;
    let arguments = first
        .pointer("/function/arguments")
        .and_then(Value::as_str)
        .unwrap_or("{}");

    let line_hint = serde_json::from_str::<Value>(arguments)
        .ok()
        .and_then(|args| {
            args.get("content")
                .or_else(|| args.get("new_text"))
                .and_then(Value::as_str)
                .map(|text| text.lines().count())
        });

    match line_hint {
        Some(lines) if lines > 0 => Some(format!("准备调用工具: {}（约 {} 行内容）", name, lines)),
        _ => Some(format!("准备调用工具: {}", name)),
    }
}

fn is_redundant_lookup_call(messages: &[Value], name: &str, arguments: &str) -> bool {
    if name != "read_file" && name != "search_files" {
        return false;
    }

    let normalized_args = normalize_json_string(arguments);
    messages
        .iter()
        .filter_map(|m| m.get("tool_calls").and_then(Value::as_array))
        .flat_map(|arr| arr.iter())
        .any(|call| {
            let call_name = call.pointer("/function/name").and_then(Value::as_str);
            let call_args = call.pointer("/function/arguments").and_then(Value::as_str);
            if call_name != Some(name) {
                return false;
            }
            normalize_json_string(call_args.unwrap_or("{}")) == normalized_args
        })
}

fn normalize_json_string(input: &str) -> String {
    serde_json::from_str::<Value>(input)
        .map(|v| v.to_string())
        .unwrap_or_else(|_| input.trim().to_string())
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn redundant_lookup_appends_synthetic_tool_response() {
        let mut state = ToolAgentState {
            messages: vec![
                json!({"role": "system", "content": "你是 Spirit Agent 代理。"}),
                json!({
                    "role": "assistant",
                    "content": Value::Null,
                    "tool_calls": [
                        {
                            "id": "call_prev",
                            "type": "function",
                            "function": {
                                "name": "read_file",
                                "arguments": "{\"path\":\"summary.md\"}",
                            }
                        }
                    ]
                }),
                json!({
                    "role": "tool",
                    "tool_call_id": "call_prev",
                    "content": "[read]\npath: summary.md",
                }),
            ],
            steps: 0,
        };

        let step = apply_tool_agent_assistant_message(
            &mut state,
            json!({
                "role": "assistant",
                "content": "让我再读一次这个文档。",
                "tool_calls": [
                    {
                        "id": "call_new",
                        "type": "function",
                        "function": {
                            "name": "read_file",
                            "arguments": "{\"path\":\"summary.md\"}",
                        }
                    }
                ]
            }),
        )
        .expect("redundant tool call should be converted into synthetic tool response");

        assert!(matches!(step, ToolAgentStep::FinalResponseReady));
        assert_eq!(state.messages.len(), 5);
        assert_eq!(
            state.messages[3]
                .get("tool_calls")
                .and_then(Value::as_array)
                .and_then(|calls| calls.first())
                .and_then(|call| call.get("id"))
                .and_then(Value::as_str),
            Some("call_new")
        );
        assert_eq!(
            state.messages[4]
                .get("tool_call_id")
                .and_then(Value::as_str),
            Some("call_new")
        );
    }

    #[test]
    fn openai_non_redundant_tool_call_is_recorded_and_returned() {
        let mut state = ToolAgentState {
            messages: vec![json!({"role": "system", "content": "你是 Spirit Agent 代理。"})],
            steps: 0,
        };

        let step = apply_tool_agent_assistant_message(
            &mut state,
            json!({
                "role": "assistant",
                "content": "我先读一下这个文件。",
                "tool_calls": [
                    {
                        "id": "call_openai",
                        "type": "function",
                        "function": {
                            "name": "read_file",
                            "arguments": "{\"path\":\"summary.md\"}",
                        }
                    }
                ]
            }),
        )
        .expect("openai style tool call should parse");

        match step {
            ToolAgentStep::ToolCall(call) => {
                assert_eq!(call.id, "call_openai");
                assert_eq!(call.name, "read_file");
                assert_eq!(call.arguments, "{\"path\":\"summary.md\"}");
            }
            ToolAgentStep::FinalResponseReady => {
                panic!("non-redundant openai tool call should not be treated as redundant");
            }
        }

        assert_eq!(state.messages.len(), 2);
        assert_eq!(
            state.messages[1]
                .get("tool_calls")
                .and_then(Value::as_array)
                .and_then(|calls| calls.first())
                .and_then(|call| call.get("id"))
                .and_then(Value::as_str),
            Some("call_openai")
        );
    }

    #[test]
    fn tool_call_message_from_stream_buffers_keeps_reasoning_content() {
        let mut tool_acc = ToolCallStreamAccumulator::default();
        tool_acc.apply_deltas(&[json!({
            "index": 0,
            "id": "call_openai",
            "type": "function",
            "function": {
                "name": "read_file",
                "arguments": "{\"path\":\"summary.md\"}"
            }
        })]);

        let message =
            build_assistant_message_from_stream_buffers("", "先检查一下文件", &tool_acc)
                .expect("tool call message should build");

        assert_eq!(
            message.get("reasoning_content").and_then(Value::as_str),
            Some("先检查一下文件")
        );
    }

    #[test]
    fn tool_call_message_without_reasoning_still_carries_empty_reasoning_content() {
        let mut tool_acc = ToolCallStreamAccumulator::default();
        tool_acc.apply_deltas(&[json!({
            "index": 0,
            "id": "call_openai",
            "type": "function",
            "function": {
                "name": "read_file",
                "arguments": "{\"path\":\"summary.md\"}"
            }
        })]);

        let message = build_assistant_message_from_stream_buffers("", "", &tool_acc)
            .expect("tool call message should build");

        assert_eq!(
            message.get("reasoning_content").and_then(Value::as_str),
            Some("")
        );
    }
}
