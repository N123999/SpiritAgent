use serde_json::{Map, Value, json};

use crate::{
    ask_questions::AskQuestionsRequest,
    view::{ChatMessage, ToolUiBlock, ToolUiPhase},
};

#[derive(Clone, Debug)]
pub(crate) struct ToolUiRequest {
    pub(crate) name: String,
    pub(crate) arguments: Value,
}

impl ToolUiRequest {
    pub(crate) fn new(name: impl Into<String>, arguments: Value) -> Self {
        Self {
            name: name.into(),
            arguments,
        }
    }
}

pub enum RuntimeEvent {
    PushMessage(ChatMessage),
    OpenAskQuestions {
        tool_call_id: String,
        tool_name: String,
        questions: AskQuestionsRequest,
    },
    BeginAssistantResponse,
    UpdatePendingAssistantThinking(String),
    AssistantThinkingSegmentFinalized(String),
    UpdatePendingAssistantCompaction(String),
    AssistantChunk(String),
    ReplacePendingAssistant(String),
    AssistantResponseCompleted,
    RemovePendingAssistant,
}

fn tool_request_args_excerpt(request: &ToolUiRequest) -> String {
    let value = match request.name.as_str() {
        "create_file" => json!({
            "path": string_arg(request, "path"),
            "content_chars": string_arg(request, "content").map(|value| value.chars().count()),
        }),
        "edit_file" => json!({
            "path": string_arg(request, "path"),
            "old_text_chars": string_arg(request, "old_text").map(|value| value.chars().count()),
            "new_text_chars": string_arg(request, "new_text").map(|value| value.chars().count()),
        }),
        "ask_questions" => json!({
            "title": string_arg(request, "title"),
            "questionCount": question_count(request),
        }),
        _ => request.arguments.clone(),
    };
    serde_json::to_string_pretty(&value).unwrap_or_else(|_| "{}".to_string())
}

fn args_object(request: &ToolUiRequest) -> Option<&Map<String, Value>> {
    request.arguments.as_object()
}

fn string_arg<'a>(request: &'a ToolUiRequest, key: &str) -> Option<&'a str> {
    args_object(request)?
        .get(key)
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
}

fn u64_arg(request: &ToolUiRequest, key: &str) -> Option<u64> {
    args_object(request)?.get(key).and_then(Value::as_u64)
}

