use anyhow::{Context, Result};
use std::{
    collections::{BTreeMap, HashMap},
    env, fs,
    fs::OpenOptions,
    path::Path,
    process::Command,
    sync::Arc,
    time::{SystemTime, UNIX_EPOCH},
};

use crate::{
    adapters::{
        DefaultAppPaths, JsonChatRepository, JsonConfigStore, KeyringSecretStore, LoggingTelemetry,
        OpenAiCompatibleTransport, WorkspaceToolExecutor,
    },
    conversation_select::{CellPointer, NormRange, normalize_selection, selection_plain_text},
    logging,
    mcp::{McpCapabilityToggles, McpServerConfig, McpTransportConfig},
    model_registry::{AppConfig, DEFAULT_API_BASE, ModelProfile},
    ports::{AppPaths, AssistantAuxArchiveEntry, ChatRepository, ConfigStore, SecretStore},
    runtime::{AgentRuntime, RuntimeEvent},
    view::{
        AssistantAuxData, BottomFormFieldEditorView, BottomFormFieldView, BottomFormView,
        ChatMessage, MessageRole, TuiViewModel,
    },
};

const MCP_ADD_FIELD_NAME: usize = 0;
const MCP_ADD_FIELD_TRANSPORT: usize = 1;
const MCP_ADD_FIELD_ENDPOINT: usize = 2;
const MCP_ADD_FIELD_METADATA: usize = 3;
const MCP_DEFAULT_TIMEOUT_MS: u64 = 20_000;

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

pub struct TuiShell {
    input: String,
    input_cursor: usize,
    messages: Vec<ChatMessage>,
    assistant_aux_by_message: HashMap<usize, AssistantAuxData>,
    show_aux_details: bool,
    pending_assistant_msg_index: Option<usize>,
    last_mcp_status_revision: u64,
    slash_commands: Vec<String>,
    slash_suggestions: Vec<String>,
    selected_suggestion: usize,
    model_picker_active: bool,
    model_picker_index: usize,
    chat_picker_active: bool,
    chat_picker_index: usize,
    chat_picker_files: Vec<String>,
    image_picker_active: bool,
    image_picker_index: usize,
    image_picker_files: Vec<String>,
    bottom_form: Option<BottomFormView>,
    history_offset_from_bottom: usize,
    conversation_sel_anchor: Option<(usize, usize)>,
    conversation_sel_head: Option<(usize, usize)>,
    conversation_dragging: bool,
    conversation_panel_hit: Option<ConversationPanelHit>,
    conversation_plain_rows: Vec<String>,
    should_quit: bool,
    runtime: AgentRuntime,
    config_store: Box<dyn ConfigStore>,
    chat_repository: Box<dyn ChatRepository>,
    secret_store: Arc<dyn SecretStore>,
    app_paths: Arc<dyn AppPaths>,
}

impl TuiShell {
    pub fn new() -> Self {
        let app_paths: Arc<dyn AppPaths> = Arc::new(DefaultAppPaths::new());
        let secret_store: Arc<dyn SecretStore> = Arc::new(KeyringSecretStore);
        let telemetry = Arc::new(LoggingTelemetry);
        let config_store: Box<dyn ConfigStore> = Box::new(JsonConfigStore);
        let chat_repository: Box<dyn ChatRepository> = Box::new(JsonChatRepository);
        let config = config_store.load().unwrap_or_else(|_| AppConfig::default());
        let llm_transport = Arc::new(OpenAiCompatibleTransport::new(
            Arc::clone(&secret_store),
            telemetry,
            app_paths.as_ref(),
        ));
        let tool_executor = Box::new(WorkspaceToolExecutor::new());
        let runtime = AgentRuntime::new(
            config.clone(),
            llm_transport,
            tool_executor,
            app_paths.workspace_root(),
        );
        let initial_mcp_status = runtime.mcp_status_snapshot();

        let slash_commands = vec![
            "/help".to_string(),
            "/clear".to_string(),
            "/quit".to_string(),
            "/exit".to_string(),
            "/model".to_string(),
            "/compact".to_string(),
            "/sessions".to_string(),
            "/image".to_string(),
            "/mcp".to_string(),
            "/log".to_string(),
        ];

        Self {
            input: String::new(),
            input_cursor: 0,
            messages: vec![welcome_message(
                &config.active_model,
                &initial_mcp_status.welcome_line(),
            )],
            assistant_aux_by_message: HashMap::new(),
            show_aux_details: true,
            pending_assistant_msg_index: None,
            last_mcp_status_revision: initial_mcp_status.revision,
            slash_commands,
            slash_suggestions: vec![],
            selected_suggestion: 0,
            model_picker_active: false,
            model_picker_index: 0,
            chat_picker_active: false,
            chat_picker_index: 0,
            chat_picker_files: vec![],
            image_picker_active: false,
            image_picker_index: 0,
            image_picker_files: vec![],
            bottom_form: None,
            history_offset_from_bottom: 0,
            conversation_sel_anchor: None,
            conversation_sel_head: None,
            conversation_dragging: false,
            conversation_panel_hit: None,
            conversation_plain_rows: Vec::new(),
            should_quit: false,
            runtime,
            config_store,
            chat_repository,
            secret_store,
            app_paths,
        }
    }

    pub fn refresh_suggestions(&mut self) {
        let Some(query) = self.current_slash_query().map(ToString::to_string) else {
            self.slash_suggestions.clear();
            self.selected_suggestion = 0;
            return;
        };

        self.slash_suggestions = self
            .slash_commands
            .iter()
            .filter(|cmd| cmd.starts_with(&query))
            .cloned()
            .collect();

        if self.slash_suggestions.is_empty() {
            self.slash_suggestions = contextual_slash_suggestions(query)
                .into_iter()
                .map(ToString::to_string)
                .collect();
        }

        if self.selected_suggestion >= self.slash_suggestions.len() {
            self.selected_suggestion = 0;
        }
    }

    pub fn poll_runtime(&mut self) {
        self.runtime.poll();
        self.apply_runtime_events();
        self.sync_welcome_mcp_status();
    }

    pub fn handle_stream_stall_timeout(&mut self) {
        self.runtime.handle_stream_stall_timeout();
        self.apply_runtime_events();
        self.sync_welcome_mcp_status();
    }

    pub fn tick(&mut self) {
        self.runtime.tick_thinking_spinner();
    }

    pub fn view_model(&self) -> TuiViewModel {
        TuiViewModel {
            input: self.input.clone(),
            input_cursor: self.input_cursor,
            pending_image_paths: self.runtime.session().pending_image_paths().to_vec(),
            pending_mcp_resources: self.runtime.session().pending_mcp_resources().to_vec(),
            messages: self.messages.clone(),
            assistant_aux_by_message: self.assistant_aux_by_message.clone(),
            config: self.runtime.config().clone(),
            show_aux_details: self.show_aux_details,
            slash_suggestions: self.slash_suggestions.clone(),
            selected_suggestion: self.selected_suggestion,
            model_picker_active: self.model_picker_active,
            model_picker_index: self.model_picker_index,
            chat_picker_active: self.chat_picker_active,
            chat_picker_index: self.chat_picker_index,
            chat_picker_files: self.chat_picker_files.clone(),
            image_picker_active: self.image_picker_active,
            image_picker_index: self.image_picker_index,
            image_picker_files: self.image_picker_files.clone(),
            bottom_form: self.bottom_form.clone(),
            history_offset_from_bottom: self.history_offset_from_bottom,
            pending_response_active: self.runtime.is_busy(),
            pending_assistant_msg_index: self.pending_assistant_msg_index,
            pending_aux: self.runtime.pending_aux_state(),
            conversation_sel_anchor: self.conversation_sel_anchor,
            conversation_sel_head: self.conversation_sel_head,
        }
    }

    pub fn note_conversation_panel(&mut self, hit: ConversationPanelHit, plain_rows: Vec<String>) {
        self.conversation_panel_hit = Some(hit);
        self.conversation_plain_rows = plain_rows;
        let max_line = hit.total_lines.saturating_sub(1);
        self.sync_conversation_selection_to_bounds(max_line);
    }

    fn sync_conversation_selection_to_bounds(&mut self, max_line: usize) {
        let clamp = |(l, c): (usize, usize)| (l.min(max_line), c);
        if let Some(p) = &mut self.conversation_sel_anchor {
            *p = clamp(*p);
        }
        if let Some(p) = &mut self.conversation_sel_head {
            *p = clamp(*p);
        }
    }

    pub fn clear_conversation_selection(&mut self) {
        self.conversation_sel_anchor = None;
        self.conversation_sel_head = None;
        self.conversation_dragging = false;
    }

    /// `column`, `row`：crossterm 终端坐标（与 ratatui 一致）。
    pub fn conversation_pointer_from_mouse(&self, column: u16, row: u16) -> Option<(usize, usize)> {
        let hit = self.conversation_panel_hit?;
        if column < hit.x || column >= hit.x.saturating_add(hit.w) {
            return None;
        }
        if row < hit.y || row >= hit.y.saturating_add(hit.h) {
            return None;
        }
        let col = (column - hit.x) as usize;
        let vrow = (row - hit.y) as usize;
        let gline = hit.scroll + vrow;
        if gline >= hit.total_lines {
            return None;
        }
        Some((gline, col))
    }

    pub fn conversation_left_down(&mut self, column: u16, row: u16) {
        let Some((line, col)) = self.conversation_pointer_from_mouse(column, row) else {
            self.clear_conversation_selection();
            return;
        };
        self.conversation_sel_anchor = Some((line, col));
        self.conversation_sel_head = Some((line, col));
        self.conversation_dragging = true;
    }

    pub fn conversation_left_drag(&mut self, column: u16, row: u16) {
        if !self.conversation_dragging {
            return;
        }
        let Some((line, col)) = self.conversation_pointer_from_mouse(column, row) else {
            return;
        };
        self.conversation_sel_head = Some((line, col));
    }

