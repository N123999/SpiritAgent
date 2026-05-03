use super::image_paths::{
    is_supported_image_path, parse_image_path_and_prompt, trim_wrapped_quotes,
};
use super::mcp_actions::{classify_prompt_tail, non_empty_opt, PromptTail};
use super::*;

impl TuiShell {
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
                match self.apply_model_add_and_switch(model, api_base, api_key, None) {
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
                content: t!("tui.user.attached_image", prompt = prompt, path = raw_path)
                    .into_owned(),
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

    pub(crate) fn handle_extensions_slash(&mut self, message: &str) {
        let tail = message
            .strip_prefix("/extensions")
            .map(str::trim)
            .unwrap_or("");
        if tail.is_empty() {
            if let Err(err) = self.refresh_extensions_from_disk() {
                self.push_agent_message(t!("tui.extensions.read_failed", err = err).into_owned());
                return;
            }

            self.open_extensions_form();
            self.push_agent_message(t!("tui.extensions.opened").into_owned());
            return;
        }

        if let Some(query) = tail.strip_prefix("marketplace").map(str::trim) {
            self.open_marketplace_view((!query.is_empty()).then_some(query));
            self.push_agent_message(if query.is_empty() {
                t!("tui.marketplace.opened").into_owned()
            } else {
                t!("tui.marketplace.opened_filtered", query = query).into_owned()
            });
            return;
        }

        let Some(subcommand) = tail.split_whitespace().next() else {
            self.push_agent_message(t!("tui.extensions.usage").into_owned());
            return;
        };

        match subcommand {
            "list" if tail == "list" => match self.refresh_extensions_from_disk() {
                Ok(()) => {
                    self.push_agent_message(format_extension_list_message(self.extension_entries()))
                }
                Err(err) => self
                    .push_agent_message(t!("tui.extensions.read_failed", err = err).into_owned()),
            },
            "import" => {
                let raw_path = tail.strip_prefix("import").map(str::trim).unwrap_or("");
                let archive_path = trim_wrapped_quotes(raw_path);
                if archive_path.is_empty() {
                    self.push_agent_message(t!("tui.extensions.usage").into_owned());
                    return;
                }

                let archive_bytes = match fs::read(archive_path) {
                    Ok(bytes) => bytes,
                    Err(err) => {
                        self.push_agent_message(
                            t!("tui.extensions.import_read_failed", err = err).into_owned(),
                        );
                        return;
                    }
                };

                let file_name = Path::new(archive_path)
                    .file_name()
                    .and_then(|value| value.to_str())
                    .map(|value| value.to_string());

                match self
                    .runtime
                    .import_extension_archive(&archive_bytes, file_name.as_deref())
                {
                    Ok(extension) => {
                        if let Err(err) = self.refresh_extensions_from_disk() {
                            self.push_agent_message(
                                t!("tui.extensions.refresh_failed", err = err).into_owned(),
                            );
                            return;
                        }

                        logging::log_event(&format!(
                            "[extensions] import ok id={} version={}",
                            extension.id, extension.version
                        ));
                        self.push_agent_message(format!(
                            "{}\nid: {}\nversion: {}",
                            t!("tui.extensions.imported", name = extension.display_name),
                            extension.id,
                            extension.version,
                        ));
                    }
                    Err(err) => {
                        logging::log_event(&format!("[extensions] import failed: {}", err));
                        self.push_agent_message(
                            t!("tui.extensions.import_failed", err = err).into_owned(),
                        );
                    }
                }
            }
            "remove" => {
                let id = tail.strip_prefix("remove").map(str::trim).unwrap_or("");
                if id.is_empty() {
                    self.push_agent_message(t!("tui.extensions.usage").into_owned());
                    return;
                }

                match self.runtime.delete_extension(id) {
                    Ok(()) => {
                        if let Err(err) = self.refresh_extensions_from_disk() {
                            self.push_agent_message(
                                t!("tui.extensions.refresh_failed", err = err).into_owned(),
                            );
                            return;
                        }

                        self.push_agent_message(t!("tui.extensions.removed", id = id).into_owned());
                    }
                    Err(err) => {
                        self.push_agent_message(
                            t!("tui.extensions.remove_failed", err = err).into_owned(),
                        );
                    }
                }
            }
            _ => self.push_agent_message(t!("tui.extensions.usage").into_owned()),
        }
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
        let generation_prompt = skills::build_create_skill_user_turn(&workspace_root, &request);
        self.submit_runtime_user_turn(generation_prompt, None);
    }

    pub(crate) fn handle_start_implementing_slash(&mut self) {
        if !self.is_plan_mode_active() {
            self.push_agent_message(t!("tui.plan.start_implementing_only_plan").into_owned());
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

    pub(crate) fn handle_continue_slash(&mut self) {
        if !self.can_continue_last_turn() {
            self.push_agent_message(t!("tui.continue.unavailable").into_owned());
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

        match self.runtime.continue_assistant_completion() {
            Ok(()) => {
                self.last_turn_can_continue = false;
                self.apply_runtime_events();
            }
            Err(err) => {
                self.push_agent_message(t!("tui.continue.failed", err = err).into_owned());
            }
        }
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
            self.push_agent_message(
                t!("tui.skills.activate_missing", name = skill_name).into_owned(),
            );
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
                Ok(prompt_definition) => {
                    match classify_prompt_tail(&prompt_definition, prompt_tail) {
                        PromptTail::ArgsJson(args_json) => {
                            self.apply_mcp_prompt_command(
                                &server,
                                prompt_name,
                                Some(args_json),
                                None,
                            );
                        }
                        PromptTail::UserMessage(user_message)
                            if prompt_definition.arguments.is_empty() =>
                        {
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
                            self.open_mcp_prompt_form(
                                &server,
                                &prompt_definition,
                                Some(user_message),
                            );
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
                    }
                }
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
