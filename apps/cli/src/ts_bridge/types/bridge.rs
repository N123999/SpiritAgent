use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::{
    ask_questions::AskQuestionsRequest,
    ports::ArchivedLlmMessage,
    session::PendingMcpResource,
    view::PendingAssistantAux,
};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalMcpToolRequest {
    pub(crate) kind: String,
    pub(crate) name: String,
    pub(crate) server: String,
    pub(crate) display_name: String,
    pub(crate) tool_name: String,
    pub(crate) arguments: Value,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalMcpToolResultEvent {
    pub(crate) request: LocalMcpToolRequest,
    pub(crate) output: String,
    pub(crate) tool_call_id: Option<String>,
    pub(crate) tool_name: String,
    pub(crate) subagent_session_id: Option<String>,
    pub(crate) subagent_title: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalMcpToolFailedEvent {
    pub(crate) request: LocalMcpToolRequest,
    pub(crate) error: String,
    pub(crate) tool_call_id: Option<String>,
    pub(crate) tool_name: String,
    pub(crate) subagent_session_id: Option<String>,
    pub(crate) subagent_title: Option<String>,
}

fn default_bridge_approval_level() -> String {
    "default".to_string()
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BridgeRuntimeSnapshot {
    pub(crate) pending_user_turn: Option<String>,
    pub(crate) pending_image_paths: Vec<String>,
    pub(crate) pending_mcp_resources: Vec<PendingMcpResource>,
    pub(crate) pending_aux_state: Option<PendingAssistantAux>,
    pub(crate) has_pending_approval: bool,
    pub(crate) has_pending_manual_approval: bool,
    pub(crate) has_pending_questions: bool,
    pub(crate) current_pending_approval: Option<BridgePendingApproval>,
    #[serde(default)]
    pub(crate) child_sessions: Vec<BridgeSubagentSessionSummary>,
    pub(crate) current_pending_questions: Option<BridgePendingQuestions>,
    pub(crate) is_busy: bool,
    #[serde(default)]
    pub(crate) loop_enabled: bool,
    #[serde(default = "default_bridge_approval_level")]
    pub(crate) approval_level: String,
    pub(crate) background_tool_status: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BridgeExportState {
    pub(crate) api_messages: Vec<Value>,
    pub(crate) request_trace: Vec<Value>,
    pub(crate) system_prompts: Value,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BridgeChatArchive {
    pub(crate) messages: Vec<BridgeChatMessage>,
    pub(crate) assistant_aux: Vec<BridgeAssistantAuxEntry>,
    pub(crate) llm_history: Vec<ArchivedLlmMessage>,
    #[serde(default)]
    pub(crate) loop_enabled: bool,
    #[serde(default = "default_bridge_approval_level")]
    pub(crate) approval_level: String,
    #[serde(default)]
    pub(crate) subagent_sessions: Vec<BridgeSubagentSessionArchiveEntry>,
    #[serde(default)]
    pub(crate) rewind: Option<Value>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BridgeSubagentSessionSummary {
    pub(crate) session_id: String,
    pub(crate) parent_tool_call_id: String,
    pub(crate) title: String,
    pub(crate) status: crate::ports::SubagentSessionStatus,
    pub(crate) started_at_unix_ms: u64,
    pub(crate) updated_at_unix_ms: u64,
    pub(crate) completed_at_unix_ms: Option<u64>,
    pub(crate) latest_message: Option<String>,
    pub(crate) final_output: Option<String>,
    pub(crate) error: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BridgeSubagentSessionArchiveEntry {
    pub(crate) summary: BridgeSubagentSessionSummary,
    #[serde(default)]
    pub(crate) llm_history: Vec<ArchivedLlmMessage>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BridgeChatMessage {
    pub(crate) role: String,
    pub(crate) content: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BridgeAssistantAuxEntry {
    pub(crate) message_index: usize,
    pub(crate) thinking: Option<String>,
    pub(crate) compaction: Option<String>,
    #[serde(default)]
    pub(crate) finish_task_notice: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BridgePendingApproval {
    pub(crate) prompt: String,
    pub(crate) request: Value,
    pub(crate) trust_target: Option<Value>,
    pub(crate) tool_call_id: Option<String>,
    pub(crate) tool_name: String,
    pub(crate) subagent_session_id: Option<String>,
    pub(crate) subagent_title: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BridgePendingQuestions {
    pub(crate) request: Value,
    pub(crate) tool_call_id: String,
    pub(crate) tool_name: String,
    pub(crate) questions: AskQuestionsRequest,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BridgeWorkspaceFileReferenceQuery {
    pub(crate) start: usize,
    pub(crate) end: usize,
    pub(crate) raw: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BridgeWorkspaceFileReferenceSuggestions {
    pub(crate) query: BridgeWorkspaceFileReferenceQuery,
    pub(crate) suggestions: Vec<String>,
    #[serde(default)]
    pub(crate) index_ready: Option<bool>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BridgeToolExecution {
    pub(crate) tool_call_id: String,
    pub(crate) tool_name: String,
    pub(crate) request: Value,
    pub(crate) output: String,
    pub(crate) failed: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BridgeDrainEventsResult {
    pub(crate) events: Vec<BridgeRuntimeEvent>,
    pub(crate) snapshot: BridgeRuntimeSnapshot,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "kind")]
pub(crate) enum BridgeManualToolCommandStartResult {
    #[serde(rename = "completed")]
    Completed {
        request: Value,
        #[serde(alias = "toolName")]
        tool_name: String,
        output: String,
        failed: bool,
        #[serde(alias = "backgroundExecution")]
        background_execution: bool,
    },
    #[serde(rename = "started-background")]
    StartedBackground {
        request: Value,
        #[serde(alias = "toolName")]
        tool_name: String,
        #[serde(alias = "statusText")]
        status_text: Option<String>,
    },
    #[serde(rename = "started-user-turn")]
    StartedUserTurn {
        #[serde(alias = "userMessage")]
        user_message: String,
    },
    #[serde(rename = "requires-approval")]
    RequiresApproval { approval: BridgePendingApproval },
    #[serde(rename = "denied")]
    Denied {
        request: Value,
        #[serde(alias = "toolName")]
        tool_name: String,
        message: String,
    },
    #[serde(rename = "failed")]
    Failed {
        error: String,
        request: Option<Value>,
    },
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BridgeLlmTokenUsage {
    pub(crate) input_tokens: u64,
    pub(crate) output_tokens: u64,
    pub(crate) total_tokens: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "kind")]
pub(crate) enum BridgeRuntimeEvent {
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
    #[serde(rename = "streaming-tool-preview")]
    StreamingToolPreview {
        #[serde(alias = "toolCallId")]
        tool_call_id: String,
        #[serde(alias = "toolName")]
        tool_name: String,
        #[serde(alias = "argumentsJson")]
        arguments_json: String,
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
    /// Incremental shell stdout/stderr while `shell` runs in the background.
    /// CLI TUI does not render chunks yet; Desktop projects them into tool cards.
    #[serde(rename = "tool-execution-output-chunk")]
    ToolExecutionOutputChunk {
        #[serde(alias = "toolCallId")]
        tool_call_id: String,
        #[serde(alias = "toolName")]
        tool_name: String,
        request: Value,
        chunk: String,
    },
    #[serde(rename = "context-usage-updated")]
    ContextUsageUpdated { usage: BridgeLlmTokenUsage },
}