    pub fn conversation_left_up(&mut self) {
        self.conversation_dragging = false;
    }

    pub fn copy_conversation_selection(&mut self) -> Result<(), String> {
        let (Some(a), Some(b)) = (self.conversation_sel_anchor, self.conversation_sel_head) else {
            return Ok(());
        };
        let max_line = self.conversation_plain_rows.len().saturating_sub(1);
        let clamp = |(l, c): (usize, usize)| (l.min(max_line), c);
        let a = CellPointer {
            line: clamp(a).0,
            col: a.1,
        };
        let b = CellPointer {
            line: clamp(b).0,
            col: b.1,
        };
        let norm = normalize_selection(a, b);
        let text = selection_plain_text(&self.conversation_plain_rows, norm);
        if text.is_empty() {
            return Ok(());
        }
        arboard::Clipboard::new()
            .map_err(|e| e.to_string())?
            .set_text(text)
            .map_err(|e| e.to_string())?;
        self.clear_conversation_selection();
        Ok(())
    }

    pub(crate) fn conversation_norm_for_paint(&self, total_lines: usize) -> Option<NormRange> {
        let (Some(a), Some(b)) = (self.conversation_sel_anchor, self.conversation_sel_head) else {
            return None;
        };
        let max_line = total_lines.saturating_sub(1);
        let a = CellPointer {
            line: a.0.min(max_line),
            col: a.1,
        };
        let b = CellPointer {
            line: b.0.min(max_line),
            col: b.1,
        };
        Some(normalize_selection(a, b))
    }

    pub fn should_quit(&self) -> bool {
        self.should_quit
    }

    pub fn request_quit(&mut self) {
        self.should_quit = true;
    }

    pub fn toggle_aux_details(&mut self) {
        self.show_aux_details = !self.show_aux_details;
    }

    pub fn is_model_picker_active(&self) -> bool {
        self.model_picker_active
    }

    pub fn is_chat_picker_active(&self) -> bool {
        self.chat_picker_active
    }

    pub fn is_image_picker_active(&self) -> bool {
        self.image_picker_active
    }

    pub fn is_bottom_form_active(&self) -> bool {
        self.bottom_form.is_some()
    }

    pub fn is_slash_mode_active(&self) -> bool {
        self.current_slash_query().is_some()
    }

    pub fn move_cursor_left(&mut self) {
        if self.input_cursor > 0 {
            self.input_cursor -= 1;
        }
    }

    pub fn move_cursor_right(&mut self) {
        let len = self.input_len_chars();
        if self.input_cursor < len {
            self.input_cursor += 1;
        }
    }

    pub fn move_cursor_home(&mut self) {
        self.input_cursor = 0;
    }

    pub fn move_cursor_end(&mut self) {
        self.input_cursor = self.input_len_chars();
    }

    pub fn insert_char_at_cursor(&mut self, ch: char) {
        let idx = self.cursor_byte_index();
        self.input.insert(idx, ch);
        self.input_cursor += 1;
    }

    pub fn insert_text_at_cursor(&mut self, text: &str) {
        if text.is_empty() {
            return;
        }

        let idx = self.cursor_byte_index();
        self.input.insert_str(idx, text);
        self.input_cursor += text.chars().count();
    }

    pub fn paste_from_clipboard(&mut self) -> Result<(), String> {
        let text = arboard::Clipboard::new()
            .map_err(|e| e.to_string())?
            .get_text()
            .map_err(|e| e.to_string())?;
        let normalized = text.replace("\r\n", "\n").replace('\r', "\n");
        self.insert_text_at_cursor(&normalized);
        self.clamp_cursor();
        self.refresh_suggestions();
        Ok(())
    }

    pub fn insert_newline_at_cursor(&mut self) {
        self.insert_char_at_cursor('\n');
    }

    pub fn backspace_at_cursor(&mut self) {
        if self.input_cursor == 0 {
            return;
        }
        self.move_cursor_left();
        let idx = self.cursor_byte_index();
        self.input.remove(idx);
    }

    pub fn delete_at_cursor(&mut self) {
        if self.input_cursor >= self.input_len_chars() {
            return;
        }
        let idx = self.cursor_byte_index();
        self.input.remove(idx);
    }

    pub fn clamp_cursor(&mut self) {
        self.input_cursor = self.input_cursor.min(self.input_len_chars());
    }

    pub fn submit_input(&mut self) {
        let raw_message = self.input.clone();
        let trimmed_message = raw_message.trim();
        if trimmed_message.is_empty() {
            return;
        }

        self.clear_conversation_selection();

        if self.runtime.has_pending_tool_approval() {
            self.scroll_history_to_bottom();
            self.messages.push(ChatMessage {
                role: MessageRole::User,
                content: trimmed_message.to_string(),
                tool_block: None,
            });
            self.runtime
                .respond_to_pending_tool_approval(trimmed_message);
            self.apply_runtime_events();
            self.set_input(String::new());
            self.refresh_suggestions();
            return;
        }

        self.scroll_history_to_bottom();

        if self.runtime.is_busy() {
            self.messages.push(ChatMessage {
                role: MessageRole::Agent,
                content: "上一条回复仍在处理中，请稍候。".to_string(),
                tool_block: None,
            });
            return;
        }

        let mut user_content = raw_message.clone();
        if !trimmed_message.starts_with('/')
            && !self.runtime.session().pending_image_paths().is_empty()
        {
            user_content.push_str(&format!(
                "\n[attached images: {}]",
                self.runtime.session().pending_image_paths().join(", ")
            ));
        }
        if !trimmed_message.starts_with('/')
            && !self.runtime.session().pending_mcp_resources().is_empty()
        {
            let summary = self
                .runtime
                .session()
                .pending_mcp_resources()
                .iter()
                .map(|resource| resource.short_label())
                .collect::<Vec<_>>()
                .join(" | ");
            user_content.push_str(&format!("\n[attached mcp resources: {}]", summary));
        }

        self.messages.push(ChatMessage {
            role: MessageRole::User,
            content: user_content,
            tool_block: None,
        });

        if trimmed_message.starts_with('/') {
            self.handle_slash_command(trimmed_message);
        } else {
            self.runtime.submit_user_turn(raw_message, None);
            self.apply_runtime_events();
        }

        self.set_input(String::new());
        self.refresh_suggestions();
    }

    pub fn select_next_suggestion(&mut self) {
        if self.slash_suggestions.is_empty() {
            return;
        }
        self.selected_suggestion = (self.selected_suggestion + 1) % self.slash_suggestions.len();
    }

    pub fn select_prev_suggestion(&mut self) {
        if self.slash_suggestions.is_empty() {
            return;
        }
        if self.selected_suggestion == 0 {
            self.selected_suggestion = self.slash_suggestions.len() - 1;
        } else {
            self.selected_suggestion -= 1;
        }
    }

    pub fn apply_selected_suggestion(&mut self) {
        if let Some(selected) = self.slash_suggestions.get(self.selected_suggestion) {
            self.set_input(slash_suggestion_apply_value(selected));
            self.refresh_suggestions();
        }
    }

    pub fn scroll_history_up(&mut self, lines: usize) {
        self.history_offset_from_bottom = self.history_offset_from_bottom.saturating_add(lines);
    }

    pub fn scroll_history_down(&mut self, lines: usize) {
        self.history_offset_from_bottom = self.history_offset_from_bottom.saturating_sub(lines);
    }

    pub fn scroll_history_to_top(&mut self) {
        self.history_offset_from_bottom = usize::MAX;
    }

    pub fn scroll_history_to_bottom(&mut self) {
        self.history_offset_from_bottom = 0;
    }

    /// 在对话折行高度变化后，避免 “贴底偏移” 超出范围导致布局/滚动错位（偶现整屏错乱，resize 后恢复）。
    pub(crate) fn clamp_history_scroll(&mut self, max_scroll: usize) -> usize {
        self.history_offset_from_bottom = self.history_offset_from_bottom.min(max_scroll);
        self.history_offset_from_bottom
    }

    pub fn cancel_model_picker(&mut self) {
        self.model_picker_active = false;
    }

    pub fn select_next_model(&mut self) {
        if self.runtime.config().models.is_empty() {
            return;
        }
        self.model_picker_index =
            (self.model_picker_index + 1) % self.runtime.config().models.len();
    }

    pub fn select_prev_model(&mut self) {
        if self.runtime.config().models.is_empty() {
            return;
        }
        if self.model_picker_index == 0 {
            self.model_picker_index = self.runtime.config().models.len() - 1;
        } else {
            self.model_picker_index -= 1;
        }
    }

    pub fn confirm_model_picker(&mut self) {
        let Some(selected) = self
            .runtime
            .config()
            .models
            .get(self.model_picker_index)
            .map(|m| m.name.clone())
        else {
            self.model_picker_active = false;
            return;
        };

        let mut config = self.runtime.config().clone();
        config.active_model = selected.clone();
        if let Err(err) = self.config_store.save(&config) {
            self.messages.push(ChatMessage {
                role: MessageRole::Agent,
                content: format!("模型切换成功但保存失败: {}", err),
                tool_block: None,
            });
        } else {
            self.runtime.replace_config(config);
            self.messages.push(ChatMessage {
                role: MessageRole::Agent,
                content: format!("已切换当前模型为: {}", selected),
                tool_block: None,
            });
        }
        self.model_picker_active = false;
    }

    pub fn cancel_chat_picker(&mut self) {
        self.chat_picker_active = false;
    }

    pub fn select_next_chat(&mut self) {
        if self.chat_picker_files.is_empty() {
            return;
        }
        self.chat_picker_index = (self.chat_picker_index + 1) % self.chat_picker_files.len();
    }

