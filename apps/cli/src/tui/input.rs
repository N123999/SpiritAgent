use std::{
    io::{self, Write},
    sync::mpsc::Receiver,
    time::{Duration, Instant},
};

use crate::view::MainInputMode;

const INTERRUPT_ESCAPE_ARM_WINDOW: Duration = Duration::from_millis(800);

pub(crate) struct InputState {
    pub(crate) value: String,
    pub(crate) cursor: usize,
    pub(crate) mode: MainInputMode,
    pub(crate) shell_mode_active: bool,
    pub(crate) file_reference_index: Vec<String>,
    pub(crate) pending_file_reference_index_rx: Option<Receiver<Vec<String>>>,
    pub(crate) file_reference_indexing: bool,
}

impl InputState {
    pub(crate) fn new(file_reference_index_rx: Receiver<Vec<String>>) -> Self {
        Self {
            value: String::new(),
            cursor: 0,
            mode: MainInputMode::Agent,
            shell_mode_active: false,
            file_reference_index: Vec::new(),
            pending_file_reference_index_rx: Some(file_reference_index_rx),
            file_reference_indexing: true,
        }
    }

    pub(crate) fn len_chars(&self) -> usize {
        self.value.chars().count()
    }

    pub(crate) fn cursor_byte_index(&self) -> usize {
        self.value
            .char_indices()
            .nth(self.cursor)
            .map(|(index, _)| index)
            .unwrap_or_else(|| self.value.len())
    }

    pub(crate) fn set_value(&mut self, value: String) {
        self.value = value;
        self.cursor = self.len_chars();
    }
}

#[cfg(test)]
mod tests {
    use super::InputState;
    use std::sync::mpsc;

    #[test]
    fn cursor_byte_index_handles_multibyte_input() {
        let (_tx, rx) = mpsc::channel();
        let mut input = InputState::new(rx);
        input.value = "a你b".to_string();
        input.cursor = 2;

        assert_eq!(input.cursor_byte_index(), "a你".len());
    }

    #[test]
    fn set_value_moves_cursor_to_end() {
        let (_tx, rx) = mpsc::channel();
        let mut input = InputState::new(rx);

        input.set_value("计划".to_string());

        assert_eq!(input.cursor, 2);
    }
}
use super::*;

impl TuiShell {
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

    pub fn can_interrupt_current_turn(&self) -> bool {
        self.runtime.is_busy()
            && !self.runtime.has_pending_tool_approval()
            && self.runtime.pending_aux_state().is_some()
    }

    pub fn can_continue_last_turn(&self) -> bool {
        self.last_turn_can_continue
    }

    pub fn clear_interrupt_escape_arm(&mut self) {
        self.interrupt_escape_armed_at = None;
    }

    pub fn handle_interrupt_escape_key(&mut self, now: Instant) -> bool {
        if !self.can_interrupt_current_turn() {
            self.clear_interrupt_escape_arm();
            return false;
        }

        match self.interrupt_escape_armed_at {
            Some(armed_at) if now.duration_since(armed_at) <= INTERRUPT_ESCAPE_ARM_WINDOW => {
                self.abort_current_turn(true);
            }
            _ => {
                self.ring_failure_bell();
                self.interrupt_escape_armed_at = Some(now);
            }
        }
        true
    }

    pub fn abort_current_turn(&mut self, show_continue_hint: bool) {
        if !self.can_interrupt_current_turn() {
            self.clear_interrupt_escape_arm();
            return;
        }

        self.runtime.abort();
        self.apply_runtime_events();
        self.sync_welcome_mcp_status();
        self.scroll_history_to_bottom();
        self.clear_interrupt_escape_arm();
        self.last_turn_can_continue = true;
        if show_continue_hint {
            self.push_agent_message(t!("tui.continue.after_abort_hint").into_owned());
        }
    }

    fn ring_failure_bell(&self) {
        let mut stderr = io::stderr();
        let _ = stderr.write_all(b"\x07");
        let _ = stderr.flush();
    }

    pub fn submit_input(&mut self) {
        let raw_message = self.input.value.clone();
        let trimmed_message = raw_message.trim();
        if trimmed_message.is_empty() {
            return;
        }

        self.clear_interrupt_escape_arm();

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
            if self.can_interrupt_current_turn() {
                self.abort_current_turn(false);
            } else {
                self.messages.push(ChatMessage {
                    role: MessageRole::Agent,
                    content: t!("tui.busy.pending_reply").into_owned(),
                    tool_block: None,
                });
                return;
            }
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

    pub(super) fn current_input_suggestion_kind(&self) -> Option<InputSuggestionKind> {
        if self.current_file_reference_query().is_some() {
            return Some(InputSuggestionKind::FileReference);
        }
        if self.current_slash_query().is_some() {
            return Some(InputSuggestionKind::Slash);
        }
        None
    }

    pub(super) fn current_slash_query(&self) -> Option<&str> {
        if self.input.shell_mode_active {
            return None;
        }
        slash::current_query(&self.input.value)
    }

    pub(super) fn current_file_reference_query(
        &self,
    ) -> Option<file_reference::ActiveReferenceQuery> {
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

    pub(super) fn set_input(&mut self, value: String) {
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
}
