use super::image_paths::list_local_image_files;
use super::*;

pub(crate) const APPROVAL_LEVEL_OPTIONS: [&str; 2] = ["default", "full-approval"];
pub(crate) const LLM_HTTP_VERSION_OPTIONS: [&str; 2] = ["http1.1", "http2"];

pub(crate) fn llm_http_version_picker_index(current: &str) -> usize {
    if crate::ports::normalize_llm_http_version(current) == "http1.1" {
        0
    } else {
        1
    }
}

pub(crate) fn approval_level_picker_index(current: &str) -> usize {
    if current == "full-approval" {
        1
    } else {
        0
    }
}

impl TuiShell {
    pub fn cancel_model_picker(&mut self) {
        self.model_picker_active = false;
    }

    pub fn cancel_language_picker(&mut self) {
        self.language_picker_active = false;
    }

    pub fn cancel_approval_picker(&mut self) {
        self.approval_picker_active = false;
    }

    pub fn cancel_network_picker(&mut self) {
        self.network_picker_active = false;
    }

    pub fn select_next_model(&mut self) {
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

    pub fn select_next_approval_level(&mut self) {
        self.approval_picker_index =
            (self.approval_picker_index + 1) % APPROVAL_LEVEL_OPTIONS.len();
    }

    pub fn select_next_network_version(&mut self) {
        self.network_picker_index =
            (self.network_picker_index + 1) % LLM_HTTP_VERSION_OPTIONS.len();
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

    pub fn select_prev_approval_level(&mut self) {
        if self.approval_picker_index == 0 {
            self.approval_picker_index = APPROVAL_LEVEL_OPTIONS.len() - 1;
        } else {
            self.approval_picker_index -= 1;
        }
    }

    pub fn select_prev_network_version(&mut self) {
        if self.network_picker_index == 0 {
            self.network_picker_index = LLM_HTTP_VERSION_OPTIONS.len() - 1;
        } else {
            self.network_picker_index -= 1;
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

    pub fn confirm_language_picker(&mut self) {
        let locales = locale::supported_ui_locales();
        let Some(selected) = locales.get(self.language_picker_index).copied() else {
            self.language_picker_active = false;
            return;
        };

        self.switch_ui_locale(selected);
        self.language_picker_active = false;
    }

    pub fn confirm_approval_picker(&mut self) {
        let Some(selected) = APPROVAL_LEVEL_OPTIONS.get(self.approval_picker_index).copied() else {
            self.approval_picker_active = false;
            return;
        };

        match self.runtime.set_approval_level(selected) {
            Ok(()) => self.push_agent_message(
                t!("tui.approval.changed", level = crate::ui::approval_level_label(selected)).into_owned(),
            ),
            Err(err) => self.push_agent_message(t!("tui.approval.failed", err = err).into_owned()),
        }
        self.approval_picker_active = false;
    }

    pub fn confirm_network_picker(&mut self) {
        let Some(selected) = LLM_HTTP_VERSION_OPTIONS.get(self.network_picker_index).copied() else {
            self.network_picker_active = false;
            return;
        };

        self.persist_llm_http_version(selected);
        self.network_picker_active = false;
    }

    pub fn cancel_chat_picker(&mut self) {
        self.chat_picker_active = false;
    }

    pub fn open_subagent_picker(&mut self) {
        self.subagent.picker_active = true;
        self.subagent.picker_index = 0;
    }

    pub fn cancel_subagent_picker(&mut self) {
        self.subagent.picker_active = false;
    }

    pub fn select_next_subagent(&mut self) {
        let total = self.runtime.subagent_sessions().len();
        if total == 0 {
            return;
        }
        self.subagent.picker_index = (self.subagent.picker_index + 1) % total;
    }

    pub fn select_prev_subagent(&mut self) {
        let total = self.runtime.subagent_sessions().len();
        if total == 0 {
            return;
        }
        if self.subagent.picker_index == 0 {
            self.subagent.picker_index = total - 1;
        } else {
            self.subagent.picker_index -= 1;
        }
    }

    pub fn confirm_subagent_picker(&mut self) {
        let Some(summary) = self
            .runtime
            .subagent_sessions()
            .get(self.subagent.picker_index)
            .cloned()
        else {
            self.subagent.picker_active = false;
            return;
        };

        self.subagent.picker_active = false;
        self.open_subagent_view(&summary.session_id);
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

    pub fn add_pending_image_with_feedback(&mut self, path: std::path::PathBuf) {
        if !path.exists() {
            super::logging::log_event(&format!("[clipboard] 图片文件不存在: {}", path.display()));
            return;
        }
        let path_str = path.to_string_lossy().to_string();
        self.runtime.add_pending_image(path_str.clone());
        self.messages.push(super::ChatMessage {
            role: super::MessageRole::Agent,
            content: super::t!(
                "tui.image_picker.added",
                count = self.runtime.session().pending_image_paths().len(),
                path = path_str
            )
            .into_owned(),
            tool_block: None,
        });
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

    pub(super) fn reset_primary_picker_overlay(&mut self) {
        self.exit_rewind_picker_mode();
        self.model_picker_active = false;
        self.language_picker_active = false;
        self.approval_picker_active = false;
        self.network_picker_active = false;
        self.chat_picker_active = false;
        self.image_picker_active = false;
        self.forms.active = None;
        self.set_input(String::new());
        self.refresh_suggestions();
    }

    pub(super) fn open_model_picker(&mut self) {
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
        self.model_display_titles = crate::model_catalog_display::build_model_display_titles(
            &self.runtime.config().models,
        );
        self.reset_primary_picker_overlay();
        self.model_picker_active = true;
    }

    pub(super) fn open_language_picker(&mut self) {
        let current = locale::normalize_ui_locale(rust_i18n::locale().as_ref());
        self.language_picker_index = locale::supported_ui_locales()
            .iter()
            .position(|candidate| *candidate == current)
            .unwrap_or(0);
        self.reset_primary_picker_overlay();
        self.language_picker_active = true;
    }

    pub(super) fn open_approval_picker(&mut self) {
        self.approval_picker_index = approval_level_picker_index(self.runtime.approval_level());
        self.reset_primary_picker_overlay();
        self.approval_picker_active = true;
    }

    pub(super) fn open_network_picker(&mut self) {
        self.network_picker_index =
            llm_http_version_picker_index(&self.runtime.config().networks.llm_http_version);
        self.reset_primary_picker_overlay();
        self.network_picker_active = true;
    }

    pub(super) fn persist_llm_http_version(&mut self, version: &str) {
        let normalized = crate::ports::normalize_llm_http_version(version);
        let mut config = self.runtime.config().clone();
        config.networks.llm_http_version = normalized.clone();
        if let Err(err) = self.config_store.save(&config) {
            self.push_agent_message(
                t!("tui.networks.save_failed", err = err).into_owned(),
            );
            return;
        }
        self.runtime.store_config(config);
        match self.runtime.set_llm_http_version(&normalized) {
            Ok(()) => self.push_agent_message(
                t!(
                    "tui.networks.changed",
                    level = crate::ui::llm_http_version_label(&normalized)
                )
                .into_owned(),
            ),
            Err(err) => {
                self.push_agent_message(t!("tui.networks.failed", err = err).into_owned())
            }
        }
    }

    pub(super) fn open_chat_picker(&mut self) {
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
                self.reset_primary_picker_overlay();
                self.chat_picker_active = true;
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

    pub(super) fn open_image_picker(&mut self) {
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
                self.reset_primary_picker_overlay();
                self.image_picker_active = true;
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
}
