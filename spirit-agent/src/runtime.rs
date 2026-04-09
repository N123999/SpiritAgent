use anyhow::{Result, anyhow};
use std::{
    collections::VecDeque,
    fs,
    path::PathBuf,
    sync::{
        Arc,
        mpsc::{self, Receiver, TryRecvError},
    },
    thread,
    time::{Duration, Instant},
};

use serde_json::{Value, json};

use crate::{
    llm_client::{
        CompactResult, LlmMessage, StreamEvent, ToolAgentState, ToolAgentStep,
        append_tool_result_message,
    },
    mcp::McpServerConfig,
    mcp_manager::{
        ManagedMcpServer, McpDiscoveredPrompt, McpDiscoveredResource, McpDiscoveredTool,
        McpManager, McpServerInspection,
    },
    model_registry::AppConfig,
    ports::{
        LlmTransport, McpStatusSnapshot, StartedToolAgentRound, ToolAgentRoundResult, ToolExecutor,
    },
    shell::file_reference,
    session::{PendingMcpResource, PendingWorkspaceFile, SessionModel},
    tool_runtime::{AuthorizationDecision, ToolRequest, ToolRuntime, TrustTarget},
    view::{
        AssistantAuxKind, ChatMessage, MessageRole, PendingAssistantAux, ToolUiBlock, ToolUiPhase,
    },
};

const STREAM_EVENT_BUDGET_PER_TICK: usize = 128;
const STREAM_STALL_TIMEOUT: Duration = Duration::from_secs(20);
const TOOL_OUTPUT_RETRY_MAX_CHARS: usize = 12_000;
const TOOL_MEMORY_RETRY_MAX_CHARS: usize = 4_000;
const TOOL_TRUNCATION_HEAD_RATIO_NUM: usize = 2;
const TOOL_TRUNCATION_HEAD_RATIO_DEN: usize = 3;
const TOOL_MEMORY_PREFIX: &str = "[TOOL_MEMORY]";
const PENDING_WORKSPACE_FILE_MAX_CHARS: usize = 24_000;

