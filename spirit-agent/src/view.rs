use crate::model_registry::AppConfig;

#[derive(Clone, Debug)]
pub struct ChatMessage {
    pub role: MessageRole,
    pub content: String,
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
    pub messages: Vec<ChatMessage>,
    pub config: AppConfig,
    pub slash_suggestions: Vec<String>,
    pub selected_suggestion: usize,
    pub model_picker_active: bool,
    pub model_picker_index: usize,
    pub chat_picker_active: bool,
    pub chat_picker_index: usize,
    pub chat_picker_files: Vec<String>,
    pub image_picker_active: bool,
    pub image_picker_index: usize,
    pub image_picker_files: Vec<String>,
    pub history_offset_from_bottom: usize,
    pub pending_response_active: bool,
    pub thinking_status: Option<String>,
    pub thinking_content: Option<String>,
}

impl TuiViewModel {
    pub fn thinking_status_text(&self) -> Option<String> {
        self.thinking_status.clone()
    }

    pub fn thinking_content_text(&self) -> Option<&str> {
        self.thinking_content.as_deref()
    }
}
