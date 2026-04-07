use anyhow::{Context, Result};
use std::{
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
    model_registry::{AppConfig, DEFAULT_API_BASE, ModelProfile},
    ports::{AppPaths, ChatRepository, ConfigStore, SecretStore},
    runtime::{AgentRuntime, RuntimeEvent},
    view::{ChatMessage, MessageRole, TuiViewModel},
    logging,
};

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
    show_aux_details: bool,
    pending_assistant_msg_index: Option<usize>,
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
        let llm_transport = Box::new(OpenAiCompatibleTransport::new(
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

        let slash_commands = vec![
            "/help".to_string(),
            "/clear".to_string(),
            "/quit".to_string(),
            "/exit".to_string(),
            "/model".to_string(),
            "/model list".to_string(),
            "/model use <name>".to_string(),
            "/model add <name> <api_base> <api_key>".to_string(),
            "/model remove <name>".to_string(),
            "/compact".to_string(),
            "/chat".to_string(),
            "/chat save".to_string(),
            "/chat save <path>".to_string(),
            "/chat load <file>".to_string(),
            "/image <path> [prompt]".to_string(),
            "/image pick".to_string(),
            "/image clear".to_string(),
            "/tool shell <command>".to_string(),
            "/tool read <path> [start] [end]".to_string(),
            "/tool search <query>".to_string(),
            "/log".to_string(),
            "/log export".to_string(),
            "/log session export".to_string(),
        ];

        Self {
            input: String::new(),
            input_cursor: 0,
            messages: vec![welcome_message(&config.active_model)],
            show_aux_details: true,
            pending_assistant_msg_index: None,
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
    }

    pub fn handle_stream_stall_timeout(&mut self) {
        self.runtime.handle_stream_stall_timeout();
        self.apply_runtime_events();
    }

    pub fn tick(&mut self) {
        self.runtime.tick_thinking_spinner();
    }

    pub fn view_model(&self) -> TuiViewModel {
        TuiViewModel {
            input: self.input.clone(),
            input_cursor: self.input_cursor,
            messages: self.messages.clone(),
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
            history_offset_from_bottom: self.history_offset_from_bottom,
            pending_response_active: self.runtime.is_busy(),
            thinking_status: self.runtime.thinking_status_text(),
            thinking_content: self
                .runtime
                .thinking_content_text()
                .map(ToString::to_string),
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
        let message = self.input.trim().to_string();
        if message.is_empty() {
            return;
        }

        self.clear_conversation_selection();

        if self.runtime.has_pending_tool_approval() {
            self.scroll_history_to_bottom();
            self.messages.push(ChatMessage {
                role: MessageRole::User,
                content: message.clone(),
                tool_block: None,
            });
            self.runtime.respond_to_pending_tool_approval(&message);
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

        let mut user_content = message.clone();
        if !message.starts_with('/') && !self.runtime.session().pending_image_paths().is_empty() {
            user_content.push_str(&format!(
                "\n[attached images: {}]",
                self.runtime.session().pending_image_paths().join(", ")
            ));
        }

        self.messages.push(ChatMessage {
            role: MessageRole::User,
            content: user_content,
            tool_block: None,
        });

        if message.starts_with('/') {
            self.handle_slash_command(&message);
        } else {
            self.runtime.submit_user_turn(message.clone(), None);
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
            self.set_input(selected.to_string());
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
                    content: format!(
                        "可用指令:\n- /help\n- /clear\n- /quit\n- /model [list|use <name>|add <name> <api_base> <api_key>|remove <name>]\n- /compact\n- /chat\n- /chat save [path]\n- /chat load <file>\n- /image <path> [prompt]\n- /image pick\n- /image clear\n- /tool shell <command>\n- /tool read <path> [start] [end]\n- /tool search <query>\n- /log（或 /log export、/log session export）\n\n说明:\n- shell 命令执行统一需要审批（y/n/t）。\n- 读取工作目录外文件需要审批（y/n/t）。\n- /tool search 仅搜索工作目录内文件。\n- /chat 打开会话列表选择器。\n- /image pick 打开当前目录图片选择器。\n- /image 不带 prompt 时会把图片加入待发送队列。\n- /log 默认打开当前 CLI 日志；/log export 导出当前 CLI 日志快照；/log session export 导出 LLM 会话全文与请求轨迹。\n- 鼠标默认开启：滚轮浏览历史；在 Conversation 内拖拽选区，Ctrl+Shift+C 或右键复制后会清除反色选区。\n- Ctrl+O 切换思考内容与工具结果细节的显示/隐藏（失败与待确认工具保持展开）。\n\nAPI Key 来源优先级: SPIRIT_API_KEY > 模型专属 keyring > 全局 keyring。"
                    ),
                tool_block: None});
            }
            "/clear" => {
                self.messages.clear();
                self.messages
                    .push(welcome_message(&self.runtime.config().active_model));
                self.pending_assistant_msg_index = None;
            }
            "/model" => self.handle_model_slash(&parts[1..]),
            "/compact" => {
                self.runtime.compact_history();
                self.apply_runtime_events();
            }
            "/chat" => self.handle_chat_slash(message),
            "/image" => self.handle_image_slash(message),
            "/tool" => self.handle_tool_slash(message),
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
            ["use", model] => {
                let mut config = self.runtime.config().clone();
                if !config.has_model(model) {
                    self.messages.push(ChatMessage {
                        role: MessageRole::Agent,
                        content: format!(
                            "模型不存在: {}，先用 /model add {} <api_base> <api_key>",
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
            ["remove", model] => {
                let mut config = self.runtime.config().clone();
                if *model == config.active_model {
                    self.messages.push(ChatMessage {
                        role: MessageRole::Agent,
                        content: "不能删除当前使用中的模型，请先 /model use 切换。".to_string(),
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
                    content:
                        "用法: /model [list|use <name>|add <name> <api_base> <api_key>|remove <name>]"
                            .to_string(),
                tool_block: None});
            }
        }
    }

    fn handle_chat_slash(&mut self, message: &str) {
        let tail = message.strip_prefix("/chat").map(str::trim).unwrap_or("");
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
                content: "用法: /chat load <file>".to_string(),
                tool_block: None,
            });
            return;
        }
        self.messages.push(ChatMessage {
            role: MessageRole::Agent,
            content: "用法: /chat [save [path]|load <file>]".to_string(),
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

    fn handle_tool_slash(&mut self, message: &str) {
        if self.runtime.has_pending_tool_approval() {
            self.messages.push(ChatMessage {
                role: MessageRole::Agent,
                content: "当前有待确认的高风险工具调用。请先输入 y / n / t。".to_string(),
                tool_block: None,
            });
            return;
        }
        self.runtime.execute_manual_tool_command(message);
        self.apply_runtime_events();
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
        fs::copy(&source, &target)
            .with_context(|| format!("导出 CLI 日志失败: {} -> {}", source.display(), target.display()))?;
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
        self.set_input(String::new());
        self.refresh_suggestions();
    }

    fn open_chat_picker(&mut self) {
        match self.chat_repository.list() {
            Ok(files) => {
                if files.is_empty() {
                    self.messages.push(ChatMessage {
                        role: MessageRole::Agent,
                        content: "没有已保存对话。可先使用 /chat save 保存当前会话。".to_string(),
                        tool_block: None,
                    });
                    return;
                }
                self.chat_picker_files = files;
                self.chat_picker_index = 0;
                self.chat_picker_active = true;
                self.model_picker_active = false;
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
        let archive = self.runtime.session().to_archive(&messages);
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
                    self.pending_assistant_msg_index = Some(self.messages.len() - 1);
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
                        if idx < self.messages.len() {
                            self.messages.remove(idx);
                        }
                    }
                }
            }
        }
    }

    fn current_slash_query(&self) -> Option<&str> {
        if !self.input.starts_with('/') {
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

fn welcome_message(active_model: &str) -> ChatMessage {
    ChatMessage {
        role: MessageRole::Agent,
        content: format!(
            "欢迎来到 SpiritAgent。\n当前模型: {}\n输入内容按 Enter 发送；输入 /help 查看指令。",
            active_model
        ),
        tool_block: None,
    }
}

fn contextual_slash_suggestions(query: String) -> Vec<&'static str> {
    let q = query.trim_end();

    if q == "/model" || q.starts_with("/model ") {
        return vec![
            "/model list",
            "/model use <name>",
            "/model add <name> <api_base> <api_key>",
            "/model remove <name>",
        ]
        .into_iter()
        .filter(|cmd| cmd.starts_with(q))
        .collect();
    }

    if q == "/chat" || q.starts_with("/chat ") {
        return vec![
            "/chat",
            "/chat save",
            "/chat save <path>",
            "/chat load <file>",
        ]
        .into_iter()
        .filter(|cmd| cmd.starts_with(q))
        .collect();
    }

    if q == "/image" || q.starts_with("/image ") {
        return vec!["/image <path> [prompt]", "/image pick", "/image clear"]
            .into_iter()
            .filter(|cmd| cmd.starts_with(q))
            .collect();
    }

    if q == "/tool" || q.starts_with("/tool ") {
        return vec![
            "/tool shell <command>",
            "/tool read <path> [start] [end]",
            "/tool search <query>",
        ]
        .into_iter()
        .filter(|cmd| cmd.starts_with(q))
        .collect();
    }

    if q == "/log" || q.starts_with("/log ") {
        return vec!["/log", "/log export", "/log session export"]
            .into_iter()
            .filter(|cmd| cmd.starts_with(q))
            .collect();
    }

    Vec::new()
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
