use anyhow::Result;
use serde_json::Value;
use std::{
    path::PathBuf,
    sync::mpsc::Receiver,
};

use crate::{
    llm_client::{CompactResult, LlmMessage, StreamEvent, ToolAgentState, ToolAgentStep},
    mcp_manager::{
        ManagedMcpServer, McpDiscoveredPrompt, McpDiscoveredResource, McpDiscoveredTool,
        McpServerInspection,
    },
    model_registry::AppConfig,
    tool_runtime::{AuthorizationDecision, ToolRequest, TrustTarget},
};

#[derive(Clone, Debug)]
pub struct AssistantAuxArchiveEntry {
    pub message_index: usize,
    pub thinking: Option<String>,
    pub compaction: Option<String>,
}

#[derive(Clone, Debug)]
pub struct ChatArchive {
    pub messages: Vec<(String, String)>,
    pub assistant_aux: Vec<AssistantAuxArchiveEntry>,
    pub llm_history: Vec<(String, String, Vec<String>)>,
}

pub trait AppPaths: Send + Sync {
    fn workspace_root(&self) -> PathBuf;
    fn config_file(&self) -> PathBuf;
    fn chats_dir(&self) -> PathBuf;
    fn permissions_file(&self) -> PathBuf;
    fn log_file(&self) -> PathBuf;
}

pub trait Telemetry: Send + Sync {
    fn log_event(&self, message: &str);
    fn log_json_http_body(&self, label: &str, payload: &Value);
}

pub trait ConfigStore: Send + Sync {
    fn load(&self) -> Result<AppConfig>;
    fn save(&self, config: &AppConfig) -> Result<()>;
}

pub trait SecretStore: Send + Sync {
    fn load_global_api_key(&self) -> Result<Option<String>>;
    fn save_global_api_key(&self, api_key: &str) -> Result<()>;
    fn remove_global_api_key(&self) -> Result<()>;
    fn load_model_api_key(&self, model_name: &str) -> Result<Option<String>>;
    fn save_model_api_key(&self, model_name: &str, api_key: &str) -> Result<()>;
    fn remove_model_api_key(&self, model_name: &str) -> Result<()>;
    fn has_model_api_key(&self, model_name: &str) -> Result<bool>;
}

pub trait ChatRepository: Send + Sync {
    fn list(&self) -> Result<Vec<String>>;
    fn save(&self, path: Option<&str>, archive: &ChatArchive) -> Result<PathBuf>;
    fn load(&self, path: &str) -> Result<ChatArchive>;
}

pub trait ToolExecutor: Send {
    fn tool_definitions_json(&self) -> Value;
    fn parse_command(&self, message: &str) -> Result<ToolRequest>;
    fn request_from_function_call(&self, name: &str, arguments_json: &str) -> Result<ToolRequest>;
    fn authorize(&self, request: &ToolRequest) -> Result<AuthorizationDecision>;
    fn trust(&mut self, target: &TrustTarget) -> Result<()>;
    fn execute(&mut self, request: &ToolRequest) -> Result<String>;
    fn list_mcp_servers(&self) -> Result<Vec<ManagedMcpServer>>;
    fn inspect_mcp_server(&self, name: &str) -> Result<McpServerInspection>;
    fn list_mcp_tools(&self, name: &str) -> Result<Vec<McpDiscoveredTool>>;
    fn list_mcp_resources(&self, name: &str) -> Result<Vec<McpDiscoveredResource>>;
    fn read_mcp_resource(&self, name: &str, uri: &str) -> Result<Value>;
    fn list_mcp_prompts(&self, name: &str) -> Result<Vec<McpDiscoveredPrompt>>;
    fn get_mcp_prompt(
        &self,
        name: &str,
        prompt: &str,
        args_json: Option<&str>,
    ) -> Result<Value>;
}

pub struct ToolAgentRoundResult {
    pub state: ToolAgentState,
    pub step: ToolAgentStep,
    pub request_trace: Vec<Value>,
}

pub struct StartedToolAgentRound {
    pub stream_rx: Receiver<StreamEvent>,
    pub result_rx: Receiver<Result<ToolAgentRoundResult>>,
}

pub trait LlmTransport: Send + Sync {
    fn start_tool_agent_round(
        &self,
        config: &AppConfig,
        state: ToolAgentState,
        tools: Value,
    ) -> Result<StartedToolAgentRound>;

    fn compact_history_manual(
        &self,
        config: &AppConfig,
        history: &mut Vec<LlmMessage>,
        progress_tx: Option<&std::sync::mpsc::Sender<String>>,
    ) -> Result<CompactResult>;

    fn compact_summary_text(&self, history: &[LlmMessage]) -> Option<String>;

    fn is_context_overflow_error(&self, err: &str) -> bool;

    fn llm_history_as_api_messages(&self, history: &[LlmMessage]) -> Vec<Value>;

    fn llm_system_prompts_for_export(&self) -> Value;
}