    pub fn select_prev_chat(&mut self) {
        if self.chat_picker_files.is_empty() {
            return;
        }
        if self.chat_picker_index == 0 {
            self.chat_picker_index = self.chat_picker_files.len() - 1;
        } else {
            self.chat_picker_index -= 1;
        }
    }

    pub fn confirm_chat_picker(&mut self) {
        let Some(selected) = self.chat_picker_files.get(self.chat_picker_index).cloned() else {
            self.chat_picker_active = false;
            return;
        };
        self.chat_picker_active = false;
        self.load_chat_by_path(&selected);
    }

    pub fn cancel_image_picker(&mut self) {
        self.image_picker_active = false;
    }

    pub fn select_next_image(&mut self) {
        if self.image_picker_files.is_empty() {
            return;
        }
        self.image_picker_index = (self.image_picker_index + 1) % self.image_picker_files.len();
    }

    pub fn select_prev_image(&mut self) {
        if self.image_picker_files.is_empty() {
            return;
        }
        if self.image_picker_index == 0 {
            self.image_picker_index = self.image_picker_files.len() - 1;
        } else {
            self.image_picker_index -= 1;
        }
    }

    pub fn confirm_image_picker(&mut self) {
        let Some(selected) = self
            .image_picker_files
            .get(self.image_picker_index)
            .cloned()
        else {
            self.image_picker_active = false;
            return;
        };

        self.image_picker_active = false;
        self.runtime
            .session_mut()
            .add_pending_image(selected.clone());
        self.messages.push(ChatMessage {
            role: MessageRole::Agent,
            content: format!(
                "已添加图片到待发送队列（{} 张）: {}",
                self.runtime.session().pending_image_paths().len(),
                selected
            ),
            tool_block: None,
        });
    }

    pub fn cancel_bottom_form(&mut self) {
        self.bottom_form = None;
    }

    pub fn select_next_bottom_form_field(&mut self) {
        let Some(form) = self.bottom_form.as_mut() else {
            return;
        };
        if form.fields.is_empty() {
            return;
        }
        form.selected_field = (form.selected_field + 1) % form.fields.len();
    }

    pub fn select_prev_bottom_form_field(&mut self) {
        let Some(form) = self.bottom_form.as_mut() else {
            return;
        };
        if form.fields.is_empty() {
            return;
        }
        if form.selected_field == 0 {
            form.selected_field = form.fields.len() - 1;
        } else {
            form.selected_field -= 1;
        }
    }

    pub fn bottom_form_move_left(&mut self) {
        let Some(form) = self.bottom_form.as_mut() else {
            return;
        };
        let selected = form.selected_field.min(form.fields.len().saturating_sub(1));
        let Some(field) = form.fields.get_mut(selected) else {
            return;
        };

        match &mut field.editor {
            BottomFormFieldEditorView::Text { value, cursor, .. } => {
                *cursor = (*cursor).min(value.chars().count());
                if *cursor > 0 {
                    *cursor -= 1;
                }
            }
            BottomFormFieldEditorView::Choice { options, selected } => {
                if options.is_empty() {
                    return;
                }
                if *selected == 0 {
                    *selected = options.len() - 1;
                } else {
                    *selected -= 1;
                }
                sync_mcp_add_form_fields(form);
            }
        }
    }

    pub fn bottom_form_move_right(&mut self) {
        let Some(form) = self.bottom_form.as_mut() else {
            return;
        };
        let selected = form.selected_field.min(form.fields.len().saturating_sub(1));
        let Some(field) = form.fields.get_mut(selected) else {
            return;
        };

        match &mut field.editor {
            BottomFormFieldEditorView::Text { value, cursor, .. } => {
                *cursor = (*cursor + 1).min(value.chars().count());
            }
            BottomFormFieldEditorView::Choice { options, selected } => {
                if options.is_empty() {
                    return;
                }
                *selected = (*selected + 1) % options.len();
                sync_mcp_add_form_fields(form);
            }
        }
    }

    pub fn bottom_form_move_home(&mut self) {
        let Some(BottomFormFieldEditorView::Text { cursor, .. }) =
            self.selected_bottom_form_editor_mut()
        else {
            return;
        };
        *cursor = 0;
    }

    pub fn bottom_form_move_end(&mut self) {
        let Some(BottomFormFieldEditorView::Text { value, cursor, .. }) =
            self.selected_bottom_form_editor_mut()
        else {
            return;
        };
        *cursor = value.chars().count();
    }

    pub fn bottom_form_insert_char(&mut self, ch: char) {
        let Some(BottomFormFieldEditorView::Text { value, cursor, .. }) =
            self.selected_bottom_form_editor_mut()
        else {
            return;
        };
        let idx = char_cursor_to_byte_index(value, *cursor);
        value.insert(idx, ch);
        *cursor += 1;
    }

    pub fn bottom_form_insert_text(&mut self, text: &str) {
        let normalized = text.replace("\r\n", " ").replace(['\r', '\n'], " ");
        if normalized.is_empty() {
            return;
        }

        let Some(BottomFormFieldEditorView::Text { value, cursor, .. }) =
            self.selected_bottom_form_editor_mut()
        else {
            return;
        };
        let idx = char_cursor_to_byte_index(value, *cursor);
        value.insert_str(idx, &normalized);
        *cursor += normalized.chars().count();
    }

    pub fn bottom_form_backspace(&mut self) {
        let Some(BottomFormFieldEditorView::Text { value, cursor, .. }) =
            self.selected_bottom_form_editor_mut()
        else {
            return;
        };
        if *cursor == 0 {
            return;
        }
        let end = char_cursor_to_byte_index(value, *cursor);
        let start = char_cursor_to_byte_index(value, cursor.saturating_sub(1));
        value.replace_range(start..end, "");
        *cursor -= 1;
    }

    pub fn bottom_form_delete(&mut self) {
        let Some(BottomFormFieldEditorView::Text { value, cursor, .. }) =
            self.selected_bottom_form_editor_mut()
        else {
            return;
        };
        if *cursor >= value.chars().count() {
            return;
        }
        let start = char_cursor_to_byte_index(value, *cursor);
        let end = char_cursor_to_byte_index(value, cursor.saturating_add(1));
        value.replace_range(start..end, "");
    }

    pub fn paste_bottom_form_from_clipboard(&mut self) -> Result<(), String> {
        let text = arboard::Clipboard::new()
            .map_err(|e| e.to_string())?
            .get_text()
            .map_err(|e| e.to_string())?;
        self.bottom_form_insert_text(&text);
        Ok(())
    }

    pub fn save_bottom_form(&mut self) {
        let Some(form) = self.bottom_form.as_ref() else {
            return;
        };

        match mcp_add_form_to_config(form) {
            Ok((server_name, config)) => match self.runtime.add_mcp_server(&server_name, config) {
                Ok(path) => {
                    self.messages.push(ChatMessage {
                        role: MessageRole::Agent,
                        content: format!(
                            "已添加 MCP server: {}\n配置文件: {}",
                            server_name,
                            path.display()
                        ),
                        tool_block: None,
                    });
                    self.bottom_form = None;
                    self.sync_welcome_mcp_status();
                }
                Err(err) => {
                    self.messages.push(ChatMessage {
                        role: MessageRole::Agent,
                        content: format!("添加 MCP server 失败: {}", err),
                        tool_block: None,
                    });
                }
            },
            Err(err) => {
                self.messages.push(ChatMessage {
                    role: MessageRole::Agent,
                    content: format!("添加 MCP server 失败: {}", err),
                    tool_block: None,
                });
            }
        }
    }

    fn selected_bottom_form_editor_mut(&mut self) -> Option<&mut BottomFormFieldEditorView> {
        let form = self.bottom_form.as_mut()?;
        let selected = form.selected_field.min(form.fields.len().saturating_sub(1));
        form.fields.get_mut(selected).map(|field| &mut field.editor)
    }

    fn handle_slash_command(&mut self, message: &str) {
        let parts: Vec<&str> = message.split_whitespace().collect();
        let Some(cmd) = parts.first().copied() else {
            return;
        };

        match cmd {
            "/quit" | "/exit" => {
                self.messages.push(ChatMessage {
                    role: MessageRole::Agent,
                    content: "收到，SpiritAgent 即将退出。".to_string(),
                    tool_block: None,
                });
                self.should_quit = true;
            }
            "/help" => {
                self.messages.push(ChatMessage {
                    role: MessageRole::Agent,
                    content: "可用指令:\n- /help\n- /clear\n- /quit\n- /model [list|use <name>|add <name> <api_base> <api_key>|remove <name>]\n- /compact\n- /sessions\n- /sessions save [path]\n- /sessions load <file>\n- /image <path> [prompt]\n- /image pick\n- /image clear\n- /mcp [list|add|inspect|tools|resources|prompts]\n- /log（或 /log export、/log session export）\n\n说明:\n- /sessions 打开已保存会话列表选择器。\n- /image pick 打开当前目录图片选择器。\n- /image 不带 prompt 时会把图片加入待发送队列。\n- /mcp add 打开底部表单，用于填写 server 名称、类型、命令或 URL。\n- /mcp tools、/mcp resources、/mcp prompts 在只有一个 server 时可省略 server 名。\n- /log 默认打开当前 CLI 日志；/log export 导出当前 CLI 日志快照；/log session export 导出 LLM 会话全文与请求轨迹。\n- 鼠标默认开启：滚轮浏览历史；在 Conversation 内拖拽选区，Ctrl+Shift+C 或右键复制后会清除反色选区。\n- Ctrl+O 切换辅助细节的显示/隐藏：包括思考内容、压缩摘要以及工具结果细节；已完成回复的辅助细节也会保留，失败与待确认工具保持展开。\n\nAPI Key 来源优先级: SPIRIT_API_KEY > 模型专属 keyring > 全局 keyring。".to_string(),
                    tool_block: None,
                });
            }
            "/clear" => {
                self.messages.clear();
                self.assistant_aux_by_message.clear();
                let mcp_status = self.runtime.mcp_status_snapshot();
                self.messages.push(welcome_message(
                    &self.runtime.config().active_model,
                    &mcp_status.welcome_line(),
                ));
                self.last_mcp_status_revision = mcp_status.revision;
                self.pending_assistant_msg_index = None;
            }
            "/model" => self.handle_model_slash(&parts[1..]),
            "/compact" => {
                self.runtime.compact_history();
                self.apply_runtime_events();
            }
            "/sessions" => self.handle_sessions_slash(message),
            "/image" => self.handle_image_slash(message),
            "/mcp" => self.handle_mcp_slash(message),
            "/log" => self.handle_log_slash(&parts[1..]),
            _ => {
                self.messages.push(ChatMessage {
                    role: MessageRole::Agent,
                    content: "未知斜杠命令，输入 /help 查看可用指令。".to_string(),
                    tool_block: None,
                });
            }
        }
    }

