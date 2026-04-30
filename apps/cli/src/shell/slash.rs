//! TUI slash command helpers.

use crate::{
    mcp_types::McpDiscoveredPrompt,
    tui::TuiShell,
    view::{InputSuggestion, MainInputMode},
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

const DEFAULT_SLASH_COMMANDS: &[&str] = &[
    "/help",
    "/clear",
    "/quit",
    "/exit",
    "/start-implementing",
    "/model",
    "/compact",
    "/sessions",
    "/subagents",
    "/image",
    "/mcp",
    "/create-rule",
    "/rules",
    "/create-skill",
    "/skills",
    "/extensions",
    "/log",
    "/language",
];

const RESERVED_SLASH_COMMANDS: &[&str] = &[
    "/help",
    "/clear",
    "/quit",
    "/exit",
    "/start-implementing",
    "/model",
    "/compact",
    "/sessions",
    "/subagents",
    "/image",
    "/mcp",
    "/create-rule",
    "/rules",
    "/create-skill",
    "/skills",
    "/extensions",
    "/log",
    "/language",
];

pub(crate) fn default_commands() -> Vec<String> {
    DEFAULT_SLASH_COMMANDS
        .iter()
        .map(|command| (*command).to_string())
        .collect()
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
        .filter(|cmd| command_visible_in_mode(cmd, shell.input_mode()))
        .filter(|cmd| cmd.starts_with(query))
        .map(|cmd| command_suggestion(cmd))
        .collect::<Vec<_>>();

    suggestions.extend(prompt_alias_suggestions(shell, query));
    suggestions.extend(skill_alias_suggestions(shell, query));

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
        "/model" | "/sessions" | "/subagents" | "/image" | "/mcp" | "/create-rule" | "/log"
        | "/language" | "/create-skill" | "/extensions" => {
            format!("{} ", command)
        }
        _ => command.to_string(),
    }
}

/// When the user continues past the primary slash command (e.g. `/model add …`), top-level
/// [`slash_commands`] no longer prefix-match, so we fall back here. We intentionally return a
/// **single** suggestion whose `label` is the primary command (e.g. `/model`) so the TUI can show
/// the static usage block (`ui.rs` only renders it when there is exactly one slash suggestion).
/// `replacement` preserves the full query so applying the suggestion does not erase typed args.
fn primary_help_suggestion(primary: &str, query: &str) -> InputSuggestion {
    InputSuggestion {
        label: primary.to_string(),
        replacement: query.to_string(),
        summary: String::new(),
        details: Vec::new(),
    }
}

fn contextual_suggestions(shell: &mut TuiShell, query: &str) -> Vec<InputSuggestion> {
    if query == "/model" || query.starts_with("/model ") {
        return vec![primary_help_suggestion("/model", query)];
    }

    if command_visible_in_mode("/start-implementing", shell.input_mode())
        && (query == "/start-implementing" || query.starts_with("/start-implementing "))
    {
        return vec![primary_help_suggestion("/start-implementing", query)];
    }

    if query == "/sessions" || query.starts_with("/sessions ") {
        return vec![primary_help_suggestion("/sessions", query)];
    }

    if query == "/subagents" || query.starts_with("/subagents ") {
        return vec![primary_help_suggestion("/subagents", query)];
    }

    if query == "/image" || query.starts_with("/image ") {
        return vec![primary_help_suggestion("/image", query)];
    }

    if query == "/mcp" || query.starts_with("/mcp ") {
        return vec![primary_help_suggestion("/mcp", query)];
    }

    if query == "/create-rule" || query.starts_with("/create-rule ") {
        return vec![primary_help_suggestion("/create-rule", query)];
    }

    if query == "/rules" || query.starts_with("/rules ") {
        return vec![primary_help_suggestion("/rules", query)];
    }

    if query == "/create-skill" || query.starts_with("/create-skill ") {
        return vec![primary_help_suggestion("/create-skill", query)];
    }

    if query == "/skills" || query.starts_with("/skills ") {
        return vec![primary_help_suggestion("/skills", query)];
    }

    if query == "/extensions" || query.starts_with("/extensions ") {
        return vec![primary_help_suggestion("/extensions", query)];
    }

    if query == "/log" || query.starts_with("/log ") {
        return vec![primary_help_suggestion("/log", query)];
    }

    if query == "/language" || query.starts_with("/language ") {
        return vec![primary_help_suggestion("/language", query)];
    }

    Vec::new()
}

