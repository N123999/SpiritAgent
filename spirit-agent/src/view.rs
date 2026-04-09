use std::collections::HashMap;

use crate::model_registry::AppConfig;
use crate::session::PendingMcpResource;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum InputSuggestionKind {
    Slash,
    FileReference,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AssistantAuxKind {
    Thinking,
    Compressing,
}

#[derive(Clone, Debug, Default)]
pub struct AssistantAuxData {
    pub thinking: Option<String>,
    pub compaction: Option<String>,
}

#[derive(Clone, Debug)]
pub struct PendingAssistantAux {
    pub kind: AssistantAuxKind,
    pub status_text: String,
    pub detail_text: Option<String>,
}

#[derive(Clone, Debug)]
pub struct BottomFormView {
    pub title: String,
    pub fields: Vec<BottomFormFieldView>,
    pub selected_field: usize,
    pub footer_hint: String,
}

#[derive(Clone, Debug)]
pub struct BottomFormFieldView {
    pub label: String,
    pub help: String,
    pub editor: BottomFormFieldEditorView,
}

#[derive(Clone, Debug)]
pub enum BottomFormFieldEditorView {
    Text {
        value: String,
        placeholder: String,
        cursor: usize,
    },
    Choice {
        options: Vec<String>,
        selected: usize,
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

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MessageRole {
    User,
    Agent,
}

#[derive(Clone, Debug)]
pub struct TuiViewModel {
    pub input: String,
    pub input_cursor: usize,
    pub shell_mode_active: bool,
    pub pending_image_paths: Vec<String>,
    pub pending_mcp_resources: Vec<PendingMcpResource>,
    pub messages: Vec<ChatMessage>,
    pub assistant_aux_by_message: HashMap<usize, AssistantAuxData>,
    pub config: AppConfig,
    pub show_aux_details: bool,
    pub input_suggestion_kind: Option<InputSuggestionKind>,
    pub input_suggestion_loading: bool,
    pub slash_suggestions: Vec<String>,
    pub selected_suggestion: usize,
    pub model_picker_active: bool,
    pub model_picker_index: usize,
    pub language_picker_active: bool,
    pub language_picker_index: usize,
    pub chat_picker_active: bool,
    pub chat_picker_index: usize,
    pub chat_picker_files: Vec<String>,
    pub image_picker_active: bool,
    pub image_picker_index: usize,
    pub image_picker_files: Vec<String>,
    pub bottom_form: Option<BottomFormView>,
    pub history_offset_from_bottom: usize,
    pub pending_response_active: bool,
    pub pending_assistant_msg_index: Option<usize>,
    pub pending_aux: Option<PendingAssistantAux>,
    /// 对话区选区：折行后的全局行号 + 显示列（与 WordWrapper 一致）。
    pub conversation_sel_anchor: Option<(usize, usize)>,
    pub conversation_sel_head: Option<(usize, usize)>,
}

impl TuiViewModel {
    pub fn assistant_aux_for_message(&self, message_index: usize) -> Option<&AssistantAuxData> {
        self.assistant_aux_by_message.get(&message_index)
    }

    pub fn is_pending_assistant_message(&self, message_index: usize) -> bool {
        self.pending_response_active && self.pending_assistant_msg_index == Some(message_index)
    }

    pub fn pending_aux_state(&self) -> Option<&PendingAssistantAux> {
        self.pending_aux.as_ref()
    }
}