pub enum RuntimeEvent {
    PushMessage(ChatMessage),
    BeginAssistantResponse,
    UpdatePendingAssistantThinking(String),
    UpdatePendingAssistantCompaction(String),
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

struct CompletedHistoryCompaction {
    result: CompactResult,
    compacted_history: Vec<LlmMessage>,
    summary_preview: String,
}

enum HistoryCompactionContinuation {
    Manual,
    AutoRetry {
        retry_state: ToolAgentState,
        tool_truncation_applied: bool,
        user_turn: String,
        original_error: String,
    },
}

struct PendingHistoryCompaction {
    progress_rx: Receiver<String>,
    result_rx: Receiver<anyhow::Result<CompletedHistoryCompaction>>,
    continuation: HistoryCompactionContinuation,
}

struct PendingBackgroundToolExecution {
    request: ToolRequest,
    ui_tool_name: String,
    continuation: Option<ToolApprovalContinuation>,
    result_rx: Receiver<anyhow::Result<String>>,
}

pub struct AgentRuntime {
    session: SessionModel,
    config: AppConfig,
    llm_transport: Arc<dyn LlmTransport>,
    tool_executor: Box<dyn ToolExecutor>,
    workspace_root: PathBuf,
    pending_response: Option<Receiver<StreamEvent>>,
    pending_tool_agent_step: Option<Receiver<anyhow::Result<ToolAgentRoundResult>>>,
    pending_tool_agent_state: Option<ToolAgentState>,
    pending_history_compaction: Option<PendingHistoryCompaction>,
    pending_background_tool_execution: Option<PendingBackgroundToolExecution>,
    pending_background_tool_status: Option<String>,
    reuse_pending_assistant_on_next_round: bool,
    pending_started_at: Option<Instant>,
    pending_last_event_at: Option<Instant>,
    stream_chunk_counter: usize,
    pending_assistant_text: String,
    pending_tool_approval: Option<PendingToolApproval>,
    thinking_spinner_index: usize,
    thinking_text: String,
    compaction_text: String,
    events: VecDeque<RuntimeEvent>,
}

impl AgentRuntime {
    pub fn new(
        config: AppConfig,
        llm_transport: Arc<dyn LlmTransport>,
        tool_executor: Box<dyn ToolExecutor>,
        workspace_root: PathBuf,
    ) -> Self {
        tool_executor.start_mcp_background_refresh();

        Self {
            session: SessionModel::new(),
            config,
            llm_transport,
            tool_executor,
            workspace_root,
            pending_response: None,
            pending_tool_agent_step: None,
            pending_tool_agent_state: None,
            pending_history_compaction: None,
            pending_background_tool_execution: None,
            pending_background_tool_status: None,
            reuse_pending_assistant_on_next_round: false,
            pending_started_at: None,
            pending_last_event_at: None,
            stream_chunk_counter: 0,
            pending_assistant_text: String::new(),
            pending_tool_approval: None,
            thinking_spinner_index: 0,
            thinking_text: String::new(),
            compaction_text: String::new(),
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

    pub fn mcp_status_snapshot(&self) -> McpStatusSnapshot {
        self.tool_executor.mcp_status_snapshot()
    }

    pub fn has_pending_tool_approval(&self) -> bool {
        self.pending_tool_approval.is_some()
    }

    pub fn is_busy(&self) -> bool {
        self.pending_response.is_some()
            || self.pending_tool_agent_step.is_some()
            || self.pending_history_compaction.is_some()
            || self.pending_background_tool_execution.is_some()
    }

    pub fn drain_events(&mut self) -> Vec<RuntimeEvent> {
        self.events.drain(..).collect()
    }

    pub fn pending_aux_state(&self) -> Option<PendingAssistantAux> {
        let kind = self.current_aux_kind()?;
        let frame = match self.thinking_spinner_index % 4 {
            0 => '|',
            1 => '/',
            2 => '-',
            _ => '\\',
        };
        let status_text = match kind {
            AssistantAuxKind::Thinking => format!("{} Thinking...", frame),
            AssistantAuxKind::Compressing => format!("{} Compressing...", frame),
        };
        let detail_text = self.current_aux_text().map(ToString::to_string);

        Some(PendingAssistantAux {
            kind,
            status_text,
            detail_text,
        })
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
        self.poll_pending_history_compaction();
        self.poll_pending_background_tool_execution();
    }

    pub fn handle_stream_stall_timeout(&mut self) {
        if self.pending_response.is_none() {
            return;
        }

        // Tool-agent rounds may legitimately stream no text for a while and only
        // yield a tool call decision at the end. Do not surface a fake text-stream timeout.
        if self.pending_tool_agent_step.is_some() {
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
        self.compaction_text.clear();
        self.pending_tool_agent_state = None;
        self.reuse_pending_assistant_on_next_round = false;
        self.events
            .push_back(RuntimeEvent::AssistantResponseCompleted);
    }

    pub fn submit_user_turn(&mut self, text: String, explicit_images: Option<Vec<String>>) {
        let images = explicit_images.unwrap_or_else(|| self.session.take_pending_images());
        let files = pending_workspace_files_from_input(&self.workspace_root, &text);
        let resources = self.session.take_pending_mcp_resources();
        for file in files {
            self.session
                .record_context_message("system", format_pending_workspace_file_context(&file));
        }
        for resource in resources {
            self.session
                .record_context_message("system", format_pending_mcp_resource_context(&resource));
        }
        self.session.set_pending_user_turn(text.clone());
        self.session.record_user_turn(text.clone(), images);
        let state = self.make_tool_agent_state(&text);
        self.start_tool_agent_step_async(state);
    }

    pub fn list_mcp_servers(&self) -> Result<Vec<ManagedMcpServer>> {
        self.tool_executor.list_mcp_servers()
    }

    pub fn inspect_mcp_server(&self, name: &str) -> Result<McpServerInspection> {
        self.tool_executor.inspect_mcp_server(name)
    }

    pub fn list_mcp_tools(&self, name: &str) -> Result<Vec<McpDiscoveredTool>> {
        self.tool_executor.list_mcp_tools(name)
    }

    pub fn list_mcp_resources(&self, name: &str) -> Result<Vec<McpDiscoveredResource>> {
        self.tool_executor.list_mcp_resources(name)
    }

    pub fn list_mcp_prompts(&self, name: &str) -> Result<Vec<McpDiscoveredPrompt>> {
        self.tool_executor.list_mcp_prompts(name)
    }

    pub fn attach_mcp_resource(&mut self, server: &str, uri: &str) -> Result<String> {
        let value = self.tool_executor.read_mcp_resource(server, uri)?;
        let display_name = self.resolve_mcp_display_name(server)?;
        let resource = pending_mcp_resource_from_read_result(server, &display_name, uri, &value)?;
        let label = resource.short_label();
        self.session.add_pending_mcp_resource(resource);
        Ok(label)
    }

    pub fn clear_pending_mcp_resources(&mut self) -> usize {
        self.session.clear_pending_mcp_resources()
    }

    pub fn apply_mcp_prompt(
        &mut self,
        server: &str,
        prompt: &str,
        args_json: Option<&str>,
    ) -> Result<String> {
        if self.is_busy() {
            return Err(anyhow!("上一条回复仍在处理中，请稍候。"));
        }
        if self.has_pending_tool_approval() {
            return Err(anyhow!("请先响应当前待确认的工具调用。"));
        }

        let value = self
            .tool_executor
            .get_mcp_prompt(server, prompt, args_json)?;
        let prompt_messages = prompt_messages_from_value(&value)?;
        if prompt_messages.is_empty() {
            return Err(anyhow!("MCP prompt 未返回可用 messages"));
        }

        let user_turn = prompt_messages
            .iter()
            .rev()
            .find(|message| message.role == "user" && !message.content.trim().is_empty())
            .map(|message| message.content.clone())
            .unwrap_or_else(|| format!("请根据已应用的 MCP prompt `{}` 继续。", prompt));

        self.session
            .llm_history_mut()
            .extend(prompt_messages.clone());
        self.session.set_pending_user_turn(user_turn.clone());
        let state = self.make_tool_agent_state(&user_turn);
        self.start_tool_agent_step_async(state);

        Ok(format!(
            "已应用 MCP prompt: {} / {}（{} 条消息）",
            server,
            prompt,
            prompt_messages.len()
        ))
    }

    pub fn add_mcp_server(&mut self, name: &str, config: McpServerConfig) -> Result<PathBuf> {
        let path = self.tool_executor.add_mcp_server(name, config)?;
        self.tool_executor.start_mcp_background_refresh();
        Ok(path)
    }

    pub fn execute_mcp_tool(
        &mut self,
        server: &str,
        tool_name: &str,
        args_json: Option<&str>,
    ) -> Result<()> {
        let arguments = parse_optional_json_value(args_json)?;
        let request = ToolRequest::McpTool {
            server: server.to_string(),
            display_name: self.resolve_mcp_display_name(server)?,
            tool_name: tool_name.to_string(),
            arguments,
        };

        match self.tool_executor.authorize(&request)? {
            AuthorizationDecision::Allowed => {
                self.execute_tool_request(&request);
                Ok(())
            }
            AuthorizationDecision::NeedApproval {
                prompt,
                trust_target,
            } => {
                self.pending_tool_approval = Some(PendingToolApproval {
                    request,
                    trust_target,
                    continuation: None,
                });
                self.push_agent_tool(
                    prompt.clone(),
                    tool_approval_block(tool_name, None, &prompt),
                );
                Ok(())
            }
        }
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
        if self.is_busy() {
            self.push_agent_message("当前已有压缩任务在后台进行，请稍候。");
            return;
        }

        self.compaction_text.clear();
        self.events.push_back(RuntimeEvent::BeginAssistantResponse);
        self.start_history_compaction(HistoryCompactionContinuation::Manual);
    }

    pub fn replace_session_from_archive(&mut self, archive: &crate::ports::ChatArchive) {
        self.session.replace_from_archive(archive);
        self.pending_tool_approval = None;
        self.pending_response = None;
        self.pending_tool_agent_step = None;
        self.pending_tool_agent_state = None;
        self.pending_history_compaction = None;
        self.pending_background_tool_execution = None;
        self.pending_background_tool_status = None;
        self.reuse_pending_assistant_on_next_round = false;
        self.pending_started_at = None;
        self.pending_last_event_at = None;
        self.stream_chunk_counter = 0;
        self.pending_assistant_text.clear();
        self.thinking_text.clear();
        self.compaction_text.clear();
    }

    fn resolve_mcp_display_name(&self, server: &str) -> Result<String> {
        self.tool_executor
            .list_mcp_servers()?
            .into_iter()
            .find(|item| item.name == server)
            .map(|item| item.display_name)
            .ok_or_else(|| anyhow!("未知 MCP server: {}", server))
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
        self.compaction_text.clear();
        self.pending_assistant_text.clear();
        self.pending_tool_agent_state = Some(state.clone());
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
                if self.reuse_pending_assistant_on_next_round {
                    self.reuse_pending_assistant_on_next_round = false;
                } else {
                    self.events.push_back(RuntimeEvent::BeginAssistantResponse);
                }
            }
            Err(err) => {
                self.pending_tool_agent_state = None;
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
                self.pending_tool_agent_state = None;
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
                                if should_execute_tool_in_background(&request) {
                                    self.start_background_tool_execution(
                                        request,
                                        Some(ToolApprovalContinuation {
                                            state,
                                            tool_call_id: call.id,
                                            tool_name: call.name.clone(),
                                        }),
                                        call.name,
                                    );
                                    return;
                                }

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
                self.pending_tool_agent_state = None;
                self.push_agent_message(format!("LLM 调用失败: {}", err));
            }
            Err(TryRecvError::Empty) => {
                self.pending_tool_agent_step = Some(rx);
            }
            Err(TryRecvError::Disconnected) => {
                self.pending_tool_agent_state = None;
                self.push_agent_message("LLM 后台任务异常中断。");
            }
        }
    }

    fn poll_pending_history_compaction(&mut self) {
        let Some(pending) = self.pending_history_compaction.take() else {
            return;
        };

        loop {
            match pending.progress_rx.try_recv() {
                Ok(chunk) => {
                    self.compaction_text.push_str(&chunk);
                    self.events
                        .push_back(RuntimeEvent::UpdatePendingAssistantCompaction(
                            self.compaction_text.clone(),
                        ));
                }
                Err(TryRecvError::Empty) => break,
                Err(TryRecvError::Disconnected) => break,
            }
        }

        match pending.result_rx.try_recv() {
            Ok(Ok(compacted)) => {
                *self.session.llm_history_mut() = compacted.compacted_history;
                if self.compaction_text.trim().is_empty()
                    && !compacted.summary_preview.trim().is_empty()
                {
                    self.compaction_text = compacted.summary_preview.clone();
                    self.events
                        .push_back(RuntimeEvent::UpdatePendingAssistantCompaction(
                            self.compaction_text.clone(),
                        ));
                }
                match pending.continuation {
                    HistoryCompactionContinuation::Manual => {
                        if compacted.result.dropped_messages == 0 {
                            self.events.push_back(RuntimeEvent::ReplacePendingAssistant(
                                "当前可压缩历史较少，已跳过压缩。".to_string(),
                            ));
                        } else {
                            self.events
                                .push_back(RuntimeEvent::ReplacePendingAssistant(format!(
                                    "压缩完成：上下文消息 {} -> {}，已合并 {} 条历史消息。",
                                    compacted.result.before_len,
                                    compacted.result.after_len,
                                    compacted.result.dropped_messages,
                                )));
                        }
                        self.events
                            .push_back(RuntimeEvent::AssistantResponseCompleted);
                        self.compaction_text.clear();
                    }
                    HistoryCompactionContinuation::AutoRetry {
                        retry_state,
                        tool_truncation_applied,
                        user_turn,
                        original_error,
                    } => {
                        if compacted.result.dropped_messages == 0 && !tool_truncation_applied {
                            self.events
                                .push_back(RuntimeEvent::ReplacePendingAssistant(format!(
                                    "检测到上下文超限，但历史已无法继续压缩。原始错误: {}",
                                    original_error
                                )));
                            self.events
                                .push_back(RuntimeEvent::AssistantResponseCompleted);
                            self.compaction_text.clear();
                            self.reuse_pending_assistant_on_next_round = false;
                            self.pending_tool_agent_state = None;
                        } else {
                            self.reuse_pending_assistant_on_next_round = true;
                            let next_state = if compacted.result.dropped_messages == 0 {
                                retry_state
                            } else {
                                self.rebuild_retry_state_after_compaction(&user_turn, retry_state)
                            };
                            self.start_tool_agent_step_async(next_state);
                        }
                    }
                }
            }
            Ok(Err(err)) => match pending.continuation {
                HistoryCompactionContinuation::Manual => {
                    self.events
                        .push_back(RuntimeEvent::ReplacePendingAssistant(format!(
                            "压缩失败: {}",
                            err
                        )));
                    self.events
                        .push_back(RuntimeEvent::AssistantResponseCompleted);
                    self.compaction_text.clear();
                }
                HistoryCompactionContinuation::AutoRetry { original_error, .. } => {
                    self.events
                        .push_back(RuntimeEvent::ReplacePendingAssistant(format!(
                            "上下文超限且自动压缩失败: {}\n原始错误: {}",
                            err, original_error
                        )));
                    self.events
                        .push_back(RuntimeEvent::AssistantResponseCompleted);
                    self.compaction_text.clear();
                    self.reuse_pending_assistant_on_next_round = false;
                    self.pending_tool_agent_state = None;
                }
            },
            Err(TryRecvError::Empty) => {
                self.pending_history_compaction = Some(pending);
            }
            Err(TryRecvError::Disconnected) => match pending.continuation {
                HistoryCompactionContinuation::Manual => {
                    self.events.push_back(RuntimeEvent::ReplacePendingAssistant(
                        "压缩后台任务异常中断。".to_string(),
                    ));
                    self.events
                        .push_back(RuntimeEvent::AssistantResponseCompleted);
                    self.compaction_text.clear();
                }
                HistoryCompactionContinuation::AutoRetry { original_error, .. } => {
                    self.events
                        .push_back(RuntimeEvent::ReplacePendingAssistant(format!(
                            "上下文超限且自动压缩任务异常中断。原始错误: {}",
                            original_error
                        )));
                    self.events
                        .push_back(RuntimeEvent::AssistantResponseCompleted);
                    self.compaction_text.clear();
                    self.reuse_pending_assistant_on_next_round = false;
                    self.pending_tool_agent_state = None;
                }
            },
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
                    self.events
                        .push_back(RuntimeEvent::UpdatePendingAssistantThinking(
                            self.thinking_text.clone(),
                        ));
                    processed += 1;
                }
                Ok(StreamEvent::ToolProgress(progress)) => {
                    self.pending_last_event_at = Some(Instant::now());
                    self.merge_tool_progress_into_thinking(&progress);
                    self.events
                        .push_back(RuntimeEvent::UpdatePendingAssistantThinking(
                            self.thinking_text.clone(),
                        ));
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

                    if self.try_auto_compact_and_retry(&err) {
                        if !self.pending_assistant_text.trim().is_empty() {
                            self.events
                                .push_back(RuntimeEvent::ReplacePendingAssistant(String::new()));
                        }
                        completed = true;
                        self.thinking_text.clear();
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
        if should_execute_tool_in_background(request) {
            self.start_background_tool_execution(request.clone(), None, "manual".to_string());
            return;
        }

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

    fn start_background_tool_execution(
        &mut self,
        request: ToolRequest,
        continuation: Option<ToolApprovalContinuation>,
        ui_tool_name: String,
    ) {
        let workspace_root = self.workspace_root.clone();
        let request_for_worker = request.clone();
        let (result_tx, result_rx) = mpsc::channel::<anyhow::Result<String>>();

        thread::spawn(move || {
            let outcome = execute_background_tool_request_sync(&workspace_root, &request_for_worker);
            let _ = result_tx.send(outcome);
        });

        self.pending_background_tool_status = background_tool_status_text(&request);
        self.pending_background_tool_execution = Some(PendingBackgroundToolExecution {
            request,
            ui_tool_name,
            continuation,
            result_rx,
        });
    }

    fn poll_pending_background_tool_execution(&mut self) {
        let Some(pending) = self.pending_background_tool_execution.take() else {
            return;
        };

        let PendingBackgroundToolExecution {
            request,
            ui_tool_name,
            continuation,
            result_rx,
        } = pending;

        match result_rx.try_recv() {
            Ok(Ok(output)) => {
                self.pending_background_tool_status = None;
                self.session.persist_tool_memory(&request, &output);
                match continuation {
                    Some(mut cont) => {
                        self.push_agent_tool(
                            format_tool_ui_message(&request, &cont.tool_name, &output),
                            build_tool_result_block(
                                &request,
                                &cont.tool_name,
                                Some(&cont.tool_call_id),
                                &output,
                            ),
                        );
                        append_tool_result_message(&mut cont.state, &cont.tool_call_id, &output);
                        self.start_tool_agent_step_async(cont.state);
                    }
                    None => {
                        self.push_agent_tool(
                            format_tool_ui_message(&request, &ui_tool_name, &output),
                            build_tool_result_block(&request, &ui_tool_name, None, &output),
                        );
                    }
                }
            }
            Ok(Err(err)) => match continuation {
                Some(mut cont) => {
                    self.pending_background_tool_status = None;
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
                    append_tool_result_message(&mut cont.state, &cont.tool_call_id, &e);
                    self.start_tool_agent_step_async(cont.state);
                }
                None => {
                    self.pending_background_tool_status = None;
                    self.push_agent_tool(
                        format!("工具执行失败: {}", err),
                        tool_failed_block(&ui_tool_name, None, "工具执行失败", &err.to_string()),
                    );
                }
            },
            Err(TryRecvError::Empty) => {
                self.pending_background_tool_execution = Some(PendingBackgroundToolExecution {
                    request,
                    ui_tool_name,
                    continuation,
                    result_rx,
                });
            }
            Err(TryRecvError::Disconnected) => match continuation {
                Some(mut cont) => {
                    self.pending_background_tool_status = None;
                    let e = "[tool error] 后台工具任务异常中断。".to_string();
                    self.push_agent_tool(
                        "模型工具调用执行失败: 后台工具任务异常中断。".to_string(),
                        tool_failed_block(
                            &cont.tool_name,
                            Some(&cont.tool_call_id),
                            "模型工具调用执行失败",
                            "后台工具任务异常中断。",
                        ),
                    );
                    append_tool_result_message(&mut cont.state, &cont.tool_call_id, &e);
                    self.start_tool_agent_step_async(cont.state);
                }
                None => {
                    self.pending_background_tool_status = None;
                    self.push_agent_tool(
                        "工具执行失败: 后台工具任务异常中断。".to_string(),
                        tool_failed_block(
                            &ui_tool_name,
                            None,
                            "工具执行失败",
                            "后台工具任务异常中断。",
                        ),
                    );
                }
            },
        }
    }

    fn merge_tool_progress_into_thinking(&mut self, progress: &str) {
        let progress = progress.trim();
        if progress.is_empty() {
            return;
        }

        if self.thinking_text.trim().is_empty() {
            self.thinking_text = progress.to_string();
            return;
        }

        if self
            .thinking_text
            .lines()
            .any(|line| line.trim() == progress)
        {
            return;
        }

        if !self.thinking_text.ends_with('\n') {
            self.thinking_text.push('\n');
        }
        self.thinking_text.push_str(progress);
    }

    fn execute_tool_request_with_continuation(
        &mut self,
        request: &ToolRequest,
        continuation: Option<ToolApprovalContinuation>,
    ) {
        match continuation {
            Some(cont) => {
                if should_execute_tool_in_background(request) {
                    let ui_tool_name = cont.tool_name.clone();
                    self.start_background_tool_execution(request.clone(), Some(cont), ui_tool_name);
                    return;
                }

                let mut cont = cont;
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
        if !self.llm_transport.is_context_overflow_error(err) {
            return false;
        }

        let Some(user_turn) = self.session.pending_user_turn().map(|s| s.to_string()) else {
            return false;
        };

        if self.pending_history_compaction.is_some() {
            return true;
        }

        let mut retry_state = self
            .pending_tool_agent_state
            .clone()
            .unwrap_or_else(|| self.make_tool_agent_state(&user_turn));
        let tool_truncation_applied = truncate_tool_messages_for_retry(&mut retry_state);

        self.start_history_compaction(HistoryCompactionContinuation::AutoRetry {
            retry_state,
            tool_truncation_applied,
            user_turn,
            original_error: err.to_string(),
        });
        true
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

    fn start_history_compaction(&mut self, continuation: HistoryCompactionContinuation) {
        let llm_transport = Arc::clone(&self.llm_transport);
        let config = self.config.clone();
        let mut history = self.session.llm_history().to_vec();
        self.compaction_text.clear();
        let (progress_tx, progress_rx) = mpsc::channel::<String>();
        let (result_tx, result_rx) = mpsc::channel::<anyhow::Result<CompletedHistoryCompaction>>();

        thread::spawn(move || {
            truncate_tool_memories_for_retry(&mut history);
            let outcome = llm_transport
                .compact_history_manual(&config, &mut history, Some(&progress_tx))
                .map(|result| CompletedHistoryCompaction {
                    result,
                    summary_preview: llm_transport
                        .compact_summary_text(&history)
                        .unwrap_or_else(|| "<无摘要内容>".to_string()),
                    compacted_history: history,
                });
            let _ = result_tx.send(outcome);
        });

        self.pending_history_compaction = Some(PendingHistoryCompaction {
            progress_rx,
            result_rx,
            continuation,
        });
        self.thinking_spinner_index = 0;
    }

    fn rebuild_retry_state_after_compaction(
        &self,
        user_turn: &str,
        retry_state: ToolAgentState,
    ) -> ToolAgentState {
        let mut rebuilt = self.make_tool_agent_state(user_turn);
        rebuilt.steps = retry_state.steps;

        if let Some(user_index) = retry_state.messages.iter().rposition(|message| {
            message.get("role").and_then(Value::as_str) == Some("user")
                && message.get("content").and_then(Value::as_str) == Some(user_turn)
        }) {
            rebuilt
                .messages
                .extend(retry_state.messages.into_iter().skip(user_index + 1));
            return rebuilt;
        }

        retry_state
    }

    fn current_aux_kind(&self) -> Option<AssistantAuxKind> {
        if self.pending_history_compaction.is_some() {
            return Some(AssistantAuxKind::Compressing);
        }
        if self.pending_response.is_some()
            || self.pending_tool_agent_step.is_some()
            || self.pending_background_tool_execution.is_some()
        {
            return Some(AssistantAuxKind::Thinking);
        }
        None
    }

    fn current_aux_text(&self) -> Option<&str> {
        if let Some(status) = self
            .pending_background_tool_status
            .as_deref()
            .filter(|status| !status.trim().is_empty())
        {
            return Some(status);
        }

        match self.current_aux_kind()? {
            AssistantAuxKind::Thinking if !self.thinking_text.trim().is_empty() => {
                Some(self.thinking_text.as_str())
            }
            AssistantAuxKind::Compressing if !self.compaction_text.trim().is_empty() => {
                Some(self.compaction_text.as_str())
            }
            _ => None,
        }
    }
}

fn execute_mcp_tool_request_sync(
    workspace_root: &PathBuf,
    request: &ToolRequest,
) -> Result<String> {
    let ToolRequest::McpTool {
        server,
        tool_name,
        arguments,
        ..
    } = request
    else {
        return Err(anyhow!("后台 MCP 工具执行收到非 MCP 请求"));
    };

    let arguments = match arguments {
        Value::Object(map) => Some(map.clone()),
        Value::Null => None,
        _ => return Err(anyhow!("MCP 工具参数必须是 JSON object")),
    };
    let value =
        McpManager::load(workspace_root.clone())?.call_tool(server, tool_name, arguments)?;
    Ok(serde_json::to_string_pretty(&value)?)
}

fn should_execute_tool_in_background(request: &ToolRequest) -> bool {
    matches!(request, ToolRequest::McpTool { .. } | ToolRequest::Search { .. })
}

fn background_tool_status_text(request: &ToolRequest) -> Option<String> {
    match request {
        ToolRequest::Search { query } => Some(format!("搜索中: {}", query)),
        ToolRequest::McpTool {
            display_name,
            tool_name,
            ..
        } => Some(format!("MCP 工具执行中: {} / {}", display_name, tool_name)),
        _ => None,
    }
}

fn execute_background_tool_request_sync(
    workspace_root: &PathBuf,
    request: &ToolRequest,
) -> Result<String> {
    match request {
        ToolRequest::McpTool { .. } => execute_mcp_tool_request_sync(workspace_root, request),
        ToolRequest::Search { .. } => ToolRuntime::new_for_workspace(workspace_root.clone()).execute(request),
        _ => Err(anyhow!("后台工具执行收到不支持的请求")),
    }
}

fn truncate_tool_messages_for_retry(state: &mut ToolAgentState) -> bool {
    let mut changed = false;

    for message in &mut state.messages {
        let role = message.get("role").and_then(Value::as_str);
        let Some(content) = message.get("content").and_then(Value::as_str) else {
            continue;
        };

        let replacement = match role {
            Some("tool") => build_context_retry_excerpt(
                content,
                TOOL_OUTPUT_RETRY_MAX_CHARS,
                "[tool output truncated for context retry]",
            ),
            Some("system") if content.starts_with(TOOL_MEMORY_PREFIX) => {
                build_context_retry_excerpt(
                    content,
                    TOOL_MEMORY_RETRY_MAX_CHARS,
                    "[tool memory truncated for context retry]",
                )
            }
            _ => None,
        };

        if let Some(new_content) = replacement {
            if let Some(obj) = message.as_object_mut() {
                obj.insert("content".to_string(), Value::String(new_content));
                changed = true;
            }
        }
    }

    changed
}

fn truncate_tool_memories_for_retry(history: &mut [LlmMessage]) -> bool {
    let mut changed = false;

    for message in history.iter_mut() {
        if message.role == "system" && message.content.starts_with(TOOL_MEMORY_PREFIX) {
            if let Some(new_content) = build_context_retry_excerpt(
                &message.content,
                TOOL_MEMORY_RETRY_MAX_CHARS,
                "[tool memory truncated for context retry]",
            ) {
                message.content = new_content;
                changed = true;
            }
        }
    }

    changed
}

fn build_context_retry_excerpt(text: &str, max_chars: usize, label: &str) -> Option<String> {
    let total_chars = text.chars().count();
    if total_chars <= max_chars {
        return None;
    }

    let total_lines = text.lines().count();
    let overhead = label.chars().count() + 160;
    let usable = max_chars.saturating_sub(overhead).max(256);
    let head_chars = usable * TOOL_TRUNCATION_HEAD_RATIO_NUM / TOOL_TRUNCATION_HEAD_RATIO_DEN;
    let tail_chars = usable.saturating_sub(head_chars);
    let head = take_first_chars(text, head_chars);
    let tail = take_last_chars(text, tail_chars);
    let omitted_chars = total_chars.saturating_sub(head.chars().count() + tail.chars().count());

    Some(format!(
        "{label}\noriginal_chars: {total_chars}\noriginal_lines: {total_lines}\nkept_head_chars: {}\nkept_tail_chars: {}\n\n<head>\n{}\n\n<omitted {} chars>\n\n<tail>\n{}",
        head.chars().count(),
        tail.chars().count(),
        head,
        omitted_chars,
        tail,
    ))
}

fn take_first_chars(text: &str, max_chars: usize) -> String {
    text.chars().take(max_chars).collect()
}

fn take_last_chars(text: &str, max_chars: usize) -> String {
    let total_chars = text.chars().count();
    if total_chars <= max_chars {
        return text.to_string();
    }
    text.chars().skip(total_chars - max_chars).collect()
}

fn openapi_tool_name(request: &ToolRequest) -> &'static str {
    match request {
        ToolRequest::Shell { .. } => "run_shell_command",
        ToolRequest::McpTool { .. } => "mcp_tool",
        ToolRequest::WebFetch { .. } => "web_fetch",
        ToolRequest::ListDirectory { .. } => "list_directory_files",
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
        ToolRequest::McpTool {
            server,
            display_name,
            tool_name,
            arguments,
        } => json!({
            "server": server,
            "display_name": display_name,
            "tool_name": tool_name,
            "arguments": arguments,
        }),
        ToolRequest::WebFetch { url } => json!({ "url": url }),
        ToolRequest::ListDirectory { path } => json!({ "path": path }),
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
        ToolRequest::McpTool {
            server,
            display_name,
            tool_name: actual_tool_name,
            ..
        } => ToolUiBlock {
            tool_call_id: tool_call_id.map(String::from),
            tool_name: tool_name.to_string(),
            phase: ToolUiPhase::Succeeded,
            headline: "MCP 工具调用完成".to_string(),
            detail_lines: vec![
                format!("Server: {} ({})", display_name, server),
                format!("Tool: {}", actual_tool_name),
            ],
            args_excerpt: Some(args_excerpt),
            output_excerpt: Some(truncate_output_for_tool_ui(output, 3600)),
        },
        ToolRequest::WebFetch { url } => ToolUiBlock {
            tool_call_id: tool_call_id.map(String::from),
            tool_name: tool_name.to_string(),
            phase: ToolUiPhase::Succeeded,
            headline: "网页内容已抓取".to_string(),
            detail_lines: vec![format!("URL: {}", url)],
            args_excerpt: Some(args_excerpt),
            output_excerpt: Some(truncate_output_for_tool_ui(output, 3600)),
        },
        ToolRequest::ListDirectory { path } => ToolUiBlock {
            tool_call_id: tool_call_id.map(String::from),
            tool_name: tool_name.to_string(),
            phase: ToolUiPhase::Succeeded,
            headline: "目录文件已列出".to_string(),
            detail_lines: vec![format!("路径: {}", path)],
            args_excerpt: Some(args_excerpt),
            output_excerpt: Some(truncate_output_for_tool_ui(output, 3600)),
        },
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
        ToolRequest::McpTool {
            server,
            display_name,
            tool_name: actual_tool_name,
            ..
        } => format!(
            "[tool] MCP {} ({}) / {} 执行完成。\n{}",
            display_name,
            server,
            actual_tool_name,
            truncate_for_preview(output, 1200)
        ),
        ToolRequest::WebFetch { url } => format!("[tool] 已抓取网页 {}", url),
        ToolRequest::ListDirectory { path } => format!("[tool] 已列出目录下文件 {}", path),
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

fn parse_optional_json_value(input: Option<&str>) -> Result<Value> {
    let Some(raw) = input.map(str::trim).filter(|raw| !raw.is_empty()) else {
        return Ok(Value::Object(serde_json::Map::new()));
    };
    let value: Value =
        serde_json::from_str(raw).map_err(|err| anyhow!("JSON 解析失败: {} ({})", raw, err))?;
    Ok(value)
}

fn format_pending_mcp_resource_context(resource: &PendingMcpResource) -> String {
    let mime_type = resource
        .mime_type
        .as_deref()
        .unwrap_or("application/octet-stream");
    format!(
        "[MCP_RESOURCE]\nserver: {}\ndisplay_name: {}\nuri: {}\nmime_type: {}\nread_at_unix_ms: {}\n\n{}",
        resource.server,
        resource.display_name,
        resource.uri,
        mime_type,
        resource.read_at_unix_ms,
        resource.content
    )
}

fn format_pending_workspace_file_context(file: &PendingWorkspaceFile) -> String {
    format!(
        "[WORKSPACE_FILE]\npath: {}\nattached_at_unix_ms: {}\nchars: {}\ntruncated: {}\n\n{}",
        file.path,
        file.attached_at_unix_ms,
        file.total_chars,
        file.truncated,
        file.content
    )
}

fn pending_workspace_files_from_input(
    workspace_root: &PathBuf,
    text: &str,
) -> Vec<PendingWorkspaceFile> {
    file_reference::referenced_paths(text)
        .into_iter()
        .filter_map(|path| pending_workspace_file_from_path(workspace_root, &path).ok())
        .collect()
}

fn pending_workspace_file_from_path(
    workspace_root: &PathBuf,
    path: &str,
) -> Result<PendingWorkspaceFile> {
    let target = workspace_root.join(path);
    let metadata = fs::metadata(&target)
        .map_err(|err| anyhow!("读取文件元信息失败: {} ({})", target.display(), err))?;
    if !metadata.is_file() {
        return Err(anyhow!("不是可引用的文件: {}", target.display()));
    }

    let bytes = fs::read(&target)
        .map_err(|err| anyhow!("读取文件失败: {} ({})", target.display(), err))?;
    if bytes.contains(&0) {
        return Err(anyhow!("暂不支持引用二进制文件: {}", path));
    }

    let text = String::from_utf8_lossy(&bytes).to_string();
    let total_chars = text.chars().count();
    let truncated = total_chars > PENDING_WORKSPACE_FILE_MAX_CHARS;
    let content = if truncated {
        let mut snippet = text
            .chars()
            .take(PENDING_WORKSPACE_FILE_MAX_CHARS)
            .collect::<String>();
        snippet.push_str("\n\n...<文件内容已截断>");
        snippet
    } else {
        text
    };

    Ok(PendingWorkspaceFile::new(
        path.replace('\\', "/"),
        total_chars,
        truncated,
        content,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        env, fs,
        time::{SystemTime, UNIX_EPOCH},
    };

    #[test]
    fn background_execution_only_covers_search_and_mcp() {
        assert!(should_execute_tool_in_background(&ToolRequest::Search {
            query: "foo".to_string(),
        }));
        assert!(should_execute_tool_in_background(&ToolRequest::McpTool {
            server: "demo".to_string(),
            display_name: "Demo".to_string(),
            tool_name: "find".to_string(),
            arguments: Value::Null,
        }));
        assert!(!should_execute_tool_in_background(&ToolRequest::ReadFile {
            path: "src/main.rs".to_string(),
            start_line: Some(1),
            end_line: Some(10),
        }));
    }

    #[test]
    fn search_background_status_mentions_query() {
        assert_eq!(
            background_tool_status_text(&ToolRequest::Search {
                query: "session store".to_string(),
            }),
            Some("搜索中: session store".to_string())
        );
    }

    #[test]
    fn pending_workspace_files_from_input_extracts_existing_references() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let workspace_root = env::temp_dir().join(format!("spirit-agent-runtime-{unique}"));
        fs::create_dir_all(workspace_root.join("src")).unwrap();
        fs::write(workspace_root.join("src/runtime.rs"), "fn main() {}\n").unwrap();
        fs::write(workspace_root.join("README.md"), "hello\n").unwrap();

        let files = pending_workspace_files_from_input(
            &workspace_root,
            "@src/runtime.rs 请参考 @README.md 和 @missing.rs",
        );

        assert_eq!(
            files.iter().map(|file| file.path.as_str()).collect::<Vec<_>>(),
            vec!["src/runtime.rs", "README.md"]
        );

        let _ = fs::remove_dir_all(workspace_root);
    }
}

fn pending_mcp_resource_from_read_result(
    server: &str,
    display_name: &str,
    requested_uri: &str,
    value: &Value,
) -> Result<PendingMcpResource> {
    let contents = value
        .get("contents")
        .and_then(Value::as_array)
        .ok_or_else(|| anyhow!("MCP resource 返回格式异常：缺少 contents"))?;
    if contents.is_empty() {
        return Err(anyhow!("MCP resource 返回为空: {}", requested_uri));
    }

    let mut rendered_sections = Vec::new();
    let mut mime_type = None;
    let mut final_uri = requested_uri.to_string();
    for content in contents {
        if let Some(uri) = content.get("uri").and_then(Value::as_str) {
            final_uri = uri.to_string();
        }
        if mime_type.is_none() {
            mime_type = content
                .get("mimeType")
                .and_then(Value::as_str)
                .map(ToString::to_string);
        }

        if let Some(text) = content.get("text").and_then(Value::as_str) {
            rendered_sections.push(text.to_string());
            continue;
        }

        if let Some(blob) = content.get("blob").and_then(Value::as_str) {
            rendered_sections.push(format!(
                "[blob base64 omitted, {} chars]",
                blob.chars().count()
            ));
            continue;
        }

        rendered_sections.push(serde_json::to_string_pretty(content)?);
    }

    Ok(PendingMcpResource::new(
        server.to_string(),
        display_name.to_string(),
        final_uri,
        mime_type,
        rendered_sections.join("\n\n---\n\n"),
    ))
}

fn prompt_messages_from_value(value: &Value) -> Result<Vec<LlmMessage>> {
    let messages = value
        .get("messages")
        .and_then(Value::as_array)
        .ok_or_else(|| anyhow!("MCP prompt 返回格式异常：缺少 messages"))?;

    let mut out = Vec::new();
    for message in messages {
        let role = normalize_prompt_role(
            message
                .get("role")
                .and_then(Value::as_str)
                .unwrap_or("user"),
        );
        let content = prompt_content_to_text(
            message
                .get("content")
                .ok_or_else(|| anyhow!("MCP prompt message 缺少 content"))?,
        )?;
        out.push(LlmMessage {
            role,
            content,
            image_paths: vec![],
        });
    }
    Ok(out)
}

fn normalize_prompt_role(role: &str) -> &'static str {
    match role {
        "assistant" => "assistant",
        "system" => "system",
        _ => "user",
    }
}

fn prompt_content_to_text(content: &Value) -> Result<String> {
    if let Some(text) = content.as_str() {
        return Ok(text.to_string());
    }

    if let Some(object) = content.as_object() {
        if object.get("type").and_then(Value::as_str) == Some("text") {
            return Ok(object
                .get("text")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string());
        }
    }

    Ok(serde_json::to_string_pretty(content)?)
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
