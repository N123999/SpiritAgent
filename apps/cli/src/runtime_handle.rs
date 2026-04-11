use anyhow::Result;
use serde_json::Value;
use std::{path::PathBuf, sync::Arc};

use crate::{
    host_runtime::RuntimeEvent,
    mcp::McpServerConfig,
    mcp_manager::{
        ManagedMcpServer, McpDiscoveredPrompt, McpDiscoveredResource, McpDiscoveredTool,
        McpServerInspection,
    },
    model_registry::AppConfig,
    ports::{AssistantAuxArchiveEntry, ChatArchive, McpStatusSnapshot, SecretStore},
    rules::EnabledRule,
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

pub struct RuntimeHandle {
    runtime: TsBridgeRuntime,
}

impl RuntimeHandle {
    pub fn new(
        config: AppConfig,
        secret_store: Arc<dyn SecretStore>,
        workspace_root: PathBuf,
        enabled_rules: Vec<EnabledRule>,
    ) -> Result<Self> {
        Ok(Self {
            runtime: TsBridgeRuntime::new(config, secret_store, workspace_root, enabled_rules)?,
        })
    }

    pub fn config(&self) -> &AppConfig {
        self.runtime.config()
    }

    pub fn validate_config_change(&self, config: &AppConfig) -> Result<()> {
        self.runtime.validate_config_change(config)
    }

    pub fn replace_config(&mut self, config: AppConfig) {
        self.runtime.replace_config(config)
    }

    pub fn replace_rules(&mut self, rules: Vec<EnabledRule>) {
        self.runtime.replace_rules(rules)
    }

    pub fn session(&self) -> &SessionModel {
        self.runtime.session()
    }

    pub fn export_llm_state(&mut self) -> Result<RuntimeExportState> {
        self.runtime.export_llm_state()
    }

    pub fn export_chat_archive(
        &mut self,
        messages: &[(String, String)],
        assistant_aux: &[AssistantAuxArchiveEntry],
    ) -> Result<ChatArchive> {
        self.runtime.export_chat_archive(messages, assistant_aux)
    }

    pub fn mcp_status_snapshot(&mut self) -> McpStatusSnapshot {
        self.runtime.mcp_status_snapshot()
    }

    pub fn has_pending_tool_approval(&self) -> bool {
        self.runtime.has_pending_tool_approval()
    }

    pub fn is_busy(&self) -> bool {
        self.runtime.is_busy()
    }

    pub fn drain_events(&mut self) -> Vec<RuntimeEvent> {
        self.runtime.drain_events()
    }

    pub fn pending_aux_state(&self) -> Option<PendingAssistantAux> {
        self.runtime.pending_aux_state()
    }

    pub fn tick_thinking_spinner(&mut self) {
        self.runtime.tick_thinking_spinner()
    }

    pub fn poll(&mut self) {
        self.runtime.poll()
    }

    pub fn handle_stream_stall_timeout(&mut self) {
        self.runtime.handle_stream_stall_timeout()
    }

    pub fn submit_user_turn(&mut self, text: String, explicit_images: Option<Vec<String>>) {
        self.runtime.submit_user_turn(text, explicit_images)
    }

    pub fn list_mcp_servers(&mut self) -> Result<Vec<ManagedMcpServer>> {
        self.runtime.list_mcp_servers()
    }

    pub fn inspect_mcp_server(&mut self, name: &str) -> Result<McpServerInspection> {
        self.runtime.inspect_mcp_server(name)
    }

    pub fn list_mcp_tools(&mut self, name: &str) -> Result<Vec<McpDiscoveredTool>> {
        self.runtime.list_mcp_tools(name)
    }

    pub fn list_mcp_resources(&mut self, name: &str) -> Result<Vec<McpDiscoveredResource>> {
        self.runtime.list_mcp_resources(name)
    }

    pub fn list_mcp_prompts(&mut self, name: &str) -> Result<Vec<McpDiscoveredPrompt>> {
        self.runtime.list_mcp_prompts(name)
    }

    pub fn attach_mcp_resource(&mut self, server: &str, uri: &str) -> Result<String> {
        self.runtime.attach_mcp_resource(server, uri)
    }

    pub fn clear_pending_mcp_resources(&mut self) -> usize {
        self.runtime.clear_pending_mcp_resources()
    }

    pub fn apply_mcp_prompt(
        &mut self,
        server: &str,
        prompt: &str,
        args_json: Option<&str>,
    ) -> Result<String> {
        self.runtime.apply_mcp_prompt(server, prompt, args_json)
    }

    pub fn add_mcp_server(&mut self, name: &str, config: McpServerConfig) -> Result<PathBuf> {
        self.runtime.add_mcp_server(name, config)
    }

    pub fn execute_mcp_tool(
        &mut self,
        server: &str,
        tool_name: &str,
        args_json: Option<&str>,
    ) -> Result<()> {
        self.runtime.execute_mcp_tool(server, tool_name, args_json)
    }

    pub fn respond_to_pending_tool_approval(&mut self, message: &str) {
        self.runtime.respond_to_pending_tool_approval(message)
    }

    pub fn execute_manual_tool_command(&mut self, message: &str) {
        self.runtime.execute_manual_tool_command(message)
    }

    pub fn compact_history(&mut self) {
        self.runtime.compact_history()
    }

    pub fn replace_session_from_archive(&mut self, archive: &crate::ports::ChatArchive) {
        self.runtime.replace_session_from_archive(archive)
    }

    pub fn add_pending_image(&mut self, path: String) {
        self.runtime.add_pending_image(path)
    }

    pub fn clear_pending_images(&mut self) -> usize {
        self.runtime.clear_pending_images()
    }
}