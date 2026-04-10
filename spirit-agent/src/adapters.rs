use anyhow::{Context, Result, anyhow};
use serde_json::{Map, Value, json};
use std::{
    collections::{BTreeMap, hash_map::DefaultHasher},
    env,
    hash::{Hash, Hasher},
    path::PathBuf,
    sync::{Arc, Mutex, mpsc},
    thread,
};

use crate::{
    chat_store,
    llm_client::{self, LlmMessage, ResolvedLlmConfig},
    logging,
    mcp::{McpServerConfig, add_mcp_server},
    mcp_manager::{McpManager, McpServerRuntimeState},
    model_registry::{
        AppConfig, config_file_path, has_model_api_key, keyring_entry, load_config,
        remove_model_api_key, save_config, save_model_api_key,
    },
    ports::{
        AppPaths, ChatArchive, ChatRepository, ConfigStore, LlmTransport, McpStatusSnapshot,
        McpStatusState, SecretStore, StartedToolAgentRound, Telemetry, ToolAgentRoundCompletion,
        ToolAgentRoundResult, ToolExecutor,
    },
    tool_runtime::{AuthorizationDecision, ToolRequest, ToolRuntime, TrustTarget},
};

const ENV_API_BASE: &str = "SPIRIT_API_BASE";
const ENV_API_KEY: &str = "SPIRIT_API_KEY";
const PERMISSIONS_FILE: &str = "tool-permissions.json";
const MCP_FUNCTION_NAME_LIMIT: usize = 64;
const MCP_SERVER_FRAGMENT_LIMIT: usize = 16;
const MCP_TOOL_FRAGMENT_LIMIT: usize = 24;

pub struct DefaultAppPaths {
    workspace_root: PathBuf,
}

impl DefaultAppPaths {
    pub fn new() -> Self {
        Self {
            workspace_root: env::current_dir().unwrap_or_else(|_| PathBuf::from(".")),
        }
    }
}

impl AppPaths for DefaultAppPaths {
    fn workspace_root(&self) -> PathBuf {
        self.workspace_root.clone()
    }

    fn config_file(&self) -> PathBuf {
        config_file_path()
    }

    fn chats_dir(&self) -> PathBuf {
        chat_store::chat_dir_path()
    }

    fn permissions_file(&self) -> PathBuf {
        if let Ok(appdata) = env::var("APPDATA") {
            return PathBuf::from(appdata)
                .join("SpiritAgent")
                .join(PERMISSIONS_FILE);
        }

        if let Ok(home) = env::var("USERPROFILE") {
            return PathBuf::from(home)
                .join(".spirit-agent")
                .join(PERMISSIONS_FILE);
        }

        PathBuf::from(format!(".spirit-agent.{}", PERMISSIONS_FILE))
    }

    fn log_file(&self) -> PathBuf {
        logging::log_file_path()
    }
}

pub struct LoggingTelemetry;

impl Telemetry for LoggingTelemetry {
    fn log_event(&self, message: &str) {
        logging::log_event(message);
    }

    fn log_json_http_body(&self, label: &str, payload: &Value) {
        logging::log_json_http_body(label, payload);
    }
}

pub struct JsonConfigStore;

impl ConfigStore for JsonConfigStore {
    fn load(&self) -> Result<AppConfig> {
        load_config()
    }

    fn save(&self, config: &AppConfig) -> Result<()> {
        save_config(config)
    }
}

pub struct KeyringSecretStore;

impl SecretStore for KeyringSecretStore {
    fn load_global_api_key(&self) -> Result<Option<String>> {
        let entry = keyring_entry()?;
        match entry.get_password() {
            Ok(value) if !value.trim().is_empty() => Ok(Some(value)),
            Ok(_) | Err(keyring::Error::NoEntry) => Ok(None),
            Err(err) => Err(anyhow!("读取 keyring 中的 API Key 失败: {}", err)),
        }
    }

    fn save_global_api_key(&self, api_key: &str) -> Result<()> {
        let entry = keyring_entry()?;
        entry
            .set_password(api_key.trim())
            .context("写入 keyring 失败")
    }

    fn remove_global_api_key(&self) -> Result<()> {
        let entry = keyring_entry()?;
        match entry.delete_password() {
            Ok(_) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(err) => Err(anyhow!("删除 keyring API Key 失败: {}", err)),
        }
    }

