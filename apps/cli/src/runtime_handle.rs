use anyhow::Result;
use serde_json::Value;
use std::{path::PathBuf, sync::Arc};

use crate::{
    ask_questions::AskQuestionsResult,
    host_runtime::RuntimeEvent,
    mcp::McpServerConfig,
    mcp_types::{
        ManagedMcpServer, McpDiscoveredPrompt, McpDiscoveredResource, McpDiscoveredTool,
        McpServerInspection,
    },
    model_registry::AppConfig,
    plan::PlanMetadata,
    ports::{
        AssistantAuxArchiveEntry, ChatArchive, McpStatusSnapshot, SecretStore,
        SubagentSessionArchiveEntry, SubagentSessionSummary,
    },
    session::SessionModel,
    skills::ActiveSkillPayload,
    ts_bridge::{
        CliExtensionEntry, CliHostMetadataSnapshot, CliMarketplaceCatalogItem,
        CliMarketplaceDetail, CliMarketplacePreparedInstall, TsBridgeRuntime,
    },
    view::{ChatMessage, PendingAssistantAux, PendingSubagentApprovalView},
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
    ) -> Result<Self> {
        Ok(Self {
            runtime: TsBridgeRuntime::new(config, secret_store, workspace_root)?,
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

    pub fn replace_plan_metadata(&mut self, metadata: PlanMetadata) {
        self.runtime.replace_plan_metadata(metadata)
    }

    pub fn activate_skill(&mut self, skill: ActiveSkillPayload) -> Result<()> {
        self.runtime.activate_skill(skill)
    }

    pub fn load_cli_host_metadata(&mut self, plan_mode: bool) -> Result<CliHostMetadataSnapshot> {
        self.runtime.load_cli_host_metadata(plan_mode)
    }

    pub fn load_plan_metadata(&mut self, plan_mode: bool) -> Result<PlanMetadata> {
        self.runtime.load_plan_metadata(plan_mode)
    }

    pub fn write_rule_state(
        &mut self,
        enabled_overrides: std::collections::BTreeMap<String, bool>,
    ) -> Result<PathBuf> {
        self.runtime.write_rule_state(enabled_overrides)
    }

    pub fn write_skill_state(
        &mut self,
        enabled_overrides: std::collections::BTreeMap<String, bool>,
    ) -> Result<PathBuf> {
        self.runtime.write_skill_state(enabled_overrides)
    }

    pub fn reload_host_metadata(&mut self, plan_mode: bool) -> Result<()> {
        self.runtime.reload_host_metadata(plan_mode)
    }

    pub fn list_extensions(&mut self) -> Result<Vec<CliExtensionEntry>> {
        self.runtime.list_extensions()
    }

    pub fn import_extension_archive(
        &mut self,
        archive_bytes: &[u8],
        file_name: Option<&str>,
    ) -> Result<CliExtensionEntry> {
        self.runtime
            .import_extension_archive(archive_bytes, file_name)
    }

    pub fn delete_extension(&mut self, id: &str) -> Result<()> {
        self.runtime.delete_extension(id)
    }

    pub fn list_marketplace_extensions(&mut self) -> Result<Vec<CliMarketplaceCatalogItem>> {
        self.runtime.list_marketplace_extensions()
    }

    pub fn get_marketplace_extension_detail(
        &mut self,
        extension_id: &str,
    ) -> Result<CliMarketplaceDetail> {
        self.runtime.get_marketplace_extension_detail(extension_id)
    }

    pub fn get_marketplace_extension_readme(&mut self, extension_id: &str) -> Result<String> {
        self.runtime.get_marketplace_extension_readme(extension_id)
    }

    pub fn prepare_marketplace_extension_install(
        &mut self,
        extension_id: &str,
        version: Option<&str>,
    ) -> Result<CliMarketplacePreparedInstall> {
        self.runtime
            .prepare_marketplace_extension_install(extension_id, version)
    }

    pub fn install_marketplace_extension(
        &mut self,
        extension_id: &str,
        version: Option<&str>,
        review_acknowledged: bool,
    ) -> Result<CliExtensionEntry> {
        self.runtime
            .install_marketplace_extension(extension_id, version, review_acknowledged)
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

    pub fn subagent_sessions(&self) -> &[SubagentSessionSummary] {
        self.runtime.subagent_sessions()
    }

    pub fn subagent_session_archive(
        &mut self,
        session_id: &str,
    ) -> Result<Option<SubagentSessionArchiveEntry>> {
        self.runtime.subagent_session_archive(session_id)
    }

    pub fn subagent_live_messages(&self, session_id: &str) -> Vec<ChatMessage> {
        self.runtime.subagent_live_messages(session_id)
    }

    pub fn subagent_pending_aux_state(
        &mut self,
        session_id: &str,
    ) -> Result<Option<PendingAssistantAux>> {
        self.runtime.subagent_pending_aux_state(session_id)
    }

    pub fn pending_subagent_approval(&self) -> Option<PendingSubagentApprovalView> {
        self.runtime.pending_subagent_approval()
    }

    pub fn has_pending_tool_approval(&self) -> bool {
        self.runtime.has_pending_tool_approval()
    }

    pub fn is_busy(&self) -> bool {
        self.runtime.is_busy()
    }

    pub fn abort(&mut self) {
        self.runtime.abort()
    }

    pub fn continue_assistant_completion(&mut self) -> Result<()> {
        self.runtime.continue_assistant_completion()
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

    pub fn list_cached_mcp_prompts(&mut self, name: &str) -> Result<Vec<McpDiscoveredPrompt>> {
        self.runtime.list_cached_mcp_prompts(name)
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
        user_message: Option<&str>,
    ) -> Result<String> {
        self.runtime
            .apply_mcp_prompt(server, prompt, args_json, user_message)
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

    pub fn respond_to_pending_questions(&mut self, result: &AskQuestionsResult) {
        self.runtime.respond_to_pending_questions(result)
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
