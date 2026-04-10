use anyhow::{Context, Result, anyhow};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    collections::VecDeque,
    env,
    io::{BufRead, BufReader, Write},
    path::{Path, PathBuf},
    process::{Child, ChildStderr, ChildStdin, ChildStdout, Command, Stdio},
    sync::{Arc, Mutex, mpsc::{self, Receiver, Sender, TryRecvError}},
    thread,
};

use crate::{
    adapters::WorkspaceToolExecutor,
    llm_client::{self, LlmMessage},
    logging,
    mcp::McpServerConfig,
    mcp_manager::{
        ManagedMcpServer, McpDiscoveredPrompt, McpDiscoveredResource, McpDiscoveredTool,
        McpManager,
        McpServerInspection,
    },
    model_registry::AppConfig,
    ports::{McpStatusSnapshot, SecretStore, ToolExecutor},
    runtime_handle::RuntimeExportState,
    runtime::{
        RuntimeEvent, build_tool_result_block, format_tool_ui_message, openapi_tool_name,
        tool_approval_block, tool_failed_block,
    },
    session::{PendingMcpResource, SessionModel},
    tool_runtime::{AuthorizationDecision, ToolRequest, ToolRuntime, TrustTarget},
    view::{ChatMessage, MessageRole, PendingAssistantAux},
};

const ENV_RUNTIME_BACKEND_NODE_PATH: &str = "SPIRIT_NODE_PATH";
const ENV_RUNTIME_BRIDGE_PATH: &str = "SPIRIT_AGENT_CORE_BRIDGE_PATH";
const ENV_API_BASE: &str = "SPIRIT_API_BASE";
const ENV_API_KEY: &str = "SPIRIT_API_KEY";

