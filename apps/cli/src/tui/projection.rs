use super::*;

impl TuiShell {
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
        let marketplace_view = self.build_marketplace_view_model();

        TuiViewModel {
            input: self.input.value.clone(),
            input_cursor: self.input.cursor,
            input_mode: self.input.mode,
            shell_mode_active: self.input.shell_mode_active,
            pending_image_paths: self.runtime.session().pending_image_paths().to_vec(),
            pending_mcp_resources: self.runtime.session().pending_mcp_resources().to_vec(),
            history_truncated_before,
            messages: visible_messages,
            assistant_aux_by_message,
            config: self.runtime.config().clone(),
            show_aux_details: self.show_aux_details,
            input_suggestion_kind: self.current_input_suggestion_kind(),
            input_suggestion_loading: self.input.file_reference_indexing
                && self.current_file_reference_query().is_some(),
            slash_suggestions: self.slash.suggestions.clone(),
            selected_suggestion: self.slash.selected_suggestion,
            model_picker_active: self.model_picker_active,
            model_picker_index: self.model_picker_index,
            language_picker_active: self.language_picker_active,
            language_picker_index: self.language_picker_index,
            chat_picker_active: self.chat_picker_active,
            chat_picker_index: self.chat_picker_index,
            chat_picker_files: self.chat_picker_files.clone(),
            subagent_picker_active: self.subagent.picker_active,
            subagent_picker_index: self.subagent.picker_index,
            subagent_sessions,
            subagent_view: self.subagent.view.clone(),
            subagent_history_offset_from_bottom: self.subagent.history_offset_from_bottom,
            pending_subagent_approval: self.runtime.pending_subagent_approval(),
            subagent_approval_input: self.subagent_approval_input_view(),
            image_picker_active: self.image_picker_active,
            image_picker_index: self.image_picker_index,
            image_picker_files: self.image_picker_files.clone(),
            bottom_form: self.forms.active.clone(),
            history_offset_from_bottom: self.conversation.history_offset_from_bottom,
            pending_response_active: self.runtime.is_busy(),
            pending_assistant_msg_index: self.pending_assistant_msg_index,
            pending_aux: self.runtime.pending_aux_state(),
            persisted_standalone_pending_aux: self.persisted_standalone_pending_aux.clone(),
            persisted_standalone_pending_aux_anchor: self.persisted_standalone_pending_aux_anchor,
            cli_ui_hooks: self.cli_ui_hooks.clone(),
            marketplace_view,
            conversation_sel_anchor: self.conversation.sel_anchor,
            conversation_sel_head: self.conversation.sel_head,
        }
    }
}
