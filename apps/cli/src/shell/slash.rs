//! TUI slash command helpers.

use crate::{
    mcp_types::{ManagedMcpServer, McpDiscoveredPrompt},
    tui::TuiShell,
    view::InputSuggestion,
};

#[derive(Debug, Default)]
pub(crate) struct SlashState {
    pub(crate) commands: Vec<String>,
    pub(crate) suggestions: Vec<InputSuggestion>,
    pub(crate) selected_suggestion: usize,
}

impl SlashState {
    pub(crate) fn new() -> Self {
        Self {
            commands: default_commands(),
            suggestions: Vec::new(),
            selected_suggestion: 0,
        }
    }
}

#[derive(Debug, PartialEq, Eq)]
enum McpPromptSuggestionStage {
    NeedServer { prefix: String },
    NeedPrompt {
        server: String,
        prefix: String,
        omit_server: bool,
    },
}

pub(crate) fn default_commands() -> Vec<String> {
    vec![
        "/help".to_string(),
        "/clear".to_string(),
        "/quit".to_string(),
        "/exit".to_string(),
        "/model".to_string(),
        "/compact".to_string(),
        "/sessions".to_string(),
        "/image".to_string(),
        "/mcp".to_string(),
        "/create-rule".to_string(),
        "/rules".to_string(),
        "/log".to_string(),
        "/language".to_string(),
    ]
}

pub(crate) fn current_query(input: &str) -> Option<&str> {
    if !input.starts_with('/') || input.contains('\n') {
        return None;
    }
    Some(input)
}

pub(crate) fn compute_suggestions(
    shell: &mut TuiShell,
    query: &str,
    slash_commands: &[String],
) -> Vec<InputSuggestion> {
    let mut suggestions = slash_commands
        .iter()
        .filter(|cmd| cmd.starts_with(query))
        .map(|cmd| command_suggestion(cmd))
        .collect::<Vec<_>>();

    if suggestions.is_empty() {
        suggestions = contextual_suggestions(shell, query);
    }

    suggestions
}

fn command_suggestion(command: &str) -> InputSuggestion {
    InputSuggestion {
        label: command.to_string(),
        replacement: command_replacement(command),
        summary: String::new(),
        details: Vec::new(),
    }
}

fn command_replacement(command: &str) -> String {
    match command {
        "/model" | "/sessions" | "/image" | "/mcp" | "/create-rule" | "/log"
        | "/language" | "/mcp prompt" => {
            format!("{} ", command)
        }
        _ => command.to_string(),
    }
}

fn contextual_suggestions(shell: &mut TuiShell, query: &str) -> Vec<InputSuggestion> {
    if query == "/model" || query.starts_with("/model ") {
        return matching_command_suggestions(
            query,
            &["/model", "/model list", "/model use", "/model add", "/model remove"],
        );
    }

    if query == "/sessions" || query.starts_with("/sessions ") {
        return matching_command_suggestions(
            query,
            &[
                "/sessions",
                "/sessions save",
                "/sessions save <path>",
                "/sessions load <file>",
            ],
        );
    }

    if query == "/image" || query.starts_with("/image ") {
        return matching_command_suggestions(
            query,
            &["/image", "/image pick", "/image clear", "/image <path> [prompt]"],
        );
    }

    if query == "/mcp prompt" || query.starts_with("/mcp prompt ") {
        let suggestions = mcp_prompt_suggestions(shell, query);
        if !suggestions.is_empty() {
            return suggestions;
        }
    }

    if query == "/mcp" || query.starts_with("/mcp ") {
        return matching_command_suggestions(
            query,
            &[
                "/mcp",
                "/mcp list",
                "/mcp add",
                "/mcp inspect",
                "/mcp tools",
                "/mcp resources",
                "/mcp prompts",
                "/mcp prompt",
            ],
        );
    }

    if query == "/create-rule" || query.starts_with("/create-rule ") {
        return matching_command_suggestions(
            query,
            &[
                "/create-rule",
                "/create-rule repo <需求描述>",
                "/create-rule user <需求描述>",
            ],
        );
    }

    if query == "/rules" || query.starts_with("/rules ") {
        return matching_command_suggestions(query, &["/rules"]);
    }

    if query == "/log" || query.starts_with("/log ") {
        return matching_command_suggestions(query, &["/log", "/log export", "/log session export"]);
    }

    if query == "/language" || query.starts_with("/language ") {
        return matching_command_suggestions(query, &["/language", "/language en", "/language zh-CN"]);
    }

    Vec::new()
}

fn matching_command_suggestions(query: &str, candidates: &[&str]) -> Vec<InputSuggestion> {
    candidates
        .iter()
        .copied()
        .filter(|candidate| candidate.starts_with(query))
        .map(command_suggestion)
        .collect()
}

