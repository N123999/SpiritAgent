use anyhow::{Context, Result, anyhow};
use rust_i18n::t;
use std::{
    collections::{BTreeMap, HashMap},
    env, fs,
    fs::OpenOptions,
    path::Path,
    process::Command,
    sync::{
        Arc,
        mpsc::{self, Receiver, TryRecvError},
    },
    thread,
    time::{SystemTime, UNIX_EPOCH},
};

use crate::{
    ask_questions::AskQuestionsResult,
    adapters::{DefaultAppPaths, JsonChatRepository, JsonConfigStore, KeyringSecretStore},
    conversation_select::{CellPointer, NormRange, normalize_selection, selection_plain_text},
    host_runtime::{RuntimeEvent, build_tool_result_block, format_tool_ui_message},
    locale,
    logging,
    mcp_types::{ManagedMcpServer, McpDiscoveredPrompt},
    model_registry::{AppConfig, DEFAULT_API_BASE, ModelProfile},
    plan::{self, PlanMetadata},
    ports::{
        AppPaths, AssistantAuxArchiveEntry, ChatRepository, ConfigStore,
        McpStatusSnapshot, McpStatusState, SecretStore, SubagentSessionArchiveEntry,
        SubagentSessionSummary,
    },
    rules::{self, RuleEntry, RuleScope},
    runtime_handle::RuntimeHandle,
    shell::{ask_questions, bottom_form, file_reference, manual_shell, slash},
    skills::{self, SkillEntry, SkillScope},
    tool_runtime::{ToolRequest, ToolRuntime},
    view::{
        AssistantAuxData, BottomFormKind, BottomFormView, ChatMessage, InputSuggestion,
        InputSuggestionKind, MainInputMode, MessageRole, PendingAssistantAux,
        PendingSubagentApprovalView,
        SubagentApprovalInputView, SubagentSessionDetailView, SubagentSessionSummaryView,
        TuiViewModel,
    },
};

const VIEW_MODEL_MESSAGE_LIMIT: usize = 180;

struct PendingShellExecution {
    tool_call_id: String,
    command: String,
    result_rx: Receiver<anyhow::Result<String>>,
}

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
    input_mode: MainInputMode,
    shell_mode_active: bool,
    file_reference_index: Vec<String>,
    pending_file_reference_index_rx: Option<Receiver<Vec<String>>>,
    file_reference_indexing: bool,
    messages: Vec<ChatMessage>,
    assistant_aux_by_message: HashMap<usize, AssistantAuxData>,
    persisted_standalone_pending_aux: Option<PendingAssistantAux>,
    persisted_standalone_pending_aux_anchor: Option<usize>,
    show_aux_details: bool,
    pending_assistant_msg_index: Option<usize>,
    last_completed_assistant_msg_index: Option<usize>,
    next_local_shell_tool_id: usize,
    pending_shell_executions: Vec<PendingShellExecution>,
    last_mcp_status_revision: u64,
    slash: slash::SlashState,
    model_picker_active: bool,
    model_picker_index: usize,
    /// Mock list-models step after add-model form (UI test).
    model_add_pick_active: bool,
    model_add_pick_index: usize,
    model_add_pick_models: Vec<String>,
    model_add_pick_api_base: String,
    model_add_pick_api_key: String,
    language_picker_active: bool,
    language_picker_index: usize,
    chat_picker_active: bool,
    chat_picker_index: usize,
    chat_picker_files: Vec<String>,
    subagent_picker_active: bool,
    subagent_picker_index: usize,
    subagent_view: Option<SubagentSessionDetailView>,
    subagent_history_offset_from_bottom: usize,
    subagent_approval_input: String,
    subagent_approval_input_cursor: usize,
    subagent_approval_input_active: bool,
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
    runtime: RuntimeHandle,
    config_store: Box<dyn ConfigStore>,
    chat_repository: Box<dyn ChatRepository>,
    secret_store: Arc<dyn SecretStore>,
    app_paths: Arc<dyn AppPaths>,
    plan_metadata: PlanMetadata,
    rule_entries: Vec<RuleEntry>,
    skill_entries: Vec<SkillEntry>,
}

impl TuiShell {
    pub fn new() -> Result<Self> {
        let app_paths: Arc<dyn AppPaths> = Arc::new(DefaultAppPaths::new());
        let secret_store: Arc<dyn SecretStore> = Arc::new(KeyringSecretStore);
        let config_store: Box<dyn ConfigStore> = Box::new(JsonConfigStore);
        let chat_repository: Box<dyn ChatRepository> = Box::new(JsonChatRepository);
        let config = config_store.load().unwrap_or_else(|err| {
            logging::log_event(&format!(
                "[config] 读取失败，已回退到内置默认模型（{}）。原因: {err:#}",
                AppConfig::default().active_model
            ));
            AppConfig::default()
        });
        locale::apply_ui_locale(&config);
        let workspace_root = app_paths.workspace_root();
        let mut runtime = RuntimeHandle::new(
            config.clone(),
            Arc::clone(&secret_store),
            workspace_root.clone(),
            Vec::new(),
            Vec::new(),
            plan::current_plan_metadata(),
        )
        .context("初始化 TypeScript runtime bridge 失败")?;
        let cli_metadata = runtime
            .load_cli_host_metadata(false)
            .context("读取共享宿主 metadata 失败")?;
        let rule_entries = cli_metadata.rule_entries;
        let skill_entries = cli_metadata.skill_entries;
        let plan_metadata = cli_metadata.plan_metadata;
        let initial_mcp_status = runtime.mcp_status_snapshot();
        let (file_index_tx, file_index_rx) = mpsc::channel::<Vec<String>>();
        thread::spawn(move || {
            let files = file_reference::collect_workspace_files(&workspace_root);
            let _ = file_index_tx.send(files);
        });

        let messages = vec![welcome_message(
            &config.active_model,
            &initial_mcp_status.welcome_line(),
        )];

        let mut shell = Self {
            input: String::new(),
            input_cursor: 0,
            input_mode: MainInputMode::Agent,
            shell_mode_active: false,
            file_reference_index: Vec::new(),
            pending_file_reference_index_rx: Some(file_index_rx),
            file_reference_indexing: true,
            messages,
            assistant_aux_by_message: HashMap::new(),
            persisted_standalone_pending_aux: None,
            persisted_standalone_pending_aux_anchor: None,
            show_aux_details: true,
            pending_assistant_msg_index: None,
            last_completed_assistant_msg_index: None,
            next_local_shell_tool_id: 0,
            pending_shell_executions: Vec::new(),
            last_mcp_status_revision: initial_mcp_status.revision,
            slash: slash::SlashState::new(),
            model_picker_active: false,
            model_picker_index: 0,
            model_add_pick_active: false,
            model_add_pick_index: 0,
            model_add_pick_models: vec![],
            model_add_pick_api_base: String::new(),
            model_add_pick_api_key: String::new(),
            language_picker_active: false,
            language_picker_index: 0,
            chat_picker_active: false,
            chat_picker_index: 0,
            chat_picker_files: vec![],
            subagent_picker_active: false,
            subagent_picker_index: 0,
            subagent_view: None,
            subagent_history_offset_from_bottom: 0,
            subagent_approval_input: String::new(),
            subagent_approval_input_cursor: 0,
            subagent_approval_input_active: false,
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
            plan_metadata,
            rule_entries,
            skill_entries,
        };

        shell.refresh_prompt_slash_commands(&initial_mcp_status);
        Ok(shell)
    }

    pub fn rule_entries(&self) -> &[RuleEntry] {
        &self.rule_entries
    }

    pub fn skill_entries(&self) -> &[SkillEntry] {
        &self.skill_entries
    }

    pub(crate) fn enabled_skill_entries(&self) -> impl Iterator<Item = &SkillEntry> {
        self.skill_entries.iter().filter(|entry| entry.enabled)
    }

    pub(crate) fn find_enabled_skill_entry(&self, name: &str) -> Option<&SkillEntry> {
        self.enabled_skill_entries()
            .find(|entry| entry.source.name == name)
    }

    pub fn refresh_rules_from_disk(&mut self) -> Result<()> {
        let metadata = self
            .runtime
            .load_cli_host_metadata(self.is_plan_mode_active())
            .context("读取共享规则 metadata 失败")?;
        self.rule_entries = metadata.rule_entries;
        self.skill_entries = metadata.skill_entries;
        self.plan_metadata = metadata.plan_metadata;
        self.runtime
            .replace_rules(rules::enabled_rules(&self.rule_entries));
        Ok(())
    }

    pub fn refresh_skills_from_disk(&mut self) -> Result<()> {
        let metadata = self
            .runtime
            .load_cli_host_metadata(self.is_plan_mode_active())
            .context("读取共享技能 metadata 失败")?;
        self.rule_entries = metadata.rule_entries;
        self.skill_entries = metadata.skill_entries;
        self.plan_metadata = metadata.plan_metadata;
        self.runtime
            .replace_skills_catalog(skills::enabled_skill_catalog(&self.skill_entries));
        if self.current_slash_query().is_some() {
            self.refresh_suggestions();
        }
        Ok(())
    }

    pub fn refresh_suggestions(&mut self) {
        if self.shell_mode_active {
            self.slash.suggestions.clear();
            self.slash.selected_suggestion = 0;
            return;
        }

        if let Some(query) = self.current_file_reference_query() {
            if self.file_reference_indexing {
                self.slash.suggestions.clear();
                self.slash.selected_suggestion = 0;
                return;
            }

            self.slash.suggestions = file_reference::compute_suggestions(
                &query.raw,
                &self.file_reference_index,
            )
            .into_iter()
            .map(InputSuggestion::simple)
            .collect();

            if self.slash.selected_suggestion >= self.slash.suggestions.len() {
                self.slash.selected_suggestion = 0;
            }
            return;
        }

        let Some(query) = self.current_slash_query().map(ToString::to_string) else {
            self.slash.suggestions.clear();
            self.slash.selected_suggestion = 0;
            return;
        };

        let commands = self.slash.commands.clone();
        self.slash.suggestions = slash::compute_suggestions(self, &query, &commands);

        if self.slash.selected_suggestion >= self.slash.suggestions.len() {
            self.slash.selected_suggestion = 0;
        }
    }

    pub fn poll_runtime(&mut self) {
        self.runtime.poll();
        self.apply_runtime_events();
        self.poll_pending_shell_executions();
        self.poll_file_reference_index();
        self.sync_welcome_mcp_status();
        self.refresh_active_subagent_view();
        self.refresh_plan_metadata_from_disk();
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
        let history_truncated_before = self.messages.len().saturating_sub(VIEW_MODEL_MESSAGE_LIMIT);
        let visible_messages = self.messages[history_truncated_before..].to_vec();
        let assistant_aux_by_message = self
            .assistant_aux_by_message
            .iter()
            .filter(|(index, _)| **index >= history_truncated_before)
            .map(|(index, value)| (*index, value.clone()))
            .collect();
        let subagent_sessions = self
            .runtime
            .subagent_sessions()
            .iter()
            .map(Self::subagent_summary_view)
            .collect();

        TuiViewModel {
            input: self.input.clone(),
            input_cursor: self.input_cursor,
            input_mode: self.input_mode,
            shell_mode_active: self.shell_mode_active,
            pending_image_paths: self.runtime.session().pending_image_paths().to_vec(),
            pending_mcp_resources: self.runtime.session().pending_mcp_resources().to_vec(),
            history_truncated_before,
            messages: visible_messages,
            assistant_aux_by_message,
            config: self.runtime.config().clone(),
            show_aux_details: self.show_aux_details,
            input_suggestion_kind: self.current_input_suggestion_kind(),
            input_suggestion_loading: self.file_reference_indexing
                && self.current_file_reference_query().is_some(),
            slash_suggestions: self.slash.suggestions.clone(),
            selected_suggestion: self.slash.selected_suggestion,
            model_picker_active: self.model_picker_active,
            model_picker_index: self.model_picker_index,
            model_add_pick_active: self.model_add_pick_active,
            model_add_pick_index: self.model_add_pick_index,
            model_add_pick_models: self.model_add_pick_models.clone(),
            model_add_pick_api_base: self.model_add_pick_api_base.clone(),
            language_picker_active: self.language_picker_active,
            language_picker_index: self.language_picker_index,
            chat_picker_active: self.chat_picker_active,
            chat_picker_index: self.chat_picker_index,
            chat_picker_files: self.chat_picker_files.clone(),
            subagent_picker_active: self.subagent_picker_active,
            subagent_picker_index: self.subagent_picker_index,
            subagent_sessions,
            subagent_view: self.subagent_view.clone(),
            subagent_history_offset_from_bottom: self.subagent_history_offset_from_bottom,
            pending_subagent_approval: self.runtime.pending_subagent_approval(),
            subagent_approval_input: self.subagent_approval_input_view(),
            image_picker_active: self.image_picker_active,
            image_picker_index: self.image_picker_index,
            image_picker_files: self.image_picker_files.clone(),
            bottom_form: self.bottom_form.clone(),
            history_offset_from_bottom: self.history_offset_from_bottom,
            pending_response_active: self.runtime.is_busy(),
            pending_assistant_msg_index: self.pending_assistant_msg_index,
            pending_aux: self.runtime.pending_aux_state(),
            persisted_standalone_pending_aux: self.persisted_standalone_pending_aux.clone(),
            persisted_standalone_pending_aux_anchor: self.persisted_standalone_pending_aux_anchor,
            conversation_sel_anchor: self.conversation_sel_anchor,
            conversation_sel_head: self.conversation_sel_head,
        }
    }
    fn subagent_summary_view(summary: &SubagentSessionSummary) -> SubagentSessionSummaryView {
        SubagentSessionSummaryView {
            session_id: summary.session_id.clone(),
            title: summary.title.clone(),
            status: summary.status,
            updated_at_unix_ms: summary.updated_at_unix_ms,
            latest_message: summary.latest_message.clone(),
        }
    }