fn skill_alias_suggestions(shell: &mut TuiShell, query: &str) -> Vec<InputSuggestion> {
    shell
        .enabled_skill_entries()
        .filter_map(|entry| {
            let alias = skill_slash_alias(&entry.source.name);
            if !alias.starts_with(query) || is_reserved_skill_alias(shell, &alias) {
                return None;
            }

            Some(InputSuggestion {
                label: alias.clone(),
                replacement: format!("{} ", alias),
                summary: entry.source.description.clone(),
                details: vec![format!("path: {}", entry.source.path.display())],
            })
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

pub(crate) fn resolve_skill_slash_command(shell: &TuiShell, command: &str) -> Option<String> {
    let normalized = command.trim();
    shell.enabled_skill_entries().find_map(|entry| {
        let alias = skill_slash_alias(&entry.source.name);
        if alias == normalized && !is_reserved_skill_alias(shell, &alias) {
            Some(entry.source.name.clone())
        } else {
            None
        }
    })
}

pub(crate) fn prompt_slash_alias(server: &str, prompt_name: &str) -> String {
    format!("/{}_{}", server, prompt_name)
}

pub(crate) fn skill_slash_alias(skill_name: &str) -> String {
    format!("/{}", skill_name)
}

fn is_reserved_skill_alias(shell: &TuiShell, alias: &str) -> bool {
    RESERVED_SLASH_COMMANDS.contains(&alias)
        || shell
            .prompt_slash_commands()
            .iter()
            .any(|command| command.alias == alias)
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

fn command_visible_in_mode(command: &str, input_mode: MainInputMode) -> bool {
    match command {
        "/start-implementing" => matches!(input_mode, MainInputMode::Plan),
        _ => true,
    }
}

pub(crate) fn help_text(input_mode: MainInputMode) -> String {
    let mut lines = vec![
        "可用指令:".to_string(),
        "- /help".to_string(),
        "- /clear".to_string(),
        "- /quit".to_string(),
    ];

    if matches!(input_mode, MainInputMode::Plan) {
        lines.push("- /start-implementing".to_string());
    }

    lines.extend([
        "- /model [list|use <name>|add|add <name> <api_base> <api_key>|remove <name>]".to_string(),
        "- /compact".to_string(),
        "- /sessions".to_string(),
        "- /sessions save [path]".to_string(),
        "- /sessions load <file>".to_string(),
        "- /subagents [list|open <session_id>|close]".to_string(),
        "- /image <path> [prompt]".to_string(),
        "- /image pick".to_string(),
        "- /image clear".to_string(),
        "- /mcp [list|add|inspect|tools|resources|prompts]".to_string(),
        "- /<server>_<prompt> [args_json | user_message]".to_string(),
        "- /create-rule [repo|user] <需求描述>".to_string(),
        "- /rules".to_string(),
        "- /create-skill <自然语言需求>".to_string(),
        "- /skills".to_string(),
        "- /extensions [list|import <zip>|remove <id>|marketplace [query]]".to_string(),
        "- /<skill-name> [补充说明]".to_string(),
        "- /log（或 /log export、/log session export）".to_string(),
        "- /language [en|zh-CN]".to_string(),
        "".to_string(),
        "说明:".to_string(),
        "- /sessions 打开已保存会话列表选择器。".to_string(),
        "- /subagents 打开当前会话里的 SubAgent 列表；回车可进入只读子会话视图，Esc 返回主会话。".to_string(),
        "- /image pick 打开当前目录图片选择器。".to_string(),
        "- /image 不带 prompt 时会把图片加入待发送队列。".to_string(),
        "- 输入 @<文件名> 会打开工作区文件引用建议，回车后会把选中文件写回输入框，格式为 @路径 加一个空格。".to_string(),
        "- /mcp add 打开底部表单，用于填写 server 名称、类型、命令或 URL（Enter 保存，Esc 取消）。".to_string(),
        "- /model add 打开底部表单：选提供商与添加方式、填写端点与 API Key；提交后将请求上游 /models（预设为批量导入全部 id，自定义可选单条）；也可一行 /model add <name> <api_base> <api_key>；成功后会切换当前模型。".to_string(),
        "- MCP prompt 会以一级 slash 命令暴露，例如 /github_issue_to_fix_workflow；若尾部是合法 JSON object，会直接作为 prompt 参数，其他文本会作为附加用户消息发给 LLM。".to_string(),
        "- 省略尾部且 prompt 定义了参数时，会自动打开参数表单；表单最后一栏可填写附加说明。".to_string(),
        "- /create-rule 会走正常 assistant 对话来起草或收紧规则；repo 目标默认写入工作区 .spirit/rule.md，user 目标写入 Spirit 用户目录 rule.md，两者都走标准工具审批；同时仍会扫描仓库根 AGENTS.md（兼容其他工具）。".to_string(),
        "- /rules 打开可滚动的规则启用清单；Enter 切换当前规则，Esc 保存并关闭，鼠标滚轮可浏览长内容。".to_string(),
        "- /create-skill 会走正常 assistant 对话来起草或收紧 SKILL.md；默认写入工作区 .spirit/skills，只有在你明确要求用户级/全局/跨仓库复用时才改写 Spirit 用户目录 skills，skill-name 也由模型自行决定，仍会走标准工具审批。".to_string(),
        "- /skills 打开可滚动的技能启用清单；Enter 切换当前技能，Esc 保存并关闭，鼠标滚轮可浏览长内容。".to_string(),
        "- /extensions 不带参数时会打开已安装扩展面板；/extensions marketplace 会进入极简 marketplace flow：先用 slash 选择扩展，再进入“概述 + README + 底部动作 slash”页面，Enter 前进、Esc 返回；支持用 query 作为初始过滤。/extensions list 会输出当前已安装扩展，/extensions import <zip> 导入 ZIP，/extensions remove <id> 删除扩展；面板里的启用/禁用切换暂未实现。".to_string(),
        "- 已启用的 skill 会直接作为一级 slash 命令暴露，例如 /llm-debug；尾部文本会作为本轮附加说明，skill 正文会作为独立 system prompt 状态注入，不会伪装成模型自行读文件。".to_string(),
        "- /mcp tools、/mcp resources、/mcp prompts 在只有一个 server 时可省略 server。".to_string(),
        "- /log 默认打开当前 CLI 日志；/log export 导出当前 CLI 日志快照；/log session export 导出 LLM 会话全文与请求轨迹。".to_string(),
        "- /language 不带参数时打开语言选择菜单。".to_string(),
        "- 鼠标默认开启：滚轮浏览历史；在 Conversation 内拖拽选区，Ctrl+Shift+C 或右键复制后会清除反色选区。".to_string(),
        "- Ctrl+O 切换辅助细节的显示/隐藏：包括思考内容、压缩摘要以及工具结果细节；已完成回复的辅助细节也会保留，失败与待确认工具保持展开。".to_string(),
        "".to_string(),
        "API Key 来源优先级: SPIRIT_API_KEY > 模型专属 keyring > 全局 keyring。".to_string(),
    ]);

    lines.join("\n")
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
        "/help" => shell.push_agent_message(help_text(shell.input_mode())),
        "/clear" => shell.clear_chat_for_slash(),
        "/start-implementing" => shell.handle_start_implementing_slash(),
        "/model" => shell.handle_model_slash(&parts[1..]),
        "/compact" => shell.compact_history_for_slash(),
        "/sessions" => shell.handle_sessions_slash(message),
        "/subagents" => shell.handle_subagents_slash(message),
        "/image" => shell.handle_image_slash(message),
        "/mcp" => shell.handle_mcp_slash(message),
        "/create-rule" => shell.handle_create_rule_slash(message),
        "/rules" => shell.handle_rules_slash(&parts[1..]),
        "/create-skill" => shell.handle_create_skill_slash(message),
        "/skills" => shell.handle_skills_slash(&parts[1..]),
        "/extensions" => shell.handle_extensions_slash(message),
        "/log" => shell.handle_log_slash(&parts[1..]),
        "/language" => shell.handle_language_slash(&parts[1..]),
        _ => {
            if !shell.handle_skill_alias_slash(message) {
                shell.push_agent_message("未知斜杠命令，输入 /help 查看可用指令。");
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn current_query_rejects_multiline_input_and_preserves_trailing_space() {
        assert_eq!(current_query("/mcp list"), Some("/mcp list"));
        assert_eq!(
            current_query("/github_issue_to_fix_workflow "),
            Some("/github_issue_to_fix_workflow ")
        );
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
        let help = help_text(MainInputMode::Agent);

        assert!(help.contains("/mcp add"));
        assert!(help.contains("/model add"));
        assert!(help.contains("底部表单"));
        assert!(help.contains("/create-rule"));
        assert!(help.contains("/rules"));
        assert!(help.contains("/create-skill"));
        assert!(help.contains("/skills"));
        assert!(help.contains("/extensions"));
        assert!(help.contains("概述 + README + 底部动作 slash"));
        assert!(help.contains("/<skill-name> [补充说明]"));
        assert!(help.contains("Enter 保存"));
        assert!(help.contains("@<文件名>"));
    }

    #[test]
    fn default_commands_hide_legacy_skill_alias() {
        let commands = default_commands();
        assert!(commands.contains(&"/skills".to_string()));
        assert!(commands.contains(&"/extensions".to_string()));
        assert_eq!(
            commands,
            DEFAULT_SLASH_COMMANDS
                .iter()
                .map(|command| (*command).to_string())
                .collect::<Vec<_>>()
        );
    }

    #[test]
    fn start_implementing_command_is_plan_only() {
        assert!(!command_visible_in_mode(
            "/start-implementing",
            MainInputMode::Agent,
        ));
        assert!(command_visible_in_mode(
            "/start-implementing",
            MainInputMode::Plan,
        ));
        assert!(!help_text(MainInputMode::Agent).contains("/start-implementing"));
        assert!(help_text(MainInputMode::Plan).contains("/start-implementing"));
    }

    #[test]
    fn skill_slash_alias_is_first_level() {
        assert_eq!(skill_slash_alias("llm-debug"), "/llm-debug");
    }

    #[test]
    fn extensions_command_completion_appends_space() {
        assert_eq!(command_replacement("/extensions"), "/extensions ");
    }

    #[test]
    fn extensions_context_keeps_primary_help_suggestion() {
        let suggestion = primary_help_suggestion("/extensions", "/extensions ");

        assert_eq!(suggestion.label, "/extensions");
        assert_eq!(suggestion.replacement, "/extensions ");
    }
}
