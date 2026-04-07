use std::{
    collections::VecDeque,
    path::PathBuf,
    sync::mpsc::{Receiver, TryRecvError},
    time::{Duration, Instant},
};

use serde_json::{Value, json};

use crate::{
    llm_client::{StreamEvent, ToolAgentState, ToolAgentStep, append_tool_result_message},
    model_registry::AppConfig,
    ports::{LlmTransport, StartedToolAgentRound, ToolAgentRoundResult, ToolExecutor},
    session::SessionModel,
    tool_runtime::{AuthorizationDecision, ToolRequest, TrustTarget},
    view::{ChatMessage, MessageRole, ToolUiBlock, ToolUiPhase},
};

const STREAM_EVENT_BUDGET_PER_TICK: usize = 128;
const STREAM_STALL_TIMEOUT: Duration = Duration::from_secs(20);

pub enum RuntimeEvent {
    PushMessage(ChatMessage),
    BeginAssistantResponse,
    AssistantChunk(String),
    ReplacePendingAssistant(String),
    AssistantResponseCompleted,
    RemovePendingAssistant,
}

struct PendingToolApproval {
    request: ToolRequest,
    trust_target: Option<TrustTarget>,
    continuation: Option<ToolApprovalContinuation>,
}

struct ToolApprovalContinuation {
    state: ToolAgentState,
    tool_call_id: String,
    tool_name: String,
}

pub struct AgentRuntime {
    session: SessionModel,
    config: AppConfig,
    llm_transport: Box<dyn LlmTransport>,
    tool_executor: Box<dyn ToolExecutor>,
    workspace_root: PathBuf,
    pending_response: Option<Receiver<StreamEvent>>,
    pending_tool_agent_step: Option<Receiver<anyhow::Result<ToolAgentRoundResult>>>,
    pending_started_at: Option<Instant>,
    pending_last_event_at: Option<Instant>,
    stream_chunk_counter: usize,
    pending_assistant_text: String,
    pending_tool_approval: Option<PendingToolApproval>,
    thinking_spinner_index: usize,
    thinking_text: String,
    events: VecDeque<RuntimeEvent>,
}

impl AgentRuntime {
    pub fn new(
        config: AppConfig,
        llm_transport: Box<dyn LlmTransport>,
        tool_executor: Box<dyn ToolExecutor>,
        workspace_root: PathBuf,
    ) -> Self {
        Self {
            session: SessionModel::new(),
            config,
            llm_transport,
            tool_executor,
            workspace_root,
            pending_response: None,
            pending_tool_agent_step: None,
            pending_started_at: None,
            pending_last_event_at: None,
            stream_chunk_counter: 0,
            pending_assistant_text: String::new(),
            pending_tool_approval: None,
            thinking_spinner_index: 0,
            thinking_text: String::new(),
            events: VecDeque::new(),
        }
    }

    pub fn config(&self) -> &AppConfig {
        &self.config
    }

    pub fn replace_config(&mut self, config: AppConfig) {
        self.config = config;
    }

    pub fn session(&self) -> &SessionModel {
        &self.session
    }

    pub fn session_mut(&mut self) -> &mut SessionModel {
        &mut self.session
    }

    pub fn llm_history_as_api_messages(&self) -> Vec<Value> {
        self.llm_transport
            .llm_history_as_api_messages(self.session.llm_history())
    }

    pub fn llm_system_prompts_for_export(&self) -> Value {
        self.llm_transport.llm_system_prompts_for_export()
    }

    pub fn has_pending_tool_approval(&self) -> bool {
        self.pending_tool_approval.is_some()
    }

    pub fn is_busy(&self) -> bool {
        self.pending_response.is_some() || self.pending_tool_agent_step.is_some()
    }

    pub fn drain_events(&mut self) -> Vec<RuntimeEvent> {
        self.events.drain(..).collect()
    }

    pub fn thinking_status_text(&self) -> Option<String> {
        if !self.is_busy() {
            return None;
        }

        let frame = match self.thinking_spinner_index % 4 {
            0 => '|',
            1 => '/',
            2 => '-',
            _ => '\\',
        };
        Some(format!("{} Thinking...", frame))
    }

