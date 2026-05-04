use anyhow::{Context, Result, anyhow};
use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64_STANDARD};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    collections::{HashMap, VecDeque},
    env,
    io::{BufRead, BufReader, Write},
    path::{Path, PathBuf},
    process::{Child, ChildStderr, ChildStdin, ChildStdout, Command, Stdio},
    sync::{
        Arc, Mutex,
        mpsc::{self, Receiver},
    },
    thread,
};

use crate::{
    ask_questions::AskQuestionsRequest,
    host_runtime::{
        RuntimeEvent, ToolUiRequest, build_tool_result_block, format_tool_ui_message,
        tool_approval_block, tool_failed_block,
    },
    llm_types::LlmMessage,
    logging,
    mcp::{McpServerConfig, add_mcp_server, spirit_agent_data_dir},
    mcp_types::{
        ManagedMcpServer, McpDiscoveredPrompt, McpDiscoveredResource, McpDiscoveredTool,
        McpServerInspection,
    },
    model_registry::{AppConfig, ModelProvider},
    plan::PlanMetadata,
    ports::{
        ArchivedLlmMessage, AssistantAuxArchiveEntry, ChatArchive, McpStatusSnapshot, SecretStore,
        SubagentSessionArchiveEntry, SubagentSessionSummary,
    },
    rules::{EnabledRule, RuleEntry},
    runtime_handle::RuntimeExportState,
    session::{PendingMcpResource, SessionModel},
    skills::{ActiveSkillPayload, EnabledSkillCatalogEntry, SkillEntry},
    view::{ChatMessage, MessageRole, PendingAssistantAux, PendingSubagentApprovalView},
};

const ENV_RUNTIME_BACKEND_NODE_PATH: &str = "SPIRIT_NODE_PATH";
const ENV_RUNTIME_BRIDGE_PATH: &str = "SPIRIT_AGENT_CORE_BRIDGE_PATH";
const ENV_RUNTIME_HOST_INTERNAL_MODULE_PATH: &str = "SPIRIT_HOST_INTERNAL_MODULE_PATH";
const ENV_RUNTIME_HOST_INTERNAL_SPIRIT_DATA_DIR: &str = "SPIRIT_HOST_INTERNAL_SPIRIT_DATA_DIR";
const ENV_API_BASE: &str = "SPIRIT_API_BASE";
const ENV_API_KEY: &str = "SPIRIT_API_KEY";