    fn subagent_detail_view(
        archive: &SubagentSessionArchiveEntry,
        live_messages: &[ChatMessage],
        pending_aux: Option<crate::view::PendingAssistantAux>,
    ) -> SubagentSessionDetailView {
        let mut messages = Vec::new();
        let title = archive.summary.title.trim();
        if !title.is_empty() {
            messages.push(ChatMessage::new(MessageRole::User, title.to_string()));
        }

        messages.extend(live_messages.iter().cloned());

        let fallback_assistant = archive
            .llm_history
            .iter()
            .rev()
            .find(|message| message.role == "assistant" && !message.content.trim().is_empty())
            .map(|message| message.content.clone());

        if let Some(output) = archive.summary.final_output.as_ref().filter(|value| !value.trim().is_empty()) {
            let already_present = messages.iter().any(|message| {
                message.role == MessageRole::Agent
                    && message.tool_block.is_none()
                    && message.content.trim() == output.trim()
            });
            if !already_present {
                messages.push(ChatMessage::new(MessageRole::Agent, output.clone()));
            }
        } else if let Some(content) = fallback_assistant {
            let already_present = messages.iter().any(|message| {
                message.role == MessageRole::Agent
                    && message.tool_block.is_none()
                    && message.content.trim() == content.trim()
            });
            if !already_present {
                messages.push(ChatMessage::new(MessageRole::Agent, content));
            }
        }

        SubagentSessionDetailView {
            summary: Self::subagent_summary_view(&archive.summary),
            messages,
            pending_aux,
            final_output: archive.summary.final_output.clone(),
            error: archive.summary.error.clone(),
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

    pub(crate) fn push_agent_message(&mut self, content: impl Into<String>) {
        self.messages.push(ChatMessage {
            role: MessageRole::Agent,
            content: content.into(),
            tool_block: None,
        });
    }

    pub(crate) fn clear_chat_for_slash(&mut self) {
        self.messages.clear();
        self.assistant_aux_by_message.clear();
        self.persisted_standalone_pending_aux = None;
        self.persisted_standalone_pending_aux_anchor = None;
        self.last_completed_assistant_msg_index = None;
        self.subagent_picker_active = false;
        self.close_subagent_view();
        let mcp_status = self.runtime.mcp_status_snapshot();
        self.messages.push(welcome_message(
            &self.runtime.config().active_model,
            &mcp_status.welcome_line(),
        ));
        self.last_mcp_status_revision = mcp_status.revision;
        self.pending_assistant_msg_index = None;
        self.last_completed_assistant_msg_index = None;
    }

    pub(crate) fn compact_history_for_slash(&mut self) {
        self.runtime.compact_history();
        self.apply_runtime_events();
    }

    pub(crate) fn prompt_slash_commands(&self) -> &[slash::PromptSlashCommand] {
        &self.slash.prompt_commands
    }

    pub fn toggle_aux_details(&mut self) {
        self.show_aux_details = !self.show_aux_details;
    }

    pub fn is_model_picker_active(&self) -> bool {
        self.model_picker_active
    }

    pub fn is_model_add_pick_active(&self) -> bool {
        self.model_add_pick_active
    }

    /// Any full-screen model list overlay (switch model or mock add-model list).
    pub fn is_model_list_overlay_active(&self) -> bool {
        self.model_picker_active || self.model_add_pick_active
    }

    pub fn is_language_picker_active(&self) -> bool {
        self.language_picker_active
    }

    pub fn is_chat_picker_active(&self) -> bool {
        self.chat_picker_active
    }

    pub fn is_subagent_picker_active(&self) -> bool {
        self.subagent_picker_active
    }

    pub fn is_subagent_view_active(&self) -> bool {
        self.subagent_view.is_some()
    }

    pub fn has_active_subagent_viewer_approval(&self) -> bool {
        self.active_view_pending_subagent_approval().is_some()
    }

    pub fn is_subagent_approval_input_active(&self) -> bool {
        self.subagent_approval_input_active && self.has_active_subagent_viewer_approval()
    }

    pub fn begin_subagent_approval_input(&mut self) {
        if self.active_view_pending_subagent_approval().is_none() {
            return;
        }

        self.subagent_approval_input_active = true;
        self.subagent_approval_input_cursor = self.subagent_approval_input_len_chars();
    }

    pub fn cancel_subagent_approval_input(&mut self) {
        self.clear_subagent_approval_input_state();
    }

    pub fn respond_to_active_subagent_approval(&mut self, message: &str) {
        if self.active_view_pending_subagent_approval().is_none() {
            return;
        }

        self.runtime.respond_to_pending_tool_approval(message);
        self.apply_runtime_events();
        self.clear_subagent_approval_input_state();
        self.refresh_active_subagent_view();
    }

    pub fn submit_subagent_approval_input(&mut self) {
        if !self.is_subagent_approval_input_active() {
            return;
        }

        let message = self.subagent_approval_input.trim().to_string();
        if message.is_empty() {
            return;
        }

        self.respond_to_active_subagent_approval(&message);
    }

    pub fn move_subagent_approval_cursor_left(&mut self) {
        if self.is_subagent_approval_input_active() && self.subagent_approval_input_cursor > 0 {
            self.subagent_approval_input_cursor -= 1;
        }
    }

    pub fn move_subagent_approval_cursor_right(&mut self) {
        if self.is_subagent_approval_input_active()
            && self.subagent_approval_input_cursor < self.subagent_approval_input_len_chars()
        {
            self.subagent_approval_input_cursor += 1;
        }
    }

    pub fn move_subagent_approval_cursor_home(&mut self) {
        if self.is_subagent_approval_input_active() {
            self.subagent_approval_input_cursor = 0;
        }
    }

    pub fn move_subagent_approval_cursor_end(&mut self) {
        if self.is_subagent_approval_input_active() {
            self.subagent_approval_input_cursor = self.subagent_approval_input_len_chars();
        }
    }

    pub fn insert_subagent_approval_char(&mut self, ch: char) {
        if !self.is_subagent_approval_input_active() {
            return;
        }

        let idx = self.subagent_approval_cursor_byte_index();
        self.subagent_approval_input.insert(idx, ch);
        self.subagent_approval_input_cursor += 1;
    }

    pub fn backspace_subagent_approval_input(&mut self) {
        if !self.is_subagent_approval_input_active() || self.subagent_approval_input_cursor == 0 {
            return;
        }

        self.subagent_approval_input_cursor -= 1;
        let idx = self.subagent_approval_cursor_byte_index();
        self.subagent_approval_input.remove(idx);
    }

    pub fn delete_subagent_approval_input(&mut self) {
        if !self.is_subagent_approval_input_active()
            || self.subagent_approval_input_cursor >= self.subagent_approval_input_len_chars()
        {
            return;
        }

        let idx = self.subagent_approval_cursor_byte_index();
        self.subagent_approval_input.remove(idx);
    }

    pub fn paste_subagent_approval_from_clipboard(&mut self) -> Result<(), String> {
        if self.active_view_pending_subagent_approval().is_none() {
            return Ok(());
        }

        let text = arboard::Clipboard::new()
            .map_err(|e| e.to_string())?
            .get_text()
            .map_err(|e| e.to_string())?;
        let normalized = text.replace("\r\n", "\n").replace('\r', "\n");
        self.begin_subagent_approval_input();
        self.insert_text_into_subagent_approval(&normalized);
        Ok(())
    }

    pub fn is_image_picker_active(&self) -> bool {
        self.image_picker_active
    }

    pub fn is_bottom_form_active(&self) -> bool {
        self.bottom_form.is_some()
    }

    pub fn bottom_form_preserves_newline(&self) -> bool {
        self.bottom_form
            .as_ref()
            .is_some_and(|form| matches!(form.kind, BottomFormKind::McpPrompt { .. }))
    }

    pub fn sync_active_bottom_form_scroll(&mut self, scroll_offset: usize) {
        if let Some(form) = self.bottom_form.as_mut() {
            form.scroll_offset = scroll_offset;
        }
    }

    pub fn scroll_active_bottom_form_up(&mut self, lines: usize) -> bool {
        let Some(form) = self.bottom_form.as_mut() else {
            return false;
        };
        if matches!(form.kind, BottomFormKind::AskQuestions { .. }) {
            ask_questions::select_prev_row(form);
            return true;
        }
        if matches!(form.kind, BottomFormKind::Rules) {
            form.scroll_offset = form.scroll_offset.saturating_sub(lines);
            return true;
        }

        bottom_form::select_prev_field(form);
        true
    }

    pub fn scroll_active_bottom_form_down(&mut self, lines: usize) -> bool {
        let Some(form) = self.bottom_form.as_mut() else {
            return false;
        };
        if matches!(form.kind, BottomFormKind::AskQuestions { .. }) {
            ask_questions::select_next_row(form);
            return true;
        }
        if matches!(form.kind, BottomFormKind::Rules) {
            form.scroll_offset = form.scroll_offset.saturating_add(lines);
            return true;
        }

        bottom_form::select_next_field(form);
        true
    }

    pub fn is_slash_mode_active(&self) -> bool {
        self.current_slash_query().is_some()
    }

    pub fn is_file_reference_mode_active(&self) -> bool {
        self.current_file_reference_query().is_some()
    }

    pub fn is_input_suggestion_active(&self) -> bool {
        self.current_input_suggestion_kind().is_some()
    }

    pub fn is_shell_mode_active(&self) -> bool {
        self.shell_mode_active
    }

    pub fn input_mode(&self) -> MainInputMode {
        self.input_mode
    }

    pub fn is_plan_mode_active(&self) -> bool {
        matches!(self.input_mode, MainInputMode::Plan)
    }

    pub fn set_input_mode(&mut self, mode: MainInputMode) {
        if self.input_mode == mode {
            return;
        }

        self.input_mode = mode;
        self.refresh_suggestions();
        self.push_plan_metadata_snapshot();
    }

    pub fn toggle_input_mode(&mut self) {
        let next = match self.input_mode {
            MainInputMode::Agent => MainInputMode::Plan,
            MainInputMode::Plan => MainInputMode::Agent,
        };
        self.set_input_mode(next);
    }

    pub fn can_enter_shell_mode(&self) -> bool {
        manual_shell::should_enter_shell_mode(
            '!',
            &self.input,
            self.input_cursor,
            self.shell_mode_active,
        )
    }

    pub fn enter_shell_mode(&mut self) {
        self.shell_mode_active = true;
        self.refresh_suggestions();
    }

    pub fn should_exit_shell_mode_on_backspace(&self) -> bool {
        manual_shell::should_exit_shell_mode_on_backspace(
            &self.input,
            self.input_cursor,
            self.shell_mode_active,
        )
    }

    pub fn exit_shell_mode(&mut self) {
        self.shell_mode_active = false;
        self.set_input(String::new());
        self.refresh_suggestions();
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
        let cursor_before = self.input_cursor;
        let idx = self.cursor_byte_index();
        self.input.insert(idx, ch);
        self.input_cursor += 1;
        if ch == '\n' {
            self.log_input_edit("insert_char", &ch.to_string(), cursor_before);
        }
    }

    pub fn insert_text_at_cursor(&mut self, text: &str) {
        if text.is_empty() {
            return;
        }

        let cursor_before = self.input_cursor;
        let idx = self.cursor_byte_index();
        self.input.insert_str(idx, text);
        self.input_cursor += text.chars().count();
        if should_log_input_edit(text) {
            self.log_input_edit("insert_text", text, cursor_before);
        }
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

        if self.shell_mode_active {
            self.scroll_history_to_bottom();
            self.start_manual_shell_execution(raw_message);
            self.set_input(String::new());
            self.refresh_suggestions();
            return;
        }

        if is_subagents_command(trimmed_message) {
            self.scroll_history_to_bottom();
            self.messages.push(ChatMessage {
                role: MessageRole::User,
                content: trimmed_message.to_string(),
                tool_block: None,
            });
            self.handle_slash_command(trimmed_message);
            self.set_input(String::new());
            self.refresh_suggestions();
            return;
        }

        if self.runtime.has_pending_tool_approval() {
            self.scroll_history_to_bottom();
            if self.runtime.pending_subagent_approval().is_none() {
                self.messages.push(ChatMessage {
                    role: MessageRole::User,
                    content: trimmed_message.to_string(),
                    tool_block: None,
                });
            }
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
                content: t!("tui.busy.pending_reply").into_owned(),
                tool_block: None,
            });
            return;
        }

        let mut user_content = raw_message.clone();
        if !trimmed_message.starts_with('/')
            && !self.runtime.session().pending_image_paths().is_empty()
        {
            user_content.push_str(
                t!(
                    "tui.user.attached_images",
                    paths = self.runtime.session().pending_image_paths().join(", ")
                )
                .as_ref(),
            );
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
            user_content.push_str(
                t!("tui.user.attached_mcp_resources", summary = summary).as_ref(),
            );
        }
        self.messages.push(ChatMessage {
            role: MessageRole::User,
            content: user_content,
            tool_block: None,
        });

        if trimmed_message.starts_with('/') {
            self.handle_slash_command(trimmed_message);
        } else {
            let workspace_root = self.app_paths.workspace_root();
            let runtime_turn = user_turn_text_for_mode(&workspace_root, self.input_mode, &raw_message);
            self.submit_runtime_user_turn(runtime_turn, None);
        }

        self.set_input(String::new());
        self.refresh_suggestions();
    }

