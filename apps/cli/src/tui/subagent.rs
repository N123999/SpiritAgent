use super::*;

#[derive(Default)]
pub(crate) struct SubagentUiState {
    pub(crate) picker_active: bool,
    pub(crate) picker_index: usize,
    pub(crate) view: Option<SubagentSessionDetailView>,
    pub(crate) history_offset_from_bottom: usize,
    pub(crate) approval_input: String,
    pub(crate) approval_input_cursor: usize,
    pub(crate) approval_input_active: bool,
}

impl SubagentUiState {
    pub(crate) fn close_view(&mut self) {
        self.view = None;
        self.history_offset_from_bottom = 0;
        self.clear_approval_input();
    }

    pub(crate) fn clear_approval_input(&mut self) {
        self.approval_input.clear();
        self.approval_input_cursor = 0;
        self.approval_input_active = false;
    }
}

impl TuiShell {
    pub(super) fn subagent_summary_view(
        summary: &SubagentSessionSummary,
    ) -> SubagentSessionSummaryView {
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

    pub(super) fn open_subagent_view(&mut self, session_id: &str) {
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

    pub(super) fn refresh_active_subagent_view(&mut self) {
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

    pub(super) fn subagent_approval_input_view(&self) -> Option<SubagentApprovalInputView> {
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

    pub(super) fn sync_subagent_approval_input_state(&mut self) {
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

    pub(super) fn sync_persisted_standalone_pending_aux(&mut self) {
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

    pub(super) fn adjust_persisted_standalone_pending_aux_anchor_for_removed_message(
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
}