    fn handle_model_slash(&mut self, args: &[&str]) {
        match args {
            [] => self.open_model_picker(),
            ["list"] => {
                let list = self
                    .runtime
                    .config()
                    .models
                    .iter()
                    .map(|m| format!("{} ({})", m.name, m.api_base))
                    .collect::<Vec<_>>()
                    .join(", ");
                self.messages.push(ChatMessage {
                    role: MessageRole::Agent,
                    content: format!(
                        "当前模型: {}\n模型列表: {}",
                        self.runtime.config().active_model,
                        list
                    ),
                    tool_block: None,
                });
            }
            ["use"] => {
                self.messages.push(ChatMessage {
                    role: MessageRole::Agent,
                    content: "用法: `/model use <name>`".to_string(),
                    tool_block: None,
                });
            }
            ["use", model] => {
                let mut config = self.runtime.config().clone();
                if !config.has_model(model) {
                    self.messages.push(ChatMessage {
                        role: MessageRole::Agent,
                        content: format!(
                            "模型不存在: {}，先用 `/model add {} <api_base> <api_key>`",
                            model, model
                        ),
                        tool_block: None,
                    });
                    return;
                }
                config.active_model = (*model).to_string();
                if let Err(err) = self.config_store.save(&config) {
                    self.messages.push(ChatMessage {
                        role: MessageRole::Agent,
                        content: format!("切换成功但保存失败: {}", err),
                        tool_block: None,
                    });
                } else {
                    self.runtime.replace_config(config);
                    self.messages.push(ChatMessage {
                        role: MessageRole::Agent,
                        content: format!("已切换当前模型为: {}", model),
                        tool_block: None,
                    });
                }
            }
            ["add"] | ["add", _] | ["add", _, _] => {
                self.messages.push(ChatMessage {
                    role: MessageRole::Agent,
                    content: "用法: `/model add <name> <api_base> <api_key>`".to_string(),
                    tool_block: None,
                });
            }
            ["add", model, api_base, api_key] => {
                let mut config = self.runtime.config().clone();
                if config.has_model(model) {
                    self.messages.push(ChatMessage {
                        role: MessageRole::Agent,
                        content: format!("模型已存在: {}", model),
                        tool_block: None,
                    });
                    return;
                }

                config.add_model(ModelProfile {
                    name: (*model).to_string(),
                    api_base: (*api_base).to_string(),
                });
                if let Err(err) = self.secret_store.save_model_api_key(model, api_key) {
                    self.messages.push(ChatMessage {
                        role: MessageRole::Agent,
                        content: format!("模型已添加，但密钥保存失败: {}", err),
                        tool_block: None,
                    });
                    return;
                }
                if let Err(err) = self.config_store.save(&config) {
                    self.messages.push(ChatMessage {
                        role: MessageRole::Agent,
                        content: format!("添加成功但保存失败: {}", err),
                        tool_block: None,
                    });
                } else {
                    self.runtime.replace_config(config);
                    self.messages.push(ChatMessage {
                        role: MessageRole::Agent,
                        content: format!("已添加模型: {} (api_base: {})", model, api_base),
                        tool_block: None,
                    });
                }
            }
            ["remove"] => {
                self.messages.push(ChatMessage {
                    role: MessageRole::Agent,
                    content: "用法: `/model remove <name>`".to_string(),
                    tool_block: None,
                });
            }
            ["remove", model] => {
                let mut config = self.runtime.config().clone();
                if *model == config.active_model {
                    self.messages.push(ChatMessage {
                        role: MessageRole::Agent,
                        content: "不能删除当前使用中的模型，请先 `/model use <name>` 切换。"
                            .to_string(),
                        tool_block: None,
                    });
                    return;
                }
                let before = config.models.len();
                config.models.retain(|m| m.name != *model);
                if config.models.len() == before {
                    self.messages.push(ChatMessage {
                        role: MessageRole::Agent,
                        content: format!("模型不存在: {}", model),
                        tool_block: None,
                    });
                    return;
                }
                if let Err(err) = self.config_store.save(&config) {
                    self.messages.push(ChatMessage {
                        role: MessageRole::Agent,
                        content: format!("删除成功但保存失败: {}", err),
                        tool_block: None,
                    });
                } else {
                    let _ = self.secret_store.remove_model_api_key(model);
                    self.runtime.replace_config(config);
                    self.messages.push(ChatMessage {
                        role: MessageRole::Agent,
                        content: format!("已删除模型: {}", model),
                        tool_block: None,
                    });
                }
            }
            _ => {
                self.messages.push(ChatMessage {
                    role: MessageRole::Agent,
                    content: "用法:\n- `/model list`\n- `/model use <name>`\n- `/model add <name> <api_base> <api_key>`\n- `/model remove <name>`".to_string(),
                    tool_block: None,
                });
            }
        }
    }

    fn handle_sessions_slash(&mut self, message: &str) {
        let tail = message
            .strip_prefix("/sessions")
            .map(str::trim)
            .unwrap_or("");
        if tail.is_empty() {
            self.open_chat_picker();
            return;
        }
        if tail == "save" {
            self.save_current_chat(None);
            return;
        }
        if let Some(path) = tail.strip_prefix("save ") {
            self.save_current_chat(Some(path.trim()));
            return;
        }
        if let Some(path) = tail.strip_prefix("load ") {
            self.load_chat_by_path(path.trim());
            return;
        }
        if tail == "load" {
            self.messages.push(ChatMessage {
                role: MessageRole::Agent,
                content: "用法: /sessions load <file>".to_string(),
                tool_block: None,
            });
            return;
        }
        self.messages.push(ChatMessage {
            role: MessageRole::Agent,
            content: "用法: /sessions [save [path]|load <file>]".to_string(),
            tool_block: None,
        });
    }

    fn handle_image_slash(&mut self, message: &str) {
        let tail = message.strip_prefix("/image").map(str::trim).unwrap_or("");

        if tail.is_empty() {
            self.messages.push(ChatMessage {
                role: MessageRole::Agent,
                content:
                    "用法: /image <path> [prompt] | /image pick | /image clear。若不带 prompt，会把图片加入待发送队列。"
                        .to_string(),
                tool_block: None});
            return;
        }

        if tail == "clear" {
            let cleared = self.runtime.session_mut().clear_pending_images();
            self.messages.push(ChatMessage {
                role: MessageRole::Agent,
                content: format!("已清空待发送图片队列（{} 张）。", cleared),
                tool_block: None,
            });
            return;
        }

        if tail == "pick" {
            self.open_image_picker();
            return;
        }

        let (raw_path, prompt) = parse_image_path_and_prompt(tail);
        if raw_path.is_empty() {
            self.messages.push(ChatMessage {
                role: MessageRole::Agent,
                content: "用法: /image <path> [prompt]".to_string(),
                tool_block: None,
            });
            return;
        }
        if !is_supported_image_path(raw_path) {
            self.messages.push(ChatMessage {
                role: MessageRole::Agent,
                content: "仅支持图片文件: .png .jpg .jpeg .webp .gif .bmp".to_string(),
                tool_block: None,
            });
            return;
        }
        if !Path::new(raw_path).exists() {
            self.messages.push(ChatMessage {
                role: MessageRole::Agent,
                content: format!("图片不存在: {}", raw_path),
                tool_block: None,
            });
            return;
        }

        if !prompt.is_empty() {
            if self.runtime.is_busy() {
                self.messages.push(ChatMessage {
                    role: MessageRole::Agent,
                    content: "上一条回复仍在处理中，请稍候。".to_string(),
                    tool_block: None,
                });
                return;
            }
            self.scroll_history_to_bottom();
            self.messages.push(ChatMessage {
                role: MessageRole::User,
                content: format!("{}\n[attached image] {}", prompt, raw_path),
                tool_block: None,
            });
            self.runtime
                .submit_user_turn(prompt.to_string(), Some(vec![raw_path.to_string()]));
            self.apply_runtime_events();
            return;
        }

        self.runtime
            .session_mut()
            .add_pending_image(raw_path.to_string());
        self.messages.push(ChatMessage {
            role: MessageRole::Agent,
            content: format!(
                "已添加图片到待发送队列（{} 张）。下一条普通消息会自动携带这些图片。",
                self.runtime.session().pending_image_paths().len()
            ),
            tool_block: None,
        });
    }