    pub fn thinking_content_text(&self) -> Option<&str> {
        if !self.is_busy() || self.thinking_text.trim().is_empty() {
            return None;
        }
        Some(self.thinking_text.as_str())
    }

    pub fn tick_thinking_spinner(&mut self) {
        if self.is_busy() {
            self.thinking_spinner_index = (self.thinking_spinner_index + 1) % 4;
        } else {
            self.thinking_spinner_index = 0;
        }
    }

    pub fn poll(&mut self) {
        self.poll_pending_response();
        self.poll_pending_tool_agent_step();
    }

    pub fn handle_stream_stall_timeout(&mut self) {
        if self.pending_response.is_none() {
            return;
        }

        let Some(last_event) = self.pending_last_event_at else {
            return;
        };

        if last_event.elapsed() < STREAM_STALL_TIMEOUT {
            return;
        }

        if self.pending_assistant_text.trim().is_empty() {
            self.events.push_back(RuntimeEvent::ReplacePendingAssistant(
                "流式响应超时，连接已中断。".to_string(),
            ));
        } else {
            self.pending_assistant_text
                .push_str("\n\n[stream timeout] 响应长时间无数据，已自动停止等待。");
            self.events.push_back(RuntimeEvent::AssistantChunk(
                "\n\n[stream timeout] 响应长时间无数据，已自动停止等待。".to_string(),
            ));
        }

        self.pending_response = None;
        self.pending_started_at = None;
        self.pending_last_event_at = None;
        self.stream_chunk_counter = 0;
        self.pending_assistant_text.clear();
        self.thinking_text.clear();
        self.events
            .push_back(RuntimeEvent::AssistantResponseCompleted);
    }

    pub fn submit_user_turn(&mut self, text: String, explicit_images: Option<Vec<String>>) {
        let images = explicit_images.unwrap_or_else(|| self.session.take_pending_images());
        self.session.set_pending_user_turn(text.clone());
        self.session.record_user_turn(text.clone(), images);
        let state = self.make_tool_agent_state(&text);
        self.start_tool_agent_step_async(state);
    }

    pub fn respond_to_pending_tool_approval(&mut self, message: &str) {
        let decision = message.trim().to_lowercase();
        let Some(pending) = self.pending_tool_approval.take() else {
            return;
        };

        match decision.as_str() {
            "y" => {
                self.execute_tool_request_with_continuation(&pending.request, pending.continuation)
            }
            "n" => {
                if let Some(mut cont) = pending.continuation {
                    append_tool_result_message(
                        &mut cont.state,
                        &cont.tool_call_id,
                        "[denied by user] tool call rejected by user approval policy",
                    );
                    self.push_agent_message(format!(
                        "已拒绝模型工具调用: {}。将继续让模型在无该工具条件下完成任务。",
                        cont.tool_name
                    ));
                    self.start_tool_agent_step_async(cont.state);
                } else {
                    self.push_agent_message("已拒绝本次工具调用。");
                }
            }
            "t" => {
                if let Some(target) = pending.trust_target {
                    if let Err(err) = self.tool_executor.trust(&target) {
                        self.push_agent_message(format!("信任规则保存失败: {}", err));
                    } else {
                        self.push_agent_message("已加入信任白名单并持久化。");
                    }
                }
                self.execute_tool_request_with_continuation(&pending.request, pending.continuation);
            }
            _ => {
                if let Some(mut cont) = pending.continuation {
                    append_tool_result_message(
                        &mut cont.state,
                        &cont.tool_call_id,
                        "[denied by user] tool call rejected by user guidance",
                    );
                    cont.state
                        .messages
                        .push(serde_json::json!({"role": "user", "content": message}));

                    self.session.record_user_turn(message.to_string(), vec![]);
                    self.session.set_pending_user_turn(message.to_string());
                    self.push_agent_message(
                        "已按你的输入拒绝本次高风险工具调用，并将该输入作为新指令继续处理。",
                    );
                    self.start_tool_agent_step_async(cont.state);
                    return;
                }

                self.session.record_user_turn(message.to_string(), vec![]);
                self.session.set_pending_user_turn(message.to_string());
                self.push_agent_message("已拒绝本次高风险工具调用，并将该输入作为新指令继续处理。");

                let state = self.make_tool_agent_state(message);
                self.start_tool_agent_step_async(state);
            }
        }
    }

