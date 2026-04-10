use anyhow::Result;
use serde_json::Value;
use std::{path::PathBuf, sync::Arc};

use crate::{
    mcp::McpServerConfig,
    mcp_manager::{
        ManagedMcpServer, McpDiscoveredPrompt, McpDiscoveredResource, McpDiscoveredTool,
        McpServerInspection,
    },
    model_registry::AppConfig,
    ports::{LlmTransport, McpStatusSnapshot, SecretStore, ToolExecutor},
    runtime::{AgentRuntime, RuntimeEvent},
    session::SessionModel,
    ts_bridge::TsBridgeRuntime,
    view::PendingAssistantAux,
};

#[derive(Clone, Debug)]
pub struct RuntimeExportState {
    pub api_messages: Vec<Value>,
    pub system_prompts: Value,
    pub api_request_trace: Vec<Value>,
}

pub enum RuntimeHandle {
    Rust(AgentRuntime),
    Ts(TsBridgeRuntime),
}

impl RuntimeHandle {
    pub fn new_rust(
        config: AppConfig,
        llm_transport: Arc<dyn LlmTransport>,
        tool_executor: Box<dyn ToolExecutor>,
        workspace_root: PathBuf,
    ) -> Self {
        Self::Rust(AgentRuntime::new(
            config,
            llm_transport,
            tool_executor,
            workspace_root,
        ))
    }

    pub fn new_ts(
        config: AppConfig,
        secret_store: Arc<dyn SecretStore>,
        workspace_root: PathBuf,
    ) -> Result<Self> {
        Ok(Self::Ts(TsBridgeRuntime::new(
            config,
            secret_store,
            workspace_root,
        )?))
    }

    pub fn config(&self) -> &AppConfig {
        match self {
            Self::Rust(runtime) => runtime.config(),
            Self::Ts(runtime) => runtime.config(),
        }
    }

    pub fn replace_config(&mut self, config: AppConfig) {
        match self {
            Self::Rust(runtime) => runtime.replace_config(config),
            Self::Ts(runtime) => runtime.replace_config(config),
        }
    }

    pub fn session(&self) -> &SessionModel {
        match self {
            Self::Rust(runtime) => runtime.session(),
            Self::Ts(runtime) => runtime.session(),
        }
    }

    pub fn llm_history_as_api_messages(&self) -> Vec<Value> {
        match self {
            Self::Rust(runtime) => runtime.llm_history_as_api_messages(),
            Self::Ts(runtime) => runtime.llm_history_as_api_messages(),
        }
    }

    pub fn llm_system_prompts_for_export(&self) -> Value {
        match self {
            Self::Rust(runtime) => runtime.llm_system_prompts_for_export(),
            Self::Ts(runtime) => runtime.llm_system_prompts_for_export(),
        }
    }

    pub fn export_llm_state(&mut self) -> Result<RuntimeExportState> {
        match self {
            Self::Rust(runtime) => Ok(RuntimeExportState {
                api_messages: runtime.llm_history_as_api_messages(),
                system_prompts: runtime.llm_system_prompts_for_export(),
                api_request_trace: runtime.session().llm_api_trace().to_vec(),
            }),
            Self::Ts(runtime) => runtime.export_llm_state(),
        }
    }

    pub fn mcp_status_snapshot(&self) -> McpStatusSnapshot {
        match self {
            Self::Rust(runtime) => runtime.mcp_status_snapshot(),
            Self::Ts(runtime) => runtime.mcp_status_snapshot(),
        }
    }

    pub fn has_pending_tool_approval(&self) -> bool {
        match self {
            Self::Rust(runtime) => runtime.has_pending_tool_approval(),
            Self::Ts(runtime) => runtime.has_pending_tool_approval(),
        }
    }

    pub fn is_busy(&self) -> bool {
        match self {
            Self::Rust(runtime) => runtime.is_busy(),
            Self::Ts(runtime) => runtime.is_busy(),
        }
    }

    pub fn drain_events(&mut self) -> Vec<RuntimeEvent> {
        match self {
            Self::Rust(runtime) => runtime.drain_events(),
            Self::Ts(runtime) => runtime.drain_events(),
        }
    }

    pub fn pending_aux_state(&self) -> Option<PendingAssistantAux> {
        match self {
            Self::Rust(runtime) => runtime.pending_aux_state(),
            Self::Ts(runtime) => runtime.pending_aux_state(),
        }
    }

    pub fn tick_thinking_spinner(&mut self) {
        match self {
            Self::Rust(runtime) => runtime.tick_thinking_spinner(),
            Self::Ts(runtime) => runtime.tick_thinking_spinner(),
        }
    }

    pub fn poll(&mut self) {
        match self {
            Self::Rust(runtime) => runtime.poll(),
            Self::Ts(runtime) => runtime.poll(),
        }
    }

