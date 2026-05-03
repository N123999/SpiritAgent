use anyhow::{anyhow, Context, Result};
use rust_i18n::t;
use std::{
    collections::{BTreeMap, HashMap},
    env, fs,
    fs::OpenOptions,
    path::Path,
    process::Command,
    sync::{
        mpsc::{self, TryRecvError},
        Arc,
    },
    thread,
    time::{SystemTime, UNIX_EPOCH},
};

use crate::{
    adapters::{DefaultAppPaths, JsonChatRepository, JsonConfigStore, KeyringSecretStore},
    ask_questions::AskQuestionsResult,
    host_runtime::{build_tool_result_block, format_tool_ui_message, RuntimeEvent, ToolUiRequest},
    locale, logging,
    mcp_types::{ManagedMcpServer, McpDiscoveredPrompt},
    model_registry::{AppConfig, ModelProfile, ModelProvider, DEFAULT_API_BASE},
    openai_models_list,
    plan::{self, PlanMetadata},
    ports::{
        AppPaths, AssistantAuxArchiveEntry, ChatRepository, ConfigStore, McpStatusSnapshot,
        McpStatusState, SecretStore, SubagentSessionArchiveEntry, SubagentSessionSummary,
    },
    rules::{self, RuleEntry, RuleScope},
    runtime_handle::RuntimeHandle,
    shell::{ask_questions, bottom_form, file_reference, manual_shell, slash},
    skills::{self, SkillEntry},
    ts_bridge::{
        CliExtensionCliUiHookEntry, CliExtensionEntry, CliMarketplaceCatalogItem,
        CliMarketplaceDetail, CliMarketplaceDetailVersion, CliMarketplacePreparedInstall,
    },
    ui::UiRenderFeedback,
    view::{
        AssistantAuxData, BottomFormKind, ChatMessage, CliUiHookSlot, CliUiHookTokenRole,
        CliUiHookTokensView, CliUiHookVariant, CliUiHookView, ConversationPanelHit,
        InputSuggestion, InputSuggestionKind, MainInputMode, MarketplaceCatalogItemView,
        MarketplaceDetailView, MarketplaceFlowStep, MarketplaceVersionChangelogView,
        MarketplaceVersionView, MarketplaceViewModel, MessageRole, PendingAssistantAux,
        PendingSubagentApprovalView, SlashFlowItemView, SlashFlowView, SubagentApprovalInputView,
        SubagentSessionDetailView, SubagentSessionSummaryView, TuiViewModel,
    },
};

mod commands;
mod conversation;
mod forms;
mod host_actions;
mod input;
mod marketplace;
mod mcp_actions;
mod pickers;
mod projection;
mod runtime_events;
mod subagent;

use conversation::ConversationUiState;
use forms::BottomFormUiState;
use input::InputState;
use marketplace::MarketplaceState;
use subagent::SubagentUiState;

const VIEW_MODEL_MESSAGE_LIMIT: usize = 180;

