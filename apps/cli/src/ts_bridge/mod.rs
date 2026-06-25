use anyhow::{Result, anyhow};
use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64_STANDARD};
use serde_json::{Value, json};
use std::{
    collections::{HashMap, VecDeque},
    env,
    path::{Path, PathBuf},
    sync::Arc,
};

use crate::{
    host_runtime::RuntimeEvent,
    logging,
    hooks_types::{HookListItem, HooksValidationReport},
    mcp::{McpServerConfig, McpScope, add_mcp_server, spirit_agent_data_dir},
    mcp_types::{
        ManagedMcpServer, McpDiscoveredPrompt, McpDiscoveredResource, McpDiscoveredTool,
        McpServerInspection,
    },
    model_registry::AppConfig,
    plan::{self, PlanMetadata},
    ports::{
        AssistantAuxArchiveEntry, ChatArchive, McpStatusSnapshot, SecretStore,
        SubagentSessionArchiveEntry, SubagentSessionSummary,
    },
    rewind::{self, DesktopRewindCheckpointSnapshot, RewindRestoreOutcome},
    rules::EnabledRule,
    runtime_handle::RuntimeExportState,
    session::SessionModel,
    skills::{ActiveSkillPayload, EnabledSkillCatalogEntry},
    view::{ChatMessage, MessageRole, PendingAssistantAux, PendingSubagentApprovalView},
};

mod archive;
mod constants;
mod host_dispatch;
mod json_rpc;
mod runtime;
mod sync;
mod tool_ui;
mod transport;
mod types;

#[cfg(test)]
pub(crate) use constants::{ENV_API_BASE, ENV_API_KEY, ENV_RUNTIME_BACKEND_NODE_PATH};
pub(crate) use json_rpc::resolve_bridge_script;
use json_rpc::JsonRpcProcess;
pub use types::*;
pub(crate) use tool_ui::{approval_decision_from_input, tool_request_from_host_value};
#[cfg(test)]
pub(crate) use tool_ui::{is_retired_builtin_host_method, tool_request_from_local_mcp, tool_request_from_streaming_preview};
pub(crate) use types::bridge::{
    BridgeChatArchive, BridgeExportState, BridgePendingApproval, BridgeRuntimeSnapshot,
    BridgeSubagentSessionArchiveEntry, BridgeWorkspaceFileReferenceSuggestions,
};
#[cfg(test)]
pub(crate) use types::bridge::{
    BridgeManualToolCommandStartResult, BridgeRuntimeEvent, BridgeSubagentSessionSummary,
    BridgeToolExecution, LocalMcpToolFailedEvent, LocalMcpToolRequest, LocalMcpToolResultEvent,
};

pub struct TsBridgeRuntime {
    pub(crate) process: JsonRpcProcess,
    pub(crate) config: AppConfig,
    pub(crate) secret_store: Arc<dyn SecretStore>,
    pub(crate) workspace_root: PathBuf,
    pub(crate) session: SessionModel,
    pub(crate) rewind: rewind::StoredDesktopRewindMetadata,
    pub(crate) enabled_rules: Vec<EnabledRule>,
    pub(crate) enabled_skill_catalog: Vec<EnabledSkillCatalogEntry>,
    pub(crate) plan_metadata: PlanMetadata,
    pub(crate) active_plan_path: Option<PathBuf>,
    pending_aux_state: Option<PendingAssistantAux>,
    pub(crate) pending_approval_kind: Option<PendingApprovalKind>,
    current_pending_approval: Option<BridgePendingApproval>,
    pub(crate) pending_questions_active: bool,
    pub(crate) pending_assistant_has_output: bool,
    pub(crate) is_busy_cache: bool,
    pub(crate) child_sessions_cache: Vec<SubagentSessionSummary>,
    pub(crate) subagent_message_cache: HashMap<String, Vec<ChatMessage>>,
    pub(crate) events: VecDeque<RuntimeEvent>,
    pub(crate) bridge_failed: bool,
    /// 忙时切换模型/endpoint 已写入 `config`，但尚未对 TS `runtime.replaceConfig`；空闲后由 `flush_deferred_transport_replace` 应用。
    pub(crate) deferred_transport_replace: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum PendingApprovalKind {
    Tool,
    Manual,
}

pub(crate) fn bootstrap_plan_metadata() -> PlanMetadata {
    PlanMetadata {
        path: PathBuf::new(),
        exists: false,
        agent_mode: "agent".to_string(),
        plan_mode: false,
    }
}

impl TsBridgeRuntime {
    pub fn config(&self) -> &AppConfig {
        &self.config
    }

    pub fn validate_config_change(&self, config: &AppConfig) -> Result<()> {
        if !self.transport_config_will_change(config) {
            return Ok(());
        }

        self.resolve_transport_config_json_for(config).map(|_| ())
    }

