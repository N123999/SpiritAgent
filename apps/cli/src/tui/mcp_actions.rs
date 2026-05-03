use super::*;

impl TuiShell {
    pub(super) fn push_mcp_usage(&mut self) {
        self.messages.push(ChatMessage {
            role: MessageRole::Agent,
            content: "用法:\n- /mcp\n- /mcp list\n- /mcp add\n- /mcp inspect [server]\n- /mcp tools [server]\n- /mcp resources [server]\n- /mcp prompts [server]\n- /<server>_<prompt> [args_json | user_message]\n\n说明:\n- `/mcp add` 会打开底部表单，支持填写 STDIO 或 HTTP server；Enter 保存，Esc 取消。\n- MCP prompt 会作为一级 slash 命令暴露，例如 `/github_issue_to_fix_workflow`。若尾部是合法 JSON object，会直接作为 prompt 参数；其他文本会作为附加用户消息发给 LLM。\n- 省略尾部且 prompt 定义了参数时，会自动打开参数表单；表单最后一栏可填写附加说明。\n- `/mcp tool call`、`/mcp resource attach`、`/mcp resource clear` 仍保留为调试入口，但不作为主交互路径。".to_string(),
            tool_block: None,
        });
    }

    pub(super) fn push_mcp_overview(&mut self) {
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

    pub(super) fn resolve_default_mcp_server(&mut self, purpose: &str) -> Option<String> {
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

    pub(super) fn server_exists(&mut self, name: &str) -> bool {
        self.runtime
            .list_mcp_servers()
            .map(|servers| servers.into_iter().any(|server| server.name == name))
            .unwrap_or(false)
    }

    pub(super) fn sync_welcome_mcp_status(&mut self) {
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

    pub(super) fn refresh_prompt_slash_commands(&mut self, snapshot: &McpStatusSnapshot) {
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
                logging::log_event(&format!("[mcp] refresh prompt slash cache failed: {}", err));
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

    pub(super) fn apply_mcp_prompt_command(
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

    pub(super) fn resolve_mcp_prompt_definition(
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
            if let Some(prompt) = prompts
                .into_iter()
                .find(|prompt| prompt.name == prompt_name)
            {
                return Ok(prompt);
            }
        }

        if let Ok(prompts) = self.runtime.list_cached_mcp_prompts(server) {
            if let Some(prompt) = prompts
                .into_iter()
                .find(|prompt| prompt.name == prompt_name)
            {
                return Ok(prompt);
            }
        }

        Err(anyhow!(
            "MCP server {} 中不存在 prompt {}",
            server,
            prompt_name
        ))
    }
}

pub(super) fn non_empty_opt(input: &str) -> Option<&str> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed)
    }
}

pub(super) enum PromptTail<'a> {
    Empty,
    ArgsJson(&'a str),
    UserMessage(&'a str),
}

pub(super) fn classify_prompt_tail<'a>(
    prompt: &McpDiscoveredPrompt,
    input: &'a str,
) -> PromptTail<'a> {
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