    fn load_model_api_key(&self, model_name: &str) -> Result<Option<String>> {
        let account = format!("model::{}", model_name);
        let entry = keyring::Entry::new("SpiritAgent", &account)
            .with_context(|| format!("初始化 keyring 条目失败: {}", account))?;
        match entry.get_password() {
            Ok(value) if !value.trim().is_empty() => Ok(Some(value)),
            Ok(_) | Err(keyring::Error::NoEntry) => Ok(None),
            Err(err) => Err(anyhow!("读取模型 {} 的 API Key 失败: {}", model_name, err)),
        }
    }

    fn save_model_api_key(&self, model_name: &str, api_key: &str) -> Result<()> {
        save_model_api_key(model_name, api_key)
    }

    fn remove_model_api_key(&self, model_name: &str) -> Result<()> {
        remove_model_api_key(model_name)
    }

    fn has_model_api_key(&self, model_name: &str) -> Result<bool> {
        has_model_api_key(model_name)
    }
}

pub struct JsonChatRepository;

impl ChatRepository for JsonChatRepository {
    fn list(&self) -> Result<Vec<String>> {
        let files = chat_store::list_chat_files()?;
        Ok(files
            .iter()
            .map(|path| chat_store::display_name(path))
            .collect())
    }

    fn save(&self, path: Option<&str>, archive: &ChatArchive) -> Result<PathBuf> {
        chat_store::save_chat(
            path,
            &archive.messages,
            &archive.assistant_aux,
            &archive.llm_history,
        )
    }

    fn load(&self, path: &str) -> Result<ChatArchive> {
        let loaded = chat_store::load_chat(path)?;
        Ok(ChatArchive {
            messages: loaded.messages,
            assistant_aux: loaded.assistant_aux,
            llm_history: loaded.llm_history,
        })
    }
}

pub struct WorkspaceToolExecutor {
    inner: ToolRuntime,
    workspace_root: PathBuf,
    mcp_state: Arc<Mutex<McpSharedState>>,
}

#[derive(Clone)]
struct McpFunctionRoute {
    server: String,
    display_name: String,
    tool_name: String,
}

#[derive(Default)]
struct McpToolCatalog {
    definitions: Vec<Value>,
    routes: BTreeMap<String, McpFunctionRoute>,
}

#[derive(Default)]
struct McpSharedState {
    catalog: McpToolCatalog,
    status: McpStatusSnapshot,
    refresh_in_flight: bool,
}

impl WorkspaceToolExecutor {
    pub fn new() -> Self {
        let workspace_root = env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
        Self {
            inner: ToolRuntime::new(),
            mcp_state: Arc::new(Mutex::new(McpSharedState {
                catalog: McpToolCatalog::default(),
                status: initial_mcp_status(&workspace_root),
                refresh_in_flight: false,
            })),
            workspace_root,
        }
    }

    fn load_mcp_manager(&self) -> Result<McpManager> {
        McpManager::load(self.workspace_root.clone())
    }
}

impl ToolExecutor for WorkspaceToolExecutor {
    fn tool_definitions_json(&self) -> Value {
        let mut definitions = self
            .inner
            .tool_definitions_json()
            .as_array()
            .cloned()
            .unwrap_or_default();

        let state = lock_mcp_state(&self.mcp_state);
        definitions.extend(state.catalog.definitions.clone());
        Value::Array(definitions)
    }

    fn parse_command(&self, message: &str) -> Result<ToolRequest> {
        self.inner.parse_tool_command(message)
    }

    fn request_from_function_call(&self, name: &str, arguments_json: &str) -> Result<ToolRequest> {
        if let Ok(request) = ToolRuntime::request_from_function_call(name, arguments_json) {
            return Ok(request);
        }

        let route = lock_mcp_state(&self.mcp_state)
            .catalog
            .routes
            .get(name)
            .cloned()
            .ok_or_else(|| anyhow!("未知工具名: {}", name))?;
        let arguments: Value = serde_json::from_str(arguments_json)
            .with_context(|| format!("MCP 工具参数 JSON 解析失败: {}", arguments_json))?;

        Ok(ToolRequest::McpTool {
            server: route.server,
            display_name: route.display_name,
            tool_name: route.tool_name,
            arguments,
        })
    }