    pub fn execute_manual_tool_command(&mut self, message: &str) {
        let request = match self.tool_executor.parse_command(message) {
            Ok(req) => req,
            Err(err) => {
                self.push_agent_message(format!("工具命令解析失败: {}", err));
                return;
            }
        };

        let manual_tool_name = openapi_tool_name(&request);
        match self.tool_executor.authorize(&request) {
            Ok(AuthorizationDecision::Allowed) => self.execute_tool_request(&request),
            Ok(AuthorizationDecision::NeedApproval {
                prompt,
                trust_target,
            }) => {
                self.pending_tool_approval = Some(PendingToolApproval {
                    request,
                    trust_target,
                    continuation: None,
                });
                self.push_agent_tool(
                    prompt.clone(),
                    tool_approval_block(manual_tool_name, None, &prompt),
                );
            }
            Err(err) => {
                self.push_agent_message(format!("工具权限检查失败: {}", err));
            }
        }
    }

    pub fn compact_history(&mut self) {
        match self
            .llm_transport
            .compact_history_manual(&self.config, self.session.llm_history_mut())
        {
            Ok(result) => {
                if result.dropped_messages == 0 {
                    self.push_agent_message("当前可压缩历史较少，已跳过压缩。");
                } else {
                    let summary_preview = self
                        .llm_transport
                        .compact_summary_text(self.session.llm_history())
                        .map(|s| truncate_for_preview(&s, 600))
                        .unwrap_or_else(|| "<无摘要内容>".to_string());
                    self.push_agent_message(format!(
                        "压缩完成：上下文消息 {} -> {}，已全量压缩为摘要并合并 {} 条历史消息（UI 历史保留不变）。\n\n压缩摘要预览:\n{}",
                        result.before_len,
                        result.after_len,
                        result.dropped_messages,
                        summary_preview
                    ));
                }
            }
            Err(err) => self.push_agent_message(format!("压缩失败: {}", err)),
        }
    }

    pub fn replace_session_from_archive(&mut self, archive: &crate::ports::ChatArchive) {
        self.session.replace_from_archive(archive);
        self.pending_tool_approval = None;
        self.pending_response = None;
        self.pending_tool_agent_step = None;
        self.pending_started_at = None;
        self.pending_last_event_at = None;
        self.stream_chunk_counter = 0;
        self.pending_assistant_text.clear();
        self.thinking_text.clear();
    }

    fn make_tool_agent_state(&self, user_input: &str) -> ToolAgentState {
        let tools = self.tool_executor.tool_definitions_json();
        crate::llm_client::start_tool_agent_state(
            self.session.llm_history(),
            user_input,
            &tools,
            &self.workspace_root,
        )
    }

    fn start_tool_agent_step_async(&mut self, state: ToolAgentState) {
        self.thinking_spinner_index = 0;
        self.thinking_text.clear();
        self.pending_assistant_text.clear();
        match self.llm_transport.start_tool_agent_round(
            &self.config,
            state,
            self.tool_executor.tool_definitions_json(),
        ) {
            Ok(StartedToolAgentRound {
                stream_rx,
                result_rx,
            }) => {
                self.pending_response = Some(stream_rx);
                self.pending_tool_agent_step = Some(result_rx);
                let now = Instant::now();
                self.pending_started_at = Some(now);
                self.pending_last_event_at = Some(now);
                self.stream_chunk_counter = 0;
                self.events.push_back(RuntimeEvent::BeginAssistantResponse);
            }
            Err(err) => {
                self.push_agent_message(format!("LLM 调用失败: {}", err));
            }
        }
    }