    fn handle_log_slash(&mut self, args: &[&str]) {
        match args {
            [] => match self.open_cli_log_file() {
                Ok(path) => {
                    self.messages.push(ChatMessage {
                        role: MessageRole::Agent,
                        content: format!("已打开当前 CLI 日志:\n{}", path.display()),
                        tool_block: None,
                    });
                }
                Err(err) => {
                    self.messages.push(ChatMessage {
                        role: MessageRole::Agent,
                        content: format!("打开 CLI 日志失败: {}", err),
                        tool_block: None,
                    });
                }
            },
            ["export"] => match self.export_cli_log_to_temp() {
                Ok(path) => {
                    self.messages.push(ChatMessage {
                        role: MessageRole::Agent,
                        content: format!("已导出当前 CLI 日志快照:\n{}", path.display()),
                        tool_block: None,
                    });
                }
                Err(err) => {
                    self.messages.push(ChatMessage {
                        role: MessageRole::Agent,
                        content: format!("导出 CLI 日志失败: {}", err),
                        tool_block: None,
                    });
                }
            },
            ["session", "export"] => match self.export_llm_history_json_to_temp() {
                Ok(path) => {
                    self.messages.push(ChatMessage {
                        role: MessageRole::Agent,
                        content: format!(
                            "已导出：llm_history、完整 API 请求轨迹（含 tools 与 system）、system 全文:\n{}",
                            path.display()
                        ),
                        tool_block: None,
                    });
                }
                Err(err) => {
                    self.messages.push(ChatMessage {
                        role: MessageRole::Agent,
                        content: format!("导出会话日志失败: {}", err),
                        tool_block: None,
                    });
                }
            },
            _ => {
                self.messages.push(ChatMessage {
                    role: MessageRole::Agent,
                    content:
                        "用法: /log 打开当前 CLI 日志；/log export 导出当前 CLI 日志快照；/log session export 导出当前会话 LLM 侧完整历史。"
                            .to_string(),
                    tool_block: None,
                });
            }
        }
    }

    fn handle_mcp_slash(&mut self, message: &str) {
        let tail = message.strip_prefix("/mcp").map(str::trim).unwrap_or("");

        if tail.is_empty() || tail == "list" {
            self.push_mcp_overview();
            return;
        }

        if tail == "add" {
            self.open_mcp_add_form();
            self.messages.push(ChatMessage {
                role: MessageRole::Agent,
                content: "已打开 MCP 添加表单。填写完成后按 Ctrl+S 保存，Esc 取消。".to_string(),
                tool_block: None,
            });
            return;
        }

        if tail == "inspect" || tail.starts_with("inspect ") {
            let server = if tail == "inspect" {
                match self.resolve_default_mcp_server("inspect") {
                    Some(server) => server,
                    None => return,
                }
            } else {
                tail.strip_prefix("inspect ")
                    .unwrap_or_default()
                    .trim()
                    .to_string()
            };

            match self.runtime.inspect_mcp_server(&server) {
                Ok(inspection) => {
                    self.messages.push(ChatMessage {
                        role: MessageRole::Agent,
                        content: format!(
                            "server: {}\ndisplay: {}\nprotocol: {}\npeer: {} {}\ncapabilities: tools={} resources={} prompts={}\ncounts: tools={} resources={} prompts={}",
                            inspection.name,
                            inspection.display_name,
                            inspection.protocol_version,
                            inspection.server_name,
                            inspection.server_version,
                            inspection.supports_tools,
                            inspection.supports_resources,
                            inspection.supports_prompts,
                            inspection.tools_count,
                            inspection.resources_count,
                            inspection.prompts_count,
                        ),
                        tool_block: None,
                    });
                }
                Err(err) => self.messages.push(ChatMessage {
                    role: MessageRole::Agent,
                    content: format!("MCP inspect 失败: {}", err),
                    tool_block: None,
                }),
            }
            return;
        }

        if tail == "tools" || tail.starts_with("tools ") {
            let server = if tail == "tools" {
                match self.resolve_default_mcp_server("tools") {
                    Some(server) => server,
                    None => return,
                }
            } else {
                tail.strip_prefix("tools ")
                    .unwrap_or_default()
                    .trim()
                    .to_string()
            };

            match self.runtime.list_mcp_tools(&server) {
                Ok(tools) if tools.is_empty() => self.messages.push(ChatMessage {
                    role: MessageRole::Agent,
                    content: format!("MCP server {} 当前没有可见 tools。", server),
                    tool_block: None,
                }),
                Ok(tools) => {
                    let lines = tools
                        .into_iter()
                        .map(|tool| {
                            let desc = tool.description.unwrap_or_else(|| "<无描述>".to_string());
                            format!("- {}: {}", tool.name, desc)
                        })
                        .collect::<Vec<_>>()
                        .join("\n");
                    self.messages.push(ChatMessage {
                        role: MessageRole::Agent,
                        content: format!("MCP tools:\n{}", lines),
                        tool_block: None,
                    });
                }
                Err(err) => self.messages.push(ChatMessage {
                    role: MessageRole::Agent,
                    content: format!("读取 MCP tools 失败: {}", err),
                    tool_block: None,
                }),
            }
            return;
        }

        if tail == "resources" || tail.starts_with("resources ") {
            let server = if tail == "resources" {
                match self.resolve_default_mcp_server("resources") {
                    Some(server) => server,
                    None => return,
                }
            } else {
                tail.strip_prefix("resources ")
                    .unwrap_or_default()
                    .trim()
                    .to_string()
            };

            match self.runtime.list_mcp_resources(&server) {
                Ok(resources) if resources.is_empty() => self.messages.push(ChatMessage {
                    role: MessageRole::Agent,
                    content: format!("MCP server {} 当前没有可见 resources。", server),
                    tool_block: None,
                }),
                Ok(resources) => {
                    let lines = resources
                        .into_iter()
                        .map(|resource| format!("- {} ({})", resource.uri, resource.name))
                        .collect::<Vec<_>>()
                        .join("\n");
                    self.messages.push(ChatMessage {
                        role: MessageRole::Agent,
                        content: format!("MCP resources:\n{}", lines),
                        tool_block: None,
                    });
                }
                Err(err) => self.messages.push(ChatMessage {
                    role: MessageRole::Agent,
                    content: format!("读取 MCP resources 失败: {}", err),
                    tool_block: None,
                }),
            }
            return;
        }

        if tail == "prompts" || tail.starts_with("prompts ") {
            let server = if tail == "prompts" {
                match self.resolve_default_mcp_server("prompts") {
                    Some(server) => server,
                    None => return,
                }
            } else {
                tail.strip_prefix("prompts ")
                    .unwrap_or_default()
                    .trim()
                    .to_string()
            };

            match self.runtime.list_mcp_prompts(&server) {
                Ok(prompts) if prompts.is_empty() => self.messages.push(ChatMessage {
                    role: MessageRole::Agent,
                    content: format!("MCP server {} 当前没有可见 prompts。", server),
                    tool_block: None,
                }),
                Ok(prompts) => {
                    let lines = prompts
                        .into_iter()
                        .map(|prompt| {
                            let desc = prompt.description.unwrap_or_else(|| "<无描述>".to_string());
                            format!("- {}: {}", prompt.name, desc)
                        })
                        .collect::<Vec<_>>()
                        .join("\n");
                    self.messages.push(ChatMessage {
                        role: MessageRole::Agent,
                        content: format!("MCP prompts:\n{}", lines),
                        tool_block: None,
                    });
                }
                Err(err) => self.messages.push(ChatMessage {
                    role: MessageRole::Agent,
                    content: format!("读取 MCP prompts 失败: {}", err),
                    tool_block: None,
                }),
            }
            return;
        }

        if let Some(rest) = tail.strip_prefix("prompt ") {
            let tail = rest.trim();
            let (server, rest) = match split_first_token(tail) {
                Some((candidate_server, remainder))
                    if self.server_exists(candidate_server) && !remainder.is_empty() =>
                {
                    (candidate_server.to_string(), remainder)
                }
                _ => {
                    let server = match self.resolve_default_mcp_server("prompt") {
                        Some(server) => server,
                        None => return,
                    };
                    (server, tail)
                }
            };

            let Some((prompt, args_json)) = split_first_token(rest) else {
                self.push_mcp_usage();
                return;
            };
            match self
                .runtime
                .apply_mcp_prompt(&server, prompt, non_empty_opt(args_json))
            {
                Ok(summary) => {
                    self.messages.push(ChatMessage {
                        role: MessageRole::Agent,
                        content: summary,
                        tool_block: None,
                    });
                    self.apply_runtime_events();
                }
                Err(err) => self.messages.push(ChatMessage {
                    role: MessageRole::Agent,
                    content: format!("应用 MCP prompt 失败: {}", err),
                    tool_block: None,
                }),
            }
            return;
        }

        if let Some(rest) = tail.strip_prefix("tool call ") {
            let Some((server, rest)) = split_first_token(rest) else {
                self.push_mcp_usage();
                return;
            };
            let Some((tool, args_json)) = split_first_token(rest) else {
                self.push_mcp_usage();
                return;
            };
            match self
                .runtime
                .execute_mcp_tool(server, tool, non_empty_opt(args_json))
            {
                Ok(()) => self.apply_runtime_events(),
                Err(err) => self.messages.push(ChatMessage {
                    role: MessageRole::Agent,
                    content: format!("执行 MCP tool 失败: {}", err),
                    tool_block: None,
                }),
            }
            return;
        }

        if let Some(rest) = tail.strip_prefix("resource attach ") {
            let Some((server, rest)) = split_first_token(rest) else {
                self.push_mcp_usage();
                return;
            };
            let uri = rest.trim();
            if uri.is_empty() {
                self.push_mcp_usage();
                return;
            }
            match self.runtime.attach_mcp_resource(server, uri) {
                Ok(label) => self.messages.push(ChatMessage {
                    role: MessageRole::Agent,
                    content: format!(
                        "已添加 MCP resource 到待发送上下文（{} 项）: {}",
                        self.runtime.session().pending_mcp_resources().len(),
                        label
                    ),
                    tool_block: None,
                }),
                Err(err) => self.messages.push(ChatMessage {
                    role: MessageRole::Agent,
                    content: format!("附加 MCP resource 失败: {}", err),
                    tool_block: None,
                }),
            }
            return;
        }

        if tail == "resource clear" {
            let cleared = self.runtime.clear_pending_mcp_resources();
            self.messages.push(ChatMessage {
                role: MessageRole::Agent,
                content: format!("已清空待发送 MCP resource 队列（{} 项）。", cleared),
                tool_block: None,
            });
            return;
        }

        self.push_mcp_usage();
    }