fn mcp_prompt_suggestions(shell: &mut TuiShell, query: &str) -> Vec<InputSuggestion> {
    let Ok(prompt_servers) = shell.list_prompt_capable_mcp_servers() else {
        return Vec::new();
    };
    if prompt_servers.is_empty() {
        return Vec::new();
    }

    let server_names = prompt_servers
        .iter()
        .map(|server| server.name.clone())
        .collect::<Vec<_>>();

    let Some(stage) = parse_mcp_prompt_stage(query, &server_names) else {
        return Vec::new();
    };

    match stage {
        McpPromptSuggestionStage::NeedServer { prefix } => prompt_servers
            .into_iter()
            .filter(|server| server.name.starts_with(prefix.as_str()))
            .map(server_prompt_suggestion)
            .collect(),
        McpPromptSuggestionStage::NeedPrompt {
            server,
            prefix,
            omit_server,
        } => {
            let Ok(prompts) = shell.list_cached_mcp_prompts_for_suggestions(&server) else {
                return Vec::new();
            };
            prompts
                .into_iter()
                .filter(|prompt| prompt.name.starts_with(prefix.as_str()))
                .map(|prompt| prompt_suggestion(&server, prompt, omit_server))
                .collect()
        }
    }
}

fn server_prompt_suggestion(server: ManagedMcpServer) -> InputSuggestion {
    let summary = if server.display_name == server.name {
        "MCP server".to_string()
    } else {
        server.display_name.clone()
    };

    InputSuggestion {
        label: format!("/mcp prompt {}", server.name),
        replacement: format!("/mcp prompt {} ", server.name),
        summary,
        details: vec![format!("选择 MCP server: {}", server.name)],
    }
}

fn prompt_suggestion(
    server: &str,
    prompt: McpDiscoveredPrompt,
    omit_server: bool,
) -> InputSuggestion {
    let replacement = if omit_server {
        format!("/mcp prompt {} ", prompt.name)
    } else {
        format!("/mcp prompt {} {} ", server, prompt.name)
    };

    let required_args = prompt
        .arguments
        .iter()
        .filter(|argument| argument.required)
        .map(|argument| argument.name.clone())
        .collect::<Vec<_>>();
    let summary = prompt
        .description
        .clone()
        .or_else(|| prompt.title.clone())
        .unwrap_or_else(|| {
            if prompt.arguments.is_empty() {
                "MCP prompt".to_string()
            } else {
                format!("{} 个参数", prompt.arguments.len())
            }
        });

    let mut details = vec![format!("server: {}", server)];
    if !required_args.is_empty() {
        details.push(format!("必填参数: {}", required_args.join(", ")));
    } else if !prompt.arguments.is_empty() {
        details.push(format!("可选参数: {} 个", prompt.arguments.len()));
    }

    InputSuggestion {
        label: replacement.trim_end().to_string(),
        replacement,
        summary,
        details,
    }
}

fn parse_mcp_prompt_stage(
    query: &str,
    server_names: &[String],
) -> Option<McpPromptSuggestionStage> {
    let tail = query.strip_prefix("/mcp prompt")?;
    let trailing_space = query.ends_with(' ');
    let tokens = tail
        .trim_start()
        .split_whitespace()
        .filter(|token| !token.is_empty())
        .collect::<Vec<_>>();

    let implicit_server = (server_names.len() == 1).then(|| server_names[0].clone());

    if let Some(server) = implicit_server {
        return match tokens.as_slice() {
            [] => Some(McpPromptSuggestionStage::NeedPrompt {
                server,
                prefix: String::new(),
                omit_server: true,
            }),
            [prompt_prefix] if !trailing_space => Some(McpPromptSuggestionStage::NeedPrompt {
                server,
                prefix: (*prompt_prefix).to_string(),
                omit_server: true,
            }),
            _ => None,
        };
    }

    match tokens.as_slice() {
        [] => Some(McpPromptSuggestionStage::NeedServer {
            prefix: String::new(),
        }),
        [server_prefix] => {
            if trailing_space && server_names.iter().any(|name| name == server_prefix) {
                Some(McpPromptSuggestionStage::NeedPrompt {
                    server: (*server_prefix).to_string(),
                    prefix: String::new(),
                    omit_server: false,
                })
            } else {
                Some(McpPromptSuggestionStage::NeedServer {
                    prefix: (*server_prefix).to_string(),
                })
            }
        }
        [server_name, prompt_prefix] if !trailing_space => server_names
            .iter()
            .any(|name| name == server_name)
            .then(|| McpPromptSuggestionStage::NeedPrompt {
                server: (*server_name).to_string(),
                prefix: (*prompt_prefix).to_string(),
                omit_server: false,
            }),
        _ => None,
    }
}

