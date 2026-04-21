use serde_json::json;

use crate::{
    tool_runtime::ToolRequest,
    view::{ChatMessage, ToolUiBlock, ToolUiPhase},
};

pub enum RuntimeEvent {
    PushMessage(ChatMessage),
    BeginAssistantResponse,
    UpdatePendingAssistantThinking(String),
    UpdatePendingAssistantCompaction(String),
    AssistantChunk(String),
    ReplacePendingAssistant(String),
    AssistantResponseCompleted,
    RemovePendingAssistant,
}

pub(crate) fn openapi_tool_name(request: &ToolRequest) -> &'static str {
    match request {
        ToolRequest::Shell { .. } => "run_shell_command",
        ToolRequest::McpTool { .. } => "mcp_tool",
        ToolRequest::WebFetch { .. } => "web_fetch",
        ToolRequest::ListDirectory { .. } => "list_directory_files",
        ToolRequest::ReadFile { .. } => "read_file",
        ToolRequest::Search { .. } => "search_files",
        ToolRequest::CreateFile { .. } => "create_file",
        ToolRequest::EditFile { .. } => "edit_file",
        ToolRequest::DeleteFile { .. } => "delete_file",
    }
}

fn tool_request_args_excerpt(request: &ToolRequest) -> String {
    let value = match request {
        ToolRequest::Shell { command } => json!({ "command": command }),
        ToolRequest::McpTool {
            server,
            display_name,
            tool_name,
            arguments,
        } => json!({
            "server": server,
            "display_name": display_name,
            "tool_name": tool_name,
            "arguments": arguments,
        }),
        ToolRequest::WebFetch { url } => json!({ "url": url }),
        ToolRequest::ListDirectory { path } => json!({ "path": path }),
        ToolRequest::ReadFile {
            path,
            start_line,
            end_line,
        } => json!({ "path": path, "start_line": start_line, "end_line": end_line }),
        ToolRequest::Search { query } => json!({ "query": query }),
        ToolRequest::CreateFile { path, content } => {
            json!({ "path": path, "content_chars": content.chars().count() })
        }
        ToolRequest::EditFile {
            path,
            old_text,
            new_text,
        } => json!({
            "path": path,
            "old_text_chars": old_text.chars().count(),
            "new_text_chars": new_text.chars().count(),
        }),
        ToolRequest::DeleteFile { path } => json!({ "path": path }),
    };
    serde_json::to_string_pretty(&value).unwrap_or_else(|_| "{}".to_string())
}

fn truncate_for_preview(text: &str, max_chars: usize) -> String {
    let chars = text.chars().collect::<Vec<_>>();
    if chars.len() <= max_chars {
        return text.to_string();
    }

    let mut out = chars.into_iter().take(max_chars).collect::<String>();
    out.push_str("...<预览已截断>");
    out
}

fn truncate_output_for_tool_ui(text: &str, max_chars: usize) -> String {
    truncate_for_preview(text, max_chars)
}

pub(crate) fn tool_approval_block(
    tool_name: &str,
    tool_call_id: Option<&str>,
    prompt: &str,
) -> ToolUiBlock {
    let detail_lines = prompt.lines().map(|line| line.to_string()).collect::<Vec<_>>();
    ToolUiBlock {
        tool_call_id: tool_call_id.map(String::from),
        tool_name: tool_name.to_string(),
        phase: ToolUiPhase::PendingApproval,
        headline: "待确认".to_string(),
        detail_lines,
        args_excerpt: None,
        output_excerpt: None,
    }
}

pub(crate) fn tool_failed_block(
    tool_name: &str,
    tool_call_id: Option<&str>,
    summary: &str,
    err: &str,
) -> ToolUiBlock {
    ToolUiBlock {
        tool_call_id: tool_call_id.map(String::from),
        tool_name: tool_name.to_string(),
        phase: ToolUiPhase::Failed,
        headline: summary.to_string(),
        detail_lines: Vec::new(),
        args_excerpt: None,
        output_excerpt: Some(truncate_output_for_tool_ui(err, 2000)),
    }
}