    fn push_mcp_usage(&mut self) {
        self.messages.push(ChatMessage {
            role: MessageRole::Agent,
            content: "用法:\n- /mcp\n- /mcp list\n- /mcp add\n- /mcp inspect [server]\n- /mcp tools [server]\n- /mcp resources [server]\n- /mcp prompts [server]\n- /mcp prompt [server] <prompt> [args_json]\n\n说明:\n- `/mcp add` 会打开底部表单，支持填写 STDIO 或 HTTP server。\n- 仅有一个 MCP server 时，`[server]` 可省略。\n- `/mcp tool call`、`/mcp resource attach`、`/mcp resource clear` 仍保留为调试入口，但不作为主交互路径。".to_string(),
            tool_block: None,
        });
    }

    fn push_mcp_overview(&mut self) {
        match self.runtime.list_mcp_servers() {
            Ok(servers) if servers.is_empty() => {
                self.messages.push(ChatMessage {
                    role: MessageRole::Agent,
                    content: "当前未配置 MCP server。可用 `/mcp add` 打开表单进行添加。"
                        .to_string(),
                    tool_block: None,
                });
            }
            Ok(servers) => {
                let summary = servers
                    .into_iter()
                    .map(|server| {
                        format!(
                            "- {} ({})  state={}  capabilities={}",
                            server.name,
                            server.display_name,
                            server.state.label(),
                            server.capability_summary(),
                        )
                    })
                    .collect::<Vec<_>>()
                    .join("\n");
                self.messages.push(ChatMessage {
                    role: MessageRole::Agent,
                    content: format!(
                        "MCP 概览:\n{}\n\n常用命令:\n- /mcp tools [server]\n- /mcp resources [server]\n- /mcp prompts [server]\n- /mcp add",
                        summary
                    ),
                    tool_block: None,
                });
            }
            Err(err) => {
                self.messages.push(ChatMessage {
                    role: MessageRole::Agent,
                    content: format!("读取 MCP 概览失败: {}", err),
                    tool_block: None,
                });
            }
        }
    }

    fn resolve_default_mcp_server(&mut self, purpose: &str) -> Option<String> {
        match self.runtime.list_mcp_servers() {
            Ok(servers) if servers.is_empty() => {
                self.messages.push(ChatMessage {
                    role: MessageRole::Agent,
                    content: "当前未配置 MCP server。可用 `/mcp add` 打开表单进行添加。"
                        .to_string(),
                    tool_block: None,
                });
                None
            }
            Ok(servers) if servers.len() == 1 => Some(servers[0].name.clone()),
            Ok(servers) => {
                let names = servers
                    .into_iter()
                    .map(|server| server.name)
                    .collect::<Vec<_>>()
                    .join(", ");
                self.messages.push(ChatMessage {
                    role: MessageRole::Agent,
                    content: format!(
                        "请为 `/mcp {}` 指定 server。可用 server: {}",
                        purpose, names
                    ),
                    tool_block: None,
                });
                None
            }
            Err(err) => {
                self.messages.push(ChatMessage {
                    role: MessageRole::Agent,
                    content: format!("读取 MCP server 列表失败: {}", err),
                    tool_block: None,
                });
                None
            }
        }
    }

    fn server_exists(&self, name: &str) -> bool {
        self.runtime
            .list_mcp_servers()
            .map(|servers| servers.into_iter().any(|server| server.name == name))
            .unwrap_or(false)
    }

    fn sync_welcome_mcp_status(&mut self) {
        let snapshot = self.runtime.mcp_status_snapshot();
        if snapshot.revision == self.last_mcp_status_revision {
            return;
        }
        self.last_mcp_status_revision = snapshot.revision;

        let Some(first_message) = self.messages.first_mut() else {
            return;
        };
        if first_message.role != MessageRole::Agent
            || !first_message.content.starts_with("欢迎来到 SpiritAgent。")
        {
            return;
        }

        first_message.content = welcome_message_text(
            &self.runtime.config().active_model,
            &snapshot.welcome_line(),
        );
    }

    fn open_cli_log_file(&self) -> Result<std::path::PathBuf> {
        let path = self.ensure_cli_log_file()?;
        logging::log_event(&format!("[cli-log] open path={}", path.display()));
        open_path_in_os(&path)?;
        Ok(path)
    }

    fn export_cli_log_to_temp(&self) -> Result<std::path::PathBuf> {
        let source = self.ensure_cli_log_file()?;
        let exported_at_unix_secs = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let target = env::temp_dir().join(format!(
            "spirit-agent-cli-log-{exported_at_unix_secs}-{}.log",
            std::process::id()
        ));
        fs::copy(&source, &target).with_context(|| {
            format!(
                "导出 CLI 日志失败: {} -> {}",
                source.display(),
                target.display()
            )
        })?;
        logging::log_event(&format!(
            "[cli-log] export source={} target={}",
            source.display(),
            target.display()
        ));
        Ok(target)
    }

    fn ensure_cli_log_file(&self) -> Result<std::path::PathBuf> {
        let path = self.app_paths.log_file();
        OpenOptions::new()
            .create(true)
            .append(true)
            .open(&path)
            .with_context(|| format!("无法创建或访问 CLI 日志文件: {}", path.display()))?;
        Ok(path)
    }

    fn export_llm_history_json_to_temp(&self) -> Result<std::path::PathBuf> {
        let messages = self.runtime.llm_history_as_api_messages();
        let active_model = self.runtime.config().active_model.clone();
        let api_base = env::var("SPIRIT_API_BASE").unwrap_or_else(|_| {
            self.runtime
                .config()
                .active_model_profile()
                .map(|m| m.api_base.clone())
                .unwrap_or_else(|| DEFAULT_API_BASE.to_string())
        });
        let working_directory = self.app_paths.workspace_root().display().to_string();
        let exported_at_unix_secs = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let export = serde_json::json!({
            "export_version": 2,
            "exported_at_unix_secs": exported_at_unix_secs,
            "active_model": active_model,
            "api_base": api_base,
            "working_directory": working_directory,
            "system_prompts": self.runtime.llm_system_prompts_for_export(),
            "note": "messages: 内存 llm_history 的 API 形态。api_request_trace: 每步模型推理均为一次 tool_agent_chat_completions，stream=true，含 tools；多轮工具时会有多条 trace（每轮一次 HTTP）。不再有单独的 final 润色请求。system_prompts 中 final_response 字段仅作元数据兼容，当前对话流已不单独使用。",
            "message_count": messages.len(),
            "messages": messages,
            "api_request_trace_count": self.runtime.session().llm_api_trace().len(),
            "api_request_trace": self.runtime.session().llm_api_trace(),
        });

        let json = serde_json::to_string_pretty(&export).context("序列化 JSON 失败")?;
        let path = env::temp_dir().join(format!(
            "spirit-agent-llm-export-{exported_at_unix_secs}-{}.json",
            std::process::id()
        ));
        fs::write(&path, json).with_context(|| format!("写入文件失败: {}", path.display()))?;
        Ok(path)
    }

    fn open_model_picker(&mut self) {
        if self.runtime.config().models.is_empty() {
            self.messages.push(ChatMessage {
                role: MessageRole::Agent,
                content: "当前没有可选模型，请先 /model add <name> <api_base> <api_key>。"
                    .to_string(),
                tool_block: None,
            });
            return;
        }

        self.model_picker_index = self
            .runtime
            .config()
            .models
            .iter()
            .position(|m| m.name == self.runtime.config().active_model)
            .unwrap_or(0);
        self.model_picker_active = true;
        self.chat_picker_active = false;
        self.image_picker_active = false;
        self.bottom_form = None;
        self.set_input(String::new());
        self.refresh_suggestions();
    }

    fn open_chat_picker(&mut self) {
        match self.chat_repository.list() {
            Ok(files) => {
                if files.is_empty() {
                    self.messages.push(ChatMessage {
                        role: MessageRole::Agent,
                        content: "没有已保存会话。可先使用 /sessions save 保存当前会话。"
                            .to_string(),
                        tool_block: None,
                    });
                    return;
                }
                self.chat_picker_files = files;
                self.chat_picker_index = 0;
                self.chat_picker_active = true;
                self.model_picker_active = false;
                self.image_picker_active = false;
                self.bottom_form = None;
                self.set_input(String::new());
                self.refresh_suggestions();
            }
            Err(err) => {
                self.messages.push(ChatMessage {
                    role: MessageRole::Agent,
                    content: format!("读取会话列表失败: {}", err),
                    tool_block: None,
                });
            }
        }
    }

    fn open_image_picker(&mut self) {
        match list_local_image_files() {
            Ok(files) => {
                if files.is_empty() {
                    self.messages.push(ChatMessage {
                        role: MessageRole::Agent,
                        content:
                            "当前目录未发现图片文件。可直接用 /image <path> 添加绝对或相对路径。"
                                .to_string(),
                        tool_block: None,
                    });
                    return;
                }
                self.image_picker_files = files;
                self.image_picker_index = 0;
                self.image_picker_active = true;
                self.model_picker_active = false;
                self.chat_picker_active = false;
                self.bottom_form = None;
                self.set_input(String::new());
                self.refresh_suggestions();
            }
            Err(err) => {
                self.messages.push(ChatMessage {
                    role: MessageRole::Agent,
                    content: format!("读取图片列表失败: {}", err),
                    tool_block: None,
                });
            }
        }
    }

    fn open_mcp_add_form(&mut self) {
        self.bottom_form = Some(new_mcp_add_form());
        self.model_picker_active = false;
        self.chat_picker_active = false;
        self.image_picker_active = false;
        self.set_input(String::new());
        self.refresh_suggestions();
    }