pub struct TuiShell {
    input: InputState,
    messages: Vec<ChatMessage>,
    assistant_aux_by_message: HashMap<usize, AssistantAuxData>,
    persisted_standalone_pending_aux: Option<PendingAssistantAux>,
    persisted_standalone_pending_aux_anchor: Option<usize>,
    show_aux_details: bool,
    pending_assistant_msg_index: Option<usize>,
    last_completed_assistant_msg_index: Option<usize>,
    last_mcp_status_revision: u64,
    slash: slash::SlashState,
    model_picker_active: bool,
    model_picker_index: usize,
    language_picker_active: bool,
    language_picker_index: usize,
    chat_picker_active: bool,
    chat_picker_index: usize,
    chat_picker_files: Vec<String>,
    subagent: SubagentUiState,
    image_picker_active: bool,
    image_picker_index: usize,
    image_picker_files: Vec<String>,
    forms: BottomFormUiState,
    conversation: ConversationUiState,
    should_quit: bool,
    runtime: RuntimeHandle,
    config_store: Box<dyn ConfigStore>,
    chat_repository: Box<dyn ChatRepository>,
    secret_store: Arc<dyn SecretStore>,
    app_paths: Arc<dyn AppPaths>,
    plan_metadata: PlanMetadata,
    rule_entries: Vec<RuleEntry>,
    skill_entries: Vec<SkillEntry>,
    extension_entries: Vec<CliExtensionEntry>,
    marketplace: MarketplaceState,
    cli_ui_hooks: Vec<CliUiHookView>,
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
        )
        .context("初始化 TypeScript runtime bridge 失败")?;
        let cli_metadata = runtime
            .load_cli_host_metadata(false)
            .context("读取共享宿主 metadata 失败")?;
        let rule_entries = cli_metadata.rule_entries;
        let skill_entries = cli_metadata.skill_entries;
        let plan_metadata = cli_metadata.plan_metadata;
        let extension_entries = runtime.list_extensions().unwrap_or_else(|err| {
            logging::log_event(&format!("[extensions] 初始化列表失败: {err:#}"));
            Vec::new()
        });
        let cli_ui_hooks = compile_cli_ui_hooks(&extension_entries);
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
            input: InputState::new(file_index_rx),
            messages,
            assistant_aux_by_message: HashMap::new(),
            persisted_standalone_pending_aux: None,
            persisted_standalone_pending_aux_anchor: None,
            show_aux_details: true,
            pending_assistant_msg_index: None,
            last_completed_assistant_msg_index: None,
            last_mcp_status_revision: initial_mcp_status.revision,
            slash: slash::SlashState::new(),
            model_picker_active: false,
            model_picker_index: 0,
            language_picker_active: false,
            language_picker_index: 0,
            chat_picker_active: false,
            chat_picker_index: 0,
            chat_picker_files: vec![],
            subagent: SubagentUiState::default(),
            image_picker_active: false,
            image_picker_index: 0,
            image_picker_files: vec![],
            forms: BottomFormUiState::default(),
            conversation: ConversationUiState::default(),
            should_quit: false,
            runtime,
            config_store,
            chat_repository,
            secret_store,
            app_paths,
            plan_metadata,
            rule_entries,
            skill_entries,
            extension_entries,
            marketplace: MarketplaceState::default(),
            cli_ui_hooks,
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

    pub fn extension_entries(&self) -> &[CliExtensionEntry] {
        &self.extension_entries
    }

    pub(crate) fn enabled_skill_entries(&self) -> impl Iterator<Item = &SkillEntry> {
        self.skill_entries.iter().filter(|entry| entry.enabled)
    }

    pub(crate) fn find_enabled_skill_entry(&self, name: &str) -> Option<&SkillEntry> {
        self.enabled_skill_entries()
            .find(|entry| entry.source.name == name)
    }

    pub fn refresh_rules_from_disk(&mut self) -> Result<()> {
        self.runtime
            .reload_host_metadata(self.is_plan_mode_active())
            .context("刷新共享规则 runtime metadata 失败")?;
        let metadata = self
            .runtime
            .load_cli_host_metadata(self.is_plan_mode_active())
            .context("读取共享规则 metadata 失败")?;
        self.rule_entries = metadata.rule_entries;
        self.skill_entries = metadata.skill_entries;
        self.plan_metadata = metadata.plan_metadata;
        Ok(())
    }

    pub fn refresh_skills_from_disk(&mut self) -> Result<()> {
        self.runtime
            .reload_host_metadata(self.is_plan_mode_active())
            .context("刷新共享技能 runtime metadata 失败")?;
        let metadata = self
            .runtime
            .load_cli_host_metadata(self.is_plan_mode_active())
            .context("读取共享技能 metadata 失败")?;
        self.rule_entries = metadata.rule_entries;
        self.skill_entries = metadata.skill_entries;
        self.plan_metadata = metadata.plan_metadata;
        if self.current_slash_query().is_some() {
            self.refresh_suggestions();
        }
        Ok(())
    }

    pub fn refresh_extensions_from_disk(&mut self) -> Result<()> {
        self.extension_entries = self.runtime.list_extensions().context("读取扩展列表失败")?;
        self.cli_ui_hooks = compile_cli_ui_hooks(&self.extension_entries);
        if self.current_slash_query().is_some() {
            self.refresh_suggestions();
        }
        Ok(())
    }

    pub fn refresh_suggestions(&mut self) {
        if self.input.shell_mode_active {
            self.slash.suggestions.clear();
            self.slash.selected_suggestion = 0;
            return;
        }

        if let Some(query) = self.current_file_reference_query() {
            if self.input.file_reference_indexing {
                self.slash.suggestions.clear();
                self.slash.selected_suggestion = 0;
                return;
            }

            self.slash.suggestions =
                file_reference::compute_suggestions(&query.raw, &self.input.file_reference_index)
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

        if let Some(output) = archive
            .summary
            .final_output
            .as_ref()
            .filter(|value| !value.trim().is_empty())
        {
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
        self.conversation.note_panel(hit, plain_rows);
    }

    pub fn apply_render_feedback(&mut self, feedback: UiRenderFeedback) {
        if let Some(conversation) = feedback.conversation_panel {
            self.conversation.history_offset_from_bottom = conversation.history_offset_from_bottom;
            self.note_conversation_panel(conversation.hit, conversation.plain_rows);
        }

        if let Some(scroll_offset) = feedback.bottom_form_scroll_offset {
            self.sync_active_bottom_form_scroll(scroll_offset);
        }

        if let Some(offset) = feedback.subagent_history_offset_from_bottom {
            self.subagent.history_offset_from_bottom = offset;
        }
    }

    pub fn clear_conversation_selection(&mut self) {
        self.conversation.clear_selection();
    }

    /// `column`, `row`：crossterm 终端坐标（与 ratatui 一致）。
    pub fn conversation_pointer_from_mouse(&self, column: u16, row: u16) -> Option<(usize, usize)> {
        self.conversation.pointer_from_mouse(column, row)
    }

    pub fn conversation_left_down(&mut self, column: u16, row: u16) {
        self.conversation.left_down(column, row);
    }

    pub fn conversation_left_drag(&mut self, column: u16, row: u16) {
        self.conversation.left_drag(column, row);
    }

    pub fn conversation_left_up(&mut self) {
        self.conversation.left_up();
    }

    pub fn copy_conversation_selection(&mut self) -> Result<(), String> {
        self.conversation.copy_selection()
    }

    pub fn should_quit(&self) -> bool {
        self.should_quit
    }

    pub fn request_quit(&mut self) {
        self.should_quit = true;
    }

    pub fn push_agent_message(&mut self, content: impl Into<String>) {
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
        self.subagent.picker_active = false;
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

    /// Any full-screen model list overlay (切换当前模型).
    pub fn is_model_list_overlay_active(&self) -> bool {
        self.model_picker_active
    }

    pub fn is_language_picker_active(&self) -> bool {
        self.language_picker_active
    }

    pub fn is_chat_picker_active(&self) -> bool {
        self.chat_picker_active
    }

    pub fn is_subagent_picker_active(&self) -> bool {
        self.subagent.picker_active
    }

    pub fn is_subagent_view_active(&self) -> bool {
        self.subagent.view.is_some()
    }

    pub fn has_active_subagent_viewer_approval(&self) -> bool {
        self.active_view_pending_subagent_approval().is_some()
    }

    pub fn is_subagent_approval_input_active(&self) -> bool {
        self.subagent.approval_input_active && self.has_active_subagent_viewer_approval()
    }

    pub fn begin_subagent_approval_input(&mut self) {
        if self.active_view_pending_subagent_approval().is_none() {
            return;
        }

        self.subagent.approval_input_active = true;
        self.subagent.approval_input_cursor = self.subagent_approval_input_len_chars();
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

        let message = self.subagent.approval_input.trim().to_string();
        if message.is_empty() {
            return;
        }

        self.respond_to_active_subagent_approval(&message);
    }

    pub fn move_subagent_approval_cursor_left(&mut self) {
        if self.is_subagent_approval_input_active() && self.subagent.approval_input_cursor > 0 {
            self.subagent.approval_input_cursor -= 1;
        }
    }

    pub fn move_subagent_approval_cursor_right(&mut self) {
        if self.is_subagent_approval_input_active()
            && self.subagent.approval_input_cursor < self.subagent_approval_input_len_chars()
        {
            self.subagent.approval_input_cursor += 1;
        }
    }

    pub fn move_subagent_approval_cursor_home(&mut self) {
        if self.is_subagent_approval_input_active() {
            self.subagent.approval_input_cursor = 0;
        }
    }

    pub fn move_subagent_approval_cursor_end(&mut self) {
        if self.is_subagent_approval_input_active() {
            self.subagent.approval_input_cursor = self.subagent_approval_input_len_chars();
        }
    }

    pub fn insert_subagent_approval_char(&mut self, ch: char) {
        if !self.is_subagent_approval_input_active() {
            return;
        }

        let idx = self.subagent_approval_cursor_byte_index();
        self.subagent.approval_input.insert(idx, ch);
        self.subagent.approval_input_cursor += 1;
    }

    pub fn backspace_subagent_approval_input(&mut self) {
        if !self.is_subagent_approval_input_active() || self.subagent.approval_input_cursor == 0 {
            return;
        }

        self.subagent.approval_input_cursor -= 1;
        let idx = self.subagent_approval_cursor_byte_index();
        self.subagent.approval_input.remove(idx);
    }

    pub fn delete_subagent_approval_input(&mut self) {
        if !self.is_subagent_approval_input_active()
            || self.subagent.approval_input_cursor >= self.subagent_approval_input_len_chars()
        {
            return;
        }

        let idx = self.subagent_approval_cursor_byte_index();
        self.subagent.approval_input.remove(idx);
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
        self.input.shell_mode_active
    }

    pub fn input_mode(&self) -> MainInputMode {
        self.input.mode
    }

    pub fn is_plan_mode_active(&self) -> bool {
        matches!(self.input.mode, MainInputMode::Plan)
    }

    pub fn set_input_mode(&mut self, mode: MainInputMode) {
        if self.input.mode == mode {
            return;
        }

        self.input.mode = mode;
        self.refresh_suggestions();
        self.push_plan_metadata_snapshot();
    }

    pub fn toggle_input_mode(&mut self) {
        let next = match self.input.mode {
            MainInputMode::Agent => MainInputMode::Plan,
            MainInputMode::Plan => MainInputMode::Agent,
        };
        self.set_input_mode(next);
    }

    pub fn can_enter_shell_mode(&self) -> bool {
        manual_shell::should_enter_shell_mode(
            '!',
            &self.input.value,
            self.input.cursor,
            self.input.shell_mode_active,
        )
    }

    pub fn enter_shell_mode(&mut self) {
        self.input.shell_mode_active = true;
        self.refresh_suggestions();
    }

    pub fn should_exit_shell_mode_on_backspace(&self) -> bool {
        manual_shell::should_exit_shell_mode_on_backspace(
            &self.input.value,
            self.input.cursor,
            self.input.shell_mode_active,
        )
    }

    pub fn exit_shell_mode(&mut self) {
        self.input.shell_mode_active = false;
        self.set_input(String::new());
        self.refresh_suggestions();
    }

    pub fn move_cursor_left(&mut self) {
        if self.input.cursor > 0 {
            self.input.cursor -= 1;
        }
    }

    pub fn move_cursor_right(&mut self) {
        let len = self.input_len_chars();
        if self.input.cursor < len {
            self.input.cursor += 1;
        }
    }

    pub fn move_cursor_home(&mut self) {
        self.input.cursor = 0;
    }

    pub fn move_cursor_end(&mut self) {
        self.input.cursor = self.input_len_chars();
    }

    pub fn insert_char_at_cursor(&mut self, ch: char) {
        let cursor_before = self.input.cursor;
        let idx = self.cursor_byte_index();
        self.input.value.insert(idx, ch);
        self.input.cursor += 1;
        if ch == '\n' {
            self.log_input_edit("insert_char", &ch.to_string(), cursor_before);
        }
    }

    pub fn insert_text_at_cursor(&mut self, text: &str) {
        if text.is_empty() {
            return;
        }

        let cursor_before = self.input.cursor;
        let idx = self.cursor_byte_index();
        self.input.value.insert_str(idx, text);
        self.input.cursor += text.chars().count();
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
        if self.input.cursor == 0 {
            return;
        }
        self.move_cursor_left();
        let idx = self.cursor_byte_index();
        self.input.value.remove(idx);
    }

    pub fn delete_at_cursor(&mut self) {
        if self.input.cursor >= self.input_len_chars() {
            return;
        }
        let idx = self.cursor_byte_index();
        self.input.value.remove(idx);
    }

    pub fn clamp_cursor(&mut self) {
        self.input.cursor = self.input.cursor.min(self.input_len_chars());
    }

    pub fn submit_input(&mut self) {
        let raw_message = self.input.value.clone();
        let trimmed_message = raw_message.trim();
        if trimmed_message.is_empty() {
            return;
        }

        self.clear_conversation_selection();

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

        if self.input.shell_mode_active {
            self.scroll_history_to_bottom();
            if self.runtime.is_busy() {
                self.messages.push(ChatMessage {
                    role: MessageRole::Agent,
                    content: t!("tui.busy.pending_reply").into_owned(),
                    tool_block: None,
                });
                return;
            }
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
            user_content
                .push_str(t!("tui.user.attached_mcp_resources", summary = summary).as_ref());
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
            let runtime_turn =
                user_turn_text_for_mode(&workspace_root, self.input.mode, &raw_message);
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
        if self.input.file_reference_indexing {
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
        self.conversation.history_offset_from_bottom = self
            .conversation
            .history_offset_from_bottom
            .saturating_add(lines);
    }

    pub fn scroll_history_down(&mut self, lines: usize) {
        self.conversation.history_offset_from_bottom = self
            .conversation
            .history_offset_from_bottom
            .saturating_sub(lines);
    }

    pub fn scroll_history_to_top(&mut self) {
        self.conversation.history_offset_from_bottom = usize::MAX;
    }

    pub fn scroll_history_to_bottom(&mut self) {
        self.conversation.history_offset_from_bottom = 0;
    }

    pub fn close_subagent_view(&mut self) {
        self.subagent.close_view();
    }

    pub fn scroll_subagent_view_up(&mut self, lines: usize) {
        self.subagent.history_offset_from_bottom = self
            .subagent
            .history_offset_from_bottom
            .saturating_add(lines);
    }

    pub fn scroll_subagent_view_down(&mut self, lines: usize) {
        self.subagent.history_offset_from_bottom = self
            .subagent
            .history_offset_from_bottom
            .saturating_sub(lines);
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
        provider: Option<ModelProvider>,
    ) -> Result<(), String> {
        let mut config = self.runtime.config().clone();
        if config.has_model(name) {
            return Err(t!("tui.model_add.duplicate", name = name).into_owned());
        }

        config.add_model(ModelProfile {
            name: name.to_string(),
            api_base: api_base.to_string(),
            provider,
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
        first_message.content = welcome_message_text(&active_model, &mcp_welcome_line);
        logging::log_event(&format!(
            "[mcp] welcome refreshed revision={} state={:?} previous_status={} next_status={}",
            snapshot.revision, snapshot.state, previous_status_line, mcp_welcome_line,
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
                self.subagent.picker_active = false;
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
                self.subagent.view = Some(Self::subagent_detail_view(
                    &archive,
                    &live_messages,
                    pending_aux,
                ));
                self.subagent.history_offset_from_bottom = 0;
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
            .subagent
            .view
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
                self.subagent.view = Some(Self::subagent_detail_view(
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
        let session_id = self.subagent.view.as_ref()?.summary.session_id.as_str();
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
            value: self.subagent.approval_input.clone(),
            cursor: self.subagent.approval_input_cursor,
        })
    }

    fn clear_subagent_approval_input_state(&mut self) {
        self.subagent.clear_approval_input();
    }

    fn sync_subagent_approval_input_state(&mut self) {
        if self.active_view_pending_subagent_approval().is_none() {
            self.clear_subagent_approval_input_state();
            return;
        }

        self.subagent.approval_input_cursor = self
            .subagent
            .approval_input_cursor
            .min(self.subagent_approval_input_len_chars());
    }

    fn subagent_approval_input_len_chars(&self) -> usize {
        self.subagent.approval_input.chars().count()
    }

    fn subagent_approval_cursor_byte_index(&self) -> usize {
        cursor_byte_index_for_text(
            &self.subagent.approval_input,
            self.subagent.approval_input_cursor,
        )
    }

    fn insert_text_into_subagent_approval(&mut self, text: &str) {
        if !self.is_subagent_approval_input_active() || text.is_empty() {
            return;
        }

        let idx = self.subagent_approval_cursor_byte_index();
        self.subagent.approval_input.insert_str(idx, text);
        self.subagent.approval_input_cursor += text.chars().count();
    }

    fn apply_runtime_events(&mut self) {
        runtime_events::apply_runtime_events(self);
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
        self.persisted_standalone_pending_aux_anchor =
            match self.persisted_standalone_pending_aux_anchor {
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
        if self.input.shell_mode_active {
            return None;
        }
        slash::current_query(&self.input.value)
    }

    fn current_file_reference_query(&self) -> Option<file_reference::ActiveReferenceQuery> {
        if self.input.shell_mode_active {
            return None;
        }
        file_reference::current_query(&self.input.value, self.input.cursor)
    }

    fn input_len_chars(&self) -> usize {
        self.input.len_chars()
    }

    fn cursor_byte_index(&self) -> usize {
        self.input.cursor_byte_index()
    }

    fn set_input(&mut self, value: String) {
        self.input.set_value(value);
    }

    fn log_input_edit(&self, action: &str, text: &str, cursor_before: usize) {
        logging::log_event(&format!(
            "[input] {} inserted_chars={} cursor_before={} cursor_after={} total_chars={} preview={}",
            action,
            text.chars().count(),
            cursor_before,
            self.input.cursor,
            self.input_len_chars(),
            truncate_input_log_preview(text, 80),
        ));
    }

    fn replace_current_file_reference(&mut self, selected: &str, finalize: bool) -> bool {
        let Some(query) = self.current_file_reference_query() else {
            return false;
        };
        let (next_input, next_cursor) =
            file_reference::replace_query(&self.input.value, &query, selected, finalize);
        self.input.value = next_input;
        self.input.cursor = next_cursor;
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
        let Some(result_rx) = self.input.pending_file_reference_index_rx.take() else {
            return;
        };

        match result_rx.try_recv() {
            Ok(files) => {
                self.input.file_reference_index = files;
                self.input.file_reference_indexing = false;
                self.refresh_suggestions();
            }
            Err(TryRecvError::Empty) => {
                self.input.pending_file_reference_index_rx = Some(result_rx);
            }
            Err(TryRecvError::Disconnected) => {
                self.input.file_reference_indexing = false;
                self.refresh_suggestions();
            }
        }
    }

    fn start_manual_shell_execution(&mut self, command: String) {
        self.runtime
            .execute_manual_tool_command(&manual_shell_tool_command(&command));
        self.apply_runtime_events();
    }
}

fn user_turn_text_for_mode(
    _workspace_root: &Path,
    _input_mode: MainInputMode,
    raw_message: &str,
) -> String {
    raw_message.to_string()
}

fn manual_shell_tool_command(command: &str) -> String {
    format!("/tool shell {}", command)
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
        is_standalone_subagent_status_aux, manual_shell_tool_command,
        next_persisted_standalone_pending_aux, next_persisted_standalone_pending_aux_anchor,
        should_reanchor_persisted_subagent_status_on_begin_assistant_response,
        user_turn_text_for_mode, TuiShell,
    };
    use crate::view::{
        AssistantAuxKind, ChatMessage, MainInputMode, MessageRole, PendingAssistantAux,
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
    fn manual_shell_tool_command_wraps_input_for_bridge() {
        assert_eq!(
            manual_shell_tool_command("echo hello world"),
            "/tool shell echo hello world"
        );
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

        let next =
            next_persisted_standalone_pending_aux(true, Some(7), None, Some(persisted.clone()));

        assert_eq!(
            next.as_ref().map(|aux| aux.status_text.as_str()),
            Some(persisted.status_text.as_str())
        );
    }

    #[test]
    fn live_subagent_status_captures_pending_assistant_anchor() {
        let live = PendingAssistantAux {
            kind: AssistantAuxKind::Thinking,
            status_text: "| 子代理任务: 执行中".to_string(),
            detail_text: None,
        };

        let next =
            next_persisted_standalone_pending_aux_anchor(Some(7), Some(&live), Some(&live), None);

        assert_eq!(next, Some(7));
    }

    #[test]
    fn live_subagent_status_captures_last_completed_assistant_anchor() {
        let live = PendingAssistantAux {
            kind: AssistantAuxKind::Thinking,
            status_text: "| 子代理任务: 执行中".to_string(),
            detail_text: None,
        };

        let next =
            next_persisted_standalone_pending_aux_anchor(Some(4), Some(&live), Some(&live), None);

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

        let next =
            next_persisted_standalone_pending_aux_anchor(None, Some(&live), Some(&live), Some(5));

        assert_eq!(next, Some(5));
    }

    #[test]
    fn completed_subagent_status_keeps_existing_anchor() {
        let persisted = PendingAssistantAux {
            kind: AssistantAuxKind::Thinking,
            status_text: "| 子代理任务: 成功".to_string(),
            detail_text: None,
        };

        let next =
            next_persisted_standalone_pending_aux_anchor(None, None, Some(&persisted), Some(5));

        assert_eq!(next, Some(5));
    }

    #[test]
    fn marketplace_version_compare_prefers_higher_semver() {
        assert_eq!(
            TuiShell::compare_marketplace_versions("1.10.0", "1.2.0"),
            std::cmp::Ordering::Greater
        );
        assert_eq!(
            TuiShell::compare_marketplace_versions("2.0.0", "10.0.0"),
            std::cmp::Ordering::Less
        );
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
    t!(
        "tui.welcome.body",
        model = active_model,
        mcp_status = mcp_status_line
    )
    .into_owned()
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

fn trim_wrapped_quotes(input: &str) -> &str {
    let trimmed = input.trim();
    if trimmed.len() >= 2 {
        let bytes = trimmed.as_bytes();
        if (bytes[0] == b'"' && bytes[trimmed.len() - 1] == b'"')
            || (bytes[0] == b'\'' && bytes[trimmed.len() - 1] == b'\'')
        {
            return &trimmed[1..trimmed.len() - 1];
        }
    }
    trimmed
}

fn compile_cli_ui_hooks(entries: &[CliExtensionEntry]) -> Vec<CliUiHookView> {
    let mut hooks = Vec::new();

    for entry in entries {
        let contributed = entry
            .contributes
            .as_ref()
            .and_then(|contributes| contributes.cli.as_ref())
            .and_then(|cli| cli.hooks.as_ref());
        let Some(contributed) = contributed else {
            continue;
        };

        for hook in contributed {
            if let Some(compiled) = compile_cli_ui_hook(hook) {
                hooks.push(compiled);
            }
        }
    }

    hooks
}

fn compile_cli_ui_hook(hook: &CliExtensionCliUiHookEntry) -> Option<CliUiHookView> {
    let slot = parse_cli_ui_hook_slot(&hook.slot)?;
    let variant = hook.variant.as_deref().and_then(parse_cli_ui_hook_variant);
    let tokens = CliUiHookTokensView {
        foreground: hook
            .tokens
            .as_ref()
            .and_then(|tokens| tokens.foreground.as_deref())
            .and_then(parse_cli_ui_hook_token_role),
        border: hook
            .tokens
            .as_ref()
            .and_then(|tokens| tokens.border.as_deref())
            .and_then(parse_cli_ui_hook_token_role),
        accent: hook
            .tokens
            .as_ref()
            .and_then(|tokens| tokens.accent.as_deref())
            .and_then(parse_cli_ui_hook_token_role),
    };

    Some(CliUiHookView {
        slot,
        variant,
        tokens,
        prefix: hook.prefix.clone(),
        suffix: hook.suffix.clone(),
    })
}

fn parse_cli_ui_hook_slot(slot: &str) -> Option<CliUiHookSlot> {
    match slot {
        "message.user" => Some(CliUiHookSlot::MessageUser),
        "message.assistant" => Some(CliUiHookSlot::MessageAssistant),
        "message.tool" => Some(CliUiHookSlot::MessageTool),
        "assistant.thinking" => Some(CliUiHookSlot::AssistantThinking),
        "input.frame" => Some(CliUiHookSlot::InputFrame),
        "bottom_form" => Some(CliUiHookSlot::BottomForm),
        "bottom_form.section" => Some(CliUiHookSlot::BottomFormSection),
        "slash_suggestions" => Some(CliUiHookSlot::SlashSuggestions),
        "approval.panel" => Some(CliUiHookSlot::ApprovalPanel),
        "questions.panel" => Some(CliUiHookSlot::QuestionsPanel),
        _ => None,
    }
}

fn parse_cli_ui_hook_variant(variant: &str) -> Option<CliUiHookVariant> {
    match variant {
        "default" => Some(CliUiHookVariant::Default),
        "accented" => Some(CliUiHookVariant::Accented),
        "muted" => Some(CliUiHookVariant::Muted),
        "warning" => Some(CliUiHookVariant::Warning),
        "success" => Some(CliUiHookVariant::Success),
        "danger" => Some(CliUiHookVariant::Danger),
        _ => None,
    }
}

fn parse_cli_ui_hook_token_role(role: &str) -> Option<CliUiHookTokenRole> {
    match role {
        "default" => Some(CliUiHookTokenRole::Default),
        "primary" => Some(CliUiHookTokenRole::Primary),
        "secondary" => Some(CliUiHookTokenRole::Secondary),
        "muted" => Some(CliUiHookTokenRole::Muted),
        "accent" => Some(CliUiHookTokenRole::Accent),
        "success" => Some(CliUiHookTokenRole::Success),
        "warning" => Some(CliUiHookTokenRole::Warning),
        "danger" => Some(CliUiHookTokenRole::Danger),
        _ => None,
    }
}

fn format_extension_list_message(entries: &[CliExtensionEntry]) -> String {
    if entries.is_empty() {
        return t!("tui.extensions.list_empty").into_owned();
    }

    let mut lines = vec!["扩展列表:".to_string()];
    for entry in entries {
        lines.push(format!("- {}", entry.display_name));
        lines.push(format!("  id: {}", entry.id));
        lines.push(format!("  version: {}", entry.version));
        if let Some(description) = entry
            .description
            .as_ref()
            .filter(|value| !value.trim().is_empty())
        {
            lines.push(format!("  description: {}", description));
        }
        if let Some(author) = entry
            .author
            .as_ref()
            .filter(|value| !value.trim().is_empty())
        {
            lines.push(format!("  author: {}", author));
        }
        if let Some(main) = entry.main.as_ref().filter(|value| !value.trim().is_empty()) {
            lines.push(format!("  main: {}", main));
        }
        if let Some(file_name) = entry
            .archive_file_name
            .as_ref()
            .filter(|value| !value.trim().is_empty())
        {
            lines.push(format!("  source: {}", file_name));
        }
    }

    lines.join("\n")
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