    fn poll_pending_tool_agent_step(&mut self) {
        let Some(rx) = self.pending_tool_agent_step.take() else {
            return;
        };

        match rx.try_recv() {
            Ok(Ok(ToolAgentRoundResult {
                mut state,
                step,
                mut request_trace,
            })) => {
                self.session.append_api_trace(&mut request_trace);
                match step {
                    ToolAgentStep::FinalResponseReady => {
                        let last_is_assistant_with_body = state.messages.last().is_some_and(|m| {
                            m.get("role").and_then(|r| r.as_str()) == Some("assistant")
                                && m.get("content")
                                    .and_then(|c| c.as_str())
                                    .is_some_and(|s| !s.trim().is_empty())
                        });
                        if last_is_assistant_with_body {
                            self.session.clear_pending_user_turn();
                        } else {
                            self.start_tool_agent_step_async(state);
                        }
                    }
                    ToolAgentStep::ToolCall(call) => {
                        let request = match self
                            .tool_executor
                            .request_from_function_call(&call.name, &call.arguments)
                        {
                            Ok(r) => r,
                            Err(err) => {
                                append_tool_result_message(
                                    &mut state,
                                    &call.id,
                                    &format!("[tool schema error] {}", err),
                                );
                                self.start_tool_agent_step_async(state);
                                return;
                            }
                        };

                        match self.tool_executor.authorize(&request) {
                            Ok(AuthorizationDecision::Allowed) => {
                                let tool_output = match self.tool_executor.execute(&request) {
                                    Ok(result) => {
                                        self.session.persist_tool_memory(&request, &result);
                                        self.push_agent_tool(
                                            format_tool_ui_message(&request, &call.name, &result),
                                            build_tool_result_block(
                                                &request,
                                                &call.name,
                                                Some(&call.id),
                                                &result,
                                            ),
                                        );
                                        result
                                    }
                                    Err(err) => {
                                        let e = format!("[tool error] {}", err);
                                        self.push_agent_tool(
                                            format!("模型工具调用执行失败: {}", err),
                                            tool_failed_block(
                                                &call.name,
                                                Some(&call.id),
                                                "模型工具调用执行失败",
                                                &err.to_string(),
                                            ),
                                        );
                                        e
                                    }
                                };
                                append_tool_result_message(&mut state, &call.id, &tool_output);
                                self.start_tool_agent_step_async(state);
                            }
                            Ok(AuthorizationDecision::NeedApproval {
                                prompt,
                                trust_target,
                            }) => {
                                let approval_ui =
                                    tool_approval_block(&call.name, Some(&call.id), &prompt);
                                self.pending_tool_approval = Some(PendingToolApproval {
                                    request,
                                    trust_target,
                                    continuation: Some(ToolApprovalContinuation {
                                        state,
                                        tool_call_id: call.id,
                                        tool_name: call.name,
                                    }),
                                });
                                self.push_agent_tool(prompt.clone(), approval_ui);
                            }
                            Err(err) => {
                                append_tool_result_message(
                                    &mut state,
                                    &call.id,
                                    &format!("[authorization error] {}", err),
                                );
                                self.start_tool_agent_step_async(state);
                            }
                        }
                    }
                }
            }
            Ok(Err(err)) => {
                if self.try_fallback_to_text_only_and_retry(&err.to_string()) {
                    return;
                }
                if self.try_auto_compact_and_retry(&err.to_string()) {
                    return;
                }
                self.push_agent_message(format!("LLM 调用失败: {}", err));
            }
            Err(TryRecvError::Empty) => {
                self.pending_tool_agent_step = Some(rx);
            }
            Err(TryRecvError::Disconnected) => {
                self.push_agent_message("LLM 后台任务异常中断。");
            }
        }
    }

