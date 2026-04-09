//! TUI slash command helpers.

use crate::tui::TuiShell;

#[derive(Debug, Default)]
pub(crate) struct SlashState {
    pub(crate) commands: Vec<String>,
    pub(crate) suggestions: Vec<String>,
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
        "/log".to_string(),
    ]
}

pub(crate) fn current_query(input: &str) -> Option<&str> {
    if !input.starts_with('/') || input.contains('\n') {
        return None;
    }
    Some(input.trim_end())
}

pub(crate) fn compute_suggestions(query: &str, slash_commands: &[String]) -> Vec<String> {
    let mut suggestions = slash_commands
        .iter()
        .filter(|cmd| cmd.starts_with(query))
        .cloned()
        .collect::<Vec<_>>();

    if suggestions.is_empty() {
        suggestions = contextual_suggestions(query)
            .into_iter()
            .map(ToString::to_string)
            .collect();
    }

    suggestions
}

pub(crate) fn apply_value(selected: &str) -> String {
    match selected {
        "/model" | "/sessions" | "/image" | "/mcp" | "/log" => {
            format!("{} ", selected)
        }
        _ => selected.to_string(),
    }
}

fn contextual_suggestions(query: &str) -> Vec<&'static str> {
    let q = query.trim_end();

    if q == "/model" || q.starts_with("/model ") {
        return vec!["/model"];
    }

    if q == "/sessions" || q.starts_with("/sessions ") {
        return vec![
            "/sessions",
            "/sessions save",
            "/sessions save <path>",
            "/sessions load <file>",
        ];
    }

    if q == "/image" || q.starts_with("/image ") {
        return vec!["/image"];
    }

    if q == "/mcp" || q.starts_with("/mcp ") {
        return vec!["/mcp"];
    }

    if q == "/log" || q.starts_with("/log ") {
        return vec!["/log"];
    }

    Vec::new()
}

pub(crate) fn help_text() -> &'static str {
    "可用指令:\n- /help\n- /clear\n- /quit\n- /model [list|use <name>|add <name> <api_base> <api_key>|remove <name>]\n- /compact\n- /sessions\n- /sessions save [path]\n- /sessions load <file>\n- /image <path> [prompt]\n- /image pick\n- /image clear\n- /mcp [list|add|inspect|tools|resources|prompts]\n- /log（或 /log export、/log session export）\n\n说明:\n- /sessions 打开已保存会话列表选择器。\n- /image pick 打开当前目录图片选择器。\n- /image 不带 prompt 时会把图片加入待发送队列。\n- /mcp add 打开底部表单，用于填写 server 名称、类型、命令或 URL（Enter 保存，Esc 取消）。\n- /mcp tools、/mcp resources、/mcp prompts 在只有一个 server 时可省略 server 名。\n- /log 默认打开当前 CLI 日志；/log export 导出当前 CLI 日志快照；/log session export 导出 LLM 会话全文与请求轨迹。\n- 鼠标默认开启：滚轮浏览历史；在 Conversation 内拖拽选区，Ctrl+Shift+C 或右键复制后会清除反色选区。\n- Ctrl+O 切换辅助细节的显示/隐藏：包括思考内容、压缩摘要以及工具结果细节；已完成回复的辅助细节也会保留，失败与待确认工具保持展开。\n\nAPI Key 来源优先级: SPIRIT_API_KEY > 模型专属 keyring > 全局 keyring。"
}

pub(crate) fn handle_command(shell: &mut TuiShell, message: &str) {
    let parts: Vec<&str> = message.split_whitespace().collect();
    let Some(cmd) = parts.first().copied() else {
        return;
    };

    match cmd {
        "/quit" | "/exit" => {
            shell.push_agent_message("收到，SpiritAgent 即将退出。");
            shell.request_quit();
        }
        "/help" => shell.push_agent_message(help_text()),
        "/clear" => shell.clear_chat_for_slash(),
        "/model" => shell.handle_model_slash(&parts[1..]),
        "/compact" => shell.compact_history_for_slash(),
        "/sessions" => shell.handle_sessions_slash(message),
        "/image" => shell.handle_image_slash(message),
        "/mcp" => shell.handle_mcp_slash(message),
        "/log" => shell.handle_log_slash(&parts[1..]),
        _ => shell.push_agent_message("未知斜杠命令，输入 /help 查看可用指令。"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn current_query_rejects_multiline_input() {
        assert_eq!(current_query("/mcp list"), Some("/mcp list"));
        assert_eq!(current_query("/mcp\nlist"), None);
        assert_eq!(current_query("hello"), None);
    }

    #[test]
    fn compute_suggestions_falls_back_to_contextual_matches() {
        let suggestions = compute_suggestions("/sessions ", &default_commands());

        assert_eq!(
            suggestions,
            vec![
                "/sessions".to_string(),
                "/sessions save".to_string(),
                "/sessions save <path>".to_string(),
                "/sessions load <file>".to_string(),
            ]
        );
    }

    #[test]
    fn apply_value_appends_space_for_group_commands() {
        assert_eq!(apply_value("/mcp"), "/mcp ");
        assert_eq!(apply_value("/clear"), "/clear");
    }

    #[test]
    fn help_text_mentions_bottom_form_shortcuts() {
        assert!(help_text().contains("/mcp add"));
        assert!(help_text().contains("Enter 保存"));
    }
}