pub struct TsBridgeRuntime {
    process: JsonRpcProcess,
    config: AppConfig,
    secret_store: Arc<dyn SecretStore>,
    workspace_root: PathBuf,
    session: SessionModel,
    tool_executor: WorkspaceToolExecutor,
    pending_aux_state: Option<PendingAssistantAux>,
    pending_approval_kind: Option<PendingApprovalKind>,
    is_busy_cache: bool,
    events: VecDeque<RuntimeEvent>,
    background_tool_completion_tx: Sender<BackgroundToolCompletion>,
    background_tool_completion_rx: Receiver<BackgroundToolCompletion>,
    bridge_failed: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum PendingApprovalKind {
    Tool,
    Manual,
}

#[derive(Debug)]
struct JsonRpcProcess {
    child: Child,
    stdin: Arc<Mutex<ChildStdin>>,
    rx: Receiver<Result<Value>>,
    next_id: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct HostToolRequestMeta {
    background_execution: bool,
    background_status_text: Option<String>,
    tool_call_id: Option<String>,
    tool_name: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct HostToolRequestEnvelope {
    request: ToolRequest,
    #[serde(rename = "__hostMeta")]
    host_meta: HostToolRequestMeta,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BridgeRuntimeSnapshot {
    pending_user_turn: Option<String>,
    pending_image_paths: Vec<String>,
    pending_mcp_resources: Vec<PendingMcpResource>,
    pending_aux_state: Option<PendingAssistantAux>,
    has_pending_approval: bool,
    has_pending_manual_approval: bool,
    current_pending_approval: Option<BridgePendingApproval>,
    is_busy: bool,
    background_tool_status: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BridgeExportState {
    api_messages: Vec<Value>,
    request_trace: Vec<Value>,
    system_prompts: Value,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BridgePendingApproval {
    prompt: String,
    request: Value,
    trust_target: Option<Value>,
    tool_call_id: Option<String>,
    tool_name: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BridgeDrainEventsResult {
    events: Vec<BridgeRuntimeEvent>,
    snapshot: BridgeRuntimeSnapshot,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "kind")]
enum BridgeRuntimeEvent {
    #[serde(rename = "begin-assistant-response")]
    BeginAssistantResponse,
    #[serde(rename = "update-pending-assistant-thinking")]
    UpdatePendingAssistantThinking { text: String },
    #[serde(rename = "update-pending-assistant-compaction")]
    UpdatePendingAssistantCompaction { text: String },
    #[serde(rename = "assistant-chunk")]
    AssistantChunk { text: String },
    #[serde(rename = "replace-pending-assistant")]
    ReplacePendingAssistant { text: String },
    #[serde(rename = "assistant-response-completed")]
    AssistantResponseCompleted,
    #[serde(rename = "remove-pending-assistant")]
    RemovePendingAssistant,
    #[serde(rename = "approval-requested")]
    ApprovalRequested { approval: BridgePendingApproval },
    #[serde(rename = "history-compacted")]
    HistoryCompacted {
        #[serde(alias = "droppedMessages")]
        dropped_messages: usize,
        #[serde(alias = "summaryPreview")]
        summary_preview: Option<String>,
    },
    #[serde(rename = "background-tool-status")]
    BackgroundToolStatus {
        phase: String,
        #[serde(alias = "toolName")]
        tool_name: Option<String>,
        request: Option<Value>,
        #[serde(alias = "statusText")]
        status_text: Option<String>,
        failed: Option<bool>,
    },
}

#[derive(Debug)]
struct BackgroundToolCompletion {
    request: ToolRequest,
    ui_tool_name: String,
    tool_call_id: Option<String>,
    result: std::result::Result<String, String>,
}

#[derive(Clone)]
struct BackgroundRpcResponseTarget {
    request_id: u64,
    stdin: Arc<Mutex<ChildStdin>>,
}

impl TsBridgeRuntime {
    pub fn new(
        config: AppConfig,
        secret_store: Arc<dyn SecretStore>,
        workspace_root: PathBuf,
    ) -> Result<Self> {
        let process = JsonRpcProcess::spawn(resolve_bridge_script(&workspace_root)?)?;
        let (background_tool_completion_tx, background_tool_completion_rx) =
            mpsc::channel::<BackgroundToolCompletion>();
        let mut runtime = Self {
            process,
            config,
            secret_store,
            workspace_root,
            session: SessionModel::new(),
            tool_executor: WorkspaceToolExecutor::new(),
            pending_aux_state: None,
            pending_approval_kind: None,
            is_busy_cache: false,
            events: VecDeque::new(),
            background_tool_completion_tx,
            background_tool_completion_rx,
            bridge_failed: false,
        };
        logging::log_event(&format!(
            "[ts-bridge-host] runtime init workspace_root={}",
            runtime.workspace_root.display()
        ));
        runtime.tool_executor.start_mcp_background_refresh();
        runtime.initialize_bridge()?;
        Ok(runtime)
    }

    pub fn config(&self) -> &AppConfig {
        &self.config
    }

    pub fn replace_config(&mut self, config: AppConfig) {
        if self.is_busy_cache || self.session.pending_user_turn().is_some() {
            self.events.push_back(RuntimeEvent::PushMessage(ChatMessage::new(
                MessageRole::Agent,
                "当前有进行中的对话，暂不支持在 TS backend 下切换模型。请等待当前回合结束后再试。",
            )));
            return;
        }

        let pending_images = self.session.pending_image_paths().to_vec();
        let pending_resources = self.session.pending_mcp_resources().to_vec();
        self.config = config;
        let transport_config = match self.resolve_transport_config_json() {
            Ok(value) => value,
            Err(err) => {
                self.handle_bridge_error(err);
                return;
            }
        };

        if let Err(err) = self.call_bridge(
            "runtime.replaceConfig",
            Some(json!({
                "transportConfig": transport_config,
            })),
        ) {
            self.handle_bridge_error(err);
            return;
        }

        if let Err(err) = self.sync_snapshot_only() {
            self.handle_bridge_error(err);
            return;
        }

        for path in pending_images {
            self.add_pending_image(path);
        }
        for resource in pending_resources {
            if let Err(err) = self.attach_mcp_resource(&resource.server, &resource.uri) {
                self.handle_bridge_error(err);
                return;
            }
        }
    }

    pub fn session(&self) -> &SessionModel {
        &self.session
    }

    pub fn llm_history_as_api_messages(&self) -> Vec<Value> {
        llm_client::llm_history_as_api_messages(self.session.llm_history(), &self.workspace_root)
    }

    pub fn llm_system_prompts_for_export(&self) -> Value {
        llm_client::llm_system_prompts_for_export()
    }

    pub fn export_llm_state(&mut self) -> Result<RuntimeExportState> {
        let value = self.call_bridge("runtime.exportState", None)?;
        let export: BridgeExportState = serde_json::from_value(value)?;
        Ok(RuntimeExportState {
            api_messages: export.api_messages,
            system_prompts: export.system_prompts,
            api_request_trace: export.request_trace,
        })
    }

    pub fn mcp_status_snapshot(&self) -> McpStatusSnapshot {
        self.tool_executor.mcp_status_snapshot()
    }

    pub fn has_pending_tool_approval(&self) -> bool {
        self.pending_approval_kind.is_some()
    }

    pub fn is_busy(&self) -> bool {
        self.is_busy_cache
    }

    pub fn drain_events(&mut self) -> Vec<RuntimeEvent> {
        self.drain_background_tool_completions();
        self.events.drain(..).collect()
    }

    pub fn pending_aux_state(&self) -> Option<PendingAssistantAux> {
        self.pending_aux_state.clone()
    }

    pub fn tick_thinking_spinner(&mut self) {
        if self.bridge_failed || !self.should_poll_bridge() {
            return;
        }
        if let Err(err) = self.call_bridge("runtime.tickThinkingSpinner", None) {
            self.handle_bridge_error(err);
            return;
        }
        if let Err(err) = self.sync_snapshot_only() {
            self.handle_bridge_error(err);
        }
    }

    pub fn poll(&mut self) {
        self.drain_background_tool_completions();
        if self.bridge_failed || !self.should_poll_bridge() {
            return;
        }
        if let Err(err) = self.call_bridge("runtime.poll", None) {
            self.handle_bridge_error(err);
            return;
        }
        if let Err(err) = self.sync_after_command() {
            self.handle_bridge_error(err);
        }
    }

    pub fn handle_stream_stall_timeout(&mut self) {
        if self.bridge_failed || !self.should_poll_bridge() {
            return;
        }
        if let Err(err) = self.call_bridge("runtime.handleStreamStallTimeout", None) {
            self.handle_bridge_error(err);
            return;
        }
        if let Err(err) = self.sync_after_command() {
            self.handle_bridge_error(err);
        }
    }

    pub fn submit_user_turn(&mut self, text: String, explicit_images: Option<Vec<String>>) {
        if self.bridge_failed {
            return;
        }
        let mut params = json!({ "text": text });
        if let Some(images) = explicit_images {
            params["explicitImages"] = serde_json::to_value(images).unwrap_or(Value::Array(vec![]));
        }
        logging::log_event(&format!(
            "[ts-bridge-host] submit_user_turn chars={} explicit_images={}",
            text.chars().count(),
            params
                .get("explicitImages")
                .and_then(Value::as_array)
                .map(|items| items.len())
                .unwrap_or(0)
        ));
        if let Err(err) = self.call_bridge("runtime.submitUserTurn", Some(params)) {
            self.handle_bridge_error(err);
            return;
        }
        if let Err(err) = self.sync_after_command() {
            self.handle_bridge_error(err);
        }
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
        let value = self.call_bridge(
            "runtime.attachMcpResource",
            Some(json!({ "server": server, "uri": uri })),
        )?;
        let snapshot = value
            .get("snapshot")
            .cloned()
            .ok_or_else(|| anyhow!("TS attachMcpResource 未返回 snapshot"))?;
        let label = value
            .get("label")
            .and_then(Value::as_str)
            .ok_or_else(|| anyhow!("TS attachMcpResource 未返回 label"))?
            .to_string();
        self.apply_snapshot(serde_json::from_value(snapshot)?);
        Ok(label)
    }

    pub fn clear_pending_mcp_resources(&mut self) -> usize {
        let cleared = match self.call_bridge("runtime.clearPendingMcpResources", None) {
            Ok(value) => value.as_u64().unwrap_or(0) as usize,
            Err(err) => {
                self.handle_bridge_error(err);
                return 0;
            }
        };
        if let Err(err) = self.sync_snapshot_only() {
            self.handle_bridge_error(err);
        }
        cleared
    }

    pub fn apply_mcp_prompt(
        &mut self,
        server: &str,
        prompt: &str,
        args_json: Option<&str>,
    ) -> Result<String> {
        let mut params = json!({
            "server": server,
            "prompt": prompt,
        });
        if let Some(args_json) = args_json {
            params["argsJson"] = Value::String(args_json.to_string());
        }
        let value = self.call_bridge("runtime.applyMcpPrompt", Some(params))?;
        let notice = value
            .get("notice")
            .and_then(Value::as_str)
            .ok_or_else(|| anyhow!("TS applyMcpPrompt 未返回 notice"))?
            .to_string();
        self.sync_after_command()?;
        Ok(notice)
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

        self.start_local_background_tool_execution(request, "manual".to_string());
        Ok(())
    }

    pub fn respond_to_pending_tool_approval(&mut self, message: &str) {
        if self.bridge_failed {
            return;
        }
        let decision = approval_decision_from_input(message);
        let method = match self.pending_approval_kind {
            Some(PendingApprovalKind::Manual) => "runtime.continuePendingManualToolApproval",
            Some(PendingApprovalKind::Tool) => "runtime.respondToPendingApproval",
            None => return,
        };

        if let Err(err) = self.call_bridge(method, Some(json!({ "decision": decision }))) {
            self.handle_bridge_error(err);
            return;
        }

        if let Err(err) = self.sync_after_command() {
            self.handle_bridge_error(err);
        }
    }

    pub fn execute_manual_tool_command(&mut self, message: &str) {
        if self.bridge_failed {
            return;
        }
        if let Err(err) = self.call_bridge(
            "runtime.startManualToolCommand",
            Some(json!({ "message": message })),
        ) {
            self.handle_bridge_error(err);
            return;
        }

        if let Err(err) = self.sync_after_command() {
            self.handle_bridge_error(err);
        }
    }

    pub fn compact_history(&mut self) {
        if self.bridge_failed {
            return;
        }
        if let Err(err) = self.call_bridge("runtime.startManualHistoryCompaction", None) {
            self.handle_bridge_error(err);
            return;
        }

        if let Err(err) = self.sync_after_command() {
            self.handle_bridge_error(err);
        }
    }

    pub fn replace_session_from_archive(&mut self, archive: &crate::ports::ChatArchive) {
        if self.bridge_failed {
            return;
        }
        if let Err(err) = self.call_bridge(
            "runtime.replaceFromArchive",
            Some(chat_archive_to_bridge_json(archive)),
        ) {
            self.handle_bridge_error(err);
            return;
        }
        if let Err(err) = self.sync_snapshot_only() {
            self.handle_bridge_error(err);
        }
    }

    pub fn add_pending_image(&mut self, path: String) {
        if self.bridge_failed {
            return;
        }
        let value = match self.call_bridge(
            "runtime.addPendingImage",
            Some(json!({ "path": path })),
        ) {
            Ok(value) => value,
            Err(err) => {
                self.handle_bridge_error(err);
                return;
            }
        };

        match serde_json::from_value::<BridgeRuntimeSnapshot>(value) {
            Ok(snapshot) => self.apply_snapshot(snapshot),
            Err(err) => self.handle_bridge_error(anyhow!("解析 TS addPendingImage snapshot 失败: {}", err)),
        }
    }

    pub fn clear_pending_images(&mut self) -> usize {
        if self.bridge_failed {
            return 0;
        }
        let cleared = match self.call_bridge("runtime.clearPendingImages", None) {
            Ok(value) => value.as_u64().unwrap_or(0) as usize,
            Err(err) => {
                self.handle_bridge_error(err);
                return 0;
            }
        };
        if let Err(err) = self.sync_snapshot_only() {
            self.handle_bridge_error(err);
        }
        cleared
    }

    fn initialize_bridge(&mut self) -> Result<()> {
        let snapshot = self.call_bridge(
            "runtime.init",
            Some(json!({
                "transportConfig": self.resolve_transport_config_json()?,
                "history": llm_history_to_json(self.session.llm_history()),
            })),
        )?;
        self.apply_snapshot(serde_json::from_value(snapshot)?);
        Ok(())
    }

    fn resolve_transport_config_json(&self) -> Result<Value> {
        let active = self
            .config
            .active_model_profile()
            .ok_or_else(|| anyhow!("当前模型不存在，请先配置模型"))?;

        let api_key = if let Ok(value) = env::var(ENV_API_KEY) {
            let trimmed = value.trim();
            if trimmed.is_empty() {
                self.resolve_key_from_store(&active.name)?
            } else {
                trimmed.to_string()
            }
        } else {
            self.resolve_key_from_store(&active.name)?
        };

        let api_base = env::var(ENV_API_BASE).unwrap_or_else(|_| active.api_base.clone());

        Ok(json!({
            "apiKey": api_key,
            "model": active.name,
            "baseUrl": api_base,
            "workspaceRoot": self.workspace_root,
        }))
    }

    fn resolve_key_from_store(&self, model_name: &str) -> Result<String> {
        if let Some(value) = self.secret_store.load_model_api_key(model_name)? {
            return Ok(value);
        }
        if let Some(value) = self.secret_store.load_global_api_key()? {
            return Ok(value);
        }

        Err(anyhow!(
            "未检测到模型 {} 的 API Key。可执行 `spirit model add {} --api-base <url> --key <api_key>` 或设置环境变量 {}",
            model_name,
            model_name,
            ENV_API_KEY
        ))
    }

    fn call_bridge(&mut self, method: &str, params: Option<Value>) -> Result<Value> {
        if self.bridge_failed {
            return Err(anyhow!("TS bridge 已处于失败状态。"));
        }

        let request_id = self.process.next_request_id();
        self.process.write_request(request_id, method, params)?;

        loop {
            let message = self.process.recv_message()?;
            if is_json_rpc_response(&message) {
                let message_id = message
                    .get("id")
                    .and_then(Value::as_u64)
                    .ok_or_else(|| anyhow!("JSON-RPC 响应缺少 id"))?;
                if message_id != request_id {
                    return Err(anyhow!("收到不匹配的 JSON-RPC 响应 id: {} != {}", message_id, request_id));
                }

                if let Some(error) = message.get("error") {
                    let summary = error
                        .get("message")
                        .and_then(Value::as_str)
                        .unwrap_or("TS bridge 返回未知错误");
                    return Err(anyhow!("runtime-error: {}", summary));
                }

                return Ok(message.get("result").cloned().unwrap_or(Value::Null));
            }

            self.handle_host_request(message)?;
        }
    }

    fn handle_host_request(&mut self, message: Value) -> Result<()> {
        let method = message
            .get("method")
            .and_then(Value::as_str)
            .ok_or_else(|| anyhow!("JSON-RPC 请求缺少 method"))?
            .to_string();
        let params = message.get("params").cloned();
        let request_id = message.get("id").and_then(Value::as_u64);

        if method == "host.execute"
            && self.try_start_background_host_execute(request_id, params.clone())?
        {
            return Ok(());
        }

        let response = match self.dispatch_host_method(&method, params) {
            Ok(result) => request_id.map(|id| json!({ "jsonrpc": "2.0", "id": id, "result": result.unwrap_or(Value::Null) })),
            Err(err) => request_id.map(|id| json!({
                "jsonrpc": "2.0",
                "id": id,
                "error": {
                    "code": -32000,
                    "message": err.to_string(),
                }
            })),
        };

        if let Some(response) = response {
            self.process.write_message(&response)?;
        }
        Ok(())
    }

    fn try_start_background_host_execute(
        &mut self,
        request_id: Option<u64>,
        params: Option<Value>,
    ) -> Result<bool> {
        let Some(request_id) = request_id else {
            return Ok(false);
        };
        let (request, meta) = request_with_meta_from_envelope(params)?;
        let Some(meta) = meta.filter(|meta| meta.background_execution) else {
            return Ok(false);
        };

        self.start_background_host_execute(request_id, request, meta);
        Ok(true)
    }

    fn start_background_host_execute(
        &mut self,
        request_id: u64,
        request: ToolRequest,
        meta: HostToolRequestMeta,
    ) {
        let ui_tool_name = meta
            .tool_name
            .unwrap_or_else(|| openapi_tool_name(&request).to_string());
        start_background_tool_worker(
            self.workspace_root.clone(),
            request,
            ui_tool_name,
            meta.tool_call_id,
            self.background_tool_completion_tx.clone(),
            Some(BackgroundRpcResponseTarget {
                request_id,
                stdin: Arc::clone(&self.process.stdin),
            }),
        );
    }

    fn start_local_background_tool_execution(&mut self, request: ToolRequest, ui_tool_name: String) {
        start_background_tool_worker(
            self.workspace_root.clone(),
            request,
            ui_tool_name,
            None,
            self.background_tool_completion_tx.clone(),
            None,
        );
    }

    fn drain_background_tool_completions(&mut self) {
        loop {
            match self.background_tool_completion_rx.try_recv() {
                Ok(completion) => self.apply_background_tool_completion(completion),
                Err(TryRecvError::Empty) | Err(TryRecvError::Disconnected) => break,
            }
        }
    }

    fn apply_background_tool_completion(&mut self, completion: BackgroundToolCompletion) {
        match completion.result {
            Ok(output) => {
                self.events.push_back(RuntimeEvent::PushMessage(ChatMessage::with_tool_block(
                    MessageRole::Agent,
                    format_tool_ui_message(&completion.request, &completion.ui_tool_name, &output),
                    build_tool_result_block(
                        &completion.request,
                        &completion.ui_tool_name,
                        completion.tool_call_id.as_deref(),
                        &output,
                    ),
                )));
            }
            Err(err) => {
                self.events.push_back(RuntimeEvent::PushMessage(ChatMessage::with_tool_block(
                    MessageRole::Agent,
                    format!("工具执行失败: {}", err),
                    tool_failed_block(
                        &completion.ui_tool_name,
                        completion.tool_call_id.as_deref(),
                        "工具执行失败",
                        &err,
                    ),
                )));
            }
        }
    }

    fn dispatch_host_method(&mut self, method: &str, params: Option<Value>) -> Result<Option<Value>> {
        match method {
            "host.toolDefinitionsJson" => Ok(Some(self.tool_executor.tool_definitions_json())),
            "host.mcpStatusSnapshot" => Ok(Some(serde_json::to_value(self.tool_executor.mcp_status_snapshot())?)),
            "host.parseCommand" => {
                let message = params
                    .and_then(|value| value.get("message").cloned())
                    .and_then(|value| value.as_str().map(ToString::to_string))
                    .ok_or_else(|| anyhow!("host.parseCommand 缺少 message"))?;
                let request = self.tool_executor.parse_command(&message)?;
                Ok(Some(serde_json::to_value(envelope_for_request(request))?))
            }
            "host.requestFromFunctionCall" => {
                let params = params.ok_or_else(|| anyhow!("host.requestFromFunctionCall 缺少 params"))?;
                let name = params
                    .get("name")
                    .and_then(Value::as_str)
                    .ok_or_else(|| anyhow!("host.requestFromFunctionCall 缺少 name"))?;
                let arguments_json = params
                    .get("argumentsJson")
                    .and_then(Value::as_str)
                    .ok_or_else(|| anyhow!("host.requestFromFunctionCall 缺少 argumentsJson"))?;
                let request = self
                    .tool_executor
                    .request_from_function_call(name, arguments_json)?;
                Ok(Some(serde_json::to_value(envelope_for_request(request))?))
            }
            "host.authorize" => {
                let request = request_from_envelope(params)?;
                Ok(Some(authorization_decision_to_value(
                    self.tool_executor.authorize(&request)?,
                )?))
            }
            "host.trust" => {
                let target = params
                    .and_then(|value| value.get("target").cloned())
                    .ok_or_else(|| anyhow!("host.trust 缺少 target"))?;
                let trust_target: TrustTarget = serde_json::from_value(target)?;
                self.tool_executor.trust(&trust_target)?;
                Ok(Some(Value::Null))
            }
            "host.execute" => {
                let (request, meta) = request_with_meta_from_envelope(params)?;
                let tool_call_id = meta.as_ref().and_then(|value| value.tool_call_id.as_deref());
                match self.tool_executor.execute(&request) {
                    Ok(output) => {
                        self.events.push_back(RuntimeEvent::PushMessage(ChatMessage::with_tool_block(
                            MessageRole::Agent,
                            format_tool_ui_message(&request, openapi_tool_name(&request), &output),
                            build_tool_result_block(
                                &request,
                                openapi_tool_name(&request),
                                tool_call_id,
                                &output,
                            ),
                        )));
                        logging::log_event(&format!(
                            "[ts-bridge-host] host.execute success tool={} tool_call_id={} output_chars={}",
                            openapi_tool_name(&request),
                            tool_call_id.unwrap_or("<none>"),
                            output.chars().count()
                        ));
                        Ok(Some(Value::String(output)))
                    }
                    Err(err) => {
                        self.events.push_back(RuntimeEvent::PushMessage(ChatMessage::with_tool_block(
                            MessageRole::Agent,
                            format!("工具执行失败: {}", err),
                            tool_failed_block(
                                openapi_tool_name(&request),
                                tool_call_id,
                                "工具执行失败",
                                &err.to_string(),
                            ),
                        )));
                        logging::log_event(&format!(
                            "[ts-bridge-host] host.execute failed tool={} tool_call_id={} error={}",
                            openapi_tool_name(&request),
                            tool_call_id.unwrap_or("<none>"),
                            err
                        ));
                        Err(err)
                    }
                }
            }
            "host.startMcpBackgroundRefresh" => {
                self.tool_executor.start_mcp_background_refresh();
                Ok(None)
            }
            "host.addMcpServer" => {
                let params = params.ok_or_else(|| anyhow!("host.addMcpServer 缺少 params"))?;
                let name = params
                    .get("name")
                    .and_then(Value::as_str)
                    .ok_or_else(|| anyhow!("host.addMcpServer 缺少 name"))?;
                let config: McpServerConfig = serde_json::from_value(
                    params
                        .get("config")
                        .cloned()
                        .ok_or_else(|| anyhow!("host.addMcpServer 缺少 config"))?,
                )?;
                let path = self.tool_executor.add_mcp_server(name, config)?;
                Ok(Some(Value::String(path.display().to_string())))
            }
            "host.listMcpServers" => Ok(Some(serde_json::to_value(self.tool_executor.list_mcp_servers()?)?)),
            "host.inspectMcpServer" => {
                let name = params
                    .and_then(|value| value.get("name").cloned())
                    .and_then(|value| value.as_str().map(ToString::to_string))
                    .ok_or_else(|| anyhow!("host.inspectMcpServer 缺少 name"))?;
                Ok(Some(serde_json::to_value(self.tool_executor.inspect_mcp_server(&name)?)?))
            }
            "host.listMcpTools" => {
                let name = params
                    .and_then(|value| value.get("name").cloned())
                    .and_then(|value| value.as_str().map(ToString::to_string))
                    .ok_or_else(|| anyhow!("host.listMcpTools 缺少 name"))?;
                Ok(Some(serde_json::to_value(self.tool_executor.list_mcp_tools(&name)?)?))
            }
            "host.listMcpResources" => {
                let name = params
                    .and_then(|value| value.get("name").cloned())
                    .and_then(|value| value.as_str().map(ToString::to_string))
                    .ok_or_else(|| anyhow!("host.listMcpResources 缺少 name"))?;
                Ok(Some(serde_json::to_value(self.tool_executor.list_mcp_resources(&name)?)?))
            }
            "host.readMcpResource" => {
                let params = params.ok_or_else(|| anyhow!("host.readMcpResource 缺少 params"))?;
                let name = params
                    .get("name")
                    .and_then(Value::as_str)
                    .ok_or_else(|| anyhow!("host.readMcpResource 缺少 name"))?;
                let uri = params
                    .get("uri")
                    .and_then(Value::as_str)
                    .ok_or_else(|| anyhow!("host.readMcpResource 缺少 uri"))?;
                Ok(Some(self.tool_executor.read_mcp_resource(name, uri)?))
            }
            "host.listMcpPrompts" => {
                let name = params
                    .and_then(|value| value.get("name").cloned())
                    .and_then(|value| value.as_str().map(ToString::to_string))
                    .ok_or_else(|| anyhow!("host.listMcpPrompts 缺少 name"))?;
                Ok(Some(serde_json::to_value(self.tool_executor.list_mcp_prompts(&name)?)?))
            }
            "host.getMcpPrompt" => {
                let params = params.ok_or_else(|| anyhow!("host.getMcpPrompt 缺少 params"))?;
                let name = params
                    .get("name")
                    .and_then(Value::as_str)
                    .ok_or_else(|| anyhow!("host.getMcpPrompt 缺少 name"))?;
                let prompt = params
                    .get("prompt")
                    .and_then(Value::as_str)
                    .ok_or_else(|| anyhow!("host.getMcpPrompt 缺少 prompt"))?;
                let args_json = params.get("argsJson").and_then(Value::as_str);
                Ok(Some(self.tool_executor.get_mcp_prompt(name, prompt, args_json)?))
            }
            _ => Err(anyhow!("未知 host callback: {}", method)),
        }
    }

    fn sync_after_command(&mut self) -> Result<()> {
        let value = self.call_bridge("runtime.drainEvents", None)?;
        let drained: BridgeDrainEventsResult = serde_json::from_value(value)?;
        if !drained.events.is_empty() {
            logging::log_event(&format!(
                "[ts-bridge-host] drain events count={} busy={} approval={} aux={}",
                drained.events.len(),
                drained.snapshot.is_busy,
                drained.snapshot.has_pending_approval,
                drained.snapshot.pending_aux_state.is_some()
            ));
        }
        self.apply_bridge_events(drained.events);
        self.apply_snapshot(drained.snapshot);
        Ok(())
    }

    fn sync_snapshot_only(&mut self) -> Result<()> {
        let value = self.call_bridge("runtime.snapshot", None)?;
        self.apply_snapshot(serde_json::from_value(value)?);
        Ok(())
    }

    fn apply_snapshot(&mut self, snapshot: BridgeRuntimeSnapshot) {
        self.session.clear_pending_user_turn();
        self.session.clear_pending_images();
        self.session.clear_pending_mcp_resources();
        if let Some(turn) = snapshot.pending_user_turn {
            self.session.set_pending_user_turn(turn);
        }
        for path in snapshot.pending_image_paths {
            self.session.add_pending_image(path);
        }
        for resource in snapshot.pending_mcp_resources {
            self.session.add_pending_mcp_resource(resource);
        }

        self.pending_aux_state = snapshot.pending_aux_state;
        self.pending_approval_kind = if snapshot.has_pending_approval {
            Some(if snapshot.has_pending_manual_approval {
                PendingApprovalKind::Manual
            } else {
                PendingApprovalKind::Tool
            })
        } else {
            None
        };
        self.is_busy_cache = snapshot.is_busy;
    }

    fn should_poll_bridge(&self) -> bool {
        self.is_busy_cache && self.pending_approval_kind.is_none()
    }

    fn apply_bridge_events(&mut self, events: Vec<BridgeRuntimeEvent>) {
        for event in events {
            match event {
                BridgeRuntimeEvent::BeginAssistantResponse => {
                    self.events.push_back(RuntimeEvent::BeginAssistantResponse);
                }
                BridgeRuntimeEvent::UpdatePendingAssistantThinking { text } => {
                    self.events
                        .push_back(RuntimeEvent::UpdatePendingAssistantThinking(text));
                }
                BridgeRuntimeEvent::UpdatePendingAssistantCompaction { text } => {
                    self.events
                        .push_back(RuntimeEvent::UpdatePendingAssistantCompaction(text));
                }
                BridgeRuntimeEvent::AssistantChunk { text } => {
                    self.events.push_back(RuntimeEvent::AssistantChunk(text));
                }
                BridgeRuntimeEvent::ReplacePendingAssistant { text } => {
                    self.events
                        .push_back(RuntimeEvent::ReplacePendingAssistant(text));
                }
                BridgeRuntimeEvent::AssistantResponseCompleted => {
                    self.events
                        .push_back(RuntimeEvent::AssistantResponseCompleted);
                }
                BridgeRuntimeEvent::RemovePendingAssistant => {
                    self.events.push_back(RuntimeEvent::RemovePendingAssistant);
                }
                BridgeRuntimeEvent::ApprovalRequested { approval } => {
                    self.events.push_back(RuntimeEvent::PushMessage(ChatMessage::with_tool_block(
                        MessageRole::Agent,
                        approval.prompt.clone(),
                        tool_approval_block(
                            &approval.tool_name,
                            approval.tool_call_id.as_deref(),
                            &approval.prompt,
                        ),
                    )));
                }
                BridgeRuntimeEvent::HistoryCompacted {
                    dropped_messages,
                    summary_preview,
                } => {
                    let summary = summary_preview.unwrap_or_else(|| "<无摘要内容>".to_string());
                    self.events.push_back(RuntimeEvent::PushMessage(ChatMessage::new(
                        MessageRole::Agent,
                        format!(
                            "检测到上下文超限，已调用模型生成/更新压缩摘要并重试（本轮合并 {} 条历史消息）。\n\n压缩摘要预览:\n{}",
                            dropped_messages, summary
                        ),
                    )));
                }
                BridgeRuntimeEvent::BackgroundToolStatus { .. } => {}
            }
        }
    }

    fn resolve_mcp_display_name(&self, server: &str) -> Result<String> {
        self.tool_executor
            .list_mcp_servers()?
            .into_iter()
            .find(|item| item.name == server)
            .map(|item| item.display_name)
            .ok_or_else(|| anyhow!("未知 MCP server: {}", server))
    }

    fn handle_bridge_error(&mut self, err: anyhow::Error) {
        let mut summary = err.to_string();
        let fatal = !summary.starts_with("runtime-error: ");
        if let Some(stripped) = summary.strip_prefix("runtime-error: ") {
            summary = stripped.to_string();
        }

        if fatal && self.bridge_failed {
            logging::log_event(&format!(
                "[ts-bridge-host] suppress repeated fatal error: {}",
                summary
            ));
            return;
        }

        if fatal {
            self.bridge_failed = true;
        }
        logging::log_event(&format!(
            "[ts-bridge-host] {}: {}",
            if fatal { "fatal error" } else { "runtime error" },
            summary
        ));
        self.is_busy_cache = false;
        self.pending_aux_state = None;
        self.pending_approval_kind = None;
        self.events.push_back(RuntimeEvent::PushMessage(ChatMessage::new(
            MessageRole::Agent,
            if fatal {
                format!("TS runtime bridge 失败: {}", summary)
            } else {
                format!("TS runtime 执行失败: {}", summary)
            },
        )));
    }
}

impl JsonRpcProcess {
    fn spawn(script_path: PathBuf) -> Result<Self> {
        let node_path = env::var(ENV_RUNTIME_BACKEND_NODE_PATH).unwrap_or_else(|_| "node".to_string());
        let mut child = Command::new(&node_path)
            .arg(script_path)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .with_context(|| format!("启动 TS bridge 失败: {}", node_path))?;

        let stdin = child.stdin.take().ok_or_else(|| anyhow!("获取 TS bridge stdin 失败"))?;
        let stdout = child.stdout.take().ok_or_else(|| anyhow!("获取 TS bridge stdout 失败"))?;
        let stderr = child.stderr.take().ok_or_else(|| anyhow!("获取 TS bridge stderr 失败"))?;
        let (tx, rx) = mpsc::channel::<Result<Value>>();
        spawn_stdout_reader(stdout, tx);
        spawn_stderr_drain(stderr);

        Ok(Self {
            child,
            stdin: Arc::new(Mutex::new(stdin)),
            rx,
            next_id: 1,
        })
    }

    fn next_request_id(&mut self) -> u64 {
        let id = self.next_id;
        self.next_id += 1;
        id
    }

    fn write_request(&self, id: u64, method: &str, params: Option<Value>) -> Result<()> {
        let mut payload = json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": method,
        });
        if let Some(params) = params {
            payload["params"] = params;
        }
        self.write_message(&payload)
    }

    fn write_message(&self, payload: &Value) -> Result<()> {
        write_message_to_stdin(&self.stdin, payload)
    }

    fn recv_message(&self) -> Result<Value> {
        match self.rx.recv() {
            Ok(result) => result,
            Err(_) => Err(anyhow!("TS bridge stdout 读取通道已关闭。")),
        }
    }
}

impl Drop for JsonRpcProcess {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

fn resolve_bridge_script(workspace_root: &Path) -> Result<PathBuf> {
    if let Ok(path) = env::var(ENV_RUNTIME_BRIDGE_PATH) {
        let candidate = PathBuf::from(path);
        if candidate.exists() {
            return Ok(candidate);
        }
    }

    let direct = workspace_root.join("packages").join("agent-core").join("dist").join("host-bridge.js");
    if direct.exists() {
        return Ok(direct);
    }

    if let Some(parent) = workspace_root.parent() {
        let sibling = parent.join("packages").join("agent-core").join("dist").join("host-bridge.js");
        if sibling.exists() {
            return Ok(sibling);
        }
    }

    Err(anyhow!(
        "未找到 TS bridge 入口 host-bridge.js。请先在 packages/agent-core 执行 npm run build。"
    ))
}

fn spawn_stdout_reader(stdout: ChildStdout, tx: mpsc::Sender<Result<Value>>) {
    thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        loop {
            let next = read_framed_message(&mut reader)
                .context("读取 TS bridge stdout 消息失败")
                .and_then(|body| serde_json::from_slice::<Value>(&body).context("解析 TS bridge JSON 失败"));

            match next {
                Ok(value) => {
                    if tx.send(Ok(value)).is_err() {
                        break;
                    }
                }
                Err(err) => {
                    let _ = tx.send(Err(err));
                    break;
                }
            }
        }
    });
}

fn spawn_stderr_drain(stderr: ChildStderr) {
    thread::spawn(move || {
        let mut reader = BufReader::new(stderr);
        let mut line = String::new();
        loop {
            line.clear();
            match reader.read_line(&mut line) {
                Ok(0) => break,
                Ok(_) => logging::log_event(&format!("[ts-bridge] {}", line.trim_end())),
                Err(err) => {
                    logging::log_event(&format!("[ts-bridge] stderr drain failed: {}", err));
                    break;
                }
            }
        }
    });
}

fn read_framed_message(reader: &mut dyn BufRead) -> Result<Vec<u8>> {
    let mut content_length = None;
    let mut line = String::new();
    loop {
        line.clear();
        let read = reader.read_line(&mut line)?;
        if read == 0 {
            return Err(anyhow!("TS bridge stdout 已提前关闭。"));
        }

        if line == "\r\n" || line == "\n" {
            break;
        }

        let mut parts = line.splitn(2, ':');
        let name = parts.next().unwrap_or_default().trim().to_ascii_lowercase();
        let value = parts.next().unwrap_or_default().trim();
        if name == "content-length" {
            content_length = Some(value.parse::<usize>().context("解析 Content-Length 失败")?);
        }
    }

    let len = content_length.ok_or_else(|| anyhow!("TS bridge 消息缺少 Content-Length"))?;
    let mut body = vec![0u8; len];
    reader.read_exact(&mut body)?;
    Ok(body)
}

fn llm_history_to_json(history: &[LlmMessage]) -> Vec<Value> {
    history
        .iter()
        .map(|message| {
            json!({
                "role": message.role,
                "content": message.content,
                "imagePaths": message.image_paths,
            })
        })
        .collect()
}

fn start_background_tool_worker(
    workspace_root: PathBuf,
    request: ToolRequest,
    ui_tool_name: String,
    tool_call_id: Option<String>,
    completion_tx: Sender<BackgroundToolCompletion>,
    response_target: Option<BackgroundRpcResponseTarget>,
) {
    thread::spawn(move || {
        let request_for_worker = request.clone();
        let result = execute_background_tool_request_sync(&workspace_root, &request_for_worker)
            .map_err(|err| err.to_string());

        if let Some(target) = response_target {
            let payload = background_tool_json_rpc_response(target.request_id, &result);
            if let Err(err) = write_message_to_stdin(&target.stdin, &payload) {
                logging::log_event(&format!(
                    "[ts-bridge-host] host.execute response write failed tool={} request_id={} error={}",
                    ui_tool_name, target.request_id, err
                ));
            }
        }

        match &result {
            Ok(output) => logging::log_event(&format!(
                "[ts-bridge-host] background tool success tool={} tool_call_id={} output_chars={}",
                ui_tool_name,
                tool_call_id.as_deref().unwrap_or("<none>"),
                output.chars().count()
            )),
            Err(err) => logging::log_event(&format!(
                "[ts-bridge-host] background tool failed tool={} tool_call_id={} error={}",
                ui_tool_name,
                tool_call_id.as_deref().unwrap_or("<none>"),
                err
            )),
        }

        let _ = completion_tx.send(BackgroundToolCompletion {
            request,
            ui_tool_name,
            tool_call_id,
            result,
        });
    });
}

fn background_tool_json_rpc_response(
    request_id: u64,
    result: &std::result::Result<String, String>,
) -> Value {
    match result {
        Ok(output) => json!({
            "jsonrpc": "2.0",
            "id": request_id,
            "result": output,
        }),
        Err(err) => json!({
            "jsonrpc": "2.0",
            "id": request_id,
            "error": {
                "code": -32000,
                "message": err,
            }
        }),
    }
}

fn write_message_to_stdin(stdin: &Arc<Mutex<ChildStdin>>, payload: &Value) -> Result<()> {
    let body = serde_json::to_vec(payload)?;
    let header = format!("Content-Length: {}\r\n\r\n", body.len());
    let mut guard = stdin
        .lock()
        .map_err(|_| anyhow!("获取 TS bridge stdin 锁失败"))?;
    guard.write_all(header.as_bytes())?;
    guard.write_all(&body)?;
    guard.flush()?;
    Ok(())
}

fn is_json_rpc_response(message: &Value) -> bool {
    message.get("id").is_some() && (message.get("result").is_some() || message.get("error").is_some())
}

fn envelope_for_request(request: ToolRequest) -> HostToolRequestEnvelope {
    HostToolRequestEnvelope {
        host_meta: HostToolRequestMeta {
            background_execution: should_execute_tool_in_background(&request),
            background_status_text: background_tool_status_text(&request),
            tool_call_id: None,
            tool_name: None,
        },
        request,
    }
}

fn request_from_envelope(params: Option<Value>) -> Result<ToolRequest> {
    Ok(request_with_meta_from_envelope(params)?.0)
}

fn request_with_meta_from_envelope(
    params: Option<Value>,
) -> Result<(ToolRequest, Option<HostToolRequestMeta>)> {
    let params = params.ok_or_else(|| anyhow!("host 请求缺少 params"))?;
    let raw_request = params
        .get("request")
        .cloned()
        .ok_or_else(|| anyhow!("host 请求缺少 request"))?;
    if raw_request.get("request").is_some() {
        let envelope: HostToolRequestEnvelope = serde_json::from_value(raw_request)?;
        return Ok((envelope.request, Some(envelope.host_meta)));
    }

    Ok((serde_json::from_value(raw_request)?, None))
}

fn authorization_decision_to_value(decision: AuthorizationDecision) -> Result<Value> {
    match decision {
        AuthorizationDecision::Allowed => Ok(json!({ "kind": "allowed" })),
        AuthorizationDecision::NeedApproval {
            prompt,
            trust_target,
        } => Ok(json!({
            "kind": "need-approval",
            "prompt": prompt,
            "trustTarget": trust_target,
        })),
    }
}

fn approval_decision_from_input(message: &str) -> Value {
    let decision = message.trim().to_lowercase();
    match decision.as_str() {
        "y" => json!({ "kind": "allow" }),
        "t" => json!({ "kind": "allow", "persistTrust": true }),
        "n" => json!({ "kind": "deny" }),
        _ => json!({
            "kind": "guidance",
            "userMessage": message,
        }),
    }
}

fn parse_optional_json_value(input: Option<&str>) -> Result<Value> {
    let Some(raw) = input else {
        return Ok(Value::Null);
    };

    serde_json::from_str(raw).with_context(|| format!("JSON 解析失败: {}", raw))
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
    let value = McpManager::load(workspace_root.clone())?.call_tool(server, tool_name, arguments)?;
    Ok(serde_json::to_string_pretty(&value)?)
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

#[cfg(test)]
mod tests {
    use super::{
        BridgeRuntimeEvent, ENV_RUNTIME_BACKEND_NODE_PATH, TsBridgeRuntime,
        background_tool_json_rpc_response, resolve_bridge_script,
    };
    use crate::{
        model_registry::{AppConfig, DEFAULT_API_BASE, ModelProfile},
        ports::SecretStore,
    };
    use anyhow::Result;
    use serde_json::json;
    use std::{env, path::PathBuf, process::Command, sync::Arc};

    struct StubSecretStore;

    impl SecretStore for StubSecretStore {
        fn load_global_api_key(&self) -> Result<Option<String>> {
            Ok(Some("test-key".to_string()))
        }

        fn save_global_api_key(&self, _api_key: &str) -> Result<()> {
            Ok(())
        }

        fn remove_global_api_key(&self) -> Result<()> {
            Ok(())
        }

        fn load_model_api_key(&self, _model_name: &str) -> Result<Option<String>> {
            Ok(None)
        }

        fn save_model_api_key(&self, _model_name: &str, _api_key: &str) -> Result<()> {
            Ok(())
        }

        fn remove_model_api_key(&self, _model_name: &str) -> Result<()> {
            Ok(())
        }

        fn has_model_api_key(&self, _model_name: &str) -> Result<bool> {
            Ok(false)
        }
    }

    #[test]
    fn ts_bridge_initializes_when_bundle_is_available() {
        let workspace_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .expect("workspace root")
            .to_path_buf();

        if resolve_bridge_script(&workspace_root).is_err() {
            return;
        }

        let node_path = env::var(ENV_RUNTIME_BACKEND_NODE_PATH).unwrap_or_else(|_| "node".to_string());
        if Command::new(&node_path).arg("--version").output().is_err() {
            return;
        }

        let config = AppConfig {
            models: vec![ModelProfile {
                name: "gpt-4o-mini".to_string(),
                api_base: DEFAULT_API_BASE.to_string(),
            }],
            active_model: "gpt-4o-mini".to_string(),
            ui_locale: None,
        };

        let runtime = TsBridgeRuntime::new(config, Arc::new(StubSecretStore), workspace_root)
            .expect("ts bridge runtime should initialize");
        assert!(!runtime.is_busy());
        assert!(!runtime.has_pending_tool_approval());
    }

    #[test]
    fn bridge_runtime_event_accepts_camel_case_background_status_fields() {
        let value = json!({
            "kind": "background-tool-status",
            "phase": "finished",
            "toolName": "mcp_tool",
            "request": { "server": "github", "tool_name": "get_me" },
            "statusText": "MCP 工具执行中: github / get_me",
            "failed": false,
        });

        let event: BridgeRuntimeEvent = serde_json::from_value(value).expect("event should deserialize");
        match event {
            BridgeRuntimeEvent::BackgroundToolStatus {
                phase,
                tool_name,
                request,
                status_text,
                failed,
            } => {
                assert_eq!(phase, "finished");
                assert_eq!(tool_name.as_deref(), Some("mcp_tool"));
                assert!(request.is_some());
                assert_eq!(status_text.as_deref(), Some("MCP 工具执行中: github / get_me"));
                assert_eq!(failed, Some(false));
            }
            other => panic!("unexpected event variant: {other:?}"),
        }
    }

    #[test]
    fn bridge_runtime_event_accepts_camel_case_history_compacted_fields() {
        let value = json!({
            "kind": "history-compacted",
            "droppedMessages": 5,
            "summaryPreview": "summary",
        });

        let event: BridgeRuntimeEvent = serde_json::from_value(value).expect("event should deserialize");
        match event {
            BridgeRuntimeEvent::HistoryCompacted {
                dropped_messages,
                summary_preview,
            } => {
                assert_eq!(dropped_messages, 5);
                assert_eq!(summary_preview.as_deref(), Some("summary"));
            }
            other => panic!("unexpected event variant: {other:?}"),
        }
    }

    #[test]
    fn background_tool_json_rpc_response_returns_result_payload_on_success() {
        let response = background_tool_json_rpc_response(7, &Ok("ok".to_string()));

        assert_eq!(response.get("id").and_then(|value| value.as_u64()), Some(7));
        assert_eq!(response.get("result").and_then(|value| value.as_str()), Some("ok"));
        assert!(response.get("error").is_none());
    }

    #[test]
    fn background_tool_json_rpc_response_returns_error_payload_on_failure() {
        let response = background_tool_json_rpc_response(11, &Err("boom".to_string()));

        assert_eq!(response.get("id").and_then(|value| value.as_u64()), Some(11));
        assert_eq!(
            response
                .get("error")
                .and_then(|value| value.get("message"))
                .and_then(|value| value.as_str()),
            Some("boom")
        );
        assert!(response.get("result").is_none());
    }
}

fn chat_archive_to_bridge_json(archive: &crate::ports::ChatArchive) -> Value {
    json!({
        "messages": archive.messages.iter().map(|(role, content)| {
            json!({
                "role": role,
                "content": content,
            })
        }).collect::<Vec<_>>(),
        "assistantAux": archive.assistant_aux.iter().map(|entry| {
            json!({
                "messageIndex": entry.message_index,
                "thinking": entry.thinking,
                "compaction": entry.compaction,
            })
        }).collect::<Vec<_>>(),
        "llmHistory": archive.llm_history.iter().map(|(role, content, image_paths)| {
            json!({
                "role": role,
                "content": content,
                "imagePaths": image_paths,
            })
        }).collect::<Vec<_>>(),
    })
}