    fn poll_pending_response(&mut self) {
        let Some(rx) = self.pending_response.take() else {
            return;
        };

        let mut completed = false;
        let mut retry_state = None;

        let mut processed = 0usize;
        loop {
            if processed >= STREAM_EVENT_BUDGET_PER_TICK {
                break;
            }

            match rx.try_recv() {
                Ok(StreamEvent::ThinkingChunk(thinking)) => {
                    self.pending_last_event_at = Some(Instant::now());
                    self.thinking_text.push_str(&thinking);
                    processed += 1;
                }
                Ok(StreamEvent::Chunk(chunk)) => {
                    self.pending_last_event_at = Some(Instant::now());
                    self.stream_chunk_counter = self.stream_chunk_counter.saturating_add(1);
                    self.pending_assistant_text.push_str(&chunk);
                    self.events.push_back(RuntimeEvent::AssistantChunk(chunk));
                    processed += 1;
                }
                Ok(StreamEvent::HistoryCompacted {
                    new_history,
                    dropped_messages,
                }) => {
                    self.pending_last_event_at = Some(Instant::now());
                    *self.session.llm_history_mut() = new_history;
                    let summary_preview = self
                        .llm_transport
                        .compact_summary_text(self.session.llm_history())
                        .map(|s| truncate_for_preview(&s, 400))
                        .unwrap_or_else(|| "<无摘要内容>".to_string());
                    self.push_agent_message(format!(
                        "检测到上下文超限，已调用模型生成/更新压缩摘要并重试（本轮合并 {} 条历史消息）。\n\n压缩摘要预览:\n{}",
                        dropped_messages, summary_preview
                    ));
                    processed += 1;
                }
                Ok(StreamEvent::Done) => {
                    self.pending_last_event_at = Some(Instant::now());
                    if self.pending_assistant_text.trim().is_empty() {
                        self.events.push_back(RuntimeEvent::RemovePendingAssistant);
                    } else {
                        self.session
                            .record_assistant_turn(self.pending_assistant_text.clone());
                        self.events
                            .push_back(RuntimeEvent::AssistantResponseCompleted);
                        self.session.clear_pending_user_turn();
                    }
                    completed = true;
                    self.thinking_text.clear();
                    break;
                }
                Ok(StreamEvent::Error(err)) => {
                    self.pending_last_event_at = Some(Instant::now());
                    if let Some(state) = self.try_fallback_to_text_only_and_build_retry_state(&err)
                    {
                        if self.pending_assistant_text.trim().is_empty() {
                            self.events.push_back(RuntimeEvent::ReplacePendingAssistant(
                                "当前模型不支持图片输入，已自动去除图片并重试。".to_string(),
                            ));
                        }
                        self.events
                            .push_back(RuntimeEvent::AssistantResponseCompleted);
                        completed = true;
                        self.thinking_text.clear();
                        retry_state = Some(state);
                        break;
                    }

                    if let Some(state) = self.try_auto_compact_and_build_retry_state(&err) {
                        if self.pending_assistant_text.trim().is_empty() {
                            self.events.push_back(RuntimeEvent::ReplacePendingAssistant(
                                "检测到上下文超限，已自动压缩并重试当前请求。".to_string(),
                            ));
                        }
                        self.events
                            .push_back(RuntimeEvent::AssistantResponseCompleted);
                        completed = true;
                        self.thinking_text.clear();
                        retry_state = Some(state);
                        break;
                    }

                    if self.pending_assistant_text.trim().is_empty() {
                        self.events
                            .push_back(RuntimeEvent::ReplacePendingAssistant(format!(
                                "LLM 调用失败: {}",
                                err
                            )));
                    } else {
                        let suffix = format!("\n\n[Error] {}", err);
                        self.pending_assistant_text.push_str(&suffix);
                        self.events.push_back(RuntimeEvent::AssistantChunk(suffix));
                    }
                    self.events
                        .push_back(RuntimeEvent::AssistantResponseCompleted);
                    completed = true;
                    self.thinking_text.clear();
                    break;
                }
                Err(TryRecvError::Disconnected) => {
                    if self.pending_assistant_text.trim().is_empty() {
                        self.events.push_back(RuntimeEvent::ReplacePendingAssistant(
                            "LLM 请求线程异常中断。".to_string(),
                        ));
                    }
                    self.events
                        .push_back(RuntimeEvent::AssistantResponseCompleted);
                    completed = true;
                    self.thinking_text.clear();
                    break;
                }
                Err(TryRecvError::Empty) => break,
            }
        }

        if completed {
            self.pending_started_at = None;
            self.pending_last_event_at = None;
            self.stream_chunk_counter = 0;
            self.pending_assistant_text.clear();
        } else {
            self.pending_response = Some(rx);
        }

        if let Some(state) = retry_state {
            self.start_tool_agent_step_async(state);
        }
    }

