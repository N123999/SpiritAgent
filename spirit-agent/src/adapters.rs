use anyhow::{Context, Result, anyhow};
use serde_json::Value;
use std::{
    env,
    path::PathBuf,
    sync::{Arc, mpsc},
    thread,
};

use crate::{
    chat_store,
    llm_client::{self, LlmMessage, ResolvedLlmConfig},
    logging,
    model_registry::{
        AppConfig, config_file_path, has_model_api_key, keyring_entry, load_config,
        remove_model_api_key, save_config, save_model_api_key,
    },
    ports::{
        AppPaths, ChatArchive, ChatRepository, ConfigStore, LlmTransport, SecretStore,
        StartedToolAgentRound, Telemetry, ToolAgentRoundResult, ToolExecutor,
    },
    tool_runtime::{AuthorizationDecision, ToolRequest, ToolRuntime, TrustTarget},
};

const ENV_API_BASE: &str = "SPIRIT_API_BASE";
const ENV_API_KEY: &str = "SPIRIT_API_KEY";
const PERMISSIONS_FILE: &str = "tool-permissions.json";

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
}

impl WorkspaceToolExecutor {
    pub fn new() -> Self {
        Self {
            inner: ToolRuntime::new(),
        }
    }
}

impl ToolExecutor for WorkspaceToolExecutor {
    fn tool_definitions_json(&self) -> Value {
        self.inner.tool_definitions_json()
    }

    fn parse_command(&self, message: &str) -> Result<ToolRequest> {
        self.inner.parse_tool_command(message)
    }

    fn request_from_function_call(&self, name: &str, arguments_json: &str) -> Result<ToolRequest> {
        ToolRuntime::request_from_function_call(name, arguments_json)
    }

    fn authorize(&self, request: &ToolRequest) -> Result<AuthorizationDecision> {
        self.inner.authorize(request)
    }

    fn trust(&mut self, target: &TrustTarget) -> Result<()> {
        self.inner.trust(target)
    }

    fn execute(&mut self, request: &ToolRequest) -> Result<String> {
        self.inner.execute(request)
    }
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
            "未检测到模型 {} 的 API Key。可执行 `spirit-agent model add {} --api-base <url> --key <api_key>` 或设置环境变量 {}",
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
        let (result_tx, result_rx) = mpsc::channel::<Result<ToolAgentRoundResult>>();

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
                    let _ = result_tx.send(Ok(ToolAgentRoundResult {
                        state,
                        step,
                        request_trace,
                    }));
                }
                Err(err) => {
                    let _ = stream_tx.send(crate::llm_client::StreamEvent::Error(err.to_string()));
                    let _ = stream_tx.send(crate::llm_client::StreamEvent::Done);
                    let _ = result_tx.send(Err(err));
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