    fn authorize(&self, request: &ToolRequest) -> Result<AuthorizationDecision> {
        match request {
            ToolRequest::McpTool { server, .. } => {
                let manager = self.load_mcp_manager()?;
                let configured = manager
                    .get(server)
                    .ok_or_else(|| anyhow!("未知 MCP server: {}", server))?;
                if !configured.capabilities.tools {
                    return Err(anyhow!("MCP server {} 未启用 tools capability", server));
                }

                match configured.state {
                    McpServerRuntimeState::Disabled => Err(anyhow!(
                        "MCP server {} 已禁用，请先执行 `spirit mcp enable {}`。",
                        server,
                        server
                    )),
                    McpServerRuntimeState::Ready => Ok(AuthorizationDecision::Allowed),
                }
            }
            _ => self.inner.authorize(request),
        }
    }

    fn trust(&mut self, target: &TrustTarget) -> Result<()> {
        self.inner.trust(target)
    }

    fn execute(&mut self, request: &ToolRequest) -> Result<String> {
        match request {
            ToolRequest::McpTool {
                server,
                tool_name,
                arguments,
                ..
            } => {
                let arguments = match arguments {
                    Value::Object(map) => Some(map.clone()),
                    Value::Null => None,
                    _ => return Err(anyhow!("MCP 工具参数必须是 JSON object")),
                };
                let value = self
                    .load_mcp_manager()?
                    .call_tool(server, tool_name, arguments)?;
                Ok(serde_json::to_string_pretty(&value)?)
            }
            _ => self.inner.execute(request),
        }
    }

    fn start_mcp_background_refresh(&self) {
        spawn_mcp_catalog_refresh(Arc::clone(&self.mcp_state), self.workspace_root.clone());
    }

    fn mcp_status_snapshot(&self) -> McpStatusSnapshot {
        lock_mcp_state(&self.mcp_state).status.clone()
    }

    fn add_mcp_server(&mut self, name: &str, config: McpServerConfig) -> Result<PathBuf> {
        let path = add_mcp_server(&self.workspace_root, name, config)?;
        self.start_mcp_background_refresh();
        Ok(path)
    }

    fn list_mcp_servers(&self) -> Result<Vec<crate::mcp_manager::ManagedMcpServer>> {
        let manager = self.load_mcp_manager()?;
        Ok(manager.servers().cloned().collect())
    }

    fn inspect_mcp_server(&self, name: &str) -> Result<crate::mcp_manager::McpServerInspection> {
        self.load_mcp_manager()?.inspect_server(name)
    }

    fn list_mcp_tools(&self, name: &str) -> Result<Vec<crate::mcp_manager::McpDiscoveredTool>> {
        self.load_mcp_manager()?.list_tools(name)
    }

    fn list_mcp_resources(
        &self,
        name: &str,
    ) -> Result<Vec<crate::mcp_manager::McpDiscoveredResource>> {
        self.load_mcp_manager()?.list_resources(name)
    }

    fn read_mcp_resource(&self, name: &str, uri: &str) -> Result<Value> {
        self.load_mcp_manager()?.read_resource(name, uri)
    }

    fn list_mcp_prompts(&self, name: &str) -> Result<Vec<crate::mcp_manager::McpDiscoveredPrompt>> {
        self.load_mcp_manager()?.list_prompts(name)
    }

    fn get_mcp_prompt(&self, name: &str, prompt: &str, args_json: Option<&str>) -> Result<Value> {
        self.load_mcp_manager()?
            .get_prompt(name, prompt, parse_optional_json_object(args_json)?)
    }
}

fn lock_mcp_state(state: &Arc<Mutex<McpSharedState>>) -> std::sync::MutexGuard<'_, McpSharedState> {
    match state.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    }
}

fn initial_mcp_status(workspace_root: &PathBuf) -> McpStatusSnapshot {
    match McpManager::load(workspace_root.clone()) {
        Ok(manager) => McpStatusSnapshot {
            revision: 0,
            state: McpStatusState::Loading,
            configured_servers: manager.servers().len(),
            loaded_servers: 0,
            cached_tools: 0,
            last_error: None,
        },
        Err(err) => McpStatusSnapshot {
            revision: 0,
            state: McpStatusState::Error,
            configured_servers: 0,
            loaded_servers: 0,
            cached_tools: 0,
            last_error: Some(err.to_string()),
        },
    }
}