pub(crate) fn build_tool_result_block(
    request: &ToolRequest,
    tool_name: &str,
    tool_call_id: Option<&str>,
    output: &str,
) -> ToolUiBlock {
    let args_excerpt = tool_request_args_excerpt(request);
    match request {
        ToolRequest::McpTool {
            server,
            display_name,
            tool_name: actual_tool_name,
            ..
        } => ToolUiBlock {
            tool_call_id: tool_call_id.map(String::from),
            tool_name: tool_name.to_string(),
            phase: ToolUiPhase::Succeeded,
            headline: "MCP 工具调用完成".to_string(),
            detail_lines: vec![
                format!("Server: {} ({})", display_name, server),
                format!("Tool: {}", actual_tool_name),
            ],
            args_excerpt: Some(args_excerpt),
            output_excerpt: Some(truncate_output_for_tool_ui(output, 3600)),
        },
        ToolRequest::WebFetch { url } => ToolUiBlock {
            tool_call_id: tool_call_id.map(String::from),
            tool_name: tool_name.to_string(),
            phase: ToolUiPhase::Succeeded,
            headline: "网页内容已抓取".to_string(),
            detail_lines: vec![format!("URL: {}", url)],
            args_excerpt: Some(args_excerpt),
            output_excerpt: Some(truncate_output_for_tool_ui(output, 3600)),
        },
        ToolRequest::ListDirectory { path } => ToolUiBlock {
            tool_call_id: tool_call_id.map(String::from),
            tool_name: tool_name.to_string(),
            phase: ToolUiPhase::Succeeded,
            headline: "目录文件已列出".to_string(),
            detail_lines: vec![format!("路径: {}", path)],
            args_excerpt: Some(args_excerpt),
            output_excerpt: Some(truncate_output_for_tool_ui(output, 3600)),
        },
        ToolRequest::ReadFile {
            path,
            start_line,
            end_line,
        } => {
            let start = start_line.unwrap_or(1);
            let end = end_line
                .map(|value| value.to_string())
                .unwrap_or_else(|| "default".to_string());
            ToolUiBlock {
                tool_call_id: tool_call_id.map(String::from),
                tool_name: tool_name.to_string(),
                phase: ToolUiPhase::Succeeded,
                headline: "已读取文件片段".to_string(),
                detail_lines: vec![
                    format!("路径: {}", path),
                    format!("行范围: {} - {}", start, end),
                ],
                args_excerpt: Some(args_excerpt),
                output_excerpt: None,
            }
        }
        ToolRequest::Search { query } => ToolUiBlock {
            tool_call_id: tool_call_id.map(String::from),
            tool_name: tool_name.to_string(),
            phase: ToolUiPhase::Succeeded,
            headline: "搜索完成".to_string(),
            detail_lines: vec![format!("查询: {}", query)],
            args_excerpt: Some(args_excerpt),
            output_excerpt: Some(truncate_output_for_tool_ui(output, 3600)),
        },
        ToolRequest::CreateFile { path, .. } => ToolUiBlock {
            tool_call_id: tool_call_id.map(String::from),
            tool_name: tool_name.to_string(),
            phase: ToolUiPhase::Succeeded,
            headline: "已创建文件".to_string(),
            detail_lines: vec![format!("路径: {}", path)],
            args_excerpt: Some(args_excerpt),
            output_excerpt: None,
        },
        ToolRequest::EditFile { path, .. } => ToolUiBlock {
            tool_call_id: tool_call_id.map(String::from),
            tool_name: tool_name.to_string(),
            phase: ToolUiPhase::Succeeded,
            headline: "已编辑文件".to_string(),
            detail_lines: vec![format!("路径: {}", path)],
            args_excerpt: Some(args_excerpt),
            output_excerpt: None,
        },
        ToolRequest::DeleteFile { path } => ToolUiBlock {
            tool_call_id: tool_call_id.map(String::from),
            tool_name: tool_name.to_string(),
            phase: ToolUiPhase::Succeeded,
            headline: "已删除文件".to_string(),
            detail_lines: vec![format!("路径: {}", path)],
            args_excerpt: Some(args_excerpt),
            output_excerpt: None,
        },
        ToolRequest::Shell { command } => ToolUiBlock {
            tool_call_id: tool_call_id.map(String::from),
            tool_name: tool_name.to_string(),
            phase: ToolUiPhase::Succeeded,
            headline: "命令已执行".to_string(),
            detail_lines: vec![format!("命令: {}", command)],
            args_excerpt: Some(args_excerpt),
            output_excerpt: Some(truncate_output_for_tool_ui(output, 3600)),
        },
    }
}