    fn save_current_chat(&mut self, path: Option<&str>) {
        let messages = self
            .messages
            .iter()
            .map(|m| {
                (
                    match m.role {
                        MessageRole::User => "user".to_string(),
                        MessageRole::Agent => "assistant".to_string(),
                    },
                    m.content.clone(),
                )
            })
            .collect::<Vec<_>>();
        let mut assistant_aux = self
            .assistant_aux_by_message
            .iter()
            .filter_map(|(idx, aux)| {
                let thinking = aux
                    .thinking
                    .clone()
                    .filter(|value| !value.trim().is_empty());
                let compaction = aux
                    .compaction
                    .clone()
                    .filter(|value| !value.trim().is_empty());
                if thinking.is_none() && compaction.is_none() {
                    None
                } else {
                    Some(AssistantAuxArchiveEntry {
                        message_index: *idx,
                        thinking,
                        compaction,
                    })
                }
            })
            .collect::<Vec<_>>();
        assistant_aux.sort_by_key(|entry| entry.message_index);
        let archive = self.runtime.session().to_archive(&messages, &assistant_aux);
        match self.chat_repository.save(path, &archive) {
            Ok(saved_path) => {
                self.messages.push(ChatMessage {
                    role: MessageRole::Agent,
                    content: format!("会话已保存: {}", saved_path.display()),
                    tool_block: None,
                });
            }
            Err(err) => {
                self.messages.push(ChatMessage {
                    role: MessageRole::Agent,
                    content: format!("保存会话失败: {}", err),
                    tool_block: None,
                });
            }
        }
    }

    fn load_chat_by_path(&mut self, path: &str) {
        match self.chat_repository.load(path) {
            Ok(archive) => {
                let mut msgs = Vec::new();
                for (role, content) in &archive.messages {
                    msgs.push(ChatMessage {
                        role: if role == "user" {
                            MessageRole::User
                        } else {
                            MessageRole::Agent
                        },
                        content: content.clone(),
                        tool_block: None,
                    });
                }
                if msgs.is_empty() {
                    msgs.push(ChatMessage {
                        role: MessageRole::Agent,
                        content: "已加载空会话。".to_string(),
                        tool_block: None,
                    });
                }
                self.messages = msgs;
                self.assistant_aux_by_message = archive
                    .assistant_aux
                    .iter()
                    .filter_map(|entry| {
                        let thinking = entry
                            .thinking
                            .clone()
                            .filter(|value| !value.trim().is_empty());
                        let compaction = entry
                            .compaction
                            .clone()
                            .filter(|value| !value.trim().is_empty());
                        if thinking.is_none() && compaction.is_none() {
                            None
                        } else {
                            Some((
                                entry.message_index,
                                AssistantAuxData {
                                    thinking,
                                    compaction,
                                },
                            ))
                        }
                    })
                    .collect();
                self.pending_assistant_msg_index = None;
                self.runtime.replace_session_from_archive(&archive);
                self.scroll_history_to_bottom();
                self.messages.push(ChatMessage {
                    role: MessageRole::Agent,
                    content: format!("会话已加载: {}", path),
                    tool_block: None,
                });
            }
            Err(err) => {
                self.messages.push(ChatMessage {
                    role: MessageRole::Agent,
                    content: format!("加载会话失败: {}", err),
                    tool_block: None,
                });
            }
        }
    }

    fn apply_runtime_events(&mut self) {
        for event in self.runtime.drain_events() {
            match event {
                RuntimeEvent::PushMessage(msg) => self.messages.push(msg),
                RuntimeEvent::BeginAssistantResponse => {
                    self.messages
                        .push(ChatMessage::new(MessageRole::Agent, String::new()));
                    let idx = self.messages.len() - 1;
                    self.assistant_aux_by_message.remove(&idx);
                    self.pending_assistant_msg_index = Some(idx);
                }
                RuntimeEvent::UpdatePendingAssistantThinking(thinking) => {
                    if let Some(idx) = self.pending_assistant_msg_index {
                        let entry = self.assistant_aux_by_message.entry(idx).or_default();
                        entry.thinking = if thinking.trim().is_empty() {
                            None
                        } else {
                            Some(thinking)
                        };
                        if entry.thinking.is_none() && entry.compaction.is_none() {
                            self.assistant_aux_by_message.remove(&idx);
                        }
                    }
                }
                RuntimeEvent::UpdatePendingAssistantCompaction(compaction) => {
                    if let Some(idx) = self.pending_assistant_msg_index {
                        let entry = self.assistant_aux_by_message.entry(idx).or_default();
                        entry.compaction = if compaction.trim().is_empty() {
                            None
                        } else {
                            Some(compaction)
                        };
                        if entry.thinking.is_none() && entry.compaction.is_none() {
                            self.assistant_aux_by_message.remove(&idx);
                        }
                    }
                }
                RuntimeEvent::AssistantChunk(chunk) => {
                    if let Some(idx) = self.pending_assistant_msg_index {
                        if let Some(msg) = self.messages.get_mut(idx) {
                            msg.content.push_str(&chunk);
                        }
                    }
                }
                RuntimeEvent::ReplacePendingAssistant(content) => {
                    if let Some(idx) = self.pending_assistant_msg_index {
                        if let Some(msg) = self.messages.get_mut(idx) {
                            msg.content = content;
                            msg.tool_block = None;
                        }
                    } else {
                        self.messages
                            .push(ChatMessage::new(MessageRole::Agent, content));
                    }
                }
                RuntimeEvent::AssistantResponseCompleted => {
                    self.pending_assistant_msg_index = None;
                }
                RuntimeEvent::RemovePendingAssistant => {
                    if let Some(idx) = self.pending_assistant_msg_index.take() {
                        let has_persisted_aux =
                            self.assistant_aux_by_message.get(&idx).is_some_and(|aux| {
                                aux.thinking
                                    .as_ref()
                                    .is_some_and(|value| !value.trim().is_empty())
                                    || aux
                                        .compaction
                                        .as_ref()
                                        .is_some_and(|value| !value.trim().is_empty())
                            });
                        if !has_persisted_aux && idx < self.messages.len() {
                            self.assistant_aux_by_message.remove(&idx);
                            self.messages.remove(idx);
                        }
                    }
                }
            }
        }
    }

    fn current_slash_query(&self) -> Option<&str> {
        if !self.input.starts_with('/') || self.input.contains('\n') {
            return None;
        }
        Some(self.input.trim_end())
    }

    fn input_len_chars(&self) -> usize {
        self.input.chars().count()
    }

    fn cursor_byte_index(&self) -> usize {
        if self.input_cursor == 0 {
            return 0;
        }
        self.input
            .char_indices()
            .nth(self.input_cursor)
            .map(|(idx, _)| idx)
            .unwrap_or(self.input.len())
    }

    fn set_input(&mut self, value: String) {
        self.input = value;
        self.input_cursor = self.input_len_chars();
    }
}

fn welcome_message(active_model: &str, mcp_status_line: &str) -> ChatMessage {
    ChatMessage {
        role: MessageRole::Agent,
        content: welcome_message_text(active_model, mcp_status_line),
        tool_block: None,
    }
}

fn welcome_message_text(active_model: &str, mcp_status_line: &str) -> String {
    format!(
        "欢迎来到 SpiritAgent。\n当前模型: {}\n输入内容按 Enter 发送，Shift+Enter 换行；输入 /help 查看指令。\n{}",
        active_model, mcp_status_line
    )
}

fn contextual_slash_suggestions(query: String) -> Vec<&'static str> {
    let q = query.trim_end();

    if q == "/model" || q.starts_with("/model ") {
        return vec!["/model"];
    }

    if q == "/sessions" || q.starts_with("/sessions ") {
        return vec![
            "/sessions",
            "/sessions save",
            "/sessions save <path>",
            "/sessions load <file>",
        ];
    }

    if q == "/image" || q.starts_with("/image ") {
        return vec!["/image"];
    }

    if q == "/mcp" || q.starts_with("/mcp ") {
        return vec!["/mcp"];
    }

    if q == "/log" || q.starts_with("/log ") {
        return vec!["/log"];
    }

    Vec::new()
}

fn slash_suggestion_apply_value(selected: &str) -> String {
    match selected {
        "/model" | "/sessions" | "/image" | "/mcp" | "/log" => format!("{} ", selected),
        _ => selected.to_string(),
    }
}

fn new_mcp_add_form() -> BottomFormView {
    let mut form = BottomFormView {
        title: "Add MCP Server".to_string(),
        fields: vec![
            BottomFormFieldView {
                label: "名称".to_string(),
                help: String::new(),
                editor: BottomFormFieldEditorView::Text {
                    value: String::new(),
                    placeholder: "名称，例如 github".to_string(),
                    cursor: 0,
                },
            },
            BottomFormFieldView {
                label: "类型".to_string(),
                help: String::new(),
                editor: BottomFormFieldEditorView::Choice {
                    options: vec!["STDIO".to_string(), "HTTP".to_string()],
                    selected: 0,
                },
            },
            BottomFormFieldView {
                label: "命令".to_string(),
                help: String::new(),
                editor: BottomFormFieldEditorView::Text {
                    value: String::new(),
                    placeholder: String::new(),
                    cursor: 0,
                },
            },
            BottomFormFieldView {
                label: "环境变量".to_string(),
                help: String::new(),
                editor: BottomFormFieldEditorView::Text {
                    value: String::new(),
                    placeholder: String::new(),
                    cursor: 0,
                },
            },
        ],
        selected_field: MCP_ADD_FIELD_NAME,
        footer_hint: "↑/↓ 切换字段  ←/→ 移动光标或切换类型  Ctrl+S 保存  Esc 取消".to_string(),
    };
    sync_mcp_add_form_fields(&mut form);
    form
}