    fn execute_tool_request(&mut self, request: &ToolRequest) {
        match self.tool_executor.execute(request) {
            Ok(output) => {
                self.session.persist_tool_memory(request, &output);
                self.push_agent_tool(
                    format_tool_ui_message(request, "manual", &output),
                    build_tool_result_block(request, "manual", None, &output),
                );
            }
            Err(err) => {
                self.push_agent_tool(
                    format!("工具执行失败: {}", err),
                    tool_failed_block(
                        openapi_tool_name(request),
                        None,
                        "工具执行失败",
                        &err.to_string(),
                    ),
                );
            }
        }
    }

    fn execute_tool_request_with_continuation(
        &mut self,
        request: &ToolRequest,
        continuation: Option<ToolApprovalContinuation>,
    ) {
        match continuation {
            Some(mut cont) => {
                let output = match self.tool_executor.execute(request) {
                    Ok(result) => {
                        self.session.persist_tool_memory(request, &result);
                        self.push_agent_tool(
                            format_tool_ui_message(request, &cont.tool_name, &result),
                            build_tool_result_block(
                                request,
                                &cont.tool_name,
                                Some(&cont.tool_call_id),
                                &result,
                            ),
                        );
                        result
                    }
                    Err(err) => {
                        let e = format!("[tool error] {}", err);
                        self.push_agent_tool(
                            format!("模型工具调用执行失败: {}", err),
                            tool_failed_block(
                                &cont.tool_name,
                                Some(&cont.tool_call_id),
                                "模型工具调用执行失败",
                                &err.to_string(),
                            ),
                        );
                        e
                    }
                };

                append_tool_result_message(&mut cont.state, &cont.tool_call_id, &output);
                self.start_tool_agent_step_async(cont.state);
            }
            None => self.execute_tool_request(request),
        }
    }

    fn try_auto_compact_and_retry(&mut self, err: &str) -> bool {
        if let Some(state) = self.try_auto_compact_and_build_retry_state(err) {
            self.start_tool_agent_step_async(state);
            return true;
        }
        false
    }

    fn try_auto_compact_and_build_retry_state(&mut self, err: &str) -> Option<ToolAgentState> {
        if !self.llm_transport.is_context_overflow_error(err) {
            return None;
        }

        let user_turn = self.session.pending_user_turn()?.to_string();

        match self
            .llm_transport
            .compact_history_manual(&self.config, self.session.llm_history_mut())
        {
            Ok(result) => {
                if result.dropped_messages == 0 {
                    self.push_agent_message(format!(
                        "检测到上下文超限，但历史已无法继续压缩。原始错误: {}",
                        err
                    ));
                    return None;
                }

                let summary_preview = self
                    .llm_transport
                    .compact_summary_text(self.session.llm_history())
                    .map(|s| truncate_for_preview(&s, 500))
                    .unwrap_or_else(|| "<无摘要内容>".to_string());
                self.push_agent_message(format!(
                    "检测到上下文超限，已自动压缩并重试：{} -> {}（压缩 {} 条）。\n\n压缩摘要预览:\n{}",
                    result.before_len,
                    result.after_len,
                    result.dropped_messages,
                    summary_preview
                ));

                Some(self.make_tool_agent_state(&user_turn))
            }
            Err(compact_err) => {
                self.push_agent_message(format!(
                    "上下文超限且自动压缩失败: {}\n原始错误: {}",
                    compact_err, err
                ));
                None
            }
        }
    }

    fn try_fallback_to_text_only_and_retry(&mut self, err: &str) -> bool {
        if let Some(state) = self.try_fallback_to_text_only_and_build_retry_state(err) {
            self.start_tool_agent_step_async(state);
            return true;
        }
        false
    }

    fn try_fallback_to_text_only_and_build_retry_state(
        &mut self,
        err: &str,
    ) -> Option<ToolAgentState> {
        if !is_vision_unsupported_error(err) {
            return None;
        }

        let mut dropped = 0usize;
        let mut user_turn = self.session.pending_user_turn().map(|s| s.to_string());

        if let Some(last_user) = self
            .session
            .llm_history_mut()
            .iter_mut()
            .rev()
            .find(|m| m.role == "user" && !m.image_paths.is_empty())
        {
            dropped = last_user.image_paths.len();
            if user_turn.is_none() {
                user_turn = Some(last_user.content.clone());
            }
            last_user.image_paths.clear();
        }

        if dropped == 0 {
            return None;
        }

        let turn = user_turn?;
        self.push_agent_message(format!(
            "当前模型/接口不支持图像输入，已自动降级为文本重试（忽略 {} 张图片）。",
            dropped
        ));

        Some(self.make_tool_agent_state(&turn))
    }