pub(crate) fn format_tool_ui_message(
    request: &ToolRequest,
    tool_name: &str,
    output: &str,
) -> String {
    match request {
        ToolRequest::McpTool {
            server,
            display_name,
            tool_name: actual_tool_name,
            ..
        } => format!(
            "[tool] MCP {} ({}) / {} 执行完成。\n{}",
            display_name,
            server,
            actual_tool_name,
            truncate_for_preview(output, 1200)
        ),
        ToolRequest::WebFetch { url } => format!("[tool] 已抓取网页 {}", url),
        ToolRequest::ListDirectory { path } => format!("[tool] 已列出目录下文件 {}", path),
        ToolRequest::ReadFile {
            path,
            start_line,
            end_line,
        } => {
            let start = start_line.unwrap_or(1);
            let end = end_line
                .map(|value| value.to_string())
                .unwrap_or_else(|| "default".to_string());
            format!("[tool] 阅读文件 {} {} - {}", path, start, end)
        }
        ToolRequest::Search { .. } => output.to_string(),
        ToolRequest::CreateFile { path, .. } => format!("[tool] 已创建文件 {}", path),
        ToolRequest::EditFile { path, .. } => {
            format!("[tool] 已编辑文件 {}", path)
        }
        ToolRequest::DeleteFile { path } => format!("[tool] 已删除文件 {}", path),
        ToolRequest::Shell { .. } => format!(
            "[tool] {} 执行完成。\n{}",
            tool_name,
            truncate_for_preview(output, 1200)
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::{build_tool_result_block, tool_request_args_excerpt};
    use crate::tool_runtime::ToolRequest;
    use serde_json::{Value, json};

    #[test]
    fn shell_tool_args_excerpt_matches_flat_legacy_shape() {
        let excerpt = tool_request_args_excerpt(&ToolRequest::Shell {
            command: "echo 牛逼".to_string(),
        });
        let parsed: Value = serde_json::from_str(&excerpt).expect("args excerpt json");
        assert_eq!(parsed, json!({ "command": "echo 牛逼" }));
    }

    #[test]
    fn tool_result_block_keeps_tool_call_id_for_shell() {
        let block = build_tool_result_block(
            &ToolRequest::Shell {
                command: "echo 牛逼".to_string(),
            },
            "run_shell_command",
            Some("call_00_demo"),
            "牛逼\n",
        );

        assert_eq!(block.tool_call_id.as_deref(), Some("call_00_demo"));
        assert_eq!(block.tool_name, "run_shell_command");
        assert_eq!(block.headline, "命令已执行");
        assert_eq!(block.args_excerpt.as_deref(), Some("{\n  \"command\": \"echo 牛逼\"\n}"));
    }

    #[test]
    fn read_file_tool_block_keeps_legacy_summary_shape() {
        let block = build_tool_result_block(
            &ToolRequest::ReadFile {
                path: "src/main.rs".to_string(),
                start_line: Some(3),
                end_line: Some(9),
            },
            "read_file",
            Some("call_01_read"),
            "line3\nline4\n",
        );

        assert_eq!(block.tool_call_id.as_deref(), Some("call_01_read"));
        assert_eq!(block.headline, "已读取文件片段");
        assert_eq!(
            block.detail_lines,
            vec!["路径: src/main.rs".to_string(), "行范围: 3 - 9".to_string()]
        );
        assert!(block.output_excerpt.is_none());
    }
}