fn question_count(request: &ToolUiRequest) -> usize {
    if let Some(count) = u64_arg(request, "questionCount") {
        return count as usize;
    }

    args_object(request)
        .and_then(|object| object.get("questions"))
        .and_then(Value::as_array)
        .map(|questions| questions.len())
        .unwrap_or(0)
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
    let detail_lines = prompt
        .lines()
        .map(|line| line.to_string())
        .collect::<Vec<_>>();
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
    request: &ToolUiRequest,
    tool_name: &str,
    tool_call_id: Option<&str>,
    output: &str,
) -> ToolUiBlock {
    let args_excerpt = tool_request_args_excerpt(request);
    match request.name.as_str() {
        "mcp_tool" => ToolUiBlock {
            tool_call_id: tool_call_id.map(String::from),
            tool_name: tool_name.to_string(),
            phase: ToolUiPhase::Succeeded,
            headline: "MCP 工具调用完成".to_string(),
            detail_lines: vec![
                format!(
                    "Server: {} ({})",
                    string_arg(request, "display_name").unwrap_or("<unknown>"),
                    string_arg(request, "server").unwrap_or("<unknown>")
                ),
                format!(
                    "Tool: {}",
                    string_arg(request, "tool_name").unwrap_or("<unknown>")
                ),
            ],
            args_excerpt: Some(args_excerpt),
            output_excerpt: Some(truncate_output_for_tool_ui(output, 3600)),
        },
        "web_fetch" => ToolUiBlock {
            tool_call_id: tool_call_id.map(String::from),
            tool_name: tool_name.to_string(),
            phase: ToolUiPhase::Succeeded,
            headline: "网页内容已抓取".to_string(),
            detail_lines: vec![format!(
                "URL: {}",
                string_arg(request, "url").unwrap_or("<unknown>")
            )],
            args_excerpt: Some(args_excerpt),
            output_excerpt: Some(truncate_output_for_tool_ui(output, 3600)),
        },
        "list_directory_files" => ToolUiBlock {
            tool_call_id: tool_call_id.map(String::from),
            tool_name: tool_name.to_string(),
            phase: ToolUiPhase::Succeeded,
            headline: "目录文件已列出".to_string(),
            detail_lines: vec![format!(
                "路径: {}",
                string_arg(request, "path").unwrap_or("<unknown>")
            )],
            args_excerpt: Some(args_excerpt),
            output_excerpt: Some(truncate_output_for_tool_ui(output, 3600)),
        },
        "read_file" => {
            let start = u64_arg(request, "start_line").unwrap_or(1);
            let end = u64_arg(request, "end_line")
                .map(|value| value.to_string())
                .unwrap_or_else(|| "default".to_string());
            ToolUiBlock {
                tool_call_id: tool_call_id.map(String::from),
                tool_name: tool_name.to_string(),
                phase: ToolUiPhase::Succeeded,
                headline: "已读取文件片段".to_string(),
                detail_lines: vec![
                    format!(
                        "路径: {}",
                        string_arg(request, "path").unwrap_or("<unknown>")
                    ),
                    format!("行范围: {} - {}", start, end),
                ],
                args_excerpt: Some(args_excerpt),
                output_excerpt: None,
            }
        }
        "search_files" => ToolUiBlock {
            tool_call_id: tool_call_id.map(String::from),
            tool_name: tool_name.to_string(),
            phase: ToolUiPhase::Succeeded,
            headline: "搜索完成".to_string(),
            detail_lines: vec![format!(
                "查询: {}",
                string_arg(request, "query").unwrap_or("<unknown>")
            )],
            args_excerpt: Some(args_excerpt),
            output_excerpt: Some(truncate_output_for_tool_ui(output, 3600)),
        },
        "run_subagent" => ToolUiBlock {
            tool_call_id: tool_call_id.map(String::from),
            tool_name: tool_name.to_string(),
            phase: ToolUiPhase::Succeeded,
            headline: "SubAgent 委托完成".to_string(),
            detail_lines: vec![format!(
                "任务: {}",
                string_arg(request, "task").unwrap_or("<unknown>")
            )],
            args_excerpt: Some(args_excerpt),
            output_excerpt: Some(truncate_output_for_tool_ui(output, 3600)),
        },
        "ask_questions" => ToolUiBlock {
            tool_call_id: tool_call_id.map(String::from),
            tool_name: tool_name.to_string(),
            phase: ToolUiPhase::Succeeded,
            headline: "问卷答案已返回".to_string(),
            detail_lines: vec![format!("问题数: {}", question_count(request))],
            args_excerpt: Some(args_excerpt),
            output_excerpt: Some(truncate_output_for_tool_ui(output, 3600)),
        },
        "create_file" => ToolUiBlock {
            tool_call_id: tool_call_id.map(String::from),
            tool_name: tool_name.to_string(),
            phase: ToolUiPhase::Succeeded,
            headline: "已创建文件".to_string(),
            detail_lines: vec![format!(
                "路径: {}",
                string_arg(request, "path").unwrap_or("<unknown>")
            )],
            args_excerpt: Some(args_excerpt),
            output_excerpt: None,
        },
        "edit_file" => ToolUiBlock {
            tool_call_id: tool_call_id.map(String::from),
            tool_name: tool_name.to_string(),
            phase: ToolUiPhase::Succeeded,
            headline: "已编辑文件".to_string(),
            detail_lines: vec![format!(
                "路径: {}",
                string_arg(request, "path").unwrap_or("<unknown>")
            )],
            args_excerpt: Some(args_excerpt),
            output_excerpt: None,
        },
        "delete_file" => ToolUiBlock {
            tool_call_id: tool_call_id.map(String::from),
            tool_name: tool_name.to_string(),
            phase: ToolUiPhase::Succeeded,
            headline: "已删除文件".to_string(),
            detail_lines: vec![format!(
                "路径: {}",
                string_arg(request, "path").unwrap_or("<unknown>")
            )],
            args_excerpt: Some(args_excerpt),
            output_excerpt: None,
        },
        "run_shell_command" => ToolUiBlock {
            tool_call_id: tool_call_id.map(String::from),
            tool_name: tool_name.to_string(),
            phase: ToolUiPhase::Succeeded,
            headline: "命令已执行".to_string(),
            detail_lines: vec![format!(
                "命令: {}",
                string_arg(request, "command").unwrap_or("<unknown>")
            )],
            args_excerpt: Some(args_excerpt),
            output_excerpt: Some(truncate_output_for_tool_ui(output, 3600)),
        },
        _ => ToolUiBlock {
            tool_call_id: tool_call_id.map(String::from),
            tool_name: tool_name.to_string(),
            phase: ToolUiPhase::Succeeded,
            headline: "工具执行完成".to_string(),
            detail_lines: Vec::new(),
            args_excerpt: Some(args_excerpt),
            output_excerpt: Some(truncate_output_for_tool_ui(output, 3600)),
        },
    }
}