pub struct TsBridgeRuntime {
    process: JsonRpcProcess,
    config: AppConfig,
    secret_store: Arc<dyn SecretStore>,
    workspace_root: PathBuf,
    session: SessionModel,
    enabled_rules: Vec<EnabledRule>,
    enabled_skill_catalog: Vec<EnabledSkillCatalogEntry>,
    plan_metadata: PlanMetadata,
    pending_aux_state: Option<PendingAssistantAux>,
    pending_approval_kind: Option<PendingApprovalKind>,
    current_pending_approval: Option<BridgePendingApproval>,
    pending_questions_active: bool,
    pending_assistant_has_output: bool,
    is_busy_cache: bool,
    child_sessions_cache: Vec<SubagentSessionSummary>,
    subagent_message_cache: HashMap<String, Vec<ChatMessage>>,
    events: VecDeque<RuntimeEvent>,
    bridge_failed: bool,
    /// 忙时切换模型/endpoint 已写入 `config`，但尚未对 TS `runtime.replaceConfig`；空闲后由 `flush_deferred_transport_replace` 应用。
    deferred_transport_replace: bool,
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
struct LocalMcpToolRequest {
    kind: String,
    name: String,
    server: String,
    display_name: String,
    tool_name: String,
    arguments: Value,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LocalMcpToolResultEvent {
    request: LocalMcpToolRequest,
    output: String,
    tool_call_id: Option<String>,
    tool_name: String,
    subagent_session_id: Option<String>,
    subagent_title: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LocalMcpToolFailedEvent {
    request: LocalMcpToolRequest,
    error: String,
    tool_call_id: Option<String>,
    tool_name: String,
    subagent_session_id: Option<String>,
    subagent_title: Option<String>,
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
    has_pending_questions: bool,
    current_pending_approval: Option<BridgePendingApproval>,
    #[serde(default)]
    child_sessions: Vec<BridgeSubagentSessionSummary>,
    current_pending_questions: Option<BridgePendingQuestions>,
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
struct BridgeChatArchive {
    messages: Vec<BridgeChatMessage>,
    assistant_aux: Vec<BridgeAssistantAuxEntry>,
    llm_history: Vec<BridgeLlmMessage>,
    #[serde(default)]
    subagent_sessions: Vec<BridgeSubagentSessionArchiveEntry>,
    #[serde(default)]
    rewind: Option<Value>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BridgeSubagentSessionSummary {
    session_id: String,
    parent_tool_call_id: String,
    title: String,
    status: crate::ports::SubagentSessionStatus,
    started_at_unix_ms: u64,
    updated_at_unix_ms: u64,
    completed_at_unix_ms: Option<u64>,
    latest_message: Option<String>,
    final_output: Option<String>,
    error: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BridgeSubagentSessionArchiveEntry {
    summary: BridgeSubagentSessionSummary,
    #[serde(default)]
    llm_history: Vec<BridgeLlmMessage>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BridgeChatMessage {
    role: String,
    content: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BridgeAssistantAuxEntry {
    message_index: usize,
    thinking: Option<String>,
    compaction: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BridgeLlmMessage {
    role: String,
    content: String,
    image_paths: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BridgePendingApproval {
    prompt: String,
    request: Value,
    trust_target: Option<Value>,
    tool_call_id: Option<String>,
    tool_name: String,
    subagent_session_id: Option<String>,
    subagent_title: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BridgePendingQuestions {
    request: Value,
    tool_call_id: String,
    tool_name: String,
    questions: AskQuestionsRequest,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BridgeToolExecution {
    tool_call_id: String,
    tool_name: String,
    request: Value,
    output: String,
    failed: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BridgeDrainEventsResult {
    events: Vec<BridgeRuntimeEvent>,
    snapshot: BridgeRuntimeSnapshot,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CliHostMetadataSnapshot {
    pub rule_entries: Vec<RuleEntry>,
    pub skill_entries: Vec<SkillEntry>,
    pub plan_metadata: PlanMetadata,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CliExtensionToolEntry {
    pub name: String,
    pub description: String,
    pub approval_mode: Option<String>,
    pub execution_mode: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CliExtensionSettingOptionEntry {
    pub value: String,
    pub label: String,
    pub description: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CliExtensionDesktopCssEntry {
    pub path: String,
    pub media: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CliExtensionCliUiHookTokensEntry {
    pub foreground: Option<String>,
    pub border: Option<String>,
    pub accent: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CliExtensionCliUiHookEntry {
    pub slot: String,
    pub variant: Option<String>,
    pub tokens: Option<CliExtensionCliUiHookTokensEntry>,
    pub prefix: Option<String>,
    pub suffix: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CliExtensionDesktopContributes {
    pub css: Option<Vec<CliExtensionDesktopCssEntry>>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CliExtensionCliContributes {
    pub hooks: Option<Vec<CliExtensionCliUiHookEntry>>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CliExtensionSettingEntry {
    pub key: String,
    pub r#type: String,
    pub title: String,
    pub description: Option<String>,
    pub placeholder: Option<String>,
    pub required: Option<bool>,
    pub default_value: Option<Value>,
    pub options: Option<Vec<CliExtensionSettingOptionEntry>>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CliExtensionSecretSlotEntry {
    pub key: String,
    pub title: String,
    pub description: Option<String>,
    pub required: Option<bool>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CliExtensionContributes {
    pub tools: Option<Vec<CliExtensionToolEntry>>,
    pub desktop: Option<CliExtensionDesktopContributes>,
    pub cli: Option<CliExtensionCliContributes>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CliExtensionEntry {
    pub id: String,
    pub display_name: String,
    pub version: String,
    pub description: Option<String>,
    pub author: Option<String>,
    pub homepage: Option<String>,
    pub main: Option<String>,
    pub supported_hosts: Vec<String>,
    pub activation_events: Option<Vec<String>>,
    pub requested_capabilities: Option<Vec<String>>,
    pub contributes: Option<CliExtensionContributes>,
    pub settings_schema: Option<Vec<CliExtensionSettingEntry>>,
    pub secret_slots: Option<Vec<CliExtensionSecretSlotEntry>>,
    pub archive_file_name: Option<String>,
    pub installed_at_unix_ms: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CliMarketplaceCatalogItem {
    pub extension_id: String,
    pub package_name: String,
    pub status: String,
    pub featured: bool,
    pub default_version: String,
    pub default_channel: String,
    pub default_review_status: String,
    pub detail_path: String,
    pub display_name: String,
    pub description: String,
    pub author: Option<String>,
    pub homepage_url: Option<String>,
    pub repository_url: Option<String>,
    pub keywords: Vec<String>,
    pub supported_hosts: Vec<String>,
    pub requested_capabilities: Vec<String>,
    pub icon_url: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CliMarketplaceVersionChangelog {
    pub summary: String,
    pub body: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CliMarketplaceDetailVersion {
    pub version: String,
    pub channel: String,
    pub review_status: String,
    pub display_name: String,
    pub description: String,
    pub author: Option<String>,
    pub homepage_url: Option<String>,
    pub repository_url: Option<String>,
    pub keywords: Vec<String>,
    pub supported_hosts: Vec<String>,
    pub requested_capabilities: Vec<String>,
    pub icon_url: Option<String>,
    pub published_at: Option<String>,
    pub tarball_url: Option<String>,
    pub integrity: Option<String>,
    pub shasum: Option<String>,
    pub changelog: Option<CliMarketplaceVersionChangelog>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CliMarketplaceDetail {
    pub extension_id: String,
    pub package_name: String,
    pub status: String,
    pub featured: bool,
    pub default_version: String,
    pub readme_path: String,
    pub versions: Vec<CliMarketplaceDetailVersion>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CliMarketplacePreparedInstall {
    pub extension_id: String,
    pub package_name: String,
    pub display_name: String,
    pub description: String,
    pub version: String,
    pub channel: String,
    pub review_status: String,
    pub supported_hosts: Vec<String>,
    pub supports_current_host: bool,
    pub tarball_url: Option<String>,
    pub integrity: Option<String>,
    pub shasum: Option<String>,
    pub source_file_name: String,
    pub catalog_item: CliMarketplaceCatalogItem,
    pub detail: CliMarketplaceDetail,
}

fn bootstrap_plan_metadata() -> PlanMetadata {
    PlanMetadata {
        path: PathBuf::new(),
        exists: false,
        plan_mode: false,
        plan_mode_host_instructions: String::new(),
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "kind")]
enum BridgeRuntimeEvent {
    #[serde(rename = "begin-assistant-response")]
    BeginAssistantResponse,
    #[serde(rename = "update-pending-assistant-thinking")]
    UpdatePendingAssistantThinking { text: String },
    #[serde(rename = "assistant-thinking-segment-finalized")]
    AssistantThinkingSegmentFinalized { text: String },
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
    #[serde(rename = "questions-requested")]
    QuestionsRequested { questions: BridgePendingQuestions },
    #[serde(rename = "tool-call-started")]
    ToolCallStarted {
        #[serde(alias = "toolCallId")]
        tool_call_id: String,
        #[serde(alias = "toolName")]
        tool_name: String,
        request: Value,
    },
    #[serde(rename = "approval-resolved")]
    ApprovalResolved {
        #[serde(alias = "toolCallId")]
        tool_call_id: String,
        #[serde(alias = "toolName")]
        tool_name: String,
        request: Value,
        #[serde(alias = "decisionKind")]
        decision_kind: String,
    },
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
    #[serde(rename = "tool-execution-finished")]
    ToolExecutionFinished { execution: BridgeToolExecution },
}

impl TsBridgeRuntime {
    pub fn new(
        config: AppConfig,
        secret_store: Arc<dyn SecretStore>,
        workspace_root: PathBuf,
    ) -> Result<Self> {
        let process = JsonRpcProcess::spawn(resolve_bridge_script(&workspace_root)?)?;
        let mut runtime = Self {
            process,
            config,
            secret_store,
            workspace_root,
            session: SessionModel::new(),
            enabled_rules: Vec::new(),
            enabled_skill_catalog: Vec::new(),
            plan_metadata: bootstrap_plan_metadata(),
            pending_aux_state: None,
            pending_approval_kind: None,
            current_pending_approval: None,
            pending_questions_active: false,
            pending_assistant_has_output: false,
            is_busy_cache: false,
            child_sessions_cache: Vec::new(),
            subagent_message_cache: HashMap::new(),
            events: VecDeque::new(),
            bridge_failed: false,
            deferred_transport_replace: false,
        };
        logging::log_event(&format!(
            "[ts-bridge-host] runtime init workspace_root={}",
            runtime.workspace_root.display()
        ));
        runtime.initialize_bridge()?;
        Ok(runtime)
    }

    pub fn new_mcp_only(
        secret_store: Arc<dyn SecretStore>,
        workspace_root: PathBuf,
    ) -> Result<Self> {
        let process = JsonRpcProcess::spawn(resolve_bridge_script(&workspace_root)?)?;
        let mut runtime = Self {
            process,
            config: AppConfig::default(),
            secret_store,
            workspace_root,
            session: SessionModel::new(),
            enabled_rules: Vec::new(),
            enabled_skill_catalog: Vec::new(),
            plan_metadata: bootstrap_plan_metadata(),
            pending_aux_state: None,
            pending_approval_kind: None,
            current_pending_approval: None,
            pending_questions_active: false,
            pending_assistant_has_output: false,
            is_busy_cache: false,
            child_sessions_cache: Vec::new(),
            subagent_message_cache: HashMap::new(),
            events: VecDeque::new(),
            bridge_failed: false,
            deferred_transport_replace: false,
        };
        runtime.initialize_bridge_with_transport_config(build_mcp_only_transport_config(
            &runtime.workspace_root,
        ))?;
        Ok(runtime)
    }

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
            return;
        }

        let busy_defer = self.is_busy_cache || self.session.pending_user_turn().is_some();
        self.config = config;

        if busy_defer {
            self.deferred_transport_replace = true;
            return;
        }

        self.deferred_transport_replace = false;
        self.apply_transport_to_bridge();
    }

    pub fn replace_plan_metadata(&mut self, metadata: PlanMetadata) {
        self.plan_metadata = metadata;
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

    pub fn load_cli_host_metadata(&mut self, plan_mode: bool) -> Result<CliHostMetadataSnapshot> {
        let value = self.call_bridge(
            "hostInternal.loadCliMetadata",
            Some(json!({
                "planMode": plan_mode,
            })),
        )?;
        let metadata: CliHostMetadataSnapshot = serde_json::from_value(value)?;
        self.plan_metadata = metadata.plan_metadata.clone();
        Ok(metadata)
    }

    pub fn load_plan_metadata(&mut self, plan_mode: bool) -> Result<PlanMetadata> {
        let value = self.call_bridge(
            "hostInternal.loadPlanMetadata",
            Some(json!({
                "planMode": plan_mode,
            })),
        )?;
        Ok(serde_json::from_value(value)?)
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

    pub fn reload_host_metadata(&mut self, plan_mode: bool) -> Result<()> {
        let value = self.call_bridge(
            "runtime.reloadHostMetadata",
            Some(json!({
                "planMode": plan_mode,
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
                })
                .collect(),
            llm_history: bridge_archive
                .llm_history
                .into_iter()
                .map(|message| (message.role, message.content, message.image_paths))
                .collect(),
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
                    llm_history: entry
                        .llm_history
                        .into_iter()
                        .map(|message| ArchivedLlmMessage {
                            role: message.role,
                            content: message.content,
                            image_paths: message.image_paths,
                        })
                        .collect(),
                })
                .collect(),
            rewind: bridge_archive.rewind,
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
            llm_history: archive
                .llm_history
                .into_iter()
                .map(|message| ArchivedLlmMessage {
                    role: message.role,
                    content: message.content,
                    image_paths: message.image_paths,
                })
                .collect(),
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

    pub fn abort(&mut self) {
        if self.bridge_failed {
            return;
        }
        if let Err(err) = self.call_bridge("runtime.abort", None) {
            self.handle_bridge_error(err);
            return;
        }
        if let Err(err) = self.sync_after_command() {
            self.handle_bridge_error(err);
        }
    }

    pub fn continue_assistant_completion(&mut self) -> Result<()> {
        if self.bridge_failed {
            return Err(anyhow!("TS bridge 已失效，无法继续补全回复"));
        }
        self.call_bridge("runtime.continueAssistantCompletionStreaming", None)?;
        self.sync_after_command()?;
        Ok(())
    }

    pub fn drain_events(&mut self) -> Vec<RuntimeEvent> {
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

    pub fn list_mcp_servers(&mut self) -> Result<Vec<ManagedMcpServer>> {
        let value = self.call_bridge("runtime.listMcpServers", None)?;
        Ok(serde_json::from_value(value)?)
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

    pub fn add_mcp_server(&mut self, name: &str, config: McpServerConfig) -> Result<PathBuf> {
        let path = add_mcp_server(&self.workspace_root, name, config)?;
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

        self.call_bridge("runtime.startManualMcpTool", Some(params))?;
        self.sync_after_command()?;
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
        self.subagent_message_cache.clear();
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

    fn initialize_bridge(&mut self) -> Result<()> {
        self.initialize_bridge_with_transport_config(self.resolve_transport_config_json()?)
    }

    fn initialize_bridge_with_transport_config(&mut self, transport_config: Value) -> Result<()> {
        let snapshot = self.call_bridge(
            "runtime.init",
            Some(json!({
                "transportConfig": transport_config,
                "history": llm_history_to_json(self.session.llm_history()),
                "enabledRules": self.enabled_rules,
                "enabledSkillCatalog": self.enabled_skill_catalog,
                "planMetadata": self.plan_metadata,
            })),
        )?;
        self.apply_snapshot(serde_json::from_value(snapshot)?);
        Ok(())
    }

    fn resolve_transport_config_json(&self) -> Result<Value> {
        self.resolve_transport_config_json_for(&self.config)
    }

    fn resolve_transport_config_json_for(&self, config: &AppConfig) -> Result<Value> {
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

        let mut transport = serde_json::json!({
            "apiKey": api_key,
            "model": active.name,
            "baseUrl": api_base,
            "workspaceRoot": self.workspace_root,
        });
        if let Some(provider) = active.provider {
            let vendor = match provider {
                ModelProvider::Deepseek => "deepseek",
                ModelProvider::Kimi => "kimi",
                ModelProvider::Minimax => "minimax",
                ModelProvider::Custom => "custom",
            };
            if let Some(obj) = transport.as_object_mut() {
                obj.insert("llmVendor".to_string(), json!(vendor));
            }
        }
        Ok(transport)
    }

    fn transport_config_will_change(&self, config: &AppConfig) -> bool {
        if self.config.active_model != config.active_model {
            return true;
        }

        if self.config.active_model_profile().map(|profile| profile.api_base.as_str())
            != config
                .active_model_profile()
                .map(|profile| profile.api_base.as_str())
        {
            return true;
        }

        self.config.active_model_profile().map(|profile| profile.provider)
            != config.active_model_profile().map(|profile| profile.provider)
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
                    return Err(anyhow!(
                        "收到不匹配的 JSON-RPC 响应 id: {} != {}",
                        message_id,
                        request_id
                    ));
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

        let response = match self.dispatch_host_method(&method, params) {
            Ok(result) => request_id.map(
                |id| json!({ "jsonrpc": "2.0", "id": id, "result": result.unwrap_or(Value::Null) }),
            ),
            Err(err) => request_id.map(|id| {
                json!({
                    "jsonrpc": "2.0",
                    "id": id,
                    "error": {
                        "code": -32000,
                        "message": err.to_string(),
                    }
                })
            }),
        };

        if let Some(response) = response {
            self.process.write_message(&response)?;
        }
        Ok(())
    }

    fn dispatch_host_method(
        &mut self,
        method: &str,
        params: Option<Value>,
    ) -> Result<Option<Value>> {
        match method {
            "host.builtinToolDefinitionEnvironment"
            | "host.parseCommand"
            | "host.requestFromFunctionCall"
            | "host.authorize"
            | "host.trust"
            | "host.execute" => Err(anyhow!(
                "CLI TS bridge 已切换到 host-internal，本回调不应再被调用: {}",
                method
            )),
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
                let path = add_mcp_server(&self.workspace_root, name, config)?;
                Ok(Some(Value::String(path.display().to_string())))
            }
            "host.localToolExecuted" => {
                let params = params.ok_or_else(|| anyhow!("host.localToolExecuted 缺少 params"))?;
                let event: LocalMcpToolResultEvent = serde_json::from_value(params)?;
                self.push_local_mcp_tool_result(event);
                Ok(None)
            }
            "host.localToolFailed" => {
                let params = params.ok_or_else(|| anyhow!("host.localToolFailed 缺少 params"))?;
                let event: LocalMcpToolFailedEvent = serde_json::from_value(params)?;
                self.push_local_mcp_tool_failure(event);
                Ok(None)
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
        self.current_pending_approval = snapshot.current_pending_approval;
        self.pending_approval_kind = if snapshot.has_pending_approval {
            Some(if snapshot.has_pending_manual_approval {
                PendingApprovalKind::Manual
            } else {
                PendingApprovalKind::Tool
            })
        } else {
            None
        };
        self.child_sessions_cache = snapshot
            .child_sessions
            .into_iter()
            .map(|summary| SubagentSessionSummary {
                session_id: summary.session_id,
                parent_tool_call_id: summary.parent_tool_call_id,
                title: summary.title,
                status: summary.status,
                started_at_unix_ms: summary.started_at_unix_ms,
                updated_at_unix_ms: summary.updated_at_unix_ms,
                completed_at_unix_ms: summary.completed_at_unix_ms,
                latest_message: summary.latest_message,
                final_output: summary.final_output,
                error: summary.error,
            })
            .collect();
        self.subagent_message_cache.retain(|session_id, _| {
            self.child_sessions_cache
                .iter()
                .any(|summary| summary.session_id == *session_id)
        });
        self.pending_questions_active = snapshot.has_pending_questions;
        self.is_busy_cache = snapshot.is_busy;
        self.flush_deferred_transport_replace();
    }

    fn should_poll_bridge(&self) -> bool {
        self.is_busy_cache && self.pending_approval_kind.is_none() && !self.pending_questions_active
    }

    fn apply_bridge_events(&mut self, events: Vec<BridgeRuntimeEvent>) {
        for event in events {
            match event {
                BridgeRuntimeEvent::BeginAssistantResponse => {
                    self.pending_assistant_has_output = false;
                    self.events.push_back(RuntimeEvent::BeginAssistantResponse);
                }
                BridgeRuntimeEvent::UpdatePendingAssistantThinking { text } => {
                    self.events
                        .push_back(RuntimeEvent::UpdatePendingAssistantThinking(text));
                }
                BridgeRuntimeEvent::AssistantThinkingSegmentFinalized { text } => {
                    self.events
                        .push_back(RuntimeEvent::AssistantThinkingSegmentFinalized(text));
                }
                BridgeRuntimeEvent::UpdatePendingAssistantCompaction { text } => {
                    self.events
                        .push_back(RuntimeEvent::UpdatePendingAssistantCompaction(text));
                }
                BridgeRuntimeEvent::AssistantChunk { text } => {
                    self.pending_assistant_has_output = true;
                    self.events.push_back(RuntimeEvent::AssistantChunk(text));
                }
                BridgeRuntimeEvent::ReplacePendingAssistant { text } => {
                    self.pending_assistant_has_output = !text.trim().is_empty();
                    self.events
                        .push_back(RuntimeEvent::ReplacePendingAssistant(text));
                }
                BridgeRuntimeEvent::AssistantResponseCompleted => {
                    self.pending_assistant_has_output = false;
                    self.events
                        .push_back(RuntimeEvent::AssistantResponseCompleted);
                }
                BridgeRuntimeEvent::RemovePendingAssistant => {
                    self.pending_assistant_has_output = false;
                    self.events.push_back(RuntimeEvent::RemovePendingAssistant);
                }
                BridgeRuntimeEvent::ApprovalRequested { approval } => {
                    if let Some(session_id) = approval.subagent_session_id.as_deref() {
                        match tool_request_from_host_value(approval.request.clone()) {
                            Ok(_) => self.push_subagent_live_message(
                                session_id,
                                ChatMessage::with_tool_block(
                                    MessageRole::Agent,
                                    approval.prompt.clone(),
                                    tool_approval_block(
                                        &approval.tool_name,
                                        approval.tool_call_id.as_deref(),
                                        &approval.prompt,
                                    ),
                                ),
                            ),
                            Err(err) => self.push_subagent_live_message(
                                session_id,
                                ChatMessage::new(
                                    MessageRole::Agent,
                                    format!(
                                        "待确认工具调用（解析失败）: {}\n{}",
                                        err, approval.prompt
                                    ),
                                ),
                            ),
                        }
                    } else {
                        self.events.push_back(RuntimeEvent::PushMessage(
                            ChatMessage::with_tool_block(
                                MessageRole::Agent,
                                approval.prompt.clone(),
                                tool_approval_block(
                                    &approval.tool_name,
                                    approval.tool_call_id.as_deref(),
                                    &approval.prompt,
                                ),
                            ),
                        ));
                    }
                }
                BridgeRuntimeEvent::QuestionsRequested { questions } => {
                    self.events.push_back(RuntimeEvent::OpenAskQuestions {
                        tool_call_id: questions.tool_call_id,
                        tool_name: questions.tool_name,
                        questions: questions.questions,
                    });
                }
                BridgeRuntimeEvent::ToolCallStarted { .. } => {}
                BridgeRuntimeEvent::ApprovalResolved { .. } => {}
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
                BridgeRuntimeEvent::ToolExecutionFinished { execution } => {
                    match tool_request_from_host_value(execution.request) {
                        Ok(request) => {
                            self.events.push_back(RuntimeEvent::PushMessage(
                                ChatMessage::with_tool_block(
                                    MessageRole::Agent,
                                    if execution.failed {
                                        format!("工具执行失败: {}", execution.output)
                                    } else {
                                        format_tool_ui_message(
                                            &request,
                                            &execution.tool_name,
                                            &execution.output,
                                        )
                                    },
                                    if execution.failed {
                                        tool_failed_block(
                                            &execution.tool_name,
                                            Some(execution.tool_call_id.as_str()),
                                            "工具执行失败",
                                            &execution.output,
                                        )
                                    } else {
                                        build_tool_result_block(
                                            &request,
                                            &execution.tool_name,
                                            Some(execution.tool_call_id.as_str()),
                                            &execution.output,
                                        )
                                    },
                                ),
                            ));
                        }
                        Err(err) => {
                            self.events.push_back(RuntimeEvent::PushMessage(
                                ChatMessage::with_tool_block(
                                    MessageRole::Agent,
                                    if execution.failed {
                                        format!(
                                            "工具执行失败（请求解析失败）: {}",
                                            execution.output
                                        )
                                    } else {
                                        format!(
                                            "工具执行完成（请求解析失败）: {}\n{}",
                                            err, execution.output
                                        )
                                    },
                                    if execution.failed {
                                        tool_failed_block(
                                            &execution.tool_name,
                                            Some(execution.tool_call_id.as_str()),
                                            "工具执行失败",
                                            &execution.output,
                                        )
                                    } else {
                                        tool_failed_block(
                                            &execution.tool_name,
                                            Some(execution.tool_call_id.as_str()),
                                            "工具执行完成但请求解析失败",
                                            &err.to_string(),
                                        )
                                    },
                                ),
                            ));
                        }
                    }
                }
            }
        }
    }

    fn push_local_mcp_tool_result(&mut self, event: LocalMcpToolResultEvent) {
        let request = tool_request_from_local_mcp(&event.request);
        if let Some(session_id) = event.subagent_session_id.as_deref() {
            self.push_subagent_tool_result(
                session_id,
                &request,
                &event.tool_name,
                event.tool_call_id.as_deref(),
                &event.output,
            );
            return;
        }

        self.events
            .push_back(RuntimeEvent::PushMessage(ChatMessage::with_tool_block(
                MessageRole::Agent,
                format_tool_ui_message(&request, &event.tool_name, &event.output),
                build_tool_result_block(
                    &request,
                    &event.tool_name,
                    event.tool_call_id.as_deref(),
                    &event.output,
                ),
            )));
    }

    fn push_local_mcp_tool_failure(&mut self, event: LocalMcpToolFailedEvent) {
        if let Some(session_id) = event.subagent_session_id.as_deref() {
            self.push_subagent_tool_failure(
                session_id,
                &event.tool_name,
                event.tool_call_id.as_deref(),
                &event.error,
            );
            return;
        }

        self.events
            .push_back(RuntimeEvent::PushMessage(ChatMessage::with_tool_block(
                MessageRole::Agent,
                format!("工具执行失败: {}", event.error),
                tool_failed_block(
                    &event.tool_name,
                    event.tool_call_id.as_deref(),
                    "工具执行失败",
                    &event.error,
                ),
            )));
    }

    fn push_subagent_live_message(&mut self, session_id: &str, message: ChatMessage) {
        self.subagent_message_cache
            .entry(session_id.to_string())
            .or_default()
            .push(message);
    }

    fn push_subagent_tool_result(
        &mut self,
        session_id: &str,
        request: &ToolUiRequest,
        tool_name: &str,
        tool_call_id: Option<&str>,
        output: &str,
    ) {
        self.push_subagent_live_message(
            session_id,
            ChatMessage::with_tool_block(
                MessageRole::Agent,
                format_tool_ui_message(request, tool_name, output),
                build_tool_result_block(request, tool_name, tool_call_id, output),
            ),
        );
    }

    fn push_subagent_tool_failure(
        &mut self,
        session_id: &str,
        tool_name: &str,
        tool_call_id: Option<&str>,
        error: &str,
    ) {
        self.push_subagent_live_message(
            session_id,
            ChatMessage::with_tool_block(
                MessageRole::Agent,
                format!("工具执行失败: {}", error),
                tool_failed_block(tool_name, tool_call_id, "工具执行失败", error),
            ),
        );
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
            if fatal {
                "fatal error"
            } else {
                "runtime error"
            },
            summary
        ));
        let had_inflight_response = self.is_busy_cache || self.pending_aux_state.is_some();
        let had_pending_output = self.pending_assistant_has_output;
        self.is_busy_cache = false;
        self.pending_aux_state = None;
        self.pending_approval_kind = None;
        self.pending_assistant_has_output = false;
        self.session.clear_pending_user_turn();
        if had_inflight_response {
            self.events.push_back(if had_pending_output {
                RuntimeEvent::AssistantResponseCompleted
            } else {
                RuntimeEvent::RemovePendingAssistant
            });
        }
        self.events
            .push_back(RuntimeEvent::PushMessage(ChatMessage::new(
                MessageRole::Agent,
                if fatal {
                    format!("TS runtime bridge 失败: {}", summary)
                } else {
                    format!("TS runtime 执行失败: {}", summary)
                },
            )));
        self.flush_deferred_transport_replace();
    }

    #[cfg(test)]
    pub(crate) fn deferred_transport_replace_for_test(&self) -> bool {
        self.deferred_transport_replace
    }
}

impl JsonRpcProcess {
    fn spawn(script_path: PathBuf) -> Result<Self> {
        let node_path =
            env::var(ENV_RUNTIME_BACKEND_NODE_PATH).unwrap_or_else(|_| "node".to_string());
        let mut command = Command::new(&node_path);
        command
            .arg(script_path)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        let host_internal_path = resolve_host_internal_module_path()?;
        command.env(ENV_RUNTIME_HOST_INTERNAL_MODULE_PATH, host_internal_path);
        command.env(
            ENV_RUNTIME_HOST_INTERNAL_SPIRIT_DATA_DIR,
            spirit_agent_data_dir(),
        );

        let mut child = command
            .spawn()
            .with_context(|| format!("启动 TS bridge 失败: {}", node_path))?;

        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| anyhow!("获取 TS bridge stdin 失败"))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| anyhow!("获取 TS bridge stdout 失败"))?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| anyhow!("获取 TS bridge stderr 失败"))?;
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

    // 与「用户项目目录」无关：bridge 位于 monorepo 的 packages/agent-core/dist。
    // 开发时 cwd 常为 apps/cli，不能仅用 workspace_root（current_dir）推导路径。
    let from_crate = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .join("packages")
        .join("agent-core")
        .join("dist")
        .join("host-bridge.js");
    if from_crate.exists() {
        return Ok(from_crate);
    }

    let direct = workspace_root
        .join("packages")
        .join("agent-core")
        .join("dist")
        .join("host-bridge.js");
    if direct.exists() {
        return Ok(direct);
    }

    if let Some(parent) = workspace_root.parent() {
        let sibling = parent
            .join("packages")
            .join("agent-core")
            .join("dist")
            .join("host-bridge.js");
        if sibling.exists() {
            return Ok(sibling);
        }
    }

    let mut cursor = workspace_root.to_path_buf();
    loop {
        let candidate = cursor
            .join("packages")
            .join("agent-core")
            .join("dist")
            .join("host-bridge.js");
        if candidate.exists() {
            return Ok(candidate);
        }
        if !cursor.pop() {
            break;
        }
    }

    Err(anyhow!(
        "未找到 TS bridge 入口 host-bridge.js。请先在 packages/agent-core 执行 npm run build。"
    ))
}

fn resolve_host_internal_module_path() -> Result<PathBuf> {
    if let Ok(path) = env::var(ENV_RUNTIME_HOST_INTERNAL_MODULE_PATH) {
        let candidate = PathBuf::from(path);
        if candidate.exists() {
            return Ok(candidate);
        }
        return Err(anyhow!(
            "环境变量 {} 指向的 host-internal 模块不存在: {}",
            ENV_RUNTIME_HOST_INTERNAL_MODULE_PATH,
            candidate.display()
        ));
    }

    let from_crate = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .join("packages")
        .join("host-internal")
        .join("dist")
        .join("index.js");
    if from_crate.exists() {
        return Ok(from_crate);
    }

    Err(anyhow!(
        "未找到 host-internal bridge 模块。请先构建 packages/host-internal，或设置 {} 指向其 dist/index.js。默认查找路径: {}",
        ENV_RUNTIME_HOST_INTERNAL_MODULE_PATH,
        from_crate.display()
    ))
}

fn spawn_stdout_reader(stdout: ChildStdout, tx: mpsc::Sender<Result<Value>>) {
    thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        loop {
            let next = read_framed_message(&mut reader)
                .context("读取 TS bridge stdout 消息失败")
                .and_then(|body| {
                    serde_json::from_slice::<Value>(&body).context("解析 TS bridge JSON 失败")
                });

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
    message.get("id").is_some()
        && (message.get("result").is_some() || message.get("error").is_some())
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

fn build_mcp_only_transport_config(workspace_root: &Path) -> Value {
    json!({
        "apiKey": "mcp-only",
        "model": "mcp-only",
        "baseUrl": "https://example.invalid/v1",
        "workspaceRoot": workspace_root,
    })
}

#[cfg(test)]
mod tests {
    use super::{
        BridgeRuntimeEvent, BridgeRuntimeSnapshot, BridgeToolExecution,
        ENV_RUNTIME_BACKEND_NODE_PATH, TsBridgeRuntime, resolve_bridge_script,
    };
    use crate::{
        host_runtime::RuntimeEvent,
        model_registry::{AppConfig, DEFAULT_API_BASE, ModelProfile},
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
                    extra: Default::default(),
                },
                ModelProfile {
                    name: "gpt-4.1-mini".to_string(),
                    api_base: DEFAULT_API_BASE.to_string(),
                    provider: None,
                    extra: Default::default(),
                },
            ],
            active_model: "gpt-4o-mini".to_string(),
            ui_locale: None,
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
            extra: Default::default(),
        });

        assert!(runtime.validate_config_change(&next).is_ok());
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
    fn tool_execution_finished_event_deserializes_host_request_shape() {
        let value = json!({
            "kind": "tool-execution-finished",
            "execution": {
                "toolCallId": "call_123",
                "toolName": "run_shell_command",
                "request": {
                    "name": "run_shell_command",
                    "command": "echo DeepSeek-V4 牛逼"
                },
                "output": "DeepSeek-V4 牛逼",
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
}

fn chat_archive_to_bridge_json(archive: &crate::ports::ChatArchive) -> Value {
    let mut value = json!({
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
        "subagentSessions": archive.subagent_sessions.iter().map(|entry| {
            json!({
                "summary": {
                    "sessionId": entry.summary.session_id,
                    "parentToolCallId": entry.summary.parent_tool_call_id,
                    "title": entry.summary.title,
                    "status": entry.summary.status,
                    "startedAtUnixMs": entry.summary.started_at_unix_ms,
                    "updatedAtUnixMs": entry.summary.updated_at_unix_ms,
                    "completedAtUnixMs": entry.summary.completed_at_unix_ms,
                    "latestMessage": entry.summary.latest_message,
                    "finalOutput": entry.summary.final_output,
                    "error": entry.summary.error,
                },
                "llmHistory": entry.llm_history.iter().map(|message| {
                    json!({
                        "role": message.role,
                        "content": message.content,
                        "imagePaths": message.image_paths,
                    })
                }).collect::<Vec<_>>(),
            })
        }).collect::<Vec<_>>(),
    });

    if let Some(rewind) = &archive.rewind {
        if let Some(object) = value.as_object_mut() {
            object.insert("rewind".to_string(), rewind.clone());
        }
    }

    value
}

fn tool_request_from_local_mcp(request: &LocalMcpToolRequest) -> ToolUiRequest {
    ToolUiRequest::new(
        "mcp_tool",
        json!({
            "server": request.server,
            "display_name": request.display_name,
            "tool_name": request.tool_name,
            "arguments": request.arguments,
        }),
    )
}

fn tool_request_from_host_value(value: Value) -> anyhow::Result<ToolUiRequest> {
    let Value::Object(mut object) = value else {
        return Err(anyhow!("工具请求必须是 JSON object"));
    };

    let name = object
        .remove("name")
        .and_then(|value| value.as_str().map(ToOwned::to_owned))
        .ok_or_else(|| anyhow!("工具请求缺少 name"))?;

    Ok(ToolUiRequest::new(name, Value::Object(object)))
}