    fn apply_transport_to_bridge(&mut self) {
        let pending_images = self.session.pending_image_paths().to_vec();
        let pending_resources = self.session.pending_mcp_resources().to_vec();
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

    fn flush_deferred_transport_replace(&mut self) {
        if !self.deferred_transport_replace {
            return;
        }
        if self.is_busy_cache || self.session.pending_user_turn().is_some() {
            return;
        }
        self.deferred_transport_replace = false;
        self.apply_transport_to_bridge();
    }

    pub fn replace_config(&mut self, config: AppConfig) {
        let transport_config_changed = self.transport_config_will_change(&config);
        if let Err(err) = self.validate_config_change(&config) {
            self.events
                .push_back(RuntimeEvent::PushMessage(ChatMessage::new(
                    MessageRole::Agent,
                    err.to_string(),
                )));
            return;
        }

        if !transport_config_changed {
            self.config = config;
            if let Err(err) = self.apply_llm_http_version_from_config() {
                self.handle_bridge_error(err);
            }
            return;
        }

        let busy_defer = self.is_busy_cache || self.session.pending_user_turn().is_some();
        self.config = config;
        if let Err(err) = self.apply_llm_http_version_from_config() {
            self.handle_bridge_error(err);
        }

        if busy_defer {
            self.deferred_transport_replace = true;
            return;
        }

        self.deferred_transport_replace = false;
        self.apply_transport_to_bridge();
    }

    pub fn replace_plan_metadata(&mut self, metadata: PlanMetadata) {
        self.plan_metadata = metadata;
        if !self.plan_metadata.path.as_os_str().is_empty() {
            self.active_plan_path = Some(self.plan_metadata.path.clone());
        }
        if self.bridge_failed {
            return;
        }

        let snapshot = match self.call_bridge(
            "runtime.replacePlanMetadata",
            Some(json!({
                "planMetadata": self.plan_metadata,
            })),
        ) {
            Ok(value) => value,
            Err(err) => {
                self.handle_bridge_error(err);
                return;
            }
        };

        match serde_json::from_value::<BridgeRuntimeSnapshot>(snapshot) {
            Ok(snapshot) => self.apply_snapshot(snapshot),
            Err(err) => self.handle_bridge_error(anyhow!(
                "解析 TS replacePlanMetadata snapshot 失败: {}",
                err
            )),
        }
    }

    pub fn activate_skill(&mut self, skill: ActiveSkillPayload) -> Result<()> {
        if self.bridge_failed {
            return Err(anyhow!("TS bridge 已失效，无法激活 skill"));
        }

        let snapshot = self.call_bridge(
            "runtime.activateSkill",
            Some(json!({
                "skill": skill,
            })),
        )?;
        self.apply_snapshot(serde_json::from_value(snapshot)?);
        Ok(())
    }

    pub fn has_active_plan(&self) -> bool {
        self.active_plan_path
            .as_ref()
            .is_some_and(|path| !path.as_os_str().is_empty())
    }

    pub fn active_plan_path(&self) -> Option<&Path> {
        self.active_plan_path.as_deref()
    }

    pub fn load_cli_host_metadata(&mut self, agent_mode: &str) -> Result<CliHostMetadataSnapshot> {
        let value = self.call_bridge(
            "hostInternal.loadCliMetadata",
            Some(json!({
                "agentMode": agent_mode,
                "activePlanPath": self.active_plan_path.as_ref().map(|path| path.display().to_string()),
            })),
        )?;
        let metadata: CliHostMetadataSnapshot = serde_json::from_value(value)?;
        self.plan_metadata = metadata.plan_metadata.clone();
        Ok(metadata)
    }

    pub fn load_plan_metadata(&mut self, agent_mode: &str) -> Result<PlanMetadata> {
        let value = self.call_bridge(
            "hostInternal.loadPlanMetadata",
            Some(json!({
                "agentMode": agent_mode,
                "activePlanPath": self.active_plan_path.as_ref().map(|path| path.display().to_string()),
            })),
        )?;
        Ok(serde_json::from_value(value)?)
    }

    pub fn list_workspace_file_reference_suggestions(
        &mut self,
        input: &str,
        cursor_chars: usize,
    ) -> Result<(Vec<String>, bool)> {
        let value = self.call_bridge(
            "hostInternal.listWorkspaceFileReferenceSuggestions",
            Some(json!({
                "input": input,
                "cursorChars": cursor_chars,
            })),
        )?;

        if value.is_null() {
            return Ok((Vec::new(), true));
        }

        let suggestions: BridgeWorkspaceFileReferenceSuggestions = serde_json::from_value(value)?;
        Ok((
            suggestions.suggestions,
            suggestions.index_ready.unwrap_or(true),
        ))
    }

    pub fn prime_workspace_file_reference_index(&mut self) -> Result<()> {
        self.call_bridge("hostInternal.primeWorkspaceFileReferenceIndex", None)?;
        Ok(())
    }

    pub fn write_rule_state(
        &mut self,
        enabled_overrides: std::collections::BTreeMap<String, bool>,
    ) -> Result<PathBuf> {
        let value = self.call_bridge(
            "hostInternal.writeRuleState",
            Some(json!({
                "enabledOverrides": enabled_overrides,
            })),
        )?;
        let path = value
            .as_str()
            .ok_or_else(|| anyhow!("hostInternal.writeRuleState 返回值无效"))?;
        Ok(PathBuf::from(path))
    }

    pub fn write_skill_state(
        &mut self,
        enabled_overrides: std::collections::BTreeMap<String, bool>,
    ) -> Result<PathBuf> {
        let value = self.call_bridge(
            "hostInternal.writeSkillState",
            Some(json!({
                "enabledOverrides": enabled_overrides,
            })),
        )?;
        let path = value
            .as_str()
            .ok_or_else(|| anyhow!("hostInternal.writeSkillState 返回值无效"))?;
        Ok(PathBuf::from(path))
    }

    pub fn list_extensions(&mut self) -> Result<Vec<CliExtensionEntry>> {
        let value = self.call_bridge("hostInternal.listExtensions", None)?;
        Ok(serde_json::from_value(value)?)
    }

    pub fn import_extension_archive(
        &mut self,
        archive_bytes: &[u8],
        file_name: Option<&str>,
    ) -> Result<CliExtensionEntry> {
        let value = self.call_bridge(
            "hostInternal.importExtension",
            Some(json!({
                "archiveBase64": BASE64_STANDARD.encode(archive_bytes),
                "fileName": file_name,
            })),
        )?;
        Ok(serde_json::from_value(value)?)
    }

    pub fn delete_extension(&mut self, id: &str) -> Result<()> {
        self.call_bridge(
            "hostInternal.deleteExtension",
            Some(json!({
                "id": id,
            })),
        )?;
        Ok(())
    }

    pub fn list_marketplace_extensions(&mut self) -> Result<Vec<CliMarketplaceCatalogItem>> {
        let value = self.call_bridge("hostInternal.listMarketplaceExtensions", None)?;
        Ok(serde_json::from_value(value)?)
    }

    pub fn get_marketplace_extension_detail(
        &mut self,
        extension_id: &str,
    ) -> Result<CliMarketplaceDetail> {
        let value = self.call_bridge(
            "hostInternal.getMarketplaceExtensionDetail",
            Some(json!({
                "extensionId": extension_id,
            })),
        )?;
        Ok(serde_json::from_value(value)?)
    }

    pub fn get_marketplace_extension_readme(&mut self, extension_id: &str) -> Result<String> {
        let value = self.call_bridge(
            "hostInternal.getMarketplaceExtensionReadme",
            Some(json!({
                "extensionId": extension_id,
            })),
        )?;
        Ok(serde_json::from_value(value)?)
    }

    pub fn prepare_marketplace_extension_install(
        &mut self,
        extension_id: &str,
        version: Option<&str>,
    ) -> Result<CliMarketplacePreparedInstall> {
        let mut params = json!({
            "extensionId": extension_id,
        });
        if let Some(version) = version {
            if !version.trim().is_empty() {
                params["version"] = Value::String(version.trim().to_string());
            }
        }
        let value = self.call_bridge(
            "hostInternal.prepareMarketplaceExtensionInstall",
            Some(params),
        )?;
        Ok(serde_json::from_value(value)?)
    }

    pub fn install_marketplace_extension(
        &mut self,
        extension_id: &str,
        version: Option<&str>,
        review_acknowledged: bool,
    ) -> Result<CliExtensionEntry> {
        let mut params = json!({
            "extensionId": extension_id,
        });
        if let Some(version) = version {
            if !version.trim().is_empty() {
                params["version"] = Value::String(version.trim().to_string());
            }
        }
        if review_acknowledged {
            params["reviewAcknowledged"] = Value::Bool(true);
        }
        let value = self.call_bridge("hostInternal.installMarketplaceExtension", Some(params))?;
        Ok(serde_json::from_value(value)?)
    }

    pub fn reload_host_metadata(&mut self, agent_mode: &str) -> Result<()> {
        let value = self.call_bridge(
            "runtime.reloadHostMetadata",
            Some(json!({
                "agentMode": agent_mode,
                "activePlanPath": self.active_plan_path.as_ref().map(|path| path.display().to_string()),
            })),
        )?;
        self.apply_snapshot(serde_json::from_value(value)?);
        Ok(())
    }

    pub fn session(&self) -> &SessionModel {
        &self.session
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

    pub fn export_chat_archive(
        &mut self,
        messages: &[(String, String)],
        assistant_aux: &[AssistantAuxArchiveEntry],
    ) -> Result<ChatArchive> {
        let message_values = messages
            .iter()
            .map(|(role, content)| {
                json!({
                    "role": role,
                    "content": content,
                })
            })
            .collect::<Vec<_>>();
        let value = self.call_bridge(
            "runtime.exportArchive",
            Some(json!({
                "messages": message_values,
                "assistantAux": assistant_aux,
            })),
        )?;
        let bridge_archive: BridgeChatArchive = serde_json::from_value(value)?;
        Ok(ChatArchive {
            messages: bridge_archive
                .messages
                .into_iter()
                .map(|message| (message.role, message.content))
                .collect(),
            assistant_aux: bridge_archive
                .assistant_aux
                .into_iter()
                .map(|entry| AssistantAuxArchiveEntry {
                    message_index: entry.message_index,
                    thinking: entry.thinking,
                    compaction: entry.compaction,
                    finish_task_notice: entry.finish_task_notice,
                })
                .collect(),
            llm_history: bridge_archive.llm_history,
            loop_enabled: bridge_archive.loop_enabled,
            approval_level: crate::ports::normalize_approval_level(&bridge_archive.approval_level),
            subagent_sessions: bridge_archive
                .subagent_sessions
                .into_iter()
                .map(|entry| SubagentSessionArchiveEntry {
                    summary: SubagentSessionSummary {
                        session_id: entry.summary.session_id,
                        parent_tool_call_id: entry.summary.parent_tool_call_id,
                        title: entry.summary.title,
                        status: entry.summary.status,
                        started_at_unix_ms: entry.summary.started_at_unix_ms,
                        updated_at_unix_ms: entry.summary.updated_at_unix_ms,
                        completed_at_unix_ms: entry.summary.completed_at_unix_ms,
                        latest_message: entry.summary.latest_message,
                        final_output: entry.summary.final_output,
                        error: entry.summary.error,
                    },
                    llm_history: entry.llm_history,
                })
                .collect(),
            desktop_messages: None,
            rewind: Some(self.rewind.as_json()),
            session_display_name: None,
        })
    }

    pub fn mcp_status_snapshot(&mut self) -> McpStatusSnapshot {
        match self.call_bridge("runtime.mcpStatusSnapshot", None) {
            Ok(value) => serde_json::from_value(value).unwrap_or_default(),
            Err(err) => {
                logging::log_event(&format!(
                    "[ts-bridge-host] read mcpStatusSnapshot failed: {}",
                    err
                ));
                McpStatusSnapshot::default()
            }
        }
    }

    pub fn can_rewind_message(&self, message_id: usize) -> bool {
        self.rewind.can_rewind_message(message_id)
    }

    pub fn set_todo_session_key(&mut self, session_key: &str) -> Result<()> {
        self.call_bridge(
            "hostInternal.setTodoSessionKey",
            Some(serde_json::json!({ "sessionKey": session_key })),
        )?;
        Ok(())
    }

    pub fn list_session_todos(&mut self) -> Result<Vec<rewind::HostTodoRecord>> {
        #[derive(serde::Deserialize)]
        struct HostTodoListResponse {
            todos: Vec<rewind::HostTodoRecord>,
        }
        let value = self.call_bridge("hostInternal.listSessionTodos", None)?;
        let parsed: HostTodoListResponse = serde_json::from_value(value)?;
        Ok(parsed.todos)
    }

    pub fn replace_session_todos(&mut self, records: Vec<rewind::HostTodoRecord>) -> Result<()> {
        self.call_bridge(
            "hostInternal.replaceSessionTodos",
            Some(serde_json::json!({ "records": records })),
        )?;
        Ok(())
    }

    pub fn record_rewind_checkpoint(
        &mut self,
        message_id: usize,
        message_index: usize,
        snapshot: DesktopRewindCheckpointSnapshot,
    ) -> Result<()> {
        let checkpoint = rewind::create_rewind_checkpoint_metadata(
            message_id,
            message_index,
            self.rewind.next_sequence(),
        );
        let spirit_data_dir = spirit_agent_data_dir();
        rewind::save_rewind_checkpoint_snapshot(
            &spirit_data_dir,
            &self.rewind.session_id,
            &checkpoint.id,
            &snapshot,
        )?;
        self.rewind.upsert_checkpoint(checkpoint);
        Ok(())
    }

    pub fn rewind_message(&mut self, message_id: usize) -> Result<RewindRestoreOutcome> {
        let checkpoint = self
            .rewind
            .checkpoint_for_message_id(message_id)
            .cloned()
            .ok_or_else(|| anyhow!("该消息没有可用的回溯检查点。"))?;
        let spirit_data_dir = spirit_agent_data_dir();
        let snapshot = rewind::load_rewind_checkpoint_snapshot(
            &spirit_data_dir,
            &self.rewind.session_id,
            &checkpoint.id,
        )?
        .ok_or_else(|| anyhow!("回溯检查点文件不存在，无法回溯。"))?;

        let changes_to_restore = self
            .rewind
            .file_changes
            .iter()
            .filter(|change| change.sequence > checkpoint.sequence)
            .cloned()
            .collect::<Vec<_>>();
        let mut loaded_changes = Vec::new();
        let mut warnings = Vec::new();
        for metadata in changes_to_restore {
            if let Some(stored) = rewind::load_rewind_file_change(
                &spirit_data_dir,
                &self.rewind.session_id,
                &metadata.id,
            )? {
                loaded_changes.push(stored);
            } else {
                warnings.push(rewind::HostFileRewindWarning {
                    change_id: Some(metadata.id.clone()),
                    path: metadata.resolved_path.clone(),
                    action: metadata.kind.clone(),
                    message: "文件变更快照缺失，已跳过该项回溯。".to_string(),
                });
            }
        }

        let restore_result = rewind::restore_host_file_changes(&loaded_changes)?;
        let mut outcome = rewind::resolve_before_checkpoint_state(&snapshot);
        outcome.restored = restore_result.restored;
        outcome.skipped = restore_result.skipped + warnings.len();
        outcome.warnings.extend(warnings);
        outcome.warnings.extend(restore_result.warnings);

        self.rewind.prune_after_checkpoint(checkpoint.sequence);
        self.replace_runtime_archive(&outcome.before_archive)?;
        let todos_to_restore = snapshot
            .before_todos
            .clone()
            .or(snapshot.todos.clone())
            .unwrap_or_default();
        self.replace_session_todos(todos_to_restore)?;
        Ok(outcome)
    }

    pub fn subagent_sessions(&self) -> &[SubagentSessionSummary] {
        &self.child_sessions_cache
    }

    pub fn subagent_session_archive(
        &mut self,
        session_id: &str,
    ) -> Result<Option<SubagentSessionArchiveEntry>> {
        let value = self.call_bridge(
            "runtime.subagentSessionArchive",
            Some(json!({
                "sessionId": session_id,
            })),
        )?;

        if value.is_null() {
            return Ok(None);
        }

        let archive: BridgeSubagentSessionArchiveEntry = serde_json::from_value(value)?;
        Ok(Some(SubagentSessionArchiveEntry {
            summary: SubagentSessionSummary {
                session_id: archive.summary.session_id,
                parent_tool_call_id: archive.summary.parent_tool_call_id,
                title: archive.summary.title,
                status: archive.summary.status,
                started_at_unix_ms: archive.summary.started_at_unix_ms,
                updated_at_unix_ms: archive.summary.updated_at_unix_ms,
                completed_at_unix_ms: archive.summary.completed_at_unix_ms,
                latest_message: archive.summary.latest_message,
                final_output: archive.summary.final_output,
                error: archive.summary.error,
            },
            llm_history: archive.llm_history,
        }))
    }

    pub fn subagent_pending_aux_state(
        &mut self,
        session_id: &str,
    ) -> Result<Option<PendingAssistantAux>> {
        let value = self.call_bridge(
            "runtime.subagentPendingAuxState",
            Some(json!({
                "sessionId": session_id,
            })),
        )?;

        if value.is_null() {
            return Ok(None);
        }

        Ok(Some(serde_json::from_value(value)?))
    }

    pub fn subagent_live_messages(&self, session_id: &str) -> Vec<ChatMessage> {
        self.subagent_message_cache
            .get(session_id)
            .cloned()
            .unwrap_or_default()
    }

    pub fn pending_subagent_approval(&self) -> Option<PendingSubagentApprovalView> {
        let approval = self.current_pending_approval.as_ref()?;
        let session_id = approval.subagent_session_id.clone()?;
        Some(PendingSubagentApprovalView {
            session_id,
            session_title: approval
                .subagent_title
                .clone()
                .unwrap_or_else(|| "SubAgent".to_string()),
            tool_name: approval.tool_name.clone(),
            prompt: approval.prompt.clone(),
        })
    }

    pub fn has_pending_tool_approval(&self) -> bool {
        self.pending_approval_kind.is_some()
    }

    pub fn is_busy(&self) -> bool {
        self.is_busy_cache
    }

    pub fn loop_enabled(&self) -> bool {
        self.session.loop_enabled()
    }

    pub fn set_loop_enabled(&mut self, enabled: bool) -> Result<()> {
        if self.bridge_failed {
            return Err(anyhow!("TS bridge 已处于失败状态。"));
        }
        let value = self.call_bridge(
            "runtime.setLoopEnabled",
            Some(json!({
                "enabled": enabled,
            })),
        )?;
        self.apply_snapshot(serde_json::from_value(value)?);
        Ok(())
    }

    pub fn approval_level(&self) -> &str {
        self.session.approval_level()
    }

    pub fn set_approval_level(&mut self, approval_level: &str) -> Result<()> {
        if self.bridge_failed {
            return Err(anyhow!("TS bridge 已处于失败状态。"));
        }
        let normalized = crate::ports::normalize_approval_level(approval_level);
        let value = self.call_bridge(
            "runtime.setApprovalLevel",
            Some(json!({
                "approvalLevel": normalized,
            })),
        )?;
        self.apply_snapshot(serde_json::from_value(value)?);
        Ok(())
    }

    pub fn set_llm_http_version(&mut self, llm_http_version: &str) -> Result<()> {
        if self.bridge_failed {
            return Err(anyhow!("TS bridge 已处于失败状态。"));
        }
        let normalized = crate::ports::normalize_llm_http_version(llm_http_version);
        self.call_bridge(
            "runtime.setLlmHttpVersion",
            Some(json!({
                "llmHttpVersion": normalized,
            })),
        )?;
        Ok(())
    }

    pub fn set_llm_client_version(&mut self, client_version: &str) -> Result<()> {
        if self.bridge_failed {
            return Err(anyhow!("TS bridge 已处于失败状态。"));
        }
        self.call_bridge(
            "runtime.setLlmClientVersion",
            Some(json!({
                "clientVersion": client_version,
            })),
        )?;
        Ok(())
    }

    pub fn store_config(&mut self, config: AppConfig) {
        self.config = config;
    }

    fn apply_llm_http_version_from_config(&mut self) -> Result<()> {
        if self.bridge_failed {
            return Err(anyhow!("TS bridge 已处于失败状态。"));
        }
        let version = self.config.networks.llm_http_version.clone();
        self.set_llm_http_version(&version)
    }

    fn apply_llm_client_version_from_build(&mut self) -> Result<()> {
        if self.bridge_failed {
            return Err(anyhow!("TS bridge 已处于失败状态。"));
        }
        self.set_llm_client_version(env!("CARGO_PKG_VERSION"))
    }

    pub fn pending_aux_state(&self) -> Option<PendingAssistantAux> {
        self.pending_aux_state.clone()
    }

    pub fn submit_user_turn(
        &mut self,
        text: String,
        explicit_images: Option<Vec<String>>,
    ) -> Result<()> {
        if self.bridge_failed {
            return Err(anyhow!("TS bridge 已处于失败状态。"));
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
            let message = err.to_string();
            self.handle_bridge_error(anyhow!(message.clone()));
            return Err(anyhow!(message));
        }
        if let Err(err) = self.sync_after_command() {
            let message = err.to_string();
            self.handle_bridge_error(anyhow!(message.clone()));
            return Err(anyhow!(message));
        }
        Ok(())
    }

    pub fn list_mcp_servers(&mut self) -> Result<Vec<ManagedMcpServer>> {
        let value = self.call_bridge("runtime.listMcpServers", None)?;
        Ok(serde_json::from_value(value)?)
    }

    pub fn validate_hooks(&mut self, workspace_root: Option<&str>) -> Result<HooksValidationReport> {
        let params = workspace_root.map(|root| json!({ "workspaceRoot": root }));
        let value = self.call_bridge("hostInternal.validateHooks", params)?;
        Ok(serde_json::from_value(value)?)
    }

    pub fn list_hook_entries(&mut self, workspace_root: Option<&str>) -> Result<Vec<HookListItem>> {
        let params = workspace_root.map(|root| json!({ "workspaceRoot": root }));
        let value = self.call_bridge("hostInternal.listHookEntries", params)?;
        Ok(serde_json::from_value(value)?)
    }

    pub fn save_hook_entry(
        &mut self,
        workspace_binding: Option<&str>,
        request: &crate::hooks_types::SaveHookEntryRequest,
    ) -> Result<()> {
        let mut params = json!({ "request": request });
        if let Some(obj) = params.as_object_mut() {
            if let Some(binding) = workspace_binding {
                obj.insert("workspaceBinding".to_string(), json!(binding));
            }
        }
        self.call_bridge("hostInternal.saveHookEntry", Some(params))?;
        Ok(())
    }

    pub fn inspect_mcp_server(&mut self, name: &str) -> Result<McpServerInspection> {
        let value = self.call_bridge("runtime.inspectMcpServer", Some(json!({ "name": name })))?;
        Ok(serde_json::from_value(value)?)
    }

    pub fn list_mcp_tools(&mut self, name: &str) -> Result<Vec<McpDiscoveredTool>> {
        let value = self.call_bridge("runtime.listMcpTools", Some(json!({ "name": name })))?;
        Ok(serde_json::from_value(value)?)
    }

    pub fn list_mcp_resources(&mut self, name: &str) -> Result<Vec<McpDiscoveredResource>> {
        let value = self.call_bridge("runtime.listMcpResources", Some(json!({ "name": name })))?;
        Ok(serde_json::from_value(value)?)
    }

    pub fn list_mcp_prompts(&mut self, name: &str) -> Result<Vec<McpDiscoveredPrompt>> {
        let value = self.call_bridge("runtime.listMcpPrompts", Some(json!({ "name": name })))?;
        Ok(serde_json::from_value(value)?)
    }

    pub fn list_cached_mcp_prompts(&mut self, name: &str) -> Result<Vec<McpDiscoveredPrompt>> {
        let value = self.call_bridge(
            "runtime.listCachedMcpPrompts",
            Some(json!({ "name": name })),
        )?;
        Ok(serde_json::from_value(value)?)
    }

    pub fn read_mcp_resource_value(&mut self, server: &str, uri: &str) -> Result<Value> {
        self.call_bridge(
            "runtime.readMcpResource",
            Some(json!({ "server": server, "uri": uri })),
        )
    }

    pub fn get_mcp_prompt_value(
        &mut self,
        server: &str,
        prompt: &str,
        args_json: Option<&str>,
    ) -> Result<Value> {
        let mut params = json!({
            "server": server,
            "prompt": prompt,
        });
        if let Some(args_json) = args_json {
            params["argsJson"] = Value::String(args_json.to_string());
        }

        self.call_bridge("runtime.getMcpPrompt", Some(params))
    }

    pub fn call_mcp_tool_value(
        &mut self,
        server: &str,
        tool_name: &str,
        args_json: Option<&str>,
    ) -> Result<Value> {
        let mut params = json!({
            "server": server,
            "tool": tool_name,
        });
        if let Some(args_json) = args_json {
            params["argsJson"] = Value::String(args_json.to_string());
        }

        self.call_bridge("runtime.callMcpTool", Some(params))
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
        user_message: Option<&str>,
    ) -> Result<String> {
        let mut params = json!({
            "server": server,
            "prompt": prompt,
        });
        if let Some(args_json) = args_json {
            params["argsJson"] = Value::String(args_json.to_string());
        }
        if let Some(user_message) = user_message {
            params["userMessage"] = Value::String(user_message.to_string());
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

    pub fn add_mcp_server(&mut self, scope: McpScope, name: &str, config: McpServerConfig) -> Result<PathBuf> {
        let path = add_mcp_server(&self.workspace_root, scope, name, config)?;
        let _ = self.call_bridge("runtime.startMcpBackgroundRefresh", None)?;
        Ok(path)
    }

    pub fn execute_mcp_tool(
        &mut self,
        server: &str,
        tool_name: &str,
        args_json: Option<&str>,
    ) -> Result<()> {
        let mut params = json!({
            "server": server,
            "tool": tool_name,
        });
        if let Some(args_json) = args_json {
            params["argsJson"] = Value::String(args_json.to_string());
        }

        let value = self.call_bridge("runtime.startManualMcpTool", Some(params))?;
        self.handle_manual_tool_command_bridge_response(&value)?;
        self.sync_after_command()?;
        Ok(())
    }

    pub fn respond_to_pending_tool_approval(&mut self, message: &str) {
        if self.bridge_failed {
            return;
        }
        let decision = approval_decision_from_input(message);
        let pending_kind = self.pending_approval_kind;
        let method = match pending_kind {
            Some(PendingApprovalKind::Manual) => "runtime.continuePendingManualToolApproval",
            Some(PendingApprovalKind::Tool) => "runtime.respondToPendingApproval",
            None => return,
        };

        let value = match self.call_bridge(method, Some(json!({ "decision": decision }))) {
            Ok(value) => value,
            Err(err) => {
                self.handle_bridge_error(err);
                return;
            }
        };

        if pending_kind == Some(PendingApprovalKind::Manual)
            && let Err(err) = self.handle_manual_tool_command_bridge_response(&value)
        {
            self.handle_bridge_error(err);
            return;
        }

        if let Err(err) = self.sync_after_command() {
            self.handle_bridge_error(err);
        }
    }

    pub fn respond_to_pending_questions(
        &mut self,
        result: &crate::ask_questions::AskQuestionsResult,
    ) {
        if self.bridge_failed {
            return;
        }

        if let Err(err) = self.call_bridge(
            "runtime.respondToPendingQuestions",
            Some(json!({ "result": result })),
        ) {
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
        let value = match self.call_bridge(
            "runtime.startManualToolCommand",
            Some(json!({ "message": message })),
        ) {
            Ok(value) => value,
            Err(err) => {
                self.handle_bridge_error(err);
                return;
            }
        };

        if let Err(err) = self.handle_manual_tool_command_bridge_response(&value) {
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
        if let Err(err) = self.replace_runtime_archive(archive) {
            self.handle_bridge_error(err);
            return;
        }
        self.rewind = rewind::normalize_desktop_rewind_metadata(archive.rewind.as_ref());
        self.active_plan_path =
            plan::extract_active_plan_path_from_archived_llm_history(&archive.llm_history);
        self.plan_metadata = plan::plan_metadata_snapshot(
            self.plan_metadata.spirit_agent_mode(),
            self.active_plan_path.as_deref(),
        );
    }

    pub fn activate_forked_session(
        &mut self,
        archive: &crate::ports::ChatArchive,
        todos: Vec<rewind::HostTodoRecord>,
    ) -> Result<()> {
        self.replace_runtime_archive(archive)?;
        self.rewind = rewind::normalize_desktop_rewind_metadata(archive.rewind.as_ref());
        self.active_plan_path =
            plan::extract_active_plan_path_from_archived_llm_history(&archive.llm_history);
        self.plan_metadata = plan::plan_metadata_snapshot(
            self.plan_metadata.spirit_agent_mode(),
            self.active_plan_path.as_deref(),
        );
        let session_key = self.rewind.session_id.clone();
        self.set_todo_session_key(&session_key)?;
        self.replace_session_todos(todos)?;
        Ok(())
    }

    pub fn reset_session(&mut self) -> Result<()> {
        if self.bridge_failed {
            return Err(anyhow!("TS bridge 已失效，无法开始新会话"));
        }
        let new_rewind = rewind::create_desktop_rewind_metadata();
        let archive = crate::ports::ChatArchive {
            messages: vec![],
            assistant_aux: vec![],
            llm_history: vec![],
            loop_enabled: false,
            approval_level: "default".to_string(),
            subagent_sessions: vec![],
            desktop_messages: None,
            rewind: Some(new_rewind.as_json()),
            session_display_name: None,
        };
        self.replace_runtime_archive(&archive)?;
        self.rewind = new_rewind;
        self.active_plan_path = None;
        self.plan_metadata = plan::plan_metadata_snapshot(
            self.plan_metadata.spirit_agent_mode(),
            None,
        );
        let session_key = self.rewind.session_id.clone();
        self.set_todo_session_key(&session_key)?;
        self.replace_session_todos(vec![])?;
        Ok(())
    }

    pub fn add_pending_image(&mut self, path: String) {
        if self.bridge_failed {
            return;
        }
        let value = match self.call_bridge("runtime.addPendingImage", Some(json!({ "path": path })))
        {
            Ok(value) => value,
            Err(err) => {
                self.handle_bridge_error(err);
                return;
            }
        };

        match serde_json::from_value::<BridgeRuntimeSnapshot>(value) {
            Ok(snapshot) => self.apply_snapshot(snapshot),
            Err(err) => {
                self.handle_bridge_error(anyhow!("解析 TS addPendingImage snapshot 失败: {}", err))
            }
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

    #[cfg(test)]
    pub(crate) fn deferred_transport_replace_for_test(&self) -> bool {
        self.deferred_transport_replace
    }
}

#[cfg(test)]
mod tests {
    use super::{
        BridgeManualToolCommandStartResult, BridgeRuntimeEvent, BridgeRuntimeSnapshot,
        BridgeToolExecution, ENV_RUNTIME_BACKEND_NODE_PATH, TsBridgeRuntime, resolve_bridge_script,
    };
    use crate::{
        host_runtime::RuntimeEvent,
        model_registry::{AppConfig, DEFAULT_API_BASE, ModelProfile, ModelProvider, NetworksConfig},
        ports::SecretStore,
    };
    use anyhow::{Result, anyhow};
    use serde_json::{Value, json};
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

    fn make_test_runtime() -> Option<TsBridgeRuntime> {
        let workspace_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .expect("workspace root")
            .to_path_buf();

        if resolve_bridge_script(&workspace_root).is_err() {
            return None;
        }

        let node_path =
            env::var(ENV_RUNTIME_BACKEND_NODE_PATH).unwrap_or_else(|_| "node".to_string());
        if Command::new(&node_path).arg("--version").output().is_err() {
            return None;
        }

        let config = AppConfig {
            models: vec![
                ModelProfile {
                    name: "gpt-4o-mini".to_string(),
                    api_base: DEFAULT_API_BASE.to_string(),
                    provider: None,
                    reasoning_effort: None,
                    context_length: None,
                    extra: Default::default(),
                },
                ModelProfile {
                    name: "gpt-4.1-mini".to_string(),
                    api_base: DEFAULT_API_BASE.to_string(),
                    provider: None,
                    reasoning_effort: None,
                    context_length: None,
                    extra: Default::default(),
                },
            ],
            active_model: "gpt-4o-mini".to_string(),
            image_generation_model: None,
            video_generation_model: None,
            ui_locale: None,
            networks: NetworksConfig::default(),
            extra: Default::default(),
        };

        TsBridgeRuntime::new(config, Arc::new(StubSecretStore), workspace_root).ok()
    }

    fn busy_snapshot() -> BridgeRuntimeSnapshot {
        BridgeRuntimeSnapshot {
            pending_user_turn: Some("你好".to_string()),
            pending_image_paths: vec![],
            pending_mcp_resources: vec![],
            pending_aux_state: None,
            has_pending_approval: false,
            has_pending_manual_approval: false,
            has_pending_questions: false,
            current_pending_approval: None,
            current_pending_questions: None,
            child_sessions: vec![],
            is_busy: true,
            loop_enabled: false,
            approval_level: "default".to_string(),
            background_tool_status: None,
        }
    }

    #[test]
    fn ts_bridge_initializes_when_bundle_is_available() {
        let Some(runtime) = make_test_runtime() else {
            return;
        };
        assert!(!runtime.is_busy());
        assert!(!runtime.has_pending_tool_approval());
    }

    fn idle_snapshot() -> BridgeRuntimeSnapshot {
        BridgeRuntimeSnapshot {
            pending_user_turn: None,
            pending_image_paths: vec![],
            pending_mcp_resources: vec![],
            pending_aux_state: None,
            has_pending_approval: false,
            has_pending_manual_approval: false,
            has_pending_questions: false,
            current_pending_approval: None,
            current_pending_questions: None,
            child_sessions: vec![],
            is_busy: false,
            loop_enabled: false,
            approval_level: "default".to_string(),
            background_tool_status: None,
        }
    }

    #[test]
    fn validate_config_change_allows_transport_switch_while_busy() {
        let Some(mut runtime) = make_test_runtime() else {
            return;
        };

        runtime.apply_snapshot(busy_snapshot());

        let mut next = runtime.config().clone();
        next.active_model = "gpt-4.1-mini".to_string();

        assert!(
            runtime.validate_config_change(&next).is_ok(),
            "忙时仍应通过校验，bridge 替换推迟到空闲"
        );
    }

    #[test]
    fn replace_config_defers_bridge_transport_while_busy_and_flushes_when_idle() {
        let Some(mut runtime) = make_test_runtime() else {
            return;
        };

        runtime.apply_snapshot(busy_snapshot());
        assert!(!runtime.deferred_transport_replace_for_test());

        let mut next = runtime.config().clone();
        next.active_model = "gpt-4.1-mini".to_string();
        runtime.replace_config(next);

        assert!(runtime.deferred_transport_replace_for_test());
        assert_eq!(runtime.config().active_model, "gpt-4.1-mini");

        runtime.apply_snapshot(idle_snapshot());
        assert!(
            !runtime.deferred_transport_replace_for_test(),
            "空闲后应完成对 TS 的 replaceConfig"
        );
    }

    #[test]
    fn validate_config_change_allows_non_transport_updates_while_busy() {
        let Some(mut runtime) = make_test_runtime() else {
            return;
        };

        runtime.apply_snapshot(busy_snapshot());

        let mut next = runtime.config().clone();
        next.ui_locale = Some("zh-CN".to_string());
        next.models.push(ModelProfile {
            name: "gpt-4.1".to_string(),
            api_base: DEFAULT_API_BASE.to_string(),
            provider: None,
            reasoning_effort: None,
            context_length: None,
            extra: Default::default(),
        });

        assert!(runtime.validate_config_change(&next).is_ok());
    }

    #[test]
    fn resolve_transport_config_json_includes_model_knobs() {
        let Some(runtime) = make_test_runtime() else {
            return;
        };

        let mut next = runtime.config().clone();
        let active = next
            .active_model_profile_mut()
            .expect("active model should exist");
        active.provider = Some(ModelProvider::Custom);
        active.reasoning_effort = Some("minimal".to_string());

        let transport = runtime
            .resolve_transport_config_json_for(&next)
            .expect("resolve transport config");

        assert_eq!(
            transport.get("llmVendor").and_then(Value::as_str),
            Some("custom")
        );
        assert!(transport.get("transportImplementation").is_none());
        assert_eq!(
            transport.get("reasoningEffort").and_then(Value::as_str),
            Some("default")
        );
    }

    #[test]
    fn resolve_transport_config_json_includes_video_generation_model_for_open_responses() {
        let Some(runtime) = make_test_runtime() else {
            return;
        };

        let mut next = runtime.config().clone();
        let active = next
            .active_model_profile_mut()
            .expect("active model should exist");
        active.provider = Some(ModelProvider::Volcengine);
        active
            .extra
            .insert("transportKind".to_string(), json!("open-responses"));
        next.models.push(ModelProfile {
            name: "seedance-video".to_string(),
            api_base: "https://ark.cn-beijing.volces.com/api/v3".to_string(),
            provider: Some(ModelProvider::Volcengine),
            reasoning_effort: None,
            context_length: None,
            extra: serde_json::Map::from_iter([(
                "capabilities".to_string(),
                json!(["videoGeneration"]),
            )]),
        });
        next.video_generation_model = Some("seedance-video".to_string());

        let transport = runtime
            .resolve_transport_config_json_for(&next)
            .expect("resolve transport config");

        assert_eq!(
            transport.get("transportKind").and_then(Value::as_str),
            Some("open-responses")
        );
        let video_generation = transport
            .get("videoGeneration")
            .expect("video generation config");
        assert_eq!(
            video_generation.get("model").and_then(Value::as_str),
            Some("seedance-video")
        );
        assert_eq!(
            video_generation.get("llmVendor").and_then(Value::as_str),
            Some("volcengine")
        );
    }

    #[test]
    fn resolve_transport_config_json_includes_image_generation_model() {
        let Some(runtime) = make_test_runtime() else {
            return;
        };

        let mut next = runtime.config().clone();
        next.active_model_profile_mut()
            .expect("active model should exist")
            .extra
            .insert("capabilities".to_string(), json!(["chat"]));
        next.models.push(ModelProfile {
            name: "image-model".to_string(),
            api_base: "https://images.example.invalid/v1".to_string(),
            provider: Some(ModelProvider::Custom),
            reasoning_effort: None,
            context_length: None,
            extra: serde_json::Map::from_iter([(
                "capabilities".to_string(),
                json!(["imageGeneration"]),
            )]),
        });
        next.image_generation_model = Some("image-model".to_string());

        let transport = runtime
            .resolve_transport_config_json_for(&next)
            .expect("resolve transport config");

        assert_eq!(
            transport
                .get("modelCapabilities")
                .and_then(|capabilities| capabilities.get("chat"))
                .and_then(Value::as_bool),
            Some(true)
        );
        let image_generation = transport
            .get("imageGeneration")
            .expect("image generation config");
        assert_eq!(
            image_generation.get("model").and_then(Value::as_str),
            Some("image-model")
        );
        assert_eq!(
            image_generation.get("baseUrl").and_then(Value::as_str),
            Some("https://images.example.invalid/v1")
        );
        assert_eq!(
            image_generation.get("llmVendor").and_then(Value::as_str),
            Some("custom")
        );
        assert_eq!(
            image_generation
                .get("modelCapabilities")
                .and_then(|capabilities| capabilities.get("imageGeneration"))
                .and_then(Value::as_bool),
            Some(true)
        );
    }

    #[test]
    fn resolve_transport_config_json_uses_xai_official_responses_provider() {
        let Some(runtime) = make_test_runtime() else {
            return;
        };

        let mut next = runtime.config().clone();
        let active = next
            .active_model_profile_mut()
            .expect("active model should exist");
        active.provider = Some(ModelProvider::Xai);
        active
            .extra
            .insert("transportKind".to_string(), json!("open-responses"));

        let transport = runtime
            .resolve_transport_config_json_for(&next)
            .expect("resolve transport config");

        assert_eq!(
            transport.get("transportKind").and_then(Value::as_str),
            Some("open-responses")
        );
        assert_eq!(
            transport.get("responsesProvider").and_then(Value::as_str),
            Some("xai")
        );
        assert_eq!(
            transport.get("llmVendor").and_then(Value::as_str),
            Some("xai")
        );
    }

    #[test]
    fn resolve_transport_config_json_uses_azure_official_responses_provider() {
        let Some(runtime) = make_test_runtime() else {
            return;
        };

        let previous_api_key = env::var(super::ENV_API_KEY).ok();
        // SAFETY: 单测串行写入进程级环境变量，结束后恢复。
        unsafe {
            env::set_var(super::ENV_API_KEY, "test-azure-key");
        }

        let mut next = runtime.config().clone();
        next.models.push(ModelProfile {
            name: "my-gpt4o-deploy".to_string(),
            api_base: "https://my-openai-resource.openai.azure.com/openai/v1".to_string(),
            provider: Some(ModelProvider::Azure),
            reasoning_effort: None,
            context_length: None,
            extra: serde_json::Map::from_iter([
                ("transportKind".to_string(), json!("open-responses")),
                ("azureResourceName".to_string(), json!("my-openai-resource")),
            ]),
        });
        next.active_model = "my-gpt4o-deploy".to_string();

        let transport = runtime
            .resolve_transport_config_json_for(&next)
            .expect("resolve transport config");

        assert_eq!(
            transport.get("transportKind").and_then(Value::as_str),
            Some("open-responses")
        );
        assert_eq!(
            transport.get("baseUrl").and_then(Value::as_str),
            Some("https://my-openai-resource.openai.azure.com/openai/v1")
        );
        assert_eq!(
            transport.get("responsesProvider").and_then(Value::as_str),
            Some("azure")
        );
        assert_eq!(
            transport.get("llmVendor").and_then(Value::as_str),
            Some("azure")
        );
        assert_eq!(
            transport
                .get("azureResourceName")
                .and_then(Value::as_str),
            Some("my-openai-resource")
        );
        assert_eq!(
            transport.get("model").and_then(Value::as_str),
            Some("my-gpt4o-deploy")
        );

        unsafe {
            match previous_api_key {
                Some(value) => env::set_var(super::ENV_API_KEY, value),
                None => env::remove_var(super::ENV_API_KEY),
            }
        }
    }

    #[test]
    fn resolve_transport_config_json_recomputes_azure_base_url_from_resource_name() {
        let Some(runtime) = make_test_runtime() else {
            return;
        };

        let previous_api_key = env::var(super::ENV_API_KEY).ok();
        // SAFETY: 单测串行写入进程级环境变量，结束后恢复。
        unsafe {
            env::set_var(super::ENV_API_KEY, "test-azure-key");
        }

        let mut next = runtime.config().clone();
        next.models.push(ModelProfile {
            name: "my-gpt4o-deploy".to_string(),
            api_base: "https://stale-host.example/openai/v1".to_string(),
            provider: Some(ModelProvider::Azure),
            reasoning_effort: None,
            context_length: None,
            extra: serde_json::Map::from_iter([
                ("transportKind".to_string(), json!("open-responses")),
                ("azureResourceName".to_string(), json!("my-openai-resource")),
            ]),
        });
        next.active_model = "my-gpt4o-deploy".to_string();

        let transport = runtime
            .resolve_transport_config_json_for(&next)
            .expect("resolve transport config");

        assert_eq!(
            transport.get("baseUrl").and_then(Value::as_str),
            Some("https://my-openai-resource.openai.azure.com/openai/v1")
        );

        unsafe {
            match previous_api_key {
                Some(value) => env::set_var(super::ENV_API_KEY, value),
                None => env::remove_var(super::ENV_API_KEY),
            }
        }
    }

    #[test]
    fn resolve_transport_config_json_routes_bedrock_mantle_openai_to_open_responses() {
        let Some(runtime) = make_test_runtime() else {
            return;
        };

        let previous_api_key = env::var(super::ENV_API_KEY).ok();
        // SAFETY: 单测串行写入进程级环境变量，结束后恢复。
        unsafe {
            env::set_var(super::ENV_API_KEY, "test-mantle-bearer");
        }

        let mut next = runtime.config().clone();
        next.models.push(ModelProfile {
            name: "openai.gpt-5.5".to_string(),
            api_base: "https://bedrock-runtime.us-east-2.amazonaws.com".to_string(),
            provider: Some(ModelProvider::AmazonBedrock),
            reasoning_effort: None,
            context_length: None,
            extra: serde_json::Map::from_iter([("awsRegion".to_string(), json!("us-east-2"))]),
        });
        next.active_model = "openai.gpt-5.5".to_string();

        let transport = runtime
            .resolve_transport_config_json_for(&next)
            .expect("resolve transport config");

        assert_eq!(
            transport.get("transportKind").and_then(Value::as_str),
            Some("open-responses")
        );
        assert_eq!(
            transport.get("baseUrl").and_then(Value::as_str),
            Some("https://bedrock-mantle.us-east-2.api.aws/openai/v1")
        );
        assert_eq!(
            transport.get("llmVendor").and_then(Value::as_str),
            Some("openai")
        );
        assert_eq!(
            transport.get("responsesProvider").and_then(Value::as_str),
            Some("openai")
        );

        unsafe {
            match previous_api_key {
                Some(value) => env::set_var(super::ENV_API_KEY, value),
                None => env::remove_var(super::ENV_API_KEY),
            }
        }
    }

    #[test]
    fn resolve_transport_config_json_uses_anthropic_union_shape() {
        let Some(runtime) = make_test_runtime() else {
            return;
        };

        let mut next = runtime.config().clone();
        let active = next
            .active_model_profile_mut()
            .expect("active model should exist");
        active.provider = Some(ModelProvider::Anthropic);
        active.reasoning_effort = Some("max".to_string());
        active
            .extra
            .insert("transportKind".to_string(), json!("anthropic"));

        let transport = runtime
            .resolve_transport_config_json_for(&next)
            .expect("resolve transport config");

        assert_eq!(
            transport.get("transportKind").and_then(Value::as_str),
            Some("anthropic")
        );
        assert_eq!(transport.get("llmVendor"), None);
        assert_eq!(transport.get("effort").and_then(Value::as_str), Some("max"));
        assert_eq!(transport.get("imageGeneration"), None);
    }

    #[test]
    fn transport_config_change_detects_model_knobs() {
        let Some(runtime) = make_test_runtime() else {
            return;
        };

        let mut next = runtime.config().clone();
        next.active_model_profile_mut()
            .expect("active model should exist")
            .provider = Some(ModelProvider::Custom);
        assert!(runtime.transport_config_will_change(&next));

        let mut next = runtime.config().clone();
        next.active_model_profile_mut()
            .expect("active model should exist")
            .extra
            .insert("transportKind".to_string(), json!("anthropic"));
        assert!(runtime.transport_config_will_change(&next));

        let mut next = runtime.config().clone();
        next.active_model_profile_mut()
            .expect("active model should exist")
            .reasoning_effort = Some("low".to_string());
        assert!(runtime.transport_config_will_change(&next));

        let mut next = runtime.config().clone();
        next.models.push(ModelProfile {
            name: "image-model".to_string(),
            api_base: DEFAULT_API_BASE.to_string(),
            provider: None,
            reasoning_effort: None,
            context_length: None,
            extra: serde_json::Map::from_iter([(
                "capabilities".to_string(),
                json!(["imageGeneration"]),
            )]),
        });
        next.image_generation_model = Some("image-model".to_string());
        assert!(runtime.transport_config_will_change(&next));
    }

    #[test]
    fn runtime_error_clears_pending_turn_and_finishes_round() {
        let Some(mut runtime) = make_test_runtime() else {
            return;
        };

        runtime.apply_snapshot(busy_snapshot());
        runtime.handle_bridge_error(anyhow!("runtime-error: 401 status code (no body)"));

        assert!(!runtime.is_busy());
        assert!(runtime.session().pending_user_turn().is_none());

        let events = runtime.drain_events();
        assert!(
            events
                .iter()
                .any(|event| matches!(event, RuntimeEvent::RemovePendingAssistant))
        );
        assert!(events.iter().any(|event| matches!(
            event,
            RuntimeEvent::PushMessage(message)
                if message.content == "TS runtime 执行失败: 401 status code (no body)"
        )));
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

        let event: BridgeRuntimeEvent =
            serde_json::from_value(value).expect("event should deserialize");
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
                assert_eq!(
                    status_text.as_deref(),
                    Some("MCP 工具执行中: github / get_me")
                );
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

        let event: BridgeRuntimeEvent =
            serde_json::from_value(value).expect("event should deserialize");
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
    fn bridge_runtime_event_accepts_assistant_thinking_segment_finalized() {
        let value = json!({
            "kind": "assistant-thinking-segment-finalized",
            "text": "先分析一下用户意图",
        });

        let event: BridgeRuntimeEvent =
            serde_json::from_value(value).expect("event should deserialize");
        match event {
            BridgeRuntimeEvent::AssistantThinkingSegmentFinalized { text } => {
                assert_eq!(text, "先分析一下用户意图");
            }
            other => panic!("unexpected event variant: {other:?}"),
        }
    }

    #[test]
    fn assistant_thinking_segment_finalized_is_forwarded_to_runtime_events() {
        let Some(mut runtime) = make_test_runtime() else {
            return;
        };

        runtime.apply_bridge_events(vec![
            BridgeRuntimeEvent::AssistantThinkingSegmentFinalized {
                text: "整理完成态 thinking".to_string(),
            },
        ]);

        let events = runtime.drain_events();
        assert!(events.iter().any(|event| matches!(
            event,
            RuntimeEvent::AssistantThinkingSegmentFinalized(text)
                if text == "整理完成态 thinking"
        )));
    }

    #[test]
    fn tool_execution_finished_event_appends_separate_tool_message() {
        let Some(mut runtime) = make_test_runtime() else {
            return;
        };

        runtime.apply_bridge_events(vec![BridgeRuntimeEvent::ToolExecutionFinished {
            execution: BridgeToolExecution {
                tool_call_id: "call_123".to_string(),
                tool_name: "web_fetch".to_string(),
                request: json!({
                    "name": "web_fetch",
                    "url": "https://example.com"
                }),
                output: "example output".to_string(),
                failed: false,
            },
        }]);

        let events = runtime.drain_events();
        assert!(events.iter().any(|event| matches!(
            event,
            RuntimeEvent::PushMessage(message)
                if message
                    .tool_block
                    .as_ref()
                    .is_some_and(|block| block.tool_name == "web_fetch" && block.tool_call_id.as_deref() == Some("call_123"))
        )));
    }

    #[test]
    fn completed_manual_tool_result_appends_tool_message() {
        let Some(mut runtime) = make_test_runtime() else {
            return;
        };

        runtime.handle_manual_tool_command_result(BridgeManualToolCommandStartResult::Completed {
            request: json!({
                "name": "run_shell_command",
                "command": "echo hello"
            }),
            tool_name: "run_shell_command".to_string(),
            output: "hello".to_string(),
            failed: false,
            background_execution: false,
        });

        let events = runtime.drain_events();
        assert!(events.iter().any(|event| matches!(
            event,
            RuntimeEvent::PushMessage(message)
                if message
                    .tool_block
                    .as_ref()
                    .is_some_and(|block| block.tool_name == "run_shell_command" && block.phase == crate::view::ToolUiPhase::Succeeded)
        )));
    }

    #[test]
    fn failed_manual_tool_result_with_request_appends_failure_message() {
        let Some(mut runtime) = make_test_runtime() else {
            return;
        };

        runtime.handle_manual_tool_command_result(BridgeManualToolCommandStartResult::Failed {
            error: "boom".to_string(),
            request: Some(json!({
                "name": "run_shell_command",
                "command": "echo hello"
            })),
        });

        let events = runtime.drain_events();
        assert!(events.iter().any(|event| matches!(
            event,
            RuntimeEvent::PushMessage(message)
                if message
                    .tool_block
                    .as_ref()
                    .is_some_and(|block| block.tool_name == "run_shell_command" && block.phase == crate::view::ToolUiPhase::Failed)
        )));
    }

    #[test]
    fn tool_execution_finished_event_deserializes_host_request_shape() {
        let value = json!({
            "kind": "tool-execution-finished",
            "execution": {
                "toolCallId": "call_123",
                "toolName": "run_shell_command",
                "request": {
                    "name": "run_shell_command",
                    "command": "echo hello"
                },
                "output": "hello",
                "failed": false
            }
        });

        let event: BridgeRuntimeEvent =
            serde_json::from_value(value).expect("event should deserialize");
        match event {
            BridgeRuntimeEvent::ToolExecutionFinished { execution } => {
                assert_eq!(execution.tool_name, "run_shell_command");
                assert_eq!(execution.tool_call_id, "call_123");
                assert_eq!(
                    execution.request.get("name").and_then(Value::as_str),
                    Some("run_shell_command")
                );
            }
            other => panic!("unexpected event variant: {other:?}"),
        }
    }

    #[test]
    fn tool_execution_output_chunk_event_deserializes() {
        let value = json!({
            "kind": "tool-execution-output-chunk",
            "toolCallId": "call_shell",
            "toolName": "run_shell_command",
            "request": {
                "name": "run_shell_command",
                "command": "npm install"
            },
            "chunk": "added 1 package\n"
        });

        let event: BridgeRuntimeEvent =
            serde_json::from_value(value).expect("event should deserialize");
        match event {
            BridgeRuntimeEvent::ToolExecutionOutputChunk {
                tool_call_id,
                tool_name,
                chunk,
                ..
            } => {
                assert_eq!(tool_call_id, "call_shell");
                assert_eq!(tool_name, "run_shell_command");
                assert_eq!(chunk, "added 1 package\n");
            }
            other => panic!("unexpected event variant: {other:?}"),
        }
    }

    #[test]
    fn tool_request_from_host_value_rejects_legacy_rust_enum_shape() {
        let err = super::tool_request_from_host_value(json!({
            "WebFetch": {
                "url": "https://example.com"
            }
        }))
        .expect_err("legacy rust enum shape should be rejected");

        assert!(err.to_string().contains("工具请求缺少 name"));
    }

    #[test]
    fn tool_request_from_host_value_keeps_name_and_args_without_rust_semantics() {
        let request = super::tool_request_from_host_value(json!({
            "name": "host_internal_preview",
            "preview": "dry-run",
            "nested": {
                "count": 2
            }
        }))
        .expect("ui request should parse");

        assert_eq!(request.name, "host_internal_preview");
        assert_eq!(
            request.arguments,
            json!({
                "preview": "dry-run",
                "nested": {
                    "count": 2
                }
            })
        );
    }

    #[test]
    fn retired_builtin_host_methods_stay_on_host_internal_side() {
        for method in [
            "host.builtinToolDefinitionEnvironment",
            "host.parseCommand",
            "host.requestFromFunctionCall",
            "host.authorize",
            "host.trust",
            "host.execute",
        ] {
            assert!(
                super::is_retired_builtin_host_method(method),
                "{method} should not fall back to Rust CLI tool runtime"
            );
        }

        assert!(!super::is_retired_builtin_host_method("host.addMcpServer"));
        assert!(!super::is_retired_builtin_host_method(
            "host.localToolExecuted"
        ));
    }
}