fn spawn_mcp_catalog_refresh(state: Arc<Mutex<McpSharedState>>, workspace_root: PathBuf) {
    {
        let mut guard = lock_mcp_state(&state);
        if guard.refresh_in_flight {
            return;
        }
        guard.refresh_in_flight = true;
        guard.status.state = McpStatusState::Loading;
        guard.status.revision = guard.status.revision.saturating_add(1);
    }

    thread::spawn(move || {
        let result = build_mcp_catalog_snapshot(&workspace_root);
        let mut guard = lock_mcp_state(&state);
        guard.refresh_in_flight = false;

        match result {
            Ok((catalog, mut status)) => {
                status.revision = guard.status.revision.saturating_add(1);
                guard.catalog = catalog;
                guard.status = status;
            }
            Err(err) => {
                let formatted = logging::format_error_chain(&err);
                guard.catalog = McpToolCatalog::default();
                guard.status = McpStatusSnapshot {
                    revision: guard.status.revision.saturating_add(1),
                    state: McpStatusState::Error,
                    configured_servers: guard.status.configured_servers,
                    loaded_servers: 0,
                    cached_tools: 0,
                    last_error: Some(formatted.clone()),
                };
                logging::log_event(&format!("[mcp] background refresh failed: {}", formatted));
            }
        }
    });
}

fn build_mcp_catalog_snapshot(
    workspace_root: &PathBuf,
) -> Result<(McpToolCatalog, McpStatusSnapshot)> {
    let manager = McpManager::load(workspace_root.clone())?;
    let servers = manager.servers().cloned().collect::<Vec<_>>();
    let configured_servers = servers.len();
    let mut loaded_servers = 0usize;
    let mut cached_tools = 0usize;
    let mut definitions = Vec::new();
    let mut routes = BTreeMap::new();
    let mut first_error = None;

    for server in servers {
        if server.state != McpServerRuntimeState::Ready {
            continue;
        }

        loaded_servers += 1;
        if !server.capabilities.tools {
            continue;
        }

        match manager.list_tools(&server.name) {
            Ok(tools) => {
                cached_tools += tools.len();
                for tool in tools {
                    let function_name = synthetic_mcp_function_name(&server.name, &tool.name);
                    let description = tool.description.clone().unwrap_or_else(|| {
                        format!(
                            "MCP tool `{}` from server `{}`.",
                            tool.name, server.display_name
                        )
                    });
                    let parameters = if tool.input_schema.is_object() {
                        tool.input_schema.clone()
                    } else {
                        json!({
                            "type": "object",
                            "additionalProperties": true,
                        })
                    };

                    definitions.push(json!({
                        "type": "function",
                        "function": {
                            "name": function_name,
                            "description": format!("[MCP {}] {}", server.display_name, description),
                            "parameters": parameters,
                        }
                    }));
                    routes.insert(
                        function_name,
                        McpFunctionRoute {
                            server: server.name.clone(),
                            display_name: server.display_name.clone(),
                            tool_name: tool.name,
                        },
                    );
                }
            }
            Err(err) => {
                let formatted = logging::format_error_chain(&err);
                logging::log_event(&format!(
                    "[mcp] preload tools failed for server {}: {}",
                    server.name, formatted
                ));
                if first_error.is_none() {
                    first_error = Some(formatted);
                }
            }
        }
    }

    let status = McpStatusSnapshot {
        revision: 0,
        state: if first_error.is_some() {
            McpStatusState::Error
        } else {
            McpStatusState::Ready
        },
        configured_servers,
        loaded_servers,
        cached_tools,
        last_error: first_error,
    };

    Ok((
        McpToolCatalog {
            definitions,
            routes,
        },
        status,
    ))
}

fn parse_optional_json_object(input: Option<&str>) -> Result<Option<Map<String, Value>>> {
    let Some(raw) = input.map(str::trim).filter(|raw| !raw.is_empty()) else {
        return Ok(None);
    };

    let value: Value =
        serde_json::from_str(raw).with_context(|| format!("JSON 解析失败: {}", raw))?;
    match value {
        Value::Object(map) => Ok(Some(map)),
        _ => Err(anyhow!(
            "参数必须是 JSON object，例如 {{\"owner\":\"microsoft\"}}"
        )),
    }
}

fn synthetic_mcp_function_name(server: &str, tool: &str) -> String {
    let server = truncate_identifier_fragment(
        &sanitize_identifier_fragment(server),
        MCP_SERVER_FRAGMENT_LIMIT,
    );
    let tool =
        truncate_identifier_fragment(&sanitize_identifier_fragment(tool), MCP_TOOL_FRAGMENT_LIMIT);

    let mut hasher = DefaultHasher::new();
    server.hash(&mut hasher);
    tool.hash(&mut hasher);
    let digest = hasher.finish();

    let mut name = format!("mcp__{}__{}__{:08x}", server, tool, digest as u32);
    if name.len() > MCP_FUNCTION_NAME_LIMIT {
        name.truncate(MCP_FUNCTION_NAME_LIMIT);
    }
    name
}

