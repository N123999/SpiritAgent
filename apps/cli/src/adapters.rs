use anyhow::{Context, Result, anyhow};
use serde_json::Value;
use std::{env, path::PathBuf};

use crate::{
    chat_store,
    logging,
    mcp::{McpServerConfig, add_mcp_server},
    model_registry::{
        AppConfig, config_file_path, has_model_api_key, keyring_entry, load_config,
        remove_model_api_key, save_config, save_model_api_key,
    },
    ports::{AppPaths, ChatArchive, ChatRepository, ConfigStore, SecretStore, ToolExecutor},
    tool_runtime::{AuthorizationDecision, ToolRequest, ToolRuntime, TrustTarget},
};

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
            &archive.subagent_sessions,
        )
    }

    fn load(&self, path: &str) -> Result<ChatArchive> {
        let loaded = chat_store::load_chat(path)?;
        Ok(ChatArchive {
            messages: loaded.messages,
            assistant_aux: loaded.assistant_aux,
            llm_history: loaded.llm_history,
            subagent_sessions: loaded.subagent_sessions,
        })
    }
}

pub struct WorkspaceToolExecutor {
    inner: ToolRuntime,
    workspace_root: PathBuf,
}

impl WorkspaceToolExecutor {
    pub fn new() -> Self {
        Self {
            inner: ToolRuntime::new(),
            workspace_root: env::current_dir().unwrap_or_else(|_| PathBuf::from(".")),
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

    fn add_mcp_server(&mut self, name: &str, config: McpServerConfig) -> Result<PathBuf> {
        add_mcp_server(&self.workspace_root, name, config)
    }
}