    fn push_agent_message<S: Into<String>>(&mut self, content: S) {
        self.events
            .push_back(RuntimeEvent::PushMessage(ChatMessage::new(
                MessageRole::Agent,
                content,
            )));
    }

    fn push_agent_tool(&mut self, content: String, block: ToolUiBlock) {
        self.events
            .push_back(RuntimeEvent::PushMessage(ChatMessage::with_tool_block(
                MessageRole::Agent,
                content,
                block,
            )));
    }
}

fn openapi_tool_name(request: &ToolRequest) -> &'static str {
    match request {
        ToolRequest::Shell { .. } => "run_shell_command",
        ToolRequest::ReadFile { .. } => "read_file",
        ToolRequest::Search { .. } => "search_files",
        ToolRequest::CreateFile { .. } => "create_file",
        ToolRequest::UpdateFile { .. } => "update_file",
        ToolRequest::DeleteFile { .. } => "delete_file",
    }
}

fn tool_request_args_excerpt(request: &ToolRequest) -> String {
    let v = match request {
        ToolRequest::Shell { command } => json!({ "command": command }),
        ToolRequest::ReadFile {
            path,
            start_line,
            end_line,
        } => json!({ "path": path, "start_line": start_line, "end_line": end_line }),
        ToolRequest::Search { query } => json!({ "query": query }),
        ToolRequest::CreateFile { path, content } => {
            json!({ "path": path, "content_chars": content.chars().count() })
        }
        ToolRequest::UpdateFile {
            path,
            old_text,
            new_text,
        } => json!({
            "path": path,
            "old_text_chars": old_text.chars().count(),
            "new_text_chars": new_text.chars().count(),
        }),
        ToolRequest::DeleteFile { path } => json!({ "path": path }),
    };
    serde_json::to_string_pretty(&v).unwrap_or_else(|_| "{}".to_string())
}

fn truncate_output_for_tool_ui(text: &str, max_chars: usize) -> String {
    truncate_for_preview(text, max_chars)
}

fn tool_approval_block(tool_name: &str, tool_call_id: Option<&str>, prompt: &str) -> ToolUiBlock {
    let detail_lines: Vec<String> = prompt.lines().map(|l| l.to_string()).collect();
    ToolUiBlock {
        tool_call_id: tool_call_id.map(String::from),
        tool_name: tool_name.to_string(),
        phase: ToolUiPhase::PendingApproval,
        headline: "待确认".to_string(),
        detail_lines,
        args_excerpt: None,
        output_excerpt: None,
    }
}

fn tool_failed_block(
    tool_name: &str,
    tool_call_id: Option<&str>,
    summary: &str,
    err: &str,
) -> ToolUiBlock {
    ToolUiBlock {
        tool_call_id: tool_call_id.map(String::from),
        tool_name: tool_name.to_string(),
        phase: ToolUiPhase::Failed,
        headline: summary.to_string(),
        detail_lines: Vec::new(),
        args_excerpt: None,
        output_excerpt: Some(truncate_output_for_tool_ui(err, 2000)),
    }
}

