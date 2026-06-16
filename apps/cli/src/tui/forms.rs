use super::*;
use crate::view::BottomFormView;
use std::path::Path;

fn workspace_hooks_scope_available(workspace_root: &Path, workspace_binding: &str) -> bool {
    if workspace_binding == "none" {
        return false;
    }
    workspace_root.join(".spirit").is_dir() || workspace_root.join(".git").exists()
}

#[derive(Default)]
pub(crate) struct BottomFormUiState {
    pub(crate) active: Option<BottomFormView>,
}

impl TuiShell {
    pub fn is_bottom_form_active(&self) -> bool {
        self.forms.active.is_some()
    }

    pub fn bottom_form_preserves_newline(&self) -> bool {
        self.forms
            .active
            .as_ref()
            .is_some_and(|form| matches!(form.kind, BottomFormKind::McpPrompt { .. }))
    }

    pub fn sync_active_bottom_form_scroll(&mut self, scroll_offset: usize) {
        if let Some(form) = self.forms.active.as_mut() {
            form.scroll_offset = scroll_offset;
        }
    }

    pub fn scroll_active_bottom_form_up(&mut self, lines: usize) -> bool {
        let Some(form) = self.forms.active.as_mut() else {
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
        let Some(form) = self.forms.active.as_mut() else {
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

    pub fn cancel_bottom_form(&mut self) {
        self.forms.active = None;
    }

    pub fn dismiss_bottom_form(&mut self) {
        let Some(kind) = self.forms.active.as_ref().map(|form| form.kind.clone()) else {
            return;
        };

        match kind {
            BottomFormKind::AskQuestions { .. } => {
                self.complete_ask_questions_form(ask_questions::dismiss_result());
            }
            BottomFormKind::McpAdd
            | BottomFormKind::ModelAdd
            | BottomFormKind::HookAdd
            | BottomFormKind::McpPrompt { .. }
            | BottomFormKind::Extensions => self.cancel_bottom_form(),
            BottomFormKind::Rules => self.save_rules_bottom_form(),
            BottomFormKind::Skills => self.save_skills_bottom_form(),
        }
    }

    pub fn select_next_bottom_form_field(&mut self) {
        let Some(form) = self.forms.active.as_mut() else {
            return;
        };
        if matches!(form.kind, BottomFormKind::AskQuestions { .. }) {
            ask_questions::select_next_row(form);
            return;
        }
        bottom_form::select_next_field(form);
    }

    pub fn select_prev_bottom_form_field(&mut self) {
        let Some(form) = self.forms.active.as_mut() else {
            return;
        };
        if matches!(form.kind, BottomFormKind::AskQuestions { .. }) {
            ask_questions::select_prev_row(form);
            return;
        }
        bottom_form::select_prev_field(form);
    }

    pub fn bottom_form_move_left(&mut self) {
        let Some(form) = self.forms.active.as_mut() else {
            return;
        };
        if matches!(form.kind, BottomFormKind::AskQuestions { .. }) {
            ask_questions::move_left(form);
            return;
        }
        bottom_form::move_left(form);
    }

    pub fn bottom_form_move_right(&mut self) {
        let Some(form) = self.forms.active.as_mut() else {
            return;
        };
        if matches!(form.kind, BottomFormKind::AskQuestions { .. }) {
            ask_questions::move_right(form);
            return;
        }
        bottom_form::move_right(form);
    }

    pub fn bottom_form_move_home(&mut self) {
        let Some(form) = self.forms.active.as_mut() else {
            return;
        };
        if matches!(form.kind, BottomFormKind::AskQuestions { .. }) {
            ask_questions::move_home(form);
            return;
        }
        bottom_form::move_home(form);
    }

    pub fn bottom_form_move_end(&mut self) {
        let Some(form) = self.forms.active.as_mut() else {
            return;
        };
        if matches!(form.kind, BottomFormKind::AskQuestions { .. }) {
            ask_questions::move_end(form);
            return;
        }
        bottom_form::move_end(form);
    }

    pub fn bottom_form_insert_char(&mut self, ch: char) {
        let Some(form) = self.forms.active.as_mut() else {
            return;
        };
        if matches!(form.kind, BottomFormKind::AskQuestions { .. }) {
            ask_questions::insert_char(form, ch);
            return;
        }
        bottom_form::insert_char(form, ch);
    }

    pub fn bottom_form_insert_text(&mut self, text: &str) {
        let Some(form) = self.forms.active.as_mut() else {
            return;
        };
        if matches!(form.kind, BottomFormKind::AskQuestions { .. }) {
            ask_questions::insert_text(form, text);
            return;
        }
        bottom_form::insert_text(form, text);
    }

    pub fn bottom_form_backspace(&mut self) {
        let Some(form) = self.forms.active.as_mut() else {
            return;
        };
        if matches!(form.kind, BottomFormKind::AskQuestions { .. }) {
            ask_questions::backspace(form);
            return;
        }
        bottom_form::backspace(form);
    }

    pub fn bottom_form_delete(&mut self) {
        let Some(form) = self.forms.active.as_mut() else {
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
        let Some(kind) = self.forms.active.as_ref().map(|form| form.kind.clone()) else {
            return;
        };

        match kind {
            BottomFormKind::AskQuestions { .. } => {
                if let Some(form) = self.forms.active.as_mut() {
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
            BottomFormKind::HookAdd => {
                let should_toggle = self
                    .forms
                    .active
                    .as_ref()
                    .is_some_and(bottom_form::hook_add_form_enter_toggles_checkbox);
                if should_toggle {
                    if let Some(form) = self.forms.active.as_mut() {
                        bottom_form::activate(form);
                    }
                } else {
                    self.save_bottom_form();
                }
            }
            BottomFormKind::McpPrompt { .. } => self.apply_prompt_bottom_form(),
            BottomFormKind::Rules => {
                if let Some(form) = self.forms.active.as_mut() {
                    bottom_form::activate(form);
                }
            }
            BottomFormKind::Skills => {
                if let Some(form) = self.forms.active.as_mut() {
                    bottom_form::activate(form);
                }
            }
            BottomFormKind::Extensions => {
                if let Some(form) = self.forms.active.as_mut() {
                    bottom_form::activate(form);
                }
            }
        }
    }

    pub fn save_bottom_form(&mut self) {
        let Some(form) = self.forms.active.as_ref() else {
            return;
        };

        if matches!(form.kind, BottomFormKind::HookAdd) {
            match bottom_form::to_hook_save_request(form) {
                Ok(request) => match self
                    .runtime
                    .save_hook_entry(Some(self.workspace_binding.as_str()), &request)
                {
                    Ok(()) => {
                        self.messages.push(ChatMessage {
                            role: MessageRole::Agent,
                            content: t!("tui.hooks.add_saved").into_owned(),
                            tool_block: None,
                        });
                        self.forms.active = None;
                    }
                    Err(err) => {
                        self.messages.push(ChatMessage {
                            role: MessageRole::Agent,
                            content: t!("tui.hooks.add_failed", err = err).into_owned(),
                            tool_block: None,
                        });
                    }
                },
                Err(err) => {
                    self.messages.push(ChatMessage {
                        role: MessageRole::Agent,
                        content: t!("tui.hooks.add_failed", err = err).into_owned(),
                        tool_block: None,
                    });
                }
            }
            return;
        }

        if matches!(form.kind, BottomFormKind::ModelAdd) {
            let parsed = match bottom_form::parse_model_add_connection(form) {
                Ok(v) => v,
                Err(err) => {
                    self.messages.push(ChatMessage {
                        role: MessageRole::Agent,
                        content: t!("tui.model_add.validation_failed", err = err).into_owned(),
                        tool_block: None,
                    });
                    return;
                }
            };
            self.forms.active = None;

            if parsed.bulk {
                match openai_models_list::list_model_ids(
                    parsed.api_base.as_str(),
                    parsed.api_key.as_str(),
                    parsed.transport_kind,
                ) {
                    Ok(ids) => match self.apply_model_add_bulk(&ids, &parsed) {
                        Ok(msg) => {
                            self.messages.push(ChatMessage {
                                role: MessageRole::Agent,
                                content: msg,
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
                    },
                    Err(err) => {
                        self.messages.push(ChatMessage {
                            role: MessageRole::Agent,
                            content: t!("tui.model_add.fetch_failed", err = err).into_owned(),
                            tool_block: None,
                        });
                    }
                }
            } else {
                let name = parsed
                    .model_name
                    .as_ref()
                    .expect("parse_model_add_connection sets name when not bulk");
                match self.apply_model_add_and_switch(
                    name.as_str(),
                    parsed.api_base.as_str(),
                    parsed.api_key.as_str(),
                    Some(parsed.provider),
                    parsed.transport_kind,
                    parsed.context_length,
                    parsed.azure_resource_name.as_deref(),
                ) {
                    Ok(()) => {
                        self.messages.push(ChatMessage {
                            role: MessageRole::Agent,
                            content: t!("tui.model_add.saved", name = name).into_owned(),
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
            return;
        }

        match bottom_form::to_config(form) {
            Ok((server_name, scope, config)) => {
                match self.runtime.add_mcp_server(scope, &server_name, config) {
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
                        self.forms.active = None;
                        self.sync_welcome_mcp_status();
                    }
                    Err(err) => {
                        self.messages.push(ChatMessage {
                            role: MessageRole::Agent,
                            content: t!("tui.bottom_form.add_failed", err = err).into_owned(),
                            tool_block: None,
                        });
                    }
                }
            }
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
        let Some(form) = self.forms.active.as_ref() else {
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
                    self.forms.active = None;
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
        let Some(form) = self.forms.active.as_ref() else {
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
                    self.forms.active = None;
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

    fn apply_model_add_bulk(
        &mut self,
        ids: &[String],
        parsed: &bottom_form::ParsedModelAddForm,
    ) -> Result<String, String> {
        if ids.is_empty() {
            return Err(t!("tui.model_add.list_empty").into_owned());
        }

        let mut config = self.runtime.config().clone();
        let mut first_new: Option<String> = None;
        let mut added: usize = 0;

        for id in ids {
            if config.has_model(id) {
                continue;
            }
            let mut extra = serde_json::Map::new();
            if parsed.transport_kind == crate::model_registry::ModelTransportKind::Anthropic
                || parsed.transport_kind == crate::model_registry::ModelTransportKind::OpenResponses
            {
                extra.insert(
                    "transportKind".to_string(),
                    serde_json::json!(parsed.transport_kind.as_str()),
                );
            }
            config.add_model(ModelProfile {
                name: id.clone(),
                api_base: parsed.api_base.clone(),
                provider: Some(parsed.provider),
                reasoning_effort: None,
                context_length: None,
                extra,
            });
            if let Err(err) = self
                .secret_store
                .save_model_api_key(id, parsed.api_key.as_str())
            {
                return Err(t!("tui.model_add.key_save_failed", err = err.to_string()).into_owned());
            }
            added += 1;
            if first_new.is_none() {
                first_new = Some(id.clone());
            }
        }

        if added == 0 {
            return Err(t!("tui.model_add.all_duplicates").into_owned());
        }

        let active = first_new.expect("added > 0");
        config.active_model = active.clone();

        if let Err(err) = self.runtime.validate_config_change(&config) {
            return Err(err.to_string());
        }

        if let Err(err) = self.config_store.save(&config) {
            return Err(t!("tui.model_add.config_save_failed", err = err.to_string()).into_owned());
        }

        self.runtime.replace_config(config);
        self.apply_runtime_events();
        Ok(t!(
            "tui.model_add.bulk_saved",
            count = added,
            name = active.as_str()
        )
        .into_owned())
    }

    pub(super) fn open_hook_add_form(&mut self) {
        let workspace_root = self.app_paths.workspace_root();
        let workspace_scope_available = workspace_hooks_scope_available(
            &workspace_root,
            self.workspace_binding.as_str(),
        );
        self.forms.active = Some(bottom_form::new_hook_add_form(workspace_scope_available));
        self.model_picker_active = false;
        self.language_picker_active = false;
        self.approval_picker_active = false;
        self.network_picker_active = false;
        self.chat_picker_active = false;
        self.image_picker_active = false;
        self.set_input(String::new());
        self.refresh_suggestions();
        self.messages.push(ChatMessage {
            role: MessageRole::Agent,
            content: t!("tui.hooks.add_opened").into_owned(),
            tool_block: None,
        });
    }

    pub(super) fn open_mcp_add_form(&mut self) {
        self.forms.active = Some(bottom_form::new_mcp_add_form());
        self.model_picker_active = false;
        self.language_picker_active = false;
        self.approval_picker_active = false;
        self.network_picker_active = false;
        self.chat_picker_active = false;
        self.image_picker_active = false;
        self.set_input(String::new());
        self.refresh_suggestions();
    }

    pub(super) fn open_model_add_form(&mut self) {
        self.forms.active = Some(bottom_form::new_model_add_form());
        self.model_picker_active = false;
        self.language_picker_active = false;
        self.approval_picker_active = false;
        self.network_picker_active = false;
        self.chat_picker_active = false;
        self.image_picker_active = false;
        self.set_input(String::new());
        self.refresh_suggestions();
    }

    pub(super) fn open_ask_questions_form(
        &mut self,
        tool_call_id: String,
        tool_name: String,
        questions: crate::ask_questions::AskQuestionsRequest,
    ) {
        self.forms.active = Some(ask_questions::new_form(tool_call_id, tool_name, questions));
        self.model_picker_active = false;
        self.language_picker_active = false;
        self.approval_picker_active = false;
        self.network_picker_active = false;
        self.chat_picker_active = false;
        self.image_picker_active = false;
        self.set_input(String::new());
        self.refresh_suggestions();
        self.scroll_history_to_bottom();
    }

    fn complete_ask_questions_form(&mut self, result: AskQuestionsResult) {
        let Some(form) = self.forms.active.take() else {
            return;
        };
        let BottomFormKind::AskQuestions {
            tool_call_id,
            tool_name,
            request,
            ..
        } = form.kind
        else {
            self.forms.active = Some(form);
            return;
        };

        let request_value = ToolUiRequest::new(
            "ask_questions",
            serde_json::json!({
                "title": request.title,
                "questionCount": request.questions.len(),
            }),
        );
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

    pub(super) fn open_mcp_prompt_form(
        &mut self,
        server: &str,
        prompt: &McpDiscoveredPrompt,
        initial_user_message: Option<&str>,
    ) {
        self.forms.active = Some(bottom_form::new_mcp_prompt_form(
            server,
            prompt,
            initial_user_message,
        ));
        self.model_picker_active = false;
        self.language_picker_active = false;
        self.approval_picker_active = false;
        self.network_picker_active = false;
        self.chat_picker_active = false;
        self.image_picker_active = false;
        self.set_input(String::new());
        self.refresh_suggestions();
    }

    pub fn open_rules_form(&mut self) {
        self.close_marketplace_view();
        self.forms.active = Some(bottom_form::new_rules_form(&self.rule_entries));
        self.model_picker_active = false;
        self.language_picker_active = false;
        self.approval_picker_active = false;
        self.network_picker_active = false;
        self.chat_picker_active = false;
        self.image_picker_active = false;
        self.set_input(String::new());
        self.refresh_suggestions();
    }

    pub fn open_skills_form(&mut self) {
        self.close_marketplace_view();
        self.forms.active = Some(bottom_form::new_skills_form(&self.skill_entries));
        self.model_picker_active = false;
        self.language_picker_active = false;
        self.approval_picker_active = false;
        self.network_picker_active = false;
        self.chat_picker_active = false;
        self.image_picker_active = false;
        self.set_input(String::new());
        self.refresh_suggestions();
    }

    pub fn open_extensions_form(&mut self) {
        self.close_marketplace_view();
        self.forms.active = Some(bottom_form::new_extensions_form(&self.extension_entries));
        self.model_picker_active = false;
        self.language_picker_active = false;
        self.approval_picker_active = false;
        self.network_picker_active = false;
        self.chat_picker_active = false;
        self.image_picker_active = false;
        self.set_input(String::new());
        self.refresh_suggestions();
    }

    fn apply_prompt_bottom_form(&mut self) {
        let Some(form) = self.forms.active.as_ref() else {
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
                    self.forms.active = None;
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
}

#[cfg(test)]
mod hook_scope_tests {
    use super::workspace_hooks_scope_available;
    use std::fs;

    #[test]
    fn workspace_hooks_scope_respects_none_binding() {
        let root = std::env::temp_dir().join(format!(
            "spirit-hook-scope-none-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join(".git")).expect("create .git");
        assert!(!workspace_hooks_scope_available(&root, "none"));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn workspace_hooks_scope_allows_project_with_markers() {
        let root = std::env::temp_dir().join(format!(
            "spirit-hook-scope-project-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join(".spirit")).expect("create .spirit");
        assert!(workspace_hooks_scope_available(&root, "project"));
        let _ = fs::remove_dir_all(&root);
    }
}
