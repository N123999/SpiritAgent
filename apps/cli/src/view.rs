use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use crate::ask_questions::{AskQuestionsQuestionKind, AskQuestionsRequest};
use crate::model_registry::AppConfig;
use crate::ports::SubagentSessionStatus;
use crate::session::PendingMcpResource;

/// 上一帧对话面板的可点击内缘（与 Block 内文字区域一致），用于鼠标命中。
#[derive(Clone, Copy, Debug, Default)]
pub struct ConversationPanelHit {
    pub x: u16,
    pub y: u16,
    pub w: u16,
    pub h: u16,
    pub scroll: usize,
    pub total_lines: usize,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum InputSuggestionKind {
    Slash,
    FileReference,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum MainInputMode {
    #[default]
    Agent,
    Plan,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MarketplaceFlowStep {
    CatalogPicker,
    DetailActions,
    VersionPicker,
    UnverifiedConfirm,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct InputSuggestion {
    pub label: String,
    pub replacement: String,
    pub summary: String,
    pub details: Vec<String>,
}

impl InputSuggestion {
    pub fn simple(value: impl Into<String>) -> Self {
        let value = value.into();
        Self {
            label: value.clone(),
            replacement: value,
            summary: String::new(),
            details: Vec::new(),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AssistantAuxKind {
    Thinking,
    Compressing,
}

#[derive(Clone, Debug, Default)]
pub struct AssistantAuxData {
    pub thinking: Option<String>,
    pub compaction: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingAssistantAux {
    pub kind: AssistantAuxKind,
    pub status_text: String,
    pub detail_text: Option<String>,
}

#[derive(Clone, Debug)]
pub struct McpPromptArgumentBinding {
    pub name: String,
    pub required: bool,
}

#[derive(Clone, Debug)]
pub enum BottomFormKind {
    McpAdd,
    ModelAdd,
    AskQuestions {
        tool_call_id: String,
        tool_name: String,
        request: AskQuestionsRequest,
        submit_selected: bool,
        validation_message: Option<String>,
    },
    McpPrompt {
        server: String,
        prompt: String,
        arguments: Vec<McpPromptArgumentBinding>,
    },
    Rules,
    Skills,
    Extensions,
}

#[derive(Clone, Debug)]
pub struct BottomFormView {
    pub kind: BottomFormKind,
    pub title: String,
    pub fields: Vec<BottomFormFieldView>,
    pub selected_field: usize,
    pub scroll_offset: usize,
    pub footer_hint: String,
}

#[derive(Clone, Debug)]
pub struct BottomFormFieldView {
    pub label: String,
    pub help: String,
    pub editor: BottomFormFieldEditorView,
}

#[derive(Clone, Debug)]
pub struct AskQuestionsOptionView {
    pub label: String,
    pub summary: Option<String>,
    pub selected: bool,
}

#[derive(Clone, Debug)]
pub struct AskQuestionsInputFieldView {
    pub label: String,
    pub placeholder: String,
    pub value: String,
    pub cursor: usize,
}

#[derive(Clone, Debug)]
pub struct AskQuestionsQuestionView {
    pub id: String,
    pub kind: AskQuestionsQuestionKind,
    pub required: bool,
    pub options: Vec<AskQuestionsOptionView>,
    pub selected_row: usize,
    pub custom_input: Option<AskQuestionsInputFieldView>,
    pub text_input: Option<AskQuestionsInputFieldView>,
}

#[derive(Clone, Debug)]
pub enum BottomFormFieldEditorView {
    Section {
        text: String,
    },
    Text {
        value: String,
        placeholder: String,
        cursor: usize,
        /// When true, the TUI renders the value masked (e.g. API keys).
        mask: bool,
        /// When true, field is shown read-only and skipped in field navigation.
        disabled: bool,
    },
    Choice {
        options: Vec<String>,
        selected: usize,
    },
    Checkbox {
        id: String,
        checked: bool,
        disabled: bool,
        path: Option<String>,
    },
    AskQuestion {
        question: AskQuestionsQuestionView,
    },
}

/// 工具卡片在对话里的生命周期阶段（用于 TUI 着色与标签）。
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ToolUiPhase {
    PendingApproval,
    Running,
    Succeeded,
    Failed,
}

/// 结构化工具调用展示块；`content` 仍保留纯文本副本供存档与导出。
#[derive(Clone, Debug)]
pub struct ToolUiBlock {
    pub tool_call_id: Option<String>,
    pub tool_name: String,
    pub phase: ToolUiPhase,
    pub headline: String,
    pub detail_lines: Vec<String>,
    /// 可选：参数的紧凑 JSON（多行），TUI 内单独着色。
    pub args_excerpt: Option<String>,
    /// 可选：输出摘要（已截断）。
    pub output_excerpt: Option<String>,
}

#[derive(Clone, Debug)]
pub struct ChatMessage {
    pub role: MessageRole,
    pub content: String,
    pub tool_block: Option<ToolUiBlock>,
}

impl ChatMessage {
    pub fn new(role: MessageRole, content: impl Into<String>) -> Self {
        Self {
            role,
            content: content.into(),
            tool_block: None,
        }
    }

    pub fn with_tool_block(
        role: MessageRole,
        content: impl Into<String>,
        tool_block: ToolUiBlock,
    ) -> Self {
        Self {
            role,
            content: content.into(),
            tool_block: Some(tool_block),
        }
    }
}

#[derive(Clone, Debug)]
pub struct SubagentSessionSummaryView {
    pub session_id: String,
    pub title: String,
    pub status: SubagentSessionStatus,
    pub updated_at_unix_ms: u64,
    pub latest_message: Option<String>,
}

#[derive(Clone, Debug)]
pub struct SubagentSessionDetailView {
    pub summary: SubagentSessionSummaryView,
    pub messages: Vec<ChatMessage>,
    pub pending_aux: Option<PendingAssistantAux>,
    pub final_output: Option<String>,
    pub error: Option<String>,
}

#[derive(Clone, Debug)]
pub struct PendingSubagentApprovalView {
    pub session_id: String,
    pub session_title: String,
    pub tool_name: String,
    pub prompt: String,
}

#[derive(Clone, Debug)]
pub struct SubagentApprovalInputView {
    pub value: String,
    pub cursor: usize,
}

#[derive(Clone, Debug)]
pub struct RewindPickerView {
    pub selected_message_id: usize,
    pub selectable_message_ids: Vec<usize>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MessageRole {
    User,
    Agent,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum CliUiHookSlot {
    MessageUser,
    MessageAssistant,
    MessageTool,
    AssistantThinking,
    InputFrame,
    BottomForm,
    BottomFormSection,
    SlashSuggestions,
    ApprovalPanel,
    QuestionsPanel,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CliUiHookVariant {
    Default,
    Accented,
    Muted,
    Warning,
    Success,
    Danger,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CliUiHookTokenRole {
    Default,
    Primary,
    Secondary,
    Muted,
    Accent,
    Success,
    Warning,
    Danger,
}

#[derive(Clone, Debug, Default)]
pub struct CliUiHookTokensView {
    pub foreground: Option<CliUiHookTokenRole>,
    pub border: Option<CliUiHookTokenRole>,
    pub accent: Option<CliUiHookTokenRole>,
}

#[derive(Clone, Debug)]
pub struct CliUiHookView {
    pub slot: CliUiHookSlot,
    pub variant: Option<CliUiHookVariant>,
    pub tokens: CliUiHookTokensView,
    pub prefix: Option<String>,
    pub suffix: Option<String>,
}

#[derive(Clone, Debug)]
pub struct TuiViewModel {
    pub input: String,
    pub input_cursor: usize,
    pub input_mode: MainInputMode,
    pub shell_mode_active: bool,
    pub pending_image_paths: Vec<String>,
    pub pending_mcp_resources: Vec<PendingMcpResource>,
    pub history_truncated_before: usize,
    pub messages: Vec<ChatMessage>,
    pub assistant_aux_by_message: HashMap<usize, AssistantAuxData>,
    pub config: AppConfig,
    pub show_aux_details: bool,
    pub input_suggestion_kind: Option<InputSuggestionKind>,
    pub input_suggestion_loading: bool,
    pub slash_suggestions: Vec<InputSuggestion>,
    pub selected_suggestion: usize,
    pub rewind_picker: Option<RewindPickerView>,
    pub model_picker_active: bool,
    pub model_picker_index: usize,
    pub language_picker_active: bool,
    pub language_picker_index: usize,
    pub chat_picker_active: bool,
    pub chat_picker_index: usize,
    pub chat_picker_files: Vec<String>,
    pub subagent_picker_active: bool,
    pub subagent_picker_index: usize,
    pub subagent_sessions: Vec<SubagentSessionSummaryView>,
    pub subagent_view: Option<SubagentSessionDetailView>,
    pub subagent_history_offset_from_bottom: usize,
    pub pending_subagent_approval: Option<PendingSubagentApprovalView>,
    pub subagent_approval_input: Option<SubagentApprovalInputView>,
    pub image_picker_active: bool,
    pub image_picker_index: usize,
    pub image_picker_files: Vec<String>,
    pub bottom_form: Option<BottomFormView>,
    pub history_offset_from_bottom: usize,
    pub pending_response_active: bool,
    pub pending_assistant_msg_index: Option<usize>,
    pub pending_aux: Option<PendingAssistantAux>,
    pub persisted_standalone_pending_aux: Option<PendingAssistantAux>,
    pub persisted_standalone_pending_aux_anchor: Option<usize>,
    pub cli_ui_hooks: Vec<CliUiHookView>,
    pub marketplace_view: Option<MarketplaceViewModel>,
    /// 对话区选区：折行后的全局行号 + 显示列（与 WordWrapper 一致）。
    pub conversation_sel_anchor: Option<(usize, usize)>,
    pub conversation_sel_head: Option<(usize, usize)>,
}

impl TuiViewModel {
    pub fn assistant_aux_for_message(&self, message_index: usize) -> Option<&AssistantAuxData> {
        self.assistant_aux_by_message.get(&message_index)
    }

    pub fn is_rewind_selectable_message(&self, message_id: usize) -> bool {
        self.rewind_picker.as_ref().is_some_and(|rewind_picker| {
            rewind_picker
                .selectable_message_ids
                .contains(&message_id)
        })
    }

    pub fn is_rewind_selected_message(&self, message_id: usize) -> bool {
        self.rewind_picker
            .as_ref()
            .is_some_and(|rewind_picker| rewind_picker.selected_message_id == message_id)
    }

    pub fn is_pending_assistant_message(&self, message_index: usize) -> bool {
        self.pending_response_active && self.pending_assistant_msg_index == Some(message_index)
    }

    pub fn pending_aux_state(&self) -> Option<&PendingAssistantAux> {
        self.pending_aux.as_ref()
    }
}

#[derive(Clone, Debug)]
pub struct MarketplaceCatalogItemView {
    pub extension_id: String,
    pub package_name: String,
    pub display_name: String,
    pub description: String,
    pub author: Option<String>,
    pub featured: bool,
    pub default_version: String,
    pub default_channel: String,
    pub default_review_status: String,
    pub supported_hosts: Vec<String>,
    pub requested_capabilities: Vec<String>,
    pub icon_url: Option<String>,
    pub installed_version: Option<String>,
}

#[derive(Clone, Debug)]
pub struct MarketplaceVersionChangelogView {
    pub summary: String,
    pub body: String,
}

#[derive(Clone, Debug)]
pub struct MarketplaceVersionView {
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
    pub changelog: Option<MarketplaceVersionChangelogView>,
}

#[derive(Clone, Debug)]
pub struct MarketplaceDetailView {
    pub package_name: String,
    pub status: String,
    pub featured: bool,
    pub default_version: String,
    pub readme: Option<String>,
    pub versions: Vec<MarketplaceVersionView>,
}

#[derive(Clone, Debug)]
pub struct SlashFlowItemView {
    pub label: String,
    pub summary: String,
    pub details: Vec<String>,
    pub disabled: bool,
    pub muted: bool,
}

#[derive(Clone, Debug)]
pub struct SlashFlowView {
    pub title: String,
    pub subtitle: Option<String>,
    pub filter: String,
    pub show_filter: bool,
    pub empty_text: String,
    pub selected_index: usize,
    pub items: Vec<SlashFlowItemView>,
    pub compact_items: bool,
    pub footer_hint: String,
}

#[derive(Clone, Debug)]
pub struct MarketplaceViewModel {
    pub step: MarketplaceFlowStep,
    pub query: String,
    pub error: Option<String>,
    pub catalog_items: Vec<MarketplaceCatalogItemView>,
    pub selected_item: Option<MarketplaceCatalogItemView>,
    pub detail: Option<MarketplaceDetailView>,
    pub slash: SlashFlowView,
    pub readme_scroll: usize,
}