fn build_tool_result_block(
    request: &ToolRequest,
    tool_name: &str,
    tool_call_id: Option<&str>,
    output: &str,
) -> ToolUiBlock {
    let args_excerpt = tool_request_args_excerpt(request);
    match request {
        ToolRequest::ReadFile {
            path,
            start_line,
            end_line,
        } => {
            let start = start_line.unwrap_or(1);
            let end = end_line
                .map(|v| v.to_string())
                .unwrap_or_else(|| "default".to_string());
            ToolUiBlock {
                tool_call_id: tool_call_id.map(String::from),
                tool_name: tool_name.to_string(),
                phase: ToolUiPhase::Succeeded,
                headline: "已读取文件片段".to_string(),
                detail_lines: vec![
                    format!("路径: {}", path),
                    format!("行范围: {} - {}", start, end),
                ],
                args_excerpt: Some(args_excerpt),
                output_excerpt: None,
            }
        }
        ToolRequest::Search { query } => ToolUiBlock {
            tool_call_id: tool_call_id.map(String::from),
            tool_name: tool_name.to_string(),
            phase: ToolUiPhase::Succeeded,
            headline: "搜索完成".to_string(),
            detail_lines: vec![format!("查询: {}", query)],
            args_excerpt: Some(args_excerpt),
            output_excerpt: Some(truncate_output_for_tool_ui(output, 3600)),
        },
        ToolRequest::CreateFile { path, .. } => ToolUiBlock {
            tool_call_id: tool_call_id.map(String::from),
            tool_name: tool_name.to_string(),
            phase: ToolUiPhase::Succeeded,
            headline: "已创建文件".to_string(),
            detail_lines: vec![format!("路径: {}", path)],
            args_excerpt: Some(args_excerpt),
            output_excerpt: None,
        },
        ToolRequest::UpdateFile { path, .. } => ToolUiBlock {
            tool_call_id: tool_call_id.map(String::from),
            tool_name: tool_name.to_string(),
            phase: ToolUiPhase::Succeeded,
            headline: "已更新文件".to_string(),
            detail_lines: vec![format!("路径: {}", path)],
            args_excerpt: Some(args_excerpt),
            output_excerpt: None,
        },
        ToolRequest::DeleteFile { path } => ToolUiBlock {
            tool_call_id: tool_call_id.map(String::from),
            tool_name: tool_name.to_string(),
            phase: ToolUiPhase::Succeeded,
            headline: "已删除文件".to_string(),
            detail_lines: vec![format!("路径: {}", path)],
            args_excerpt: Some(args_excerpt),
            output_excerpt: None,
        },
        ToolRequest::Shell { command } => ToolUiBlock {
            tool_call_id: tool_call_id.map(String::from),
            tool_name: tool_name.to_string(),
            phase: ToolUiPhase::Succeeded,
            headline: "命令已执行".to_string(),
            detail_lines: vec![format!("命令: {}", command)],
            args_excerpt: Some(args_excerpt),
            output_excerpt: Some(truncate_output_for_tool_ui(output, 3600)),
        },
    }
}

fn format_tool_ui_message(request: &ToolRequest, tool_name: &str, output: &str) -> String {
    match request {
        ToolRequest::ReadFile {
            path,
            start_line,
            end_line,
        } => {
            let start = start_line.unwrap_or(1);
            let end = end_line
                .map(|v| v.to_string())
                .unwrap_or_else(|| "default".to_string());
            format!("[tool] 阅读文件 {} {} - {}", path, start, end)
        }
        ToolRequest::Search { .. } => output.to_string(),
        ToolRequest::CreateFile { path, .. } => format!("[tool] 已创建文件 {}", path),
        ToolRequest::UpdateFile { path, .. } => {
            format!("[tool] 已按精确片段替换更新文件 {}", path)
        }
        ToolRequest::DeleteFile { path } => format!("[tool] 已删除文件 {}", path),
        _ => format!(
            "[tool] {} 执行完成。\n{}",
            tool_name,
            truncate_for_preview(output, 1200)
        ),
    }
}

fn truncate_for_preview(text: &str, max_chars: usize) -> String {
    let chars = text.chars().collect::<Vec<_>>();
    if chars.len() <= max_chars {
        return text.to_string();
    }

    let mut out = chars.into_iter().take(max_chars).collect::<String>();
    out.push_str("...<预览已截断>");
    out
}

fn is_vision_unsupported_error(err: &str) -> bool {
    let e = err.to_ascii_lowercase();
    let mentions_image = e.contains("image")
        || e.contains("vision")
        || e.contains("multimodal")
        || e.contains("content[1]")
        || e.contains("image_url")
        || e.contains("invalid_image")
        || e.contains("base64");
    let mentions_unsupported = e.contains("not support")
        || e.contains("unsupported")
        || e.contains("invalid")
        || e.contains("unknown")
        || e.contains("not allowed")
        || e.contains("must be string")
        || e.contains("failed to process")
        || e.contains("cannot process")
        || e.contains("decode");

    mentions_image && mentions_unsupported
}