fn sync_mcp_add_form_fields(form: &mut BottomFormView) {
    let is_http = matches!(
        selected_transport_kind(form),
        Some(McpAddTransportKind::Http)
    );

    if let Some(field) = form.fields.get_mut(MCP_ADD_FIELD_ENDPOINT) {
        if is_http {
            field.label = "URL".to_string();
            field.help = String::new();
            if let BottomFormFieldEditorView::Text { placeholder, .. } = &mut field.editor {
                *placeholder = "URL，例如 https://example.com/mcp".to_string();
            }
        } else {
            field.label = "命令".to_string();
            field.help = String::new();
            if let BottomFormFieldEditorView::Text { placeholder, .. } = &mut field.editor {
                *placeholder = "命令，例如 npx -y @modelcontextprotocol/server-github".to_string();
            }
        }
    }

    if let Some(field) = form.fields.get_mut(MCP_ADD_FIELD_METADATA) {
        if is_http {
            field.label = "请求头".to_string();
            field.help = String::new();
            if let BottomFormFieldEditorView::Text { placeholder, .. } = &mut field.editor {
                *placeholder =
                    "请求头，可选，例如 Authorization=Bearer ${env:GITHUB_TOKEN}".to_string();
            }
        } else {
            field.label = "环境变量".to_string();
            field.help = String::new();
            if let BottomFormFieldEditorView::Text { placeholder, .. } = &mut field.editor {
                *placeholder =
                    "环境变量，可选，例如 GITHUB_PERSONAL_ACCESS_TOKEN=${env:GITHUB_TOKEN}"
                        .to_string();
            }
        }
    }

    form.selected_field = form.selected_field.min(form.fields.len().saturating_sub(1));
}

fn mcp_add_form_to_config(
    form: &BottomFormView,
) -> std::result::Result<(String, McpServerConfig), String> {
    let server_name = bottom_form_text_value(form, MCP_ADD_FIELD_NAME)
        .trim()
        .to_string();
    if server_name.is_empty() {
        return Err("server 名称不能为空".to_string());
    }
    if server_name.chars().any(char::is_whitespace) {
        return Err("server 名称不能包含空白字符，请使用 - 或 _".to_string());
    }

    let endpoint = bottom_form_text_value(form, MCP_ADD_FIELD_ENDPOINT)
        .trim()
        .to_string();
    if endpoint.is_empty() {
        let label = form
            .fields
            .get(MCP_ADD_FIELD_ENDPOINT)
            .map(|field| field.label.as_str())
            .unwrap_or("命令或 URL");
        return Err(format!("{} 不能为空", label));
    }

    let metadata_text = bottom_form_text_value(form, MCP_ADD_FIELD_METADATA);
    let transport = match selected_transport_kind(form).unwrap_or(McpAddTransportKind::Stdio) {
        McpAddTransportKind::Stdio => {
            let tokens = split_command_line(&endpoint)?;
            let Some((command, args)) = tokens.split_first() else {
                return Err("命令不能为空".to_string());
            };
            McpTransportConfig::Stdio {
                command: command.clone(),
                args: args.to_vec(),
                env: parse_metadata_map(metadata_text, "环境变量")?,
                cwd: None,
                timeout_ms: Some(MCP_DEFAULT_TIMEOUT_MS),
            }
        }
        McpAddTransportKind::Http => McpTransportConfig::Http {
            url: endpoint,
            headers: parse_metadata_map(metadata_text, "请求头")?,
            timeout_ms: Some(MCP_DEFAULT_TIMEOUT_MS),
        },
    };

    Ok((
        server_name.clone(),
        McpServerConfig {
            display_name: Some(server_name),
            enabled: true,
            trusted: false,
            capabilities: McpCapabilityToggles::default(),
            transport,
        },
    ))
}

fn bottom_form_text_value(form: &BottomFormView, index: usize) -> &str {
    match form.fields.get(index).map(|field| &field.editor) {
        Some(BottomFormFieldEditorView::Text { value, .. }) => value.as_str(),
        _ => "",
    }
}

fn selected_transport_kind(form: &BottomFormView) -> Option<McpAddTransportKind> {
    match form
        .fields
        .get(MCP_ADD_FIELD_TRANSPORT)
        .map(|field| &field.editor)
    {
        Some(BottomFormFieldEditorView::Choice { options, selected }) => options
            .get((*selected).min(options.len().saturating_sub(1)))
            .map(|value| {
                if value.eq_ignore_ascii_case("http") {
                    McpAddTransportKind::Http
                } else {
                    McpAddTransportKind::Stdio
                }
            }),
        _ => None,
    }
}

fn parse_metadata_map(
    input: &str,
    field_label: &str,
) -> std::result::Result<BTreeMap<String, String>, String> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Ok(BTreeMap::new());
    }

    let mut result = BTreeMap::new();
    for item in trimmed.split(';') {
        let pair = item.trim();
        if pair.is_empty() {
            continue;
        }
        let Some((key, value)) = pair.split_once('=') else {
            return Err(format!(
                "{} 格式错误，应为 KEY=VALUE; KEY2=VALUE",
                field_label
            ));
        };
        let key = key.trim();
        if key.is_empty() {
            return Err(format!("{} 中存在空键名", field_label));
        }
        result.insert(key.to_string(), value.trim().to_string());
    }
    Ok(result)
}

fn split_command_line(input: &str) -> std::result::Result<Vec<String>, String> {
    let mut tokens = Vec::new();
    let mut current = String::new();
    let mut chars = input.chars().peekable();
    let mut quote: Option<char> = None;

    while let Some(ch) = chars.next() {
        match quote {
            Some(active_quote) if ch == active_quote => {
                quote = None;
            }
            Some(_) => {
                current.push(ch);
            }
            None if ch == '\'' || ch == '"' => {
                quote = Some(ch);
            }
            None if ch.is_whitespace() => {
                if !current.is_empty() {
                    tokens.push(std::mem::take(&mut current));
                }
                while chars.next_if(|c| c.is_whitespace()).is_some() {}
            }
            None => {
                current.push(ch);
            }
        }
    }

    if quote.is_some() {
        return Err("命令中存在未闭合的引号".to_string());
    }
    if !current.is_empty() {
        tokens.push(current);
    }
    if tokens.is_empty() {
        return Err("命令不能为空".to_string());
    }
    Ok(tokens)
}

fn char_cursor_to_byte_index(value: &str, cursor: usize) -> usize {
    if cursor == 0 {
        return 0;
    }
    value
        .char_indices()
        .nth(cursor)
        .map(|(idx, _)| idx)
        .unwrap_or(value.len())
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum McpAddTransportKind {
    Stdio,
    Http,
}

fn split_first_token(input: &str) -> Option<(&str, &str)> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return None;
    }

    for (idx, ch) in trimmed.char_indices() {
        if ch.is_whitespace() {
            let first = &trimmed[..idx];
            let rest = trimmed[idx..].trim();
            return Some((first, rest));
        }
    }

    Some((trimmed, ""))
}

fn non_empty_opt(input: &str) -> Option<&str> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed)
    }
}

fn parse_image_path_and_prompt(input: &str) -> (&str, &str) {
    let tail = input.trim();
    if tail.is_empty() {
        return ("", "");
    }

    if let Some(quote) = tail.chars().next().filter(|c| *c == '"' || *c == '\'') {
        let rest = &tail[quote.len_utf8()..];
        if let Some(end) = rest.find(quote) {
            let path = rest[..end].trim();
            let prompt = rest[end + quote.len_utf8()..].trim();
            return (path, prompt);
        }
    }

    for (idx, ch) in tail.char_indices() {
        if !ch.is_whitespace() {
            continue;
        }
        let candidate = tail[..idx].trim();
        if is_supported_image_path(candidate) {
            return (candidate, tail[idx..].trim());
        }
    }

    (tail, "")
}

fn is_supported_image_path(path: &str) -> bool {
    let ext = Path::new(path)
        .extension()
        .and_then(|s| s.to_str())
        .map(|s| s.to_ascii_lowercase());

    matches!(
        ext.as_deref(),
        Some("png") | Some("jpg") | Some("jpeg") | Some("webp") | Some("gif") | Some("bmp")
    )
}

fn list_local_image_files() -> Result<Vec<String>> {
    let cwd = env::current_dir().context("读取当前目录失败")?;
    let mut files = Vec::new();

    for entry in fs::read_dir(&cwd).context("遍历当前目录失败")? {
        let entry = entry.context("读取目录项失败")?;
        let path = entry.path();
        if !path.is_file() {
            continue;
        }

        let Some(path_str) = path.to_str() else {
            continue;
        };
        if !is_supported_image_path(path_str) {
            continue;
        }
        let display = path
            .strip_prefix(&cwd)
            .ok()
            .and_then(|p| p.to_str())
            .unwrap_or(path_str)
            .to_string();
        files.push(display);
    }

    files.sort_by_key(|s| s.to_ascii_lowercase());
    Ok(files)
}

fn open_path_in_os(path: &Path) -> Result<()> {
    #[cfg(target_os = "windows")]
    {
        Command::new("cmd")
            .arg("/C")
            .arg("start")
            .arg("")
            .arg(path.as_os_str())
            .spawn()
            .with_context(|| format!("调用系统打开日志失败: {}", path.display()))?;
        return Ok(());
    }

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(path)
            .spawn()
            .with_context(|| format!("调用系统打开日志失败: {}", path.display()))?;
        return Ok(());
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        Command::new("xdg-open")
            .arg(path)
            .spawn()
            .with_context(|| format!("调用系统打开日志失败: {}", path.display()))?;
        return Ok(());
    }

    #[allow(unreachable_code)]
    Err(anyhow::anyhow!(
        "当前平台暂不支持自动打开日志文件: {}",
        path.display()
    ))
}