    pub fn handle_stream_stall_timeout(&mut self) {
        match self {
            Self::Rust(runtime) => runtime.handle_stream_stall_timeout(),
            Self::Ts(runtime) => runtime.handle_stream_stall_timeout(),
        }
    }

    pub fn submit_user_turn(&mut self, text: String, explicit_images: Option<Vec<String>>) {
        match self {
            Self::Rust(runtime) => runtime.submit_user_turn(text, explicit_images),
            Self::Ts(runtime) => runtime.submit_user_turn(text, explicit_images),
        }
    }

    pub fn list_mcp_servers(&self) -> Result<Vec<ManagedMcpServer>> {
        match self {
            Self::Rust(runtime) => runtime.list_mcp_servers(),
            Self::Ts(runtime) => runtime.list_mcp_servers(),
        }
    }

    pub fn inspect_mcp_server(&self, name: &str) -> Result<McpServerInspection> {
        match self {
            Self::Rust(runtime) => runtime.inspect_mcp_server(name),
            Self::Ts(runtime) => runtime.inspect_mcp_server(name),
        }
    }

    pub fn list_mcp_tools(&self, name: &str) -> Result<Vec<McpDiscoveredTool>> {
        match self {
            Self::Rust(runtime) => runtime.list_mcp_tools(name),
            Self::Ts(runtime) => runtime.list_mcp_tools(name),
        }
    }

    pub fn list_mcp_resources(&self, name: &str) -> Result<Vec<McpDiscoveredResource>> {
        match self {
            Self::Rust(runtime) => runtime.list_mcp_resources(name),
            Self::Ts(runtime) => runtime.list_mcp_resources(name),
        }
    }

    pub fn list_mcp_prompts(&self, name: &str) -> Result<Vec<McpDiscoveredPrompt>> {
        match self {
            Self::Rust(runtime) => runtime.list_mcp_prompts(name),
            Self::Ts(runtime) => runtime.list_mcp_prompts(name),
        }
    }

    pub fn attach_mcp_resource(&mut self, server: &str, uri: &str) -> Result<String> {
        match self {
            Self::Rust(runtime) => runtime.attach_mcp_resource(server, uri),
            Self::Ts(runtime) => runtime.attach_mcp_resource(server, uri),
        }
    }

    pub fn clear_pending_mcp_resources(&mut self) -> usize {
        match self {
            Self::Rust(runtime) => runtime.clear_pending_mcp_resources(),
            Self::Ts(runtime) => runtime.clear_pending_mcp_resources(),
        }
    }

    pub fn apply_mcp_prompt(
        &mut self,
        server: &str,
        prompt: &str,
        args_json: Option<&str>,
    ) -> Result<String> {
        match self {
            Self::Rust(runtime) => runtime.apply_mcp_prompt(server, prompt, args_json),
            Self::Ts(runtime) => runtime.apply_mcp_prompt(server, prompt, args_json),
        }
    }

    pub fn add_mcp_server(&mut self, name: &str, config: McpServerConfig) -> Result<PathBuf> {
        match self {
            Self::Rust(runtime) => runtime.add_mcp_server(name, config),
            Self::Ts(runtime) => runtime.add_mcp_server(name, config),
        }
    }

    pub fn execute_mcp_tool(
        &mut self,
        server: &str,
        tool_name: &str,
        args_json: Option<&str>,
    ) -> Result<()> {
        match self {
            Self::Rust(runtime) => runtime.execute_mcp_tool(server, tool_name, args_json),
            Self::Ts(runtime) => runtime.execute_mcp_tool(server, tool_name, args_json),
        }
    }

    pub fn respond_to_pending_tool_approval(&mut self, message: &str) {
        match self {
            Self::Rust(runtime) => runtime.respond_to_pending_tool_approval(message),
            Self::Ts(runtime) => runtime.respond_to_pending_tool_approval(message),
        }
    }

    pub fn execute_manual_tool_command(&mut self, message: &str) {
        match self {
            Self::Rust(runtime) => runtime.execute_manual_tool_command(message),
            Self::Ts(runtime) => runtime.execute_manual_tool_command(message),
        }
    }

    pub fn compact_history(&mut self) {
        match self {
            Self::Rust(runtime) => runtime.compact_history(),
            Self::Ts(runtime) => runtime.compact_history(),
        }
    }

    pub fn replace_session_from_archive(&mut self, archive: &crate::ports::ChatArchive) {
        match self {
            Self::Rust(runtime) => runtime.replace_session_from_archive(archive),
            Self::Ts(runtime) => runtime.replace_session_from_archive(archive),
        }
    }

    pub fn add_pending_image(&mut self, path: String) {
        match self {
            Self::Rust(runtime) => runtime.session_mut().add_pending_image(path),
            Self::Ts(runtime) => runtime.add_pending_image(path),
        }
    }

    pub fn clear_pending_images(&mut self) -> usize {
        match self {
            Self::Rust(runtime) => runtime.session_mut().clear_pending_images(),
            Self::Ts(runtime) => runtime.clear_pending_images(),
        }
    }
}