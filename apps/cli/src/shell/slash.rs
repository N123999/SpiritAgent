//! TUI slash command helpers.

use crate::{
    mcp_types::McpDiscoveredPrompt,
    tui::TuiShell,
    view::InputSuggestion,
};

#[derive(Debug, Default)]
pub(crate) struct SlashState {
    pub(crate) commands: Vec<String>,
    pub(crate) prompt_commands: Vec<PromptSlashCommand>,
    pub(crate) suggestions: Vec<InputSuggestion>,
    pub(crate) selected_suggestion: usize,
}

impl SlashState {
    pub(crate) fn new() -> Self {
        Self {
            commands: default_commands(),
            prompt_commands: Vec::new(),
            suggestions: Vec::new(),
            selected_suggestion: 0,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct PromptSlashCommand {
    pub(crate) alias: String,
    pub(crate) server: String,
    pub(crate) prompt: McpDiscoveredPrompt,
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
        "/create-skill".to_string(),
        "/skills".to_string(),
        "/i-am-skills".to_string(),
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

    suggestions.extend(prompt_alias_suggestions(shell, query));

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
        | "/language" | "/create-skill" | "/i-am-skills" => {
            format!("{} ", command)
        }
        _ => command.to_string(),
    }
}

fn contextual_suggestions(_shell: &mut TuiShell, query: &str) -> Vec<InputSuggestion> {
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

    if query == "/create-skill" || query.starts_with("/create-skill ") {
        return matching_command_suggestions(
            query,
            &[
                "/create-skill",
                "/create-skill repo <skill-name> <需求描述>",
                "/create-skill user <skill-name> <需求描述>",
            ],
        );
    }

    if query == "/skills" || query.starts_with("/skills ") {
        return matching_command_suggestions(query, &["/skills"]);
    }

    if query == "/i-am-skills" || query.starts_with("/i-am-skills") {
        return skill_activation_suggestions(_shell, query);
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

fn skill_activation_suggestions(shell: &mut TuiShell, query: &str) -> Vec<InputSuggestion> {
    if query == "/i-am-skills" {
        return vec![command_suggestion("/i-am-skills")];
    }

    let Some(prefix) = query.strip_prefix("/i-am-skills ") else {
        return Vec::new();
    };

    let prefix = prefix.trim();
    shell
        .enabled_skill_entries()
        .filter(|entry| entry.source.name.starts_with(prefix))
        .map(|entry| InputSuggestion {
            label: format!("/i-am-skills {}", entry.source.name),
            replacement: format!("/i-am-skills {} ", entry.source.name),
            summary: entry.source.description.clone(),
            details: vec![format!("path: {}", entry.source.path.display())],
        })
        .collect()
}

fn prompt_alias_suggestions(shell: &mut TuiShell, query: &str) -> Vec<InputSuggestion> {
    let mut commands = shell.prompt_slash_commands().to_vec();
    commands.retain(|command| command.alias.starts_with(query));
    commands.into_iter().map(prompt_suggestion).collect()
}

pub(crate) fn resolve_prompt_slash_command(
    shell: &TuiShell,
    command: &str,
) -> Option<PromptSlashCommand> {
    let normalized = command.trim();
    shell
        .prompt_slash_commands()
        .iter()
        .cloned()
        .into_iter()
        .find(|candidate| candidate.alias == normalized)
}

pub(crate) fn prompt_slash_alias(server: &str, prompt_name: &str) -> String {
    format!("/{}_{}", server, prompt_name)
}

fn prompt_suggestion(command: PromptSlashCommand) -> InputSuggestion {
    let PromptSlashCommand {
        alias,
        server,
        prompt,
    } = command;
    let replacement = if prompt.arguments.is_empty() {
        alias.clone()
    } else {
        format!("{} ", alias)
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
        label: alias,
        replacement,
        summary,
        details,
    }
}

pub(crate) fn help_text() -> &'static str {
    "可用指令:\n- /help\n- /clear\n- /quit\n- /model [list|use <name>|add <name> <api_base> <api_key>|remove <name>]\n- /compact\n- /sessions\n- /sessions save [path]\n- /sessions load <file>\n- /image <path> [prompt]\n- /image pick\n- /image clear\n- /mcp [list|add|inspect|tools|resources|prompts]\n- /<server>_<prompt> [args_json | user_message]\n- /create-rule [repo|user] <需求描述>\n- /rules\n- /create-skill [repo|user] <skill-name> <需求描述>\n- /skills\n- /i-am-skills <skill-name> [补充说明]\n- /log（或 /log export、/log session export）\n- /language [en|zh-CN]\n\n说明:\n- /sessions 打开已保存会话列表选择器。\n- /image pick 打开当前目录图片选择器。\n- /image 不带 prompt 时会把图片加入待发送队列。\n- 输入 @<文件名> 会打开工作区文件引用建议，回车后会把选中文件写回输入框，格式为 @路径 加一个空格。\n- /mcp add 打开底部表单，用于填写 server 名称、类型、命令或 URL（Enter 保存，Esc 取消）。\n- MCP prompt 会以一级 slash 命令暴露，例如 /github_issue_to_fix_workflow；若尾部是合法 JSON object，会直接作为 prompt 参数，其他文本会作为附加用户消息发给 LLM。\n- 省略尾部且 prompt 定义了参数时，会自动打开参数表单；表单最后一栏可填写附加说明。\n- /create-rule 会走正常 assistant 对话来起草或收紧规则；工作区写入仍走标准工具审批，默认目标是工作区 .spirit/rule.md；同时仍会扫描仓库根 AGENTS.md（兼容其他工具）。\n- /rules 打开可滚动的规则启用清单；Enter 切换当前规则，Esc 保存并关闭，鼠标滚轮可浏览长内容。\n- /create-skill 会走正常 assistant 对话来起草或收紧 SKILL.md；默认目标是工作区 .spirit/skills/<skill-name>/SKILL.md。\n- /skills 打开可滚动的技能启用清单；Enter 切换当前技能，Esc 保存并关闭，鼠标滚轮可浏览长内容。\n- /i-am-skills 用于显式指定一个已启用 skill，并附加本轮任务说明。\n- /mcp tools、/mcp resources、/mcp prompts 在只有一个 server 时可省略 server。\n- /log 默认打开当前 CLI 日志；/log export 导出当前 CLI 日志快照；/log session export 导出 LLM 会话全文与请求轨迹。\n- /language 不带参数时打开语言选择菜单。\n- 鼠标默认开启：滚轮浏览历史；在 Conversation 内拖拽选区，Ctrl+Shift+C 或右键复制后会清除反色选区。\n- Ctrl+O 切换辅助细节的显示/隐藏：包括思考内容、压缩摘要以及工具结果细节；已完成回复的辅助细节也会保留，失败与待确认工具保持展开。\n\nAPI Key 来源优先级: SPIRIT_API_KEY > 模型专属 keyring > 全局 keyring。"
}

pub(crate) fn handle_command(shell: &mut TuiShell, message: &str) {
    if shell.handle_prompt_alias_slash(message) {
        return;
    }

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
        "/create-skill" => shell.handle_create_skill_slash(message),
        "/skills" => shell.handle_skills_slash(&parts[1..]),
        "/i-am-skills" => shell.handle_i_am_skills_slash(message),
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
        assert_eq!(current_query("/github_issue_to_fix_workflow "), Some("/github_issue_to_fix_workflow "));
        assert_eq!(current_query("/mcp\nlist"), None);
        assert_eq!(current_query("hello"), None);
    }

    #[test]
    fn prompt_slash_alias_joins_server_and_prompt_name() {
        assert_eq!(
            prompt_slash_alias("github", "issue_to_fix_workflow"),
            "/github_issue_to_fix_workflow"
        );
    }

    #[test]
    fn help_text_mentions_bottom_form_shortcuts() {
        assert!(help_text().contains("/mcp add"));
        assert!(help_text().contains("/create-rule"));
        assert!(help_text().contains("/rules"));
        assert!(help_text().contains("/create-skill"));
        assert!(help_text().contains("/skills"));
        assert!(help_text().contains("/i-am-skills"));
        assert!(help_text().contains("Enter 保存"));
        assert!(help_text().contains("@<文件名>"));
    }
}