pub(crate) fn help_text() -> &'static str {
    "可用指令:\n- /help\n- /clear\n- /quit\n- /model [list|use <name>|add <name> <api_base> <api_key>|remove <name>]\n- /compact\n- /sessions\n- /sessions save [path]\n- /sessions load <file>\n- /image <path> [prompt]\n- /image pick\n- /image clear\n- /mcp [list|add|inspect|tools|resources|prompts]\n- /create-rule [repo|user] <需求描述>\n- /rules\n- /log（或 /log export、/log session export）\n- /language [en|zh-CN]\n\n说明:\n- /sessions 打开已保存会话列表选择器。\n- /image pick 打开当前目录图片选择器。\n- /image 不带 prompt 时会把图片加入待发送队列。\n- 输入 @<文件名> 会打开工作区文件引用建议，回车后会把选中文件写回输入框，格式为 @路径 加一个空格。\n- /mcp add 打开底部表单，用于填写 server 名称、类型、命令或 URL（Enter 保存，Esc 取消）。\n- /create-rule 会走正常 assistant 对话来起草或收紧规则；工作区写入仍走标准工具审批，默认目标是工作区 AGENTS.md。\n- /rules 打开可滚动的规则启用清单；Enter 切换当前规则，Esc 保存并关闭，鼠标滚轮可浏览长内容。\n- /mcp tools、/mcp resources、/mcp prompts 在只有一个 server 时可省略 server。\n- /log 默认打开当前 CLI 日志；/log export 导出当前 CLI 日志快照；/log session export 导出 LLM 会话全文与请求轨迹。\n- /language 不带参数时打开语言选择菜单。\n- 鼠标默认开启：滚轮浏览历史；在 Conversation 内拖拽选区，Ctrl+Shift+C 或右键复制后会清除反色选区。\n- Ctrl+O 切换辅助细节的显示/隐藏：包括思考内容、压缩摘要以及工具结果细节；已完成回复的辅助细节也会保留，失败与待确认工具保持展开。\n\nAPI Key 来源优先级: SPIRIT_API_KEY > 模型专属 keyring > 全局 keyring。"
}

pub(crate) fn handle_command(shell: &mut TuiShell, message: &str) {
    let parts: Vec<&str> = message.split_whitespace().collect();
    let Some(cmd) = parts.first().copied() else {
        return;
    };

    match cmd {
        "/quit" | "/exit" => {
            shell.push_agent_message("收到，Spirit Agent 即将退出。");
            shell.request_quit();
        }
        "/help" => shell.push_agent_message(help_text()),
        "/clear" => shell.clear_chat_for_slash(),
        "/model" => shell.handle_model_slash(&parts[1..]),
        "/compact" => shell.compact_history_for_slash(),
        "/sessions" => shell.handle_sessions_slash(message),
        "/image" => shell.handle_image_slash(message),
        "/mcp" => shell.handle_mcp_slash(message),
        "/create-rule" => shell.handle_create_rule_slash(message),
        "/rules" => shell.handle_rules_slash(&parts[1..]),
        "/log" => shell.handle_log_slash(&parts[1..]),
        "/language" => shell.handle_language_slash(&parts[1..]),
        _ => shell.push_agent_message("未知斜杠命令，输入 /help 查看可用指令。"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn current_query_rejects_multiline_input_and_preserves_trailing_space() {
        assert_eq!(current_query("/mcp list"), Some("/mcp list"));
        assert_eq!(current_query("/mcp prompt github "), Some("/mcp prompt github "));
        assert_eq!(current_query("/mcp\nlist"), None);
        assert_eq!(current_query("hello"), None);
    }

    #[test]
    fn parse_mcp_prompt_stage_requires_server_when_multiple_servers_exist() {
        let stage = parse_mcp_prompt_stage(
            "/mcp prompt git",
            &["github".to_string(), "notion".to_string()],
        );

        assert_eq!(
            stage,
            Some(McpPromptSuggestionStage::NeedServer {
                prefix: "git".to_string(),
            })
        );
    }

    #[test]
    fn parse_mcp_prompt_stage_switches_to_prompt_after_server_space() {
        let stage = parse_mcp_prompt_stage(
            "/mcp prompt github ",
            &["github".to_string(), "notion".to_string()],
        );

        assert_eq!(
            stage,
            Some(McpPromptSuggestionStage::NeedPrompt {
                server: "github".to_string(),
                prefix: String::new(),
                omit_server: false,
            })
        );
    }

    #[test]
    fn parse_mcp_prompt_stage_supports_single_server_implicit_prompt_lookup() {
        let stage = parse_mcp_prompt_stage(
            "/mcp prompt ass",
            &["github".to_string()],
        );

        assert_eq!(
            stage,
            Some(McpPromptSuggestionStage::NeedPrompt {
                server: "github".to_string(),
                prefix: "ass".to_string(),
                omit_server: true,
            })
        );
    }

    #[test]
    fn help_text_mentions_bottom_form_shortcuts() {
        assert!(help_text().contains("/mcp add"));
        assert!(help_text().contains("/create-rule"));
        assert!(help_text().contains("/rules"));
        assert!(help_text().contains("Enter 保存"));
        assert!(help_text().contains("@<文件名>"));
    }
}