fn sanitize_identifier_fragment(input: &str) -> String {
    let mut out = String::new();
    for ch in input.chars() {
        if ch.is_ascii_alphanumeric() {
            out.push(ch.to_ascii_lowercase());
        } else if !out.ends_with('_') {
            out.push('_');
        }
    }

    let trimmed = out.trim_matches('_');
    if trimmed.is_empty() {
        "tool".to_string()
    } else {
        trimmed.to_string()
    }
}

fn truncate_identifier_fragment(input: &str, max_len: usize) -> String {
    input.chars().take(max_len).collect()
}

pub struct OpenAiCompatibleTransport {
    secret_store: Arc<dyn SecretStore>,
    telemetry: Arc<dyn Telemetry>,
    workspace_root: PathBuf,
}

impl OpenAiCompatibleTransport {
    pub fn new(
        secret_store: Arc<dyn SecretStore>,
        telemetry: Arc<dyn Telemetry>,
        app_paths: &dyn AppPaths,
    ) -> Self {
        Self {
            secret_store,
            telemetry,
            workspace_root: app_paths.workspace_root(),
        }
    }

    fn resolve_model_config(&self, config: &AppConfig) -> Result<ResolvedLlmConfig> {
        let active = config
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

        Ok(ResolvedLlmConfig {
            model: active.name.clone(),
            api_base,
            api_key,
            workspace_root: self.workspace_root.clone(),
        })
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
}

impl LlmTransport for OpenAiCompatibleTransport {
    fn start_tool_agent_round(
        &self,
        config: &AppConfig,
        state: crate::llm_client::ToolAgentState,
        tools: Value,
    ) -> Result<StartedToolAgentRound> {
        let resolved = self.resolve_model_config(config)?;
        let telemetry = Arc::clone(&self.telemetry);
        let (stream_tx, stream_rx) = mpsc::channel::<crate::llm_client::StreamEvent>();
        let (result_tx, result_rx) = mpsc::channel::<ToolAgentRoundCompletion>();

        thread::spawn(move || {
            let mut state = state;
            let mut request_trace = Vec::new();
            let outcome = llm_client::stream_tool_agent_round(
                &resolved,
                telemetry.as_ref(),
                &mut state,
                &tools,
                &stream_tx,
                Some(&mut request_trace),
            );

            match outcome {
                Ok(step) => {
                    let _ = stream_tx.send(crate::llm_client::StreamEvent::Done);
                    let _ = result_tx.send(ToolAgentRoundCompletion::Success(ToolAgentRoundResult {
                        state,
                        step,
                        request_trace,
                    }));
                }
                Err(err) => {
                    let _ = stream_tx.send(crate::llm_client::StreamEvent::Error(err.to_string()));
                    let _ = stream_tx.send(crate::llm_client::StreamEvent::Done);
                    let _ = result_tx.send(ToolAgentRoundCompletion::Failure {
                        error: err.to_string(),
                        request_trace,
                    });
                }
            }
        });

        Ok(StartedToolAgentRound {
            stream_rx,
            result_rx,
        })
    }

    fn compact_history_manual(
        &self,
        config: &AppConfig,
        history: &mut Vec<LlmMessage>,
        progress_tx: Option<&std::sync::mpsc::Sender<String>>,
    ) -> Result<llm_client::CompactResult> {
        let resolved = self.resolve_model_config(config)?;
        llm_client::compact_history_manual(&resolved, self.telemetry.as_ref(), history, progress_tx)
    }

    fn compact_summary_text(&self, history: &[LlmMessage]) -> Option<String> {
        llm_client::compact_summary_text(history)
    }

    fn is_context_overflow_error(&self, err: &str) -> bool {
        llm_client::is_context_overflow_error(err)
    }

    fn llm_history_as_api_messages(&self, history: &[LlmMessage]) -> Vec<Value> {
        llm_client::llm_history_as_api_messages(history, &self.workspace_root)
    }

    fn llm_system_prompts_for_export(&self) -> Value {
        llm_client::llm_system_prompts_for_export()
    }
}