    pub fn select_next_suggestion(&mut self) {
        if self.slash.suggestions.is_empty() {
            return;
        }
        self.slash.selected_suggestion =
            (self.slash.selected_suggestion + 1) % self.slash.suggestions.len();
    }

    pub fn select_prev_suggestion(&mut self) {
        if self.slash.suggestions.is_empty() {
            return;
        }
        if self.slash.selected_suggestion == 0 {
            self.slash.selected_suggestion = self.slash.suggestions.len() - 1;
        } else {
            self.slash.selected_suggestion -= 1;
        }
    }

    pub fn apply_selected_suggestion(&mut self) {
        if let Some(selected) = self
            .slash
            .suggestions
            .get(self.slash.selected_suggestion)
            .cloned()
        {
            match self.current_input_suggestion_kind() {
                Some(InputSuggestionKind::Slash) => self.set_input(selected.replacement),
                Some(InputSuggestionKind::FileReference) => {
                    if !self.replace_current_file_reference(&selected.replacement, false) {
                        return;
                    }
                }
                None => return,
            }
            self.refresh_suggestions();
        }
    }

    pub fn confirm_selected_file_reference(&mut self) {
        if !self.is_file_reference_mode_active() {
            return;
        }
        if self.file_reference_indexing {
            self.push_agent_message(t!("tui.file_reference.indexing").into_owned());
            return;
        }

        let Some(selected) = self
            .slash
            .suggestions
            .get(self.slash.selected_suggestion)
            .cloned()
        else {
            return;
        };

        if self.replace_current_file_reference(&selected.replacement, true) {
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

    pub fn cancel_model_add_pick(&mut self) {
        self.model_add_pick_active = false;
        self.model_add_pick_models.clear();
        self.model_add_pick_api_base.clear();
        self.model_add_pick_api_key.clear();
        self.model_add_pick_index = 0;
    }

    pub fn cancel_language_picker(&mut self) {
        self.language_picker_active = false;
    }

    pub fn select_next_model(&mut self) {
        if self.model_add_pick_active {
            if self.model_add_pick_models.is_empty() {
                return;
            }
            self.model_add_pick_index =
                (self.model_add_pick_index + 1) % self.model_add_pick_models.len();
            return;
        }
        if self.runtime.config().models.is_empty() {
            return;
        }
        self.model_picker_index =
            (self.model_picker_index + 1) % self.runtime.config().models.len();
    }

    pub fn select_next_language(&mut self) {
        let locales = locale::supported_ui_locales();
        if locales.is_empty() {
            return;
        }
        self.language_picker_index = (self.language_picker_index + 1) % locales.len();
    }

    pub fn select_prev_model(&mut self) {
        if self.model_add_pick_active {
            if self.model_add_pick_models.is_empty() {
                return;
            }
            if self.model_add_pick_index == 0 {
                self.model_add_pick_index = self.model_add_pick_models.len() - 1;
            } else {
                self.model_add_pick_index -= 1;
            }
            return;
        }
        if self.runtime.config().models.is_empty() {
            return;
        }
        if self.model_picker_index == 0 {
            self.model_picker_index = self.runtime.config().models.len() - 1;
        } else {
            self.model_picker_index -= 1;
        }
    }

    pub fn select_prev_language(&mut self) {
        let locales = locale::supported_ui_locales();
        if locales.is_empty() {
            return;
        }
        if self.language_picker_index == 0 {
            self.language_picker_index = locales.len() - 1;
        } else {
            self.language_picker_index -= 1;
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
        if let Err(err) = self.runtime.validate_config_change(&config) {
            self.messages.push(ChatMessage {
                role: MessageRole::Agent,
                content: err.to_string(),
                tool_block: None,
            });
            self.model_picker_active = false;
            return;
        }
        if let Err(err) = self.config_store.save(&config) {
            self.messages.push(ChatMessage {
                role: MessageRole::Agent,
                content: t!("tui.model_picker.switch_saved_fail", err = err).into_owned(),
                tool_block: None,
            });
        } else {
            self.runtime.replace_config(config);
            self.apply_runtime_events();
            self.messages.push(ChatMessage {
                role: MessageRole::Agent,
                content: t!("tui.model_picker.switch_success", model = selected).into_owned(),
                tool_block: None,
            });
        }
        self.model_picker_active = false;
    }

    pub fn confirm_model_add_pick(&mut self) {
        let Some(selected_name) = self
            .model_add_pick_models
            .get(self.model_add_pick_index)
            .cloned()
        else {
            self.cancel_model_add_pick();
            return;
        };
        let api_base = self.model_add_pick_api_base.clone();
        let api_key = std::mem::take(&mut self.model_add_pick_api_key);
        self.model_add_pick_active = false;
        self.model_add_pick_models.clear();
        self.model_add_pick_api_base.clear();
        self.model_add_pick_index = 0;

        match self.apply_model_add_and_switch(selected_name.as_str(), api_base.as_str(), api_key.as_str())
        {
            Ok(()) => {
                self.messages.push(ChatMessage {
                    role: MessageRole::Agent,
                    content: t!("tui.model_add.saved", name = selected_name).into_owned(),
                    tool_block: None,
                });
            }
            Err(err) => {
                self.messages.push(ChatMessage {
                    role: MessageRole::Agent,
                    content: err,
                    tool_block: None,
                });
            }
        }
    }

    pub fn confirm_language_picker(&mut self) {
        let locales = locale::supported_ui_locales();
        let Some(selected) = locales.get(self.language_picker_index).copied() else {
            self.language_picker_active = false;
            return;
        };

        self.switch_ui_locale(selected);
        self.language_picker_active = false;
    }

    pub fn cancel_chat_picker(&mut self) {
        self.chat_picker_active = false;
    }

    pub fn open_subagent_picker(&mut self) {
        self.subagent_picker_active = true;
        self.subagent_picker_index = 0;
    }

    pub fn cancel_subagent_picker(&mut self) {
        self.subagent_picker_active = false;
    }

    pub fn select_next_subagent(&mut self) {
        let total = self.runtime.subagent_sessions().len();
        if total == 0 {
            return;
        }
        self.subagent_picker_index = (self.subagent_picker_index + 1) % total;
    }

    pub fn select_prev_subagent(&mut self) {
        let total = self.runtime.subagent_sessions().len();
        if total == 0 {
            return;
        }
        if self.subagent_picker_index == 0 {
            self.subagent_picker_index = total - 1;
        } else {
            self.subagent_picker_index -= 1;
        }
    }

    pub fn confirm_subagent_picker(&mut self) {
        let Some(summary) = self
            .runtime
            .subagent_sessions()
            .get(self.subagent_picker_index)
            .cloned()
        else {
            self.subagent_picker_active = false;
            return;
        };

        self.subagent_picker_active = false;
        self.open_subagent_view(&summary.session_id);
    }

    pub fn close_subagent_view(&mut self) {
        self.subagent_view = None;
        self.subagent_history_offset_from_bottom = 0;
        self.clear_subagent_approval_input_state();
    }

    pub fn scroll_subagent_view_up(&mut self, lines: usize) {
        self.subagent_history_offset_from_bottom =
            self.subagent_history_offset_from_bottom.saturating_add(lines);
    }

    pub fn scroll_subagent_view_down(&mut self, lines: usize) {
        self.subagent_history_offset_from_bottom =
            self.subagent_history_offset_from_bottom.saturating_sub(lines);
    }

    pub(crate) fn clamp_subagent_history_scroll(&mut self, max_scroll: usize) -> usize {
        self.subagent_history_offset_from_bottom =
            self.subagent_history_offset_from_bottom.min(max_scroll);
        self.subagent_history_offset_from_bottom
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
        self.runtime.add_pending_image(selected.clone());
        self.messages.push(ChatMessage {
            role: MessageRole::Agent,
            content: t!(
                "tui.image_picker.added",
                count = self.runtime.session().pending_image_paths().len(),
                path = selected
            )
            .into_owned(),
            tool_block: None,
        });
    }

    pub fn cancel_bottom_form(&mut self) {
        self.bottom_form = None;
    }

    pub fn dismiss_bottom_form(&mut self) {
        let Some(kind) = self.bottom_form.as_ref().map(|form| form.kind.clone()) else {
            return;
        };

        match kind {
            BottomFormKind::AskQuestions { .. } => {
                self.complete_ask_questions_form(ask_questions::dismiss_result());
            }
            BottomFormKind::McpAdd
            | BottomFormKind::ModelAdd
            | BottomFormKind::McpPrompt { .. } => self.cancel_bottom_form(),
            BottomFormKind::Rules => self.save_rules_bottom_form(),
            BottomFormKind::Skills => self.save_skills_bottom_form(),
        }
    }

    pub fn select_next_bottom_form_field(&mut self) {
        let Some(form) = self.bottom_form.as_mut() else {
            return;
        };
        if matches!(form.kind, BottomFormKind::AskQuestions { .. }) {
            ask_questions::select_next_row(form);
            return;
        }
        bottom_form::select_next_field(form);
    }

    pub fn select_prev_bottom_form_field(&mut self) {
        let Some(form) = self.bottom_form.as_mut() else {
            return;
        };
        if matches!(form.kind, BottomFormKind::AskQuestions { .. }) {
            ask_questions::select_prev_row(form);
            return;
        }
        bottom_form::select_prev_field(form);
    }

    pub fn bottom_form_move_left(&mut self) {
        let Some(form) = self.bottom_form.as_mut() else {
            return;
        };
        if matches!(form.kind, BottomFormKind::AskQuestions { .. }) {
            ask_questions::move_left(form);
            return;
        }
        bottom_form::move_left(form);
    }

    pub fn bottom_form_move_right(&mut self) {
        let Some(form) = self.bottom_form.as_mut() else {
            return;
        };
        if matches!(form.kind, BottomFormKind::AskQuestions { .. }) {
            ask_questions::move_right(form);
            return;
        }
        bottom_form::move_right(form);
    }

    pub fn bottom_form_move_home(&mut self) {
        let Some(form) = self.bottom_form.as_mut() else {
            return;
        };
        if matches!(form.kind, BottomFormKind::AskQuestions { .. }) {
            ask_questions::move_home(form);
            return;
        }
        bottom_form::move_home(form);
    }

    pub fn bottom_form_move_end(&mut self) {
        let Some(form) = self.bottom_form.as_mut() else {
            return;
        };
        if matches!(form.kind, BottomFormKind::AskQuestions { .. }) {
            ask_questions::move_end(form);
            return;
        }
        bottom_form::move_end(form);
    }

    pub fn bottom_form_insert_char(&mut self, ch: char) {
        let Some(form) = self.bottom_form.as_mut() else {
            return;
        };
        if matches!(form.kind, BottomFormKind::AskQuestions { .. }) {
            ask_questions::insert_char(form, ch);
            return;
        }
        bottom_form::insert_char(form, ch);
    }

    pub fn bottom_form_insert_text(&mut self, text: &str) {
        let Some(form) = self.bottom_form.as_mut() else {
            return;
        };
        if matches!(form.kind, BottomFormKind::AskQuestions { .. }) {
            ask_questions::insert_text(form, text);
            return;
        }
        bottom_form::insert_text(form, text);
    }

    pub fn bottom_form_backspace(&mut self) {
        let Some(form) = self.bottom_form.as_mut() else {
            return;
        };
        if matches!(form.kind, BottomFormKind::AskQuestions { .. }) {
            ask_questions::backspace(form);
            return;
        }
        bottom_form::backspace(form);
    }

    pub fn bottom_form_delete(&mut self) {
        let Some(form) = self.bottom_form.as_mut() else {
            return;
        };
        if matches!(form.kind, BottomFormKind::AskQuestions { .. }) {
            ask_questions::delete(form);
            return;
        }
        bottom_form::delete(form);
    }

    pub fn paste_bottom_form_from_clipboard(&mut self) -> Result<(), String> {
        let text = arboard::Clipboard::new()
            .map_err(|e| e.to_string())?
            .get_text()
            .map_err(|e| e.to_string())?;
        self.bottom_form_insert_text(&text);
        Ok(())
    }

    pub fn activate_bottom_form(&mut self) {
        let Some(kind) = self.bottom_form.as_ref().map(|form| form.kind.clone()) else {
            return;
        };

        match kind {
            BottomFormKind::AskQuestions { .. } => {
                if let Some(form) = self.bottom_form.as_mut() {
                    match ask_questions::activate(form) {
                        Ok(ask_questions::AskQuestionsActivateOutcome::None) => {}
                        Ok(ask_questions::AskQuestionsActivateOutcome::Submit(result)) => {
                            self.complete_ask_questions_form(result);
                        }
                        Err(err) => {
                            self.messages.push(ChatMessage {
                                role: MessageRole::Agent,
                                content: err,
                                tool_block: None,
                            });
                        }
                    }
                }
            }
            BottomFormKind::McpAdd | BottomFormKind::ModelAdd => self.save_bottom_form(),
            BottomFormKind::McpPrompt { .. } => self.apply_prompt_bottom_form(),
            BottomFormKind::Rules => {
                if let Some(form) = self.bottom_form.as_mut() {
                    bottom_form::activate(form);
                }
            }
            BottomFormKind::Skills => {
                if let Some(form) = self.bottom_form.as_mut() {
                    bottom_form::activate(form);
                }
            }
        }
    }

    pub fn save_bottom_form(&mut self) {
        let Some(form) = self.bottom_form.as_ref() else {
            return;
        };

        if matches!(form.kind, BottomFormKind::ModelAdd) {
            match bottom_form::parse_model_add_connection(form) {
                Ok((provider_idx, api_base, api_key)) => {
                    self.bottom_form = None;
                    self.model_add_pick_models = bottom_form::model_add_mock_model_ids(provider_idx);
                    self.model_add_pick_api_base = api_base;
                    self.model_add_pick_api_key = api_key;
                    self.model_add_pick_index = 0;
                    self.model_add_pick_active = true;
                    self.messages.push(ChatMessage {
                        role: MessageRole::Agent,
                        content: t!("tui.model_add.mock_list_opened").into_owned(),
                        tool_block: None,
                    });
                }
                Err(err) => {
                    self.messages.push(ChatMessage {
                        role: MessageRole::Agent,
                        content: t!("tui.model_add.validation_failed", err = err).into_owned(),
                        tool_block: None,
                    });
                }
            }
            return;
        }

        match bottom_form::to_config(form) {
            Ok((server_name, config)) => match self.runtime.add_mcp_server(&server_name, config) {
                Ok(path) => {
                    self.messages.push(ChatMessage {
                        role: MessageRole::Agent,
                        content: t!(
                            "tui.bottom_form.added",
                            server = server_name,
                            path = path.display()
                        )
                        .into_owned(),
                        tool_block: None,
                    });
                    self.bottom_form = None;
                    self.sync_welcome_mcp_status();
                }
                Err(err) => {
                    self.messages.push(ChatMessage {
                        role: MessageRole::Agent,
                        content: t!("tui.bottom_form.add_failed", err = err).into_owned(),
                        tool_block: None,
                    });
                }
            },
            Err(err) => {
                self.messages.push(ChatMessage {
                    role: MessageRole::Agent,
                    content: t!("tui.bottom_form.add_failed", err = err).into_owned(),
                    tool_block: None,
                });
            }
        }
    }

    fn save_rules_bottom_form(&mut self) {
        let Some(form) = self.bottom_form.as_ref() else {
            return;
        };

        let mut enabled_overrides = BTreeMap::new();
        for (rule_id, enabled) in bottom_form::rules_form_overrides(form) {
            enabled_overrides.insert(rule_id, enabled);
        }

        match self.runtime.write_rule_state(enabled_overrides) {
            Ok(path) => match self.refresh_rules_from_disk() {
                Ok(()) => {
                    self.messages.push(ChatMessage {
                        role: MessageRole::Agent,
                        content: t!("tui.rules.saved", path = path.display()).into_owned(),
                        tool_block: None,
                    });
                    self.bottom_form = None;
                }
                Err(err) => {
                    self.messages.push(ChatMessage {
                        role: MessageRole::Agent,
                        content: t!("tui.rules.refresh_failed", err = err).into_owned(),
                        tool_block: None,
                    });
                }
            },
            Err(err) => {
                self.messages.push(ChatMessage {
                    role: MessageRole::Agent,
                    content: t!("tui.rules.save_failed", err = err).into_owned(),
                    tool_block: None,
                });
            }
        }
    }

    fn save_skills_bottom_form(&mut self) {
        let Some(form) = self.bottom_form.as_ref() else {
            return;
        };

        let mut enabled_overrides = BTreeMap::new();
        for (skill_id, enabled) in bottom_form::skills_form_overrides(form) {
            enabled_overrides.insert(skill_id, enabled);
        }

        match self.runtime.write_skill_state(enabled_overrides) {
            Ok(path) => match self.refresh_skills_from_disk() {
                Ok(()) => {
                    self.messages.push(ChatMessage {
                        role: MessageRole::Agent,
                        content: t!("tui.skills.saved", path = path.display()).into_owned(),
                        tool_block: None,
                    });
                    self.bottom_form = None;
                }
                Err(err) => {
                    self.messages.push(ChatMessage {
                        role: MessageRole::Agent,
                        content: t!("tui.skills.refresh_failed", err = err).into_owned(),
                        tool_block: None,
                    });
                }
            },
            Err(err) => {
                self.messages.push(ChatMessage {
                    role: MessageRole::Agent,
                    content: t!("tui.skills.save_failed", err = err).into_owned(),
                    tool_block: None,
                });
            }
        }
    }

    fn handle_slash_command(&mut self, message: &str) {
        slash::handle_command(self, message);
    }

    /// Adds a model, saves API key, sets it as `active_model`, and persists config.
    fn apply_model_add_and_switch(
        &mut self,
        name: &str,
        api_base: &str,
        api_key: &str,
    ) -> Result<(), String> {
        let mut config = self.runtime.config().clone();
        if config.has_model(name) {
            return Err(t!("tui.model_add.duplicate", name = name).into_owned());
        }

        config.add_model(ModelProfile {
            name: name.to_string(),
            api_base: api_base.to_string(),
        });
        config.active_model = name.to_string();

        if let Err(err) = self.runtime.validate_config_change(&config) {
            return Err(err.to_string());
        }

        if let Err(err) = self.secret_store.save_model_api_key(name, api_key) {
            return Err(t!("tui.model_add.key_save_failed", err = err).into_owned());
        }

        if let Err(err) = self.config_store.save(&config) {
            return Err(t!("tui.model_add.config_save_failed", err = err).into_owned());
        }

        self.runtime.replace_config(config);
        self.apply_runtime_events();
        Ok(())
    }

    pub(crate) fn handle_model_slash(&mut self, args: &[&str]) {
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
                            "模型不存在: {}，先用 `/model add` 打开表单添加，或 `/model add {} <api_base> <api_key>`",
                            model, model
                        ),
                        tool_block: None,
                    });
                    return;
                }
                config.active_model = (*model).to_string();
                if let Err(err) = self.runtime.validate_config_change(&config) {
                    self.messages.push(ChatMessage {
                        role: MessageRole::Agent,
                        content: err.to_string(),
                        tool_block: None,
                    });
                    return;
                }
                if let Err(err) = self.config_store.save(&config) {
                    self.messages.push(ChatMessage {
                        role: MessageRole::Agent,
                        content: format!("切换成功但保存失败: {}", err),
                        tool_block: None,
                    });
                } else {
                    self.runtime.replace_config(config);
                    self.apply_runtime_events();
                    self.messages.push(ChatMessage {
                        role: MessageRole::Agent,
                        content: format!("已切换当前模型为: {}", model),
                        tool_block: None,
                    });
                }
            }
            ["add"] => {
                self.open_model_add_form();
                self.messages.push(ChatMessage {
                    role: MessageRole::Agent,
                    content: t!("tui.model_add.opened").into_owned(),
                    tool_block: None,
                });
            }
            ["add", model, api_base, api_key] => {
                match self.apply_model_add_and_switch(model, api_base, api_key) {
                    Ok(()) => {
                        self.messages.push(ChatMessage {
                            role: MessageRole::Agent,
                            content: t!("tui.model_add.saved", name = model).into_owned(),
                            tool_block: None,
                        });
                    }
                    Err(err) => {
                        self.messages.push(ChatMessage {
                            role: MessageRole::Agent,
                            content: err,
                            tool_block: None,
                        });
                    }
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
                    content: "用法:\n- `/model list`\n- `/model use <name>`\n- `/model add`（底部表单）或 `/model add <name> <api_base> <api_key>`\n- `/model remove <name>`".to_string(),
                    tool_block: None,
                });
            }
        }
    }

    pub(crate) fn handle_sessions_slash(&mut self, message: &str) {
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

    pub(crate) fn handle_subagents_slash(&mut self, message: &str) {
        let tail = message
            .strip_prefix("/subagents")
            .map(str::trim)
            .unwrap_or("");

        if tail.is_empty() || tail == "list" {
            self.open_subagent_picker();
            return;
        }

        if tail == "close" {
            self.close_subagent_view();
            return;
        }

        if let Some(session_id) = tail.strip_prefix("open ") {
            self.open_subagent_view(session_id.trim());
            return;
        }

        self.messages.push(ChatMessage {
            role: MessageRole::Agent,
            content: "用法: /subagents [list|open <session_id>|close]".to_string(),
            tool_block: None,
        });
    }

    pub(crate) fn handle_image_slash(&mut self, message: &str) {
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
            let cleared = self.runtime.clear_pending_images();
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
                    content: t!("tui.busy.pending_reply").into_owned(),
                    tool_block: None,
                });
                return;
            }
            self.scroll_history_to_bottom();
            self.messages.push(ChatMessage {
                role: MessageRole::User,
                content: t!("tui.user.attached_image", prompt = prompt, path = raw_path).into_owned(),
                tool_block: None,
            });
            self.submit_runtime_user_turn(prompt.to_string(), Some(vec![raw_path.to_string()]));
            return;
        }

        self.runtime.add_pending_image(raw_path.to_string());
        self.messages.push(ChatMessage {
            role: MessageRole::Agent,
            content: t!(
                "tui.image_queue.added_auto_attach",
                count = self.runtime.session().pending_image_paths().len()
            )
            .into_owned(),
            tool_block: None,
        });
    }

    pub(crate) fn handle_log_slash(&mut self, args: &[&str]) {
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

    pub(crate) fn handle_language_slash(&mut self, args: &[&str]) {
        match args {
            [] => self.open_language_picker(),
            [locale_code] => {
                let Some(normalized) = locale::parse_ui_locale(locale_code) else {
                    self.messages.push(ChatMessage {
                        role: MessageRole::Agent,
                        content: t!(
                            "tui.language.unsupported",
                            locale = *locale_code,
                            available = locale::supported_ui_locales().join(", ")
                        )
                        .into_owned(),
                        tool_block: None,
                    });
                    return;
                };
                self.switch_ui_locale(&normalized);
            }
            _ => self.push_agent_message("用法: /language [en|zh-CN]"),
        }
    }

    pub(crate) fn handle_rules_slash(&mut self, args: &[&str]) {
        if !args.is_empty() {
            self.push_agent_message(t!("tui.rules.usage").into_owned());
            return;
        }

        if let Err(err) = self.refresh_rules_from_disk() {
            self.messages.push(ChatMessage {
                role: MessageRole::Agent,
                content: t!("tui.rules.read_failed", err = err).into_owned(),
                tool_block: None,
            });
            return;
        }

        self.open_rules_form();
        self.messages.push(ChatMessage {
            role: MessageRole::Agent,
            content: t!("tui.rules.opened").into_owned(),
            tool_block: None,
        });
    }

    pub(crate) fn handle_skills_slash(&mut self, args: &[&str]) {
        if !args.is_empty() {
            self.push_agent_message(t!("tui.skills.usage").into_owned());
            return;
        }

        if let Err(err) = self.refresh_skills_from_disk() {
            self.messages.push(ChatMessage {
                role: MessageRole::Agent,
                content: t!("tui.skills.read_failed", err = err).into_owned(),
                tool_block: None,
            });
            return;
        }

        self.open_skills_form();
        self.messages.push(ChatMessage {
            role: MessageRole::Agent,
            content: t!("tui.skills.opened").into_owned(),
            tool_block: None,
        });
    }

    pub(crate) fn handle_create_rule_slash(&mut self, message: &str) {
        let tail = message
            .strip_prefix("/create-rule")
            .map(str::trim)
            .unwrap_or("");
        let request = match rules::parse_create_rule_request(tail) {
            Ok(request) => request,
            Err(err) => {
                self.push_agent_message(err.to_string());
                return;
            }
        };

        if self.runtime.is_busy() {
            self.messages.push(ChatMessage {
                role: MessageRole::Agent,
                content: t!("tui.busy.pending_reply").into_owned(),
                tool_block: None,
            });
            return;
        }

        let workspace_root = self.app_paths.workspace_root();
        if request.scope == RuleScope::Workspace {
            if let Err(err) = rules::ensure_workspace_spirit_dir(&workspace_root) {
                self.push_agent_message(err.to_string());
                return;
            }
        }
        let generation_prompt = rules::build_create_rule_user_turn(&workspace_root, &request);
        self.submit_runtime_user_turn(generation_prompt, None);
    }

    pub(crate) fn handle_create_skill_slash(&mut self, message: &str) {
        let tail = message
            .strip_prefix("/create-skill")
            .map(str::trim)
            .unwrap_or("");
        let request = match skills::parse_create_skill_request(tail) {
            Ok(request) => request,
            Err(err) => {
                self.push_agent_message(err.to_string());
                return;
            }
        };

        if self.runtime.is_busy() {
            self.messages.push(ChatMessage {
                role: MessageRole::Agent,
                content: t!("tui.busy.pending_reply").into_owned(),
                tool_block: None,
            });
            return;
        }

        let workspace_root = self.app_paths.workspace_root();
        if request.scope == SkillScope::Workspace {
            if let Err(err) = skills::ensure_workspace_spirit_skills_dir(&workspace_root) {
                self.push_agent_message(err.to_string());
                return;
            }
        }

        let generation_prompt = skills::build_create_skill_user_turn(&workspace_root, &request);
    self.submit_runtime_user_turn(generation_prompt, None);
    }

    pub(crate) fn handle_start_implementing_slash(&mut self) {
        if !self.is_plan_mode_active() {
            self.push_agent_message(
                "该命令仅在 Plan 模式下可用；按 Tab 切到 Plan 后重试。".to_string(),
            );
            return;
        }

        if self.runtime.is_busy() {
            self.messages.push(ChatMessage {
                role: MessageRole::Agent,
                content: t!("tui.busy.pending_reply").into_owned(),
                tool_block: None,
            });
            return;
        }

        self.set_input_mode(MainInputMode::Agent);
        let user_turn = plan::build_start_implementing_user_turn();
    self.submit_runtime_user_turn(user_turn, None);
    }

    pub(crate) fn handle_skill_alias_slash(&mut self, message: &str) -> bool {
        let Some((command, user_message)) = split_first_token(message) else {
            return false;
        };
        let Some(skill_name) = slash::resolve_skill_slash_command(self, command) else {
            return false;
        };

        self.activate_skill_slash(&skill_name, user_message);
        true
    }

    fn activate_skill_slash(&mut self, skill_name: &str, user_message: &str) {
        let Some(skill) = self.find_enabled_skill_entry(skill_name) else {
            self.push_agent_message(t!("tui.skills.activate_missing", name = skill_name).into_owned());
            return;
        };

        if self.runtime.is_busy() {
            self.messages.push(ChatMessage {
                role: MessageRole::Agent,
                content: t!("tui.busy.pending_reply").into_owned(),
                tool_block: None,
            });
            return;
        }

        let payload = match skills::build_active_skill_payload(skill) {
            Ok(payload) => payload,
            Err(err) => {
                self.push_agent_message(t!("tui.skills.activate_failed", err = err).into_owned());
                return;
            }
        };
        if let Err(err) = self.runtime.activate_skill(payload) {
            self.push_agent_message(t!("tui.skills.activate_failed", err = err).into_owned());
            return;
        }

        let user_turn = skills::build_activate_skill_user_turn(skill_name, user_message);
        self.submit_runtime_user_turn(user_turn, None);
    }

    pub(crate) fn handle_mcp_slash(&mut self, message: &str) {
        let tail = message.strip_prefix("/mcp").map(str::trim).unwrap_or("");

        if tail.is_empty() || tail == "list" {
            self.push_mcp_overview();
            return;
        }

        if tail == "add" {
            self.open_mcp_add_form();
            self.messages.push(ChatMessage {
                role: MessageRole::Agent,
                content: "已打开 MCP 添加表单。填写完成后按 Enter 保存，Esc 取消。".to_string(),
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

            let Some((prompt_name, prompt_tail)) = split_first_token(rest) else {
                self.push_mcp_usage();
                return;
            };
            match self.resolve_mcp_prompt_definition(&server, prompt_name) {
                Ok(prompt_definition) => match classify_prompt_tail(&prompt_definition, prompt_tail) {
                    PromptTail::ArgsJson(args_json) => {
                        self.apply_mcp_prompt_command(&server, prompt_name, Some(args_json), None);
                    }
                    PromptTail::UserMessage(user_message) if prompt_definition.arguments.is_empty() => {
                        self.apply_mcp_prompt_command(
                            &server,
                            prompt_name,
                            None,
                            Some(user_message),
                        );
                    }
                    PromptTail::Empty if prompt_definition.arguments.is_empty() => {
                        self.apply_mcp_prompt_command(&server, prompt_name, None, None);
                    }
                    PromptTail::Empty => {
                        self.open_mcp_prompt_form(&server, &prompt_definition, None);
                        self.messages.push(ChatMessage {
                            role: MessageRole::Agent,
                            content: t!(
                                "tui.bottom_form.prompt_opened",
                                server = server,
                                prompt = prompt_name
                            )
                            .into_owned(),
                            tool_block: None,
                        });
                    }
                    PromptTail::UserMessage(user_message) => {
                        self.open_mcp_prompt_form(&server, &prompt_definition, Some(user_message));
                        self.messages.push(ChatMessage {
                            role: MessageRole::Agent,
                            content: t!(
                                "tui.bottom_form.prompt_opened",
                                server = server,
                                prompt = prompt_name
                            )
                            .into_owned(),
                            tool_block: None,
                        });
                    }
                },
                Err(err) => self.messages.push(ChatMessage {
                    role: MessageRole::Agent,
                    content: format!("读取 MCP prompt 参数失败: {}", err),
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

    pub(crate) fn handle_prompt_alias_slash(&mut self, message: &str) -> bool {
        let Some((command, rest)) = split_first_token(message) else {
            return false;
        };

        let Some(resolved) = slash::resolve_prompt_slash_command(self, command) else {
            return false;
        };

        let server = resolved.server;
        let prompt = resolved.prompt;

        match classify_prompt_tail(&prompt, rest) {
            PromptTail::ArgsJson(args_json) => {
                self.apply_mcp_prompt_command(&server, &prompt.name, Some(args_json), None);
            }
            PromptTail::UserMessage(user_message) if prompt.arguments.is_empty() => {
                self.apply_mcp_prompt_command(&server, &prompt.name, None, Some(user_message));
            }
            PromptTail::Empty if prompt.arguments.is_empty() => {
                self.apply_mcp_prompt_command(&server, &prompt.name, None, None);
            }
            PromptTail::Empty => {
                self.open_mcp_prompt_form(&server, &prompt, None);
                self.messages.push(ChatMessage {
                    role: MessageRole::Agent,
                    content: t!(
                        "tui.bottom_form.prompt_opened",
                        server = server,
                        prompt = prompt.name
                    )
                    .into_owned(),
                    tool_block: None,
                });
            }
            PromptTail::UserMessage(user_message) => {
                self.open_mcp_prompt_form(&server, &prompt, Some(user_message));
                self.messages.push(ChatMessage {
                    role: MessageRole::Agent,
                    content: t!(
                        "tui.bottom_form.prompt_opened",
                        server = server,
                        prompt = prompt.name
                    )
                    .into_owned(),
                    tool_block: None,
                });
            }
        }
        true
    }

    fn push_mcp_usage(&mut self) {
        self.messages.push(ChatMessage {
            role: MessageRole::Agent,
            content: "用法:\n- /mcp\n- /mcp list\n- /mcp add\n- /mcp inspect [server]\n- /mcp tools [server]\n- /mcp resources [server]\n- /mcp prompts [server]\n- /<server>_<prompt> [args_json | user_message]\n\n说明:\n- `/mcp add` 会打开底部表单，支持填写 STDIO 或 HTTP server；Enter 保存，Esc 取消。\n- MCP prompt 会作为一级 slash 命令暴露，例如 `/github_issue_to_fix_workflow`。若尾部是合法 JSON object，会直接作为 prompt 参数；其他文本会作为附加用户消息发给 LLM。\n- 省略尾部且 prompt 定义了参数时，会自动打开参数表单；表单最后一栏可填写附加说明。\n- `/mcp tool call`、`/mcp resource attach`、`/mcp resource clear` 仍保留为调试入口，但不作为主交互路径。".to_string(),
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

    fn server_exists(&mut self, name: &str) -> bool {
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
        logging::log_event(&format!(
            "[mcp] snapshot revision={} prev_revision={} state={:?} configured={} loaded={} cached_tools={} last_error={}",
            snapshot.revision,
            self.last_mcp_status_revision,
            snapshot.state,
            snapshot.configured_servers,
            snapshot.loaded_servers,
            snapshot.cached_tools,
            snapshot.last_error.as_deref().unwrap_or("<none>"),
        ));
        self.last_mcp_status_revision = snapshot.revision;
        self.refresh_prompt_slash_commands(&snapshot);
        self.refresh_welcome_message_with_snapshot(&snapshot);
    }

    fn refresh_prompt_slash_commands(&mut self, snapshot: &McpStatusSnapshot) {
        if !matches!(snapshot.state, McpStatusState::Ready) {
            if !self.slash.prompt_commands.is_empty() {
                self.slash.prompt_commands.clear();
                if self.current_slash_query().is_some() {
                    self.refresh_suggestions();
                }
            }
            return;
        }

        let commands = match self.build_prompt_slash_commands() {
            Ok(commands) => commands,
            Err(err) => {
                logging::log_event(&format!(
                    "[mcp] refresh prompt slash cache failed: {}",
                    err
                ));
                return;
            }
        };
        let changed = self.slash.prompt_commands != commands;
        self.slash.prompt_commands = commands;
        if changed && self.current_slash_query().is_some() {
            self.refresh_suggestions();
        }
    }

    fn build_prompt_slash_commands(&mut self) -> Result<Vec<slash::PromptSlashCommand>> {
        let prompt_servers = self.runtime.list_mcp_servers()?;
        let mut commands = Vec::new();
        for ManagedMcpServer {
            name,
            enabled,
            capabilities,
            ..
        } in prompt_servers
        {
            if !(enabled && capabilities.prompts) {
                continue;
            }

            let prompts = self.runtime.list_cached_mcp_prompts(&name)?;
            commands.extend(prompts.into_iter().map(|prompt| slash::PromptSlashCommand {
                alias: slash::prompt_slash_alias(&name, &prompt.name),
                server: name.clone(),
                prompt,
            }));
        }

        commands.sort_by(|left, right| left.alias.cmp(&right.alias));
        logging::log_event(&format!(
            "[mcp] refreshed prompt slash cache commands={}",
            commands.len()
        ));
        Ok(commands)
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

    fn export_llm_history_json_to_temp(&mut self) -> Result<std::path::PathBuf> {
        let export_state = self.runtime.export_llm_state()?;
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
            "system_prompts": export_state.system_prompts,
            "note": "messages: 内存 llm_history 的 API 形态。api_request_trace: 每步模型推理均为一次 tool_agent_chat_completions，stream=true，含 tools；多轮工具时会有多条 trace（每轮一次 HTTP），失败轮次也会保留最后一次请求体。system_prompts 为 transport 导出的 system 文案（如 tool_agent），供调试与导出。",
            "message_count": export_state.api_messages.len(),
            "messages": export_state.api_messages,
            "api_request_trace_count": export_state.api_request_trace.len(),
            "api_request_trace": export_state.api_request_trace,
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
        self.cancel_model_add_pick();
        if self.runtime.config().models.is_empty() {
            self.messages.push(ChatMessage {
                role: MessageRole::Agent,
                content: "当前没有可选模型，请先 `/model add` 添加（或一行 `/model add <name> <api_base> <api_key>`）。"
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
        self.language_picker_active = false;
        self.chat_picker_active = false;
        self.image_picker_active = false;
        self.bottom_form = None;
        self.set_input(String::new());
        self.refresh_suggestions();
    }

    fn open_language_picker(&mut self) {
        self.cancel_model_add_pick();
        let current = locale::normalize_ui_locale(rust_i18n::locale().as_ref());
        self.language_picker_index = locale::supported_ui_locales()
            .iter()
            .position(|candidate| *candidate == current)
            .unwrap_or(0);
        self.language_picker_active = true;
        self.model_picker_active = false;
        self.chat_picker_active = false;
        self.image_picker_active = false;
        self.bottom_form = None;
        self.set_input(String::new());
        self.refresh_suggestions();
    }

    fn open_chat_picker(&mut self) {
        self.cancel_model_add_pick();
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
                self.language_picker_active = false;
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
        self.cancel_model_add_pick();
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
                self.language_picker_active = false;
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
        self.cancel_model_add_pick();
        self.bottom_form = Some(bottom_form::new_mcp_add_form());
        self.model_picker_active = false;
        self.language_picker_active = false;
        self.chat_picker_active = false;
        self.image_picker_active = false;
        self.set_input(String::new());
        self.refresh_suggestions();
    }

    fn open_model_add_form(&mut self) {
        self.cancel_model_add_pick();
        self.bottom_form = Some(bottom_form::new_model_add_form());
        self.model_picker_active = false;
        self.language_picker_active = false;
        self.chat_picker_active = false;
        self.image_picker_active = false;
        self.set_input(String::new());
        self.refresh_suggestions();
    }

    fn open_ask_questions_form(
        &mut self,
        tool_call_id: String,
        tool_name: String,
        questions: crate::ask_questions::AskQuestionsRequest,
    ) {
        self.cancel_model_add_pick();
        self.bottom_form = Some(ask_questions::new_form(tool_call_id, tool_name, questions));
        self.model_picker_active = false;
        self.language_picker_active = false;
        self.chat_picker_active = false;
        self.image_picker_active = false;
        self.set_input(String::new());
        self.refresh_suggestions();
        self.scroll_history_to_bottom();
    }

    fn complete_ask_questions_form(&mut self, result: AskQuestionsResult) {
        let Some(form) = self.bottom_form.take() else {
            return;
        };
        let BottomFormKind::AskQuestions {
            tool_call_id,
            tool_name,
            request,
            ..
        } = form.kind
        else {
            self.bottom_form = Some(form);
            return;
        };

        let request_value = ToolRequest::AskQuestions {
            questions: request.clone(),
        };
        let output = serde_json::to_string_pretty(&result)
            .unwrap_or_else(|_| "{\"status\":\"skipped\"}".to_string());
        self.messages.push(ChatMessage::with_tool_block(
            MessageRole::Agent,
            format_tool_ui_message(&request_value, &tool_name, &output),
            build_tool_result_block(
                &request_value,
                &tool_name,
                Some(tool_call_id.as_str()),
                &output,
            ),
        ));
        self.scroll_history_to_bottom();
        self.runtime.respond_to_pending_questions(&result);
        self.apply_runtime_events();
    }

    fn open_mcp_prompt_form(
        &mut self,
        server: &str,
        prompt: &McpDiscoveredPrompt,
        initial_user_message: Option<&str>,
    ) {
        self.cancel_model_add_pick();
        self.bottom_form = Some(bottom_form::new_mcp_prompt_form(
            server,
            prompt,
            initial_user_message,
        ));
        self.model_picker_active = false;
        self.language_picker_active = false;
        self.chat_picker_active = false;
        self.image_picker_active = false;
        self.set_input(String::new());
        self.refresh_suggestions();
    }

    pub fn open_rules_form(&mut self) {
        self.cancel_model_add_pick();
        self.bottom_form = Some(bottom_form::new_rules_form(&self.rule_entries));
        self.model_picker_active = false;
        self.language_picker_active = false;
        self.chat_picker_active = false;
        self.image_picker_active = false;
        self.set_input(String::new());
        self.refresh_suggestions();
    }

    pub fn open_skills_form(&mut self) {
        self.cancel_model_add_pick();
        self.bottom_form = Some(bottom_form::new_skills_form(&self.skill_entries));
        self.model_picker_active = false;
        self.language_picker_active = false;
        self.chat_picker_active = false;
        self.image_picker_active = false;
        self.set_input(String::new());
        self.refresh_suggestions();
    }

    fn apply_mcp_prompt_command(
        &mut self,
        server: &str,
        prompt: &str,
        args_json: Option<&str>,
        user_message: Option<&str>,
    ) -> bool {
        match self
            .runtime
            .apply_mcp_prompt(server, prompt, args_json, user_message)
        {
            Ok(_) => {
                self.apply_runtime_events();
                true
            }
            Err(err) => {
                self.messages.push(ChatMessage {
                    role: MessageRole::Agent,
                    content: format!("应用 MCP prompt 失败: {}", err),
                    tool_block: None,
                });
                false
            }
        }
    }

    fn apply_prompt_bottom_form(&mut self) {
        let Some(form) = self.bottom_form.as_ref() else {
            return;
        };
        let BottomFormKind::McpPrompt { server, prompt, .. } = &form.kind else {
            return;
        };
        let server = server.clone();
        let prompt = prompt.clone();

        match (
            bottom_form::to_prompt_args_json(form),
            bottom_form::prompt_user_message(form),
        ) {
            (Ok(args_json), Ok(user_message)) => {
                if self.apply_mcp_prompt_command(
                    &server,
                    &prompt,
                    args_json.as_deref(),
                    user_message.as_deref(),
                ) {
                    self.bottom_form = None;
                }
            }
            (Err(err), _) | (_, Err(err)) => {
                self.messages.push(ChatMessage {
                    role: MessageRole::Agent,
                    content: format!("应用 MCP prompt 失败: {}", err),
                    tool_block: None,
                });
            }
        }
    }

    fn resolve_mcp_prompt_definition(
        &mut self,
        server: &str,
        prompt_name: &str,
    ) -> Result<McpDiscoveredPrompt> {
        if let Some(prompt) = self
            .slash
            .prompt_commands
            .iter()
            .find(|candidate| candidate.server == server && candidate.prompt.name == prompt_name)
            .map(|candidate| candidate.prompt.clone())
        {
            return Ok(prompt);
        }

        if let Ok(prompts) = self.runtime.list_mcp_prompts(server) {
            if let Some(prompt) = prompts.into_iter().find(|prompt| prompt.name == prompt_name) {
                return Ok(prompt);
            }
        }

        if let Ok(prompts) = self.runtime.list_cached_mcp_prompts(server) {
            if let Some(prompt) = prompts.into_iter().find(|prompt| prompt.name == prompt_name) {
                return Ok(prompt);
            }
        }

        Err(anyhow!(
            "MCP server {} 中不存在 prompt {}",
            server,
            prompt_name
        ))
    }

    fn switch_ui_locale(&mut self, locale_code: &str) {
        let normalized = locale::normalize_ui_locale(locale_code);
        let mut config = self.runtime.config().clone();
        config.ui_locale = Some(normalized.clone());
        locale::apply_ui_locale(&config);
        self.runtime.replace_config(config.clone());
        let locale_name = locale::language_display_name(&normalized);

        if let Err(err) = self.config_store.save(&config) {
            self.messages.push(ChatMessage {
                role: MessageRole::Agent,
                content: t!(
                    "tui.language.switch_saved_fail",
                    locale_name = locale_name,
                    err = err
                )
                .into_owned(),
                tool_block: None,
            });
        } else {
            self.messages.push(ChatMessage {
                role: MessageRole::Agent,
                content: t!("tui.language.switch_success", locale_name = locale_name).into_owned(),
                tool_block: None,
            });
        }

        self.refresh_welcome_message();
    }

    fn refresh_welcome_message(&mut self) {
        let snapshot = self.runtime.mcp_status_snapshot();
        self.refresh_welcome_message_with_snapshot(&snapshot);
    }

    fn refresh_welcome_message_with_snapshot(&mut self, snapshot: &McpStatusSnapshot) {
        let Some(first_message) = self.messages.first_mut() else {
            logging::log_event("[mcp] welcome refresh skipped: no first message");
            return;
        };
        let is_welcome = locale::is_welcome_message(&first_message.content);
        if first_message.role != MessageRole::Agent || !is_welcome {
            logging::log_event(&format!(
                "[mcp] welcome refresh skipped: role={:?} is_welcome={} first_line={}",
                first_message.role,
                is_welcome,
                first_message.content.lines().next().unwrap_or("<empty>"),
            ));
            return;
        }
        let active_model = self.runtime.config().active_model.clone();
        let mcp_welcome_line = snapshot.welcome_line();
        let previous_status_line = first_message
            .content
            .lines()
            .last()
            .unwrap_or("<empty>")
            .to_string();
        first_message.content = welcome_message_text(
            &active_model,
            &mcp_welcome_line,
        );
        logging::log_event(&format!(
            "[mcp] welcome refreshed revision={} state={:?} previous_status={} next_status={}",
            snapshot.revision,
            snapshot.state,
            previous_status_line,
            mcp_welcome_line,
        ));
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
        match self.runtime.export_chat_archive(&messages, &assistant_aux) {
            Ok(archive) => match self.chat_repository.save(path, &archive) {
                Ok(saved_path) => {
                    self.messages.push(ChatMessage {
                        role: MessageRole::Agent,
                        content: t!("tui.session.saved", path = saved_path.display()).into_owned(),
                        tool_block: None,
                    });
                }
                Err(err) => {
                    self.messages.push(ChatMessage {
                        role: MessageRole::Agent,
                        content: t!("tui.session.save_failed", err = err).into_owned(),
                        tool_block: None,
                    });
                }
            },
            Err(err) => {
                self.messages.push(ChatMessage {
                    role: MessageRole::Agent,
                    content: t!("tui.session.save_failed", err = err).into_owned(),
                    tool_block: None,
                });
            }
        }
    }

    fn load_chat_by_path(&mut self, path: &str) {
        match self.chat_repository.load(path) {
            Ok(archive) => {
                self.subagent_picker_active = false;
                self.close_subagent_view();
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
                        content: t!("tui.session.loaded_empty").into_owned(),
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
                self.persisted_standalone_pending_aux = None;
                self.persisted_standalone_pending_aux_anchor = None;
                self.pending_assistant_msg_index = None;
                self.last_completed_assistant_msg_index = None;
                self.runtime.replace_session_from_archive(&archive);
                self.scroll_history_to_bottom();
                self.messages.push(ChatMessage {
                    role: MessageRole::Agent,
                    content: t!("tui.session.loaded", path = path).into_owned(),
                    tool_block: None,
                });
            }
            Err(err) => {
                self.messages.push(ChatMessage {
                    role: MessageRole::Agent,
                    content: t!("tui.session.load_failed", err = err).into_owned(),
                    tool_block: None,
                });
            }
        }
    }

    fn open_subagent_view(&mut self, session_id: &str) {
        match self.runtime.subagent_session_archive(session_id) {
            Ok(Some(archive)) => {
                let live_messages = self.runtime.subagent_live_messages(session_id);
                let pending_aux = match self.runtime.subagent_pending_aux_state(session_id) {
                    Ok(value) => value,
                    Err(err) => {
                        self.messages.push(ChatMessage {
                            role: MessageRole::Agent,
                            content: format!("读取子会话状态失败: {}", err),
                            tool_block: None,
                        });
                        None
                    }
                };
                self.subagent_view = Some(Self::subagent_detail_view(
                    &archive,
                    &live_messages,
                    pending_aux,
                ));
                self.subagent_history_offset_from_bottom = 0;
                self.sync_subagent_approval_input_state();
            }
            Ok(None) => {
                self.messages.push(ChatMessage {
                    role: MessageRole::Agent,
                    content: format!("未找到子会话: {}", session_id),
                    tool_block: None,
                });
            }
            Err(err) => {
                self.messages.push(ChatMessage {
                    role: MessageRole::Agent,
                    content: format!("读取子会话失败: {}", err),
                    tool_block: None,
                });
            }
        }
    }

    fn refresh_active_subagent_view(&mut self) {
        let Some(session_id) = self
            .subagent_view
            .as_ref()
            .map(|view| view.summary.session_id.clone())
        else {
            return;
        };

        match self.runtime.subagent_session_archive(&session_id) {
            Ok(Some(archive)) => {
                let live_messages = self.runtime.subagent_live_messages(&session_id);
                let pending_aux = match self.runtime.subagent_pending_aux_state(&session_id) {
                    Ok(value) => value,
                    Err(err) => {
                        self.messages.push(ChatMessage {
                            role: MessageRole::Agent,
                            content: format!("刷新子会话状态失败: {}", err),
                            tool_block: None,
                        });
                        None
                    }
                };
                self.subagent_view = Some(Self::subagent_detail_view(
                    &archive,
                    &live_messages,
                    pending_aux,
                ));
                self.sync_subagent_approval_input_state();
            }
            Ok(None) => {
                self.close_subagent_view();
            }
            Err(err) => {
                self.messages.push(ChatMessage {
                    role: MessageRole::Agent,
                    content: format!("刷新子会话失败: {}", err),
                    tool_block: None,
                });
                self.close_subagent_view();
            }
        }
    }

    fn active_view_pending_subagent_approval(&self) -> Option<PendingSubagentApprovalView> {
        let approval = self.runtime.pending_subagent_approval()?;
        let session_id = self.subagent_view.as_ref()?.summary.session_id.as_str();
        if approval.session_id == session_id {
            Some(approval)
        } else {
            None
        }
    }

    fn subagent_approval_input_view(&self) -> Option<SubagentApprovalInputView> {
        if !self.is_subagent_approval_input_active() {
            return None;
        }

        Some(SubagentApprovalInputView {
            value: self.subagent_approval_input.clone(),
            cursor: self.subagent_approval_input_cursor,
        })
    }

    fn clear_subagent_approval_input_state(&mut self) {
        self.subagent_approval_input.clear();
        self.subagent_approval_input_cursor = 0;
        self.subagent_approval_input_active = false;
    }

    fn sync_subagent_approval_input_state(&mut self) {
        if self.active_view_pending_subagent_approval().is_none() {
            self.clear_subagent_approval_input_state();
            return;
        }

        self.subagent_approval_input_cursor = self
            .subagent_approval_input_cursor
            .min(self.subagent_approval_input_len_chars());
    }

    fn subagent_approval_input_len_chars(&self) -> usize {
        self.subagent_approval_input.chars().count()
    }

    fn subagent_approval_cursor_byte_index(&self) -> usize {
        cursor_byte_index_for_text(
            &self.subagent_approval_input,
            self.subagent_approval_input_cursor,
        )
    }

    fn insert_text_into_subagent_approval(&mut self, text: &str) {
        if !self.is_subagent_approval_input_active() || text.is_empty() {
            return;
        }

        let idx = self.subagent_approval_cursor_byte_index();
        self.subagent_approval_input.insert_str(idx, text);
        self.subagent_approval_input_cursor += text.chars().count();
    }

    fn apply_runtime_events(&mut self) {
        for event in self.runtime.drain_events() {
            match event {
                RuntimeEvent::PushMessage(msg) => self.messages.push(msg),
                RuntimeEvent::OpenAskQuestions {
                    tool_call_id,
                    tool_name,
                    questions,
                } => {
                    self.open_ask_questions_form(tool_call_id, tool_name, questions);
                }
                RuntimeEvent::BeginAssistantResponse => {
                    let should_reanchor_persisted_subagent_status =
                        should_reanchor_persisted_subagent_status_on_begin_assistant_response(
                            self.messages.last(),
                            self.persisted_standalone_pending_aux.as_ref(),
                        );
                    self.messages
                        .push(ChatMessage::new(MessageRole::Agent, String::new()));
                    let idx = self.messages.len() - 1;
                    self.assistant_aux_by_message.remove(&idx);
                    self.pending_assistant_msg_index = Some(idx);
                    self.last_completed_assistant_msg_index = None;
                    if should_reanchor_persisted_subagent_status {
                        let previous_anchor = self.persisted_standalone_pending_aux_anchor;
                        self.persisted_standalone_pending_aux_anchor = Some(idx);
                        if previous_anchor != Some(idx) {
                            logging::log_event(&format!(
                                "[tui-subagent-anchor] begin-response-reanchor prev_anchor={:?} next_anchor={:?} status={}",
                                previous_anchor,
                                Some(idx),
                                self.persisted_standalone_pending_aux
                                    .as_ref()
                                    .map(|aux| aux.status_text.as_str())
                                    .unwrap_or("<none>"),
                            ));
                        }
                    }
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
                    self.last_completed_assistant_msg_index = self.pending_assistant_msg_index;
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
                                self.adjust_persisted_standalone_pending_aux_anchor_for_removed_message(idx);
                            self.assistant_aux_by_message.remove(&idx);
                            self.messages.remove(idx);
                        }
                    }
                }
            }
        }

        self.sync_persisted_standalone_pending_aux();
        self.sync_subagent_approval_input_state();
    }

    fn sync_persisted_standalone_pending_aux(&mut self) {
        let live_pending_aux = self.runtime.pending_aux_state();
        let next_persisted_standalone_pending_aux = next_persisted_standalone_pending_aux(
            self.runtime.is_busy(),
            self.pending_assistant_msg_index,
            live_pending_aux.clone(),
            self.persisted_standalone_pending_aux.clone(),
        );
        let previous_anchor = self.persisted_standalone_pending_aux_anchor;
        let next_anchor = next_persisted_standalone_pending_aux_anchor(
            self.pending_assistant_msg_index
                .or(self.last_completed_assistant_msg_index),
            live_pending_aux.as_ref(),
            next_persisted_standalone_pending_aux.as_ref(),
            self.persisted_standalone_pending_aux_anchor,
        );
        if previous_anchor != next_anchor
            && next_persisted_standalone_pending_aux
                .as_ref()
                .is_some_and(is_standalone_subagent_status_aux)
        {
            logging::log_event(&format!(
                "[tui-subagent-anchor] pending_idx={:?} prev_anchor={:?} next_anchor={:?} live_status={} persisted_status={}",
                self.pending_assistant_msg_index
                    .or(self.last_completed_assistant_msg_index),
                previous_anchor,
                next_anchor,
                live_pending_aux
                    .as_ref()
                    .map(|aux| aux.status_text.as_str())
                    .unwrap_or("<none>"),
                next_persisted_standalone_pending_aux
                    .as_ref()
                    .map(|aux| aux.status_text.as_str())
                    .unwrap_or("<none>"),
            ));
        }
        self.persisted_standalone_pending_aux_anchor = next_anchor;
        self.persisted_standalone_pending_aux = next_persisted_standalone_pending_aux;
    }

    fn submit_runtime_user_turn(
        &mut self,
        user_turn: String,
        explicit_images: Option<Vec<String>>,
    ) {
        self.runtime.submit_user_turn(user_turn, explicit_images);
        self.apply_runtime_events();
    }

    fn adjust_persisted_standalone_pending_aux_anchor_for_removed_message(
        &mut self,
        removed_message_index: usize,
    ) {
        self.persisted_standalone_pending_aux_anchor = match self
            .persisted_standalone_pending_aux_anchor
        {
            Some(anchor) if anchor == removed_message_index => None,
            Some(anchor) if anchor > removed_message_index => Some(anchor - 1),
            other => other,
        };
        self.last_completed_assistant_msg_index = match self.last_completed_assistant_msg_index {
            Some(index) if index == removed_message_index => None,
            Some(index) if index > removed_message_index => Some(index - 1),
            other => other,
        };
    }

    fn current_input_suggestion_kind(&self) -> Option<InputSuggestionKind> {
        if self.current_file_reference_query().is_some() {
            return Some(InputSuggestionKind::FileReference);
        }
        if self.current_slash_query().is_some() {
            return Some(InputSuggestionKind::Slash);
        }
        None
    }

    fn current_slash_query(&self) -> Option<&str> {
        if self.shell_mode_active {
            return None;
        }
        slash::current_query(&self.input)
    }

    fn current_file_reference_query(&self) -> Option<file_reference::ActiveReferenceQuery> {
        if self.shell_mode_active {
            return None;
        }
        file_reference::current_query(&self.input, self.input_cursor)
    }

    fn input_len_chars(&self) -> usize {
        self.input.chars().count()
    }

    fn cursor_byte_index(&self) -> usize {
        cursor_byte_index_for_text(&self.input, self.input_cursor)
    }

    fn set_input(&mut self, value: String) {
        self.input = value;
        self.input_cursor = self.input_len_chars();
    }

    fn log_input_edit(&self, action: &str, text: &str, cursor_before: usize) {
        logging::log_event(&format!(
            "[input] {} inserted_chars={} cursor_before={} cursor_after={} total_chars={} preview={}",
            action,
            text.chars().count(),
            cursor_before,
            self.input_cursor,
            self.input_len_chars(),
            truncate_input_log_preview(text, 80),
        ));
    }

    fn replace_current_file_reference(&mut self, selected: &str, finalize: bool) -> bool {
        let Some(query) = self.current_file_reference_query() else {
            return false;
        };
        let (next_input, next_cursor) =
            file_reference::replace_query(&self.input, &query, selected, finalize);
        self.input = next_input;
        self.input_cursor = next_cursor;
        true
    }

    fn refresh_plan_metadata_from_disk(&mut self) {
        let Ok(next) = self.runtime.load_plan_metadata(self.is_plan_mode_active()) else {
            return;
        };
        if next == self.plan_metadata {
            return;
        }

        self.plan_metadata = next.clone();
        self.runtime.replace_plan_metadata(next);
    }

    fn push_plan_metadata_snapshot(&mut self) {
        let Ok(next) = self.runtime.load_plan_metadata(self.is_plan_mode_active()) else {
            return;
        };
        if next == self.plan_metadata {
            return;
        }

        self.plan_metadata = next.clone();
        self.runtime.replace_plan_metadata(next);
    }

    fn poll_file_reference_index(&mut self) {
        let Some(result_rx) = self.pending_file_reference_index_rx.take() else {
            return;
        };

        match result_rx.try_recv() {
            Ok(files) => {
                self.file_reference_index = files;
                self.file_reference_indexing = false;
                self.refresh_suggestions();
            }
            Err(TryRecvError::Empty) => {
                self.pending_file_reference_index_rx = Some(result_rx);
            }
            Err(TryRecvError::Disconnected) => {
                self.file_reference_indexing = false;
                self.refresh_suggestions();
            }
        }
    }

    fn next_local_shell_tool_call_id(&mut self) -> String {
        let id = manual_shell::local_tool_call_id(self.next_local_shell_tool_id);
        self.next_local_shell_tool_id += 1;
        id
    }

    fn start_manual_shell_execution(&mut self, command: String) {
        let tool_call_id = self.next_local_shell_tool_call_id();
        let (result_tx, result_rx) = mpsc::channel::<anyhow::Result<String>>();
        let request = ToolRequest::Shell {
            command: command.clone(),
        };

        thread::spawn(move || {
            let runtime = ToolRuntime::new();
            let outcome = runtime.execute(&request);
            let _ = result_tx.send(outcome);
        });

        self.messages.push(ChatMessage::with_tool_block(
            MessageRole::Agent,
            String::new(),
            manual_shell::running_block(&tool_call_id, &command),
        ));
        self.pending_shell_executions.push(PendingShellExecution {
            tool_call_id,
            command,
            result_rx,
        });
    }

    fn poll_pending_shell_executions(&mut self) {
        let mut still_pending = Vec::new();
        let pending_executions = std::mem::take(&mut self.pending_shell_executions);

        for pending in pending_executions {
            match pending.result_rx.try_recv() {
                Ok(Ok(output)) => {
                    let block = manual_shell::success_block(
                        &pending.tool_call_id,
                        &pending.command,
                        &output,
                    );
                    self.finish_pending_shell_execution(&pending.tool_call_id, block);
                }
                Ok(Err(err)) => {
                    let block = manual_shell::failed_block(
                        &pending.tool_call_id,
                        &pending.command,
                        &err.to_string(),
                    );
                    self.finish_pending_shell_execution(&pending.tool_call_id, block);
                }
                Err(TryRecvError::Empty) => still_pending.push(pending),
                Err(TryRecvError::Disconnected) => {
                    let block = manual_shell::failed_block(
                        &pending.tool_call_id,
                        &pending.command,
                        t!("tui.shell.background_disconnected").as_ref(),
                    );
                    self.finish_pending_shell_execution(&pending.tool_call_id, block);
                }
            }
        }

        self.pending_shell_executions = still_pending;
    }

    fn finish_pending_shell_execution(
        &mut self,
        tool_call_id: &str,
        block: crate::view::ToolUiBlock,
    ) {
        if let Some(message) = self.messages.iter_mut().find(|message| {
            message.tool_block.as_ref().and_then(|tool| tool.tool_call_id.as_deref())
                == Some(tool_call_id)
        }) {
            message.tool_block = Some(block);
            return;
        }

        self.messages
            .push(ChatMessage::with_tool_block(MessageRole::Agent, String::new(), block));
    }
}

fn user_turn_text_for_mode(
    _workspace_root: &Path,
    _input_mode: MainInputMode,
    raw_message: &str,
) -> String {
    raw_message.to_string()
}

fn is_standalone_subagent_status_aux(pending_aux: &PendingAssistantAux) -> bool {
    let status = pending_aux
        .status_text
        .trim()
        .strip_prefix("| ")
        .or_else(|| pending_aux.status_text.trim().strip_prefix("/ "))
        .or_else(|| pending_aux.status_text.trim().strip_prefix("- "))
        .or_else(|| pending_aux.status_text.trim().strip_prefix("\\ "))
        .unwrap_or(pending_aux.status_text.trim())
        .trim();

    !status.is_empty() && status != "Thinking..." && status != "Compressing..."
}

fn next_persisted_standalone_pending_aux(
    is_busy: bool,
    pending_assistant_msg_index: Option<usize>,
    live_pending_aux: Option<PendingAssistantAux>,
    persisted_standalone_pending_aux: Option<PendingAssistantAux>,
) -> Option<PendingAssistantAux> {
    let live_is_subagent_status = live_pending_aux
        .as_ref()
        .is_some_and(is_standalone_subagent_status_aux);
    let persisted_is_subagent_status = persisted_standalone_pending_aux
        .as_ref()
        .is_some_and(is_standalone_subagent_status_aux);

    if is_busy {
        if live_is_subagent_status {
            return live_pending_aux;
        }

        if pending_assistant_msg_index.is_none() {
            return live_pending_aux;
        }

        return if persisted_is_subagent_status {
            persisted_standalone_pending_aux
        } else {
            None
        };
    }

    if live_pending_aux.is_some() {
        return live_pending_aux;
    }

    persisted_standalone_pending_aux
}

fn next_persisted_standalone_pending_aux_anchor(
    anchor_source_msg_index: Option<usize>,
    live_pending_aux: Option<&PendingAssistantAux>,
    persisted_standalone_pending_aux: Option<&PendingAssistantAux>,
    persisted_standalone_pending_aux_anchor: Option<usize>,
) -> Option<usize> {
    if live_pending_aux.is_some_and(is_standalone_subagent_status_aux) {
        return anchor_source_msg_index.or(persisted_standalone_pending_aux_anchor);
    }

    if persisted_standalone_pending_aux.is_none() {
        return None;
    }

    if !persisted_standalone_pending_aux.is_some_and(is_standalone_subagent_status_aux) {
        return None;
    }

    persisted_standalone_pending_aux_anchor
}

fn should_reanchor_persisted_subagent_status_on_begin_assistant_response(
    last_message: Option<&ChatMessage>,
    persisted_standalone_pending_aux: Option<&PendingAssistantAux>,
) -> bool {
    last_message.is_some_and(|message| message.role == MessageRole::Agent)
        && persisted_standalone_pending_aux.is_some_and(is_standalone_subagent_status_aux)
}

#[cfg(test)]
mod tests {
    use super::{
        is_standalone_subagent_status_aux, next_persisted_standalone_pending_aux,
        next_persisted_standalone_pending_aux_anchor,
        should_reanchor_persisted_subagent_status_on_begin_assistant_response,
        user_turn_text_for_mode,
    };
    use crate::{
        view::{AssistantAuxKind, ChatMessage, MainInputMode, MessageRole, PendingAssistantAux},
    };
    use std::path::PathBuf;

    #[test]
    fn user_turn_text_for_agent_mode_keeps_raw_input() {
        let workspace_root = PathBuf::from("C:/workspace/demo");
        let raw_message = "实现计划模式";

        let runtime_turn =
            user_turn_text_for_mode(&workspace_root, MainInputMode::Agent, raw_message);

        assert_eq!(runtime_turn, raw_message);
    }

    #[test]
    fn user_turn_text_for_plan_mode_keeps_only_user_text() {
        let workspace_root = PathBuf::from("C:/workspace/demo");
        let raw_message = "实现计划模式";

        let runtime_turn =
            user_turn_text_for_mode(&workspace_root, MainInputMode::Plan, raw_message);

        assert_eq!(runtime_turn, raw_message);
    }

    #[test]
    fn standalone_subagent_status_aux_detection_ignores_generic_spinner_text() {
        assert!(!is_standalone_subagent_status_aux(&PendingAssistantAux {
            kind: AssistantAuxKind::Thinking,
            status_text: "| Thinking...".to_string(),
            detail_text: Some("继续处理中".to_string()),
        }));
    }

    #[test]
    fn standalone_subagent_status_aux_detection_accepts_named_status_text() {
        assert!(is_standalone_subagent_status_aux(&PendingAssistantAux {
            kind: AssistantAuxKind::Thinking,
            status_text: "| 子代理任务: 成功".to_string(),
            detail_text: None,
        }));
    }

    #[test]
    fn completed_subagent_status_survives_parent_completion_while_busy() {
        let persisted = PendingAssistantAux {
            kind: AssistantAuxKind::Thinking,
            status_text: "| 子代理任务: 成功".to_string(),
            detail_text: None,
        };

        let next = next_persisted_standalone_pending_aux(
            true,
            Some(7),
            None,
            Some(persisted.clone()),
        );

        assert_eq!(next.as_ref().map(|aux| aux.status_text.as_str()), Some(persisted.status_text.as_str()));
    }

    #[test]
    fn live_subagent_status_captures_pending_assistant_anchor() {
        let live = PendingAssistantAux {
            kind: AssistantAuxKind::Thinking,
            status_text: "| 子代理任务: 执行中".to_string(),
            detail_text: None,
        };

        let next = next_persisted_standalone_pending_aux_anchor(Some(7), Some(&live), Some(&live), None);

        assert_eq!(next, Some(7));
    }

    #[test]
    fn live_subagent_status_captures_last_completed_assistant_anchor() {
        let live = PendingAssistantAux {
            kind: AssistantAuxKind::Thinking,
            status_text: "| 子代理任务: 执行中".to_string(),
            detail_text: None,
        };

        let next = next_persisted_standalone_pending_aux_anchor(Some(4), Some(&live), Some(&live), None);

        assert_eq!(next, Some(4));
    }

    #[test]
    fn begin_assistant_response_reanchors_persisted_subagent_status_after_agent_message() {
        let persisted = PendingAssistantAux {
            kind: AssistantAuxKind::Thinking,
            status_text: "| 子代理任务: 成功".to_string(),
            detail_text: None,
        };

        let should_reanchor = should_reanchor_persisted_subagent_status_on_begin_assistant_response(
            Some(&ChatMessage::new(MessageRole::Agent, "上一段父回复")),
            Some(&persisted),
        );

        assert!(should_reanchor);
    }

    #[test]
    fn begin_assistant_response_does_not_reanchor_persisted_subagent_status_after_user_message() {
        let persisted = PendingAssistantAux {
            kind: AssistantAuxKind::Thinking,
            status_text: "| 子代理任务: 成功".to_string(),
            detail_text: None,
        };

        let should_reanchor = should_reanchor_persisted_subagent_status_on_begin_assistant_response(
            Some(&ChatMessage::new(MessageRole::User, "新用户输入")),
            Some(&persisted),
        );

        assert!(!should_reanchor);
    }

    #[test]
    fn live_subagent_status_keeps_existing_anchor_after_parent_completion() {
        let live = PendingAssistantAux {
            kind: AssistantAuxKind::Thinking,
            status_text: "| 子代理任务: 成功".to_string(),
            detail_text: None,
        };

        let next = next_persisted_standalone_pending_aux_anchor(None, Some(&live), Some(&live), Some(5));

        assert_eq!(next, Some(5));
    }

    #[test]
    fn completed_subagent_status_keeps_existing_anchor() {
        let persisted = PendingAssistantAux {
            kind: AssistantAuxKind::Thinking,
            status_text: "| 子代理任务: 成功".to_string(),
            detail_text: None,
        };

        let next = next_persisted_standalone_pending_aux_anchor(None, None, Some(&persisted), Some(5));

        assert_eq!(next, Some(5));
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
    t!("tui.welcome.body", model = active_model, mcp_status = mcp_status_line).into_owned()
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

fn is_subagents_command(message: &str) -> bool {
    message == "/subagents" || message.starts_with("/subagents ")
}

fn cursor_byte_index_for_text(text: &str, cursor_chars: usize) -> usize {
    if cursor_chars == 0 {
        return 0;
    }

    text.char_indices()
        .nth(cursor_chars)
        .map(|(idx, _)| idx)
        .unwrap_or(text.len())
}

fn non_empty_opt(input: &str) -> Option<&str> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed)
    }
}

enum PromptTail<'a> {
    Empty,
    ArgsJson(&'a str),
    UserMessage(&'a str),
}

fn classify_prompt_tail<'a>(prompt: &McpDiscoveredPrompt, input: &'a str) -> PromptTail<'a> {
    let Some(tail) = non_empty_opt(input) else {
        return PromptTail::Empty;
    };

    if !prompt.arguments.is_empty() && looks_like_prompt_args_json(tail) {
        PromptTail::ArgsJson(tail)
    } else {
        PromptTail::UserMessage(tail)
    }
}

fn looks_like_prompt_args_json(input: &str) -> bool {
    serde_json::from_str::<serde_json::Value>(input)
        .map(|value| value.is_object())
        .unwrap_or(false)
}

fn should_log_input_edit(text: &str) -> bool {
    text.contains('\n')
        || text.chars().count() >= 16
        || text.chars().filter(|ch| !ch.is_ascii()).count() >= 8
}

fn truncate_input_log_preview(text: &str, max_chars: usize) -> String {
    let mut preview = String::new();
    let mut emitted = 0usize;
    for ch in text.chars() {
        if emitted >= max_chars {
            preview.push('…');
            break;
        }
        match ch {
            '\n' => preview.push_str("\\n"),
            '\r' => preview.push_str("\\r"),
            _ => preview.push(ch),
        }
        emitted += 1;
    }
    preview
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