pub(crate) fn format_tool_ui_message(
    request: &ToolUiRequest,
    tool_name: &str,
    output: &str,
) -> String {
    match request.name.as_str() {
        "mcp_tool" => format!(
            "[tool] MCP {} ({}) / {} 执行完成。\n{}",
            string_arg(request, "display_name").unwrap_or("<unknown>"),
            string_arg(request, "server").unwrap_or("<unknown>"),
            string_arg(request, "tool_name").unwrap_or("<unknown>"),
            truncate_for_preview(output, 1200)
        ),
        "web_fetch" => format!(
            "[tool] 已抓取网页 {}",
            string_arg(request, "url").unwrap_or("<unknown>")
        ),
        "list_directory_files" => format!(
            "[tool] 已列出目录下文件 {}",
            string_arg(request, "path").unwrap_or("<unknown>")
        ),
        "read_file" => {
            let start = u64_arg(request, "start_line").unwrap_or(1);
            let end = u64_arg(request, "end_line")
                .map(|value| value.to_string())
                .unwrap_or_else(|| "default".to_string());
            format!(
                "[tool] 阅读文件 {} {} - {}",
                string_arg(request, "path").unwrap_or("<unknown>"),
                start,
                end
            )
        }
        "search_files" => output.to_string(),
        "run_subagent" => format!(
            "[tool] SubAgent 已完成任务: {}\n{}",
            string_arg(request, "task").unwrap_or("<unknown>"),
            truncate_for_preview(output, 1200)
        ),
        "ask_questions" => format!(
            "[tool] {} 已返回结构化答案。\n{}",
            tool_name,
            truncate_for_preview(output, 1200)
        ),
        "create_file" => format!(
            "[tool] 已创建文件 {}",
            string_arg(request, "path").unwrap_or("<unknown>")
        ),
        "edit_file" => format!(
            "[tool] 已编辑文件 {}",
            string_arg(request, "path").unwrap_or("<unknown>")
        ),
        "delete_file" => format!(
            "[tool] 已删除文件 {}",
            string_arg(request, "path").unwrap_or("<unknown>")
        ),
        "run_shell_command" => format!(
            "[tool] {} 执行完成。\n{}",
            tool_name,
            truncate_for_preview(output, 1200)
        ),
        _ => format!(
            "[tool] {} 执行完成。\n{}",
            tool_name,
            truncate_for_preview(output, 1200)
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::{ToolUiRequest, build_tool_result_block, tool_request_args_excerpt};
    use serde_json::{Value, json};

    #[test]
    fn shell_tool_args_excerpt_matches_flat_legacy_shape() {
        let excerpt = tool_request_args_excerpt(&ToolUiRequest::new(
            "run_shell_command",
            json!({ "command": "echo 牛逼" }),
        ));
        let parsed: Value = serde_json::from_str(&excerpt).expect("args excerpt json");
        assert_eq!(parsed, json!({ "command": "echo 牛逼" }));
    }

    #[test]
    fn tool_result_block_keeps_tool_call_id_for_shell() {
        let block = build_tool_result_block(
            &ToolUiRequest::new("run_shell_command", json!({ "command": "echo 牛逼" })),
            "run_shell_command",
            Some("call_00_demo"),
            "牛逼\n",
        );

        assert_eq!(block.tool_call_id.as_deref(), Some("call_00_demo"));
        assert_eq!(block.tool_name, "run_shell_command");
        assert_eq!(block.headline, "命令已执行");
        assert_eq!(
            block.args_excerpt.as_deref(),
            Some("{\n  \"command\": \"echo 牛逼\"\n}")
        );
    }

    #[test]
    fn read_file_tool_block_keeps_legacy_summary_shape() {
        let block = build_tool_result_block(
            &ToolUiRequest::new(
                "read_file",
                json!({
                    "path": "src/main.rs",
                    "start_line": 3,
                    "end_line": 9
                }),
            ),
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
