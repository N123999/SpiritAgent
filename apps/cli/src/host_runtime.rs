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
    UpsertToolPreview {
        tool_call_id: String,
        tool_name: String,
        arguments: serde_json::Value,
    },
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
        "apply_patch" => json!({
            "operation": {
                "type": apply_patch_operation_type(request),
                "path": apply_patch_path(request),
                "diff_chars": apply_patch_diff_chars(request),
            }
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

fn apply_patch_operation_object(request: &ToolUiRequest) -> Option<&Map<String, Value>> {
    args_object(request)?
        .get("operation")
        .and_then(Value::as_object)
}

fn apply_patch_path<'a>(request: &'a ToolUiRequest) -> Option<&'a str> {
    apply_patch_operation_object(request)?
        .get("path")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
}

fn apply_patch_operation_type(request: &ToolUiRequest) -> Option<&str> {
    apply_patch_operation_object(request)?
        .get("type")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
}

fn apply_patch_diff_chars(request: &ToolUiRequest) -> Option<usize> {
    apply_patch_operation_object(request)?
        .get("diff")
        .and_then(Value::as_str)
        .map(|value| value.chars().count())
        .filter(|count| *count > 0)
}

fn strip_shell_reason_from_prompt(prompt: &str) -> (Option<String>, Vec<String>) {
    let mut lines = prompt.lines();
    let first = lines.next();
    let reason = first
        .and_then(|line| line.trim().strip_prefix("理由:"))
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string);
    let detail_lines = if reason.is_some() {
        lines.map(|line| line.to_string()).collect::<Vec<_>>()
    } else {
        prompt
            .lines()
            .map(|line| line.to_string())
            .collect::<Vec<_>>()
    };
    (reason, detail_lines)
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

pub(crate) fn build_tool_preview_block(
    tool_name: &str,
    tool_call_id: &str,
    request: &ToolUiRequest,
) -> ToolUiBlock {
    let (headline, detail_lines) = preview_summary_for_tool(tool_name, request);
    ToolUiBlock {
        tool_call_id: Some(tool_call_id.to_string()),
        tool_name: tool_name.to_string(),
        phase: ToolUiPhase::Preview,
        headline,
        detail_lines,
        image_paths: Vec::new(),
        video_paths: Vec::new(),
        args_excerpt: Some(tool_request_args_excerpt(request)),
        output_excerpt: None,
    }
}

fn preview_summary_for_tool(tool_name: &str, request: &ToolUiRequest) -> (String, Vec<String>) {
    match tool_name {
        "read_file" => {
            let path = string_arg(request, "path")
                .or_else(|| string_arg(request, "filePath"))
                .unwrap_or("文件");
            ("查看".to_string(), vec![path.to_string()])
        }
        "list_directory_files" => (
            "列出目录".to_string(),
            vec![string_arg(request, "path").unwrap_or(".").to_string()],
        ),
        "glob" => (
            "匹配".to_string(),
            vec![string_arg(request, "pattern").unwrap_or("**/*").to_string()],
        ),
        "run_shell_command" => (
            "执行命令".to_string(),
            string_arg(request, "command")
                .map(|value| vec![value.to_string()])
                .unwrap_or_default(),
        ),
        "edit_file" => {
            let path = string_arg(request, "path").unwrap_or("文件");
            let mut lines = vec![path.to_string()];
            if let Some(old) = string_arg(request, "old_text") {
                lines.push(format!("旧文本: {} 字符", old.chars().count()));
            } else if let Some(chars) = u64_arg(request, "old_text_chars") {
                if chars > 0 {
                    lines.push(format!("旧文本: 流式生成中… {} 字符", chars));
                }
            }
            if let Some(new) = string_arg(request, "new_text") {
                lines.push(format!("新文本: {} 字符", new.chars().count()));
            } else if let Some(chars) = u64_arg(request, "new_text_chars") {
                if chars > 0 {
                    lines.push(format!("新文本: 流式生成中… {} 字符", chars));
                }
            }
            ("编辑".to_string(), lines)
        }
        "create_file" => {
            let path = string_arg(request, "path").unwrap_or("文件");
            let mut lines = vec![path.to_string()];
            if let Some(content) = string_arg(request, "content") {
                lines.push(format!("内容: {} 字符", content.chars().count()));
            } else if let Some(chars) = u64_arg(request, "content_chars") {
                if chars > 0 {
                    lines.push(format!("内容: 流式生成中… {} 字符", chars));
                }
            }
            ("创建".to_string(), lines)
        }
        "apply_patch" => {
            let path = apply_patch_path(request).unwrap_or("文件");
            let mut lines = vec![path.to_string()];
            if let Some(chars) = apply_patch_diff_chars(request) {
                lines.push(format!("diff: {} 字符", chars));
            }
            let headline = match apply_patch_operation_type(request) {
                Some("create_file") => "创建".to_string(),
                Some("update_file") => "编辑".to_string(),
                Some("delete_file") => "删除".to_string(),
                _ => "补丁".to_string(),
            };
            (headline, lines)
        }
        _ => (
            format!("调用 {}", tool_name),
            Vec::new(),
        ),
    }
}

pub(crate) fn tool_approval_block(
    tool_name: &str,
    tool_call_id: Option<&str>,
    prompt: &str,
    supports_trust: bool,
) -> ToolUiBlock {
    let (shell_reason, mut detail_lines) = if tool_name == "run_shell_command" {
        strip_shell_reason_from_prompt(prompt)
    } else {
        (
            None,
            prompt
                .lines()
                .map(|line| line.to_string())
                .collect::<Vec<_>>(),
        )
    };
    detail_lines.push(if supports_trust {
        "快捷键: Y 允许一次 / N 拒绝 / T 信任并持久化".to_string()
    } else {
        "快捷键: Y 允许一次 / N 拒绝".to_string()
    });
    ToolUiBlock {
        tool_call_id: tool_call_id.map(String::from),
        tool_name: tool_name.to_string(),
        phase: ToolUiPhase::PendingApproval,
        headline: shell_reason.unwrap_or_else(|| "待确认".to_string()),
        detail_lines,
        image_paths: Vec::new(),
        video_paths: Vec::new(),
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
        image_paths: Vec::new(),
        video_paths: Vec::new(),
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
            image_paths: Vec::new(),
            video_paths: Vec::new(),
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
            image_paths: Vec::new(),
            video_paths: Vec::new(),
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
            image_paths: Vec::new(),
            video_paths: Vec::new(),
            args_excerpt: Some(args_excerpt),
            output_excerpt: Some(truncate_output_for_tool_ui(output, 3600)),
        },
        "glob" => ToolUiBlock {
            tool_call_id: tool_call_id.map(String::from),
            tool_name: tool_name.to_string(),
            phase: ToolUiPhase::Succeeded,
            headline: "文件匹配完成".to_string(),
            detail_lines: vec![format!(
                "模式: {}",
                string_arg(request, "pattern").unwrap_or("<unknown>")
            )],
            image_paths: Vec::new(),
            video_paths: Vec::new(),
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
                image_paths: Vec::new(),
            video_paths: Vec::new(),
                args_excerpt: Some(args_excerpt),
                output_excerpt: None,
            }
        }
        "grep" => ToolUiBlock {
            tool_call_id: tool_call_id.map(String::from),
            tool_name: tool_name.to_string(),
            phase: ToolUiPhase::Succeeded,
            headline: "搜索完成".to_string(),
            detail_lines: vec![format!(
                "查询: {}",
                string_arg(request, "query").unwrap_or("<unknown>")
            )],
            image_paths: Vec::new(),
            video_paths: Vec::new(),
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
            image_paths: Vec::new(),
            video_paths: Vec::new(),
            args_excerpt: Some(args_excerpt),
            output_excerpt: Some(truncate_output_for_tool_ui(output, 3600)),
        },
        "ask_questions" => ToolUiBlock {
            tool_call_id: tool_call_id.map(String::from),
            tool_name: tool_name.to_string(),
            phase: ToolUiPhase::Succeeded,
            headline: "问卷答案已返回".to_string(),
            detail_lines: vec![format!("问题数: {}", question_count(request))],
            image_paths: Vec::new(),
            video_paths: Vec::new(),
            args_excerpt: Some(args_excerpt),
            output_excerpt: Some(truncate_output_for_tool_ui(output, 3600)),
        },
        "generate_image" => {
            let image_paths = generated_image_paths_from_output(output);
            ToolUiBlock {
                tool_call_id: tool_call_id.map(String::from),
                tool_name: tool_name.to_string(),
                phase: ToolUiPhase::Succeeded,
                headline: "图片生成完成".to_string(),
                detail_lines: image_paths
                    .iter()
                    .map(|path| format!("路径: {}", path))
                    .collect(),
                image_paths,
                video_paths: Vec::new(),
                args_excerpt: Some(args_excerpt),
                output_excerpt: Some(truncate_output_for_tool_ui(output, 3600)),
            }
        }
        "generate_video" => {
            let video_paths = generated_video_paths_from_output(output);
            ToolUiBlock {
                tool_call_id: tool_call_id.map(String::from),
                tool_name: tool_name.to_string(),
                phase: ToolUiPhase::Succeeded,
                headline: "视频生成完成".to_string(),
                detail_lines: video_paths
                    .iter()
                    .map(|path| format!("路径: {}", path))
                    .collect(),
                image_paths: Vec::new(),
                video_paths,
                args_excerpt: Some(args_excerpt),
                output_excerpt: Some(truncate_output_for_tool_ui(output, 3600)),
            }
        }
        "create_file" => ToolUiBlock {
            tool_call_id: tool_call_id.map(String::from),
            tool_name: tool_name.to_string(),
            phase: ToolUiPhase::Succeeded,
            headline: "已创建文件".to_string(),
            detail_lines: vec![format!(
                "路径: {}",
                string_arg(request, "path").unwrap_or("<unknown>")
            )],
            image_paths: Vec::new(),
            video_paths: Vec::new(),
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
            image_paths: Vec::new(),
            video_paths: Vec::new(),
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
            image_paths: Vec::new(),
            video_paths: Vec::new(),
            args_excerpt: Some(args_excerpt),
            output_excerpt: None,
        },
        "apply_patch" => {
            let path = apply_patch_path(request).unwrap_or("<unknown>");
            let headline = match apply_patch_operation_type(request) {
                Some("create_file") => "已创建文件",
                Some("update_file") => "已编辑文件",
                Some("delete_file") => "已删除文件",
                _ => "已应用补丁",
            };
            ToolUiBlock {
                tool_call_id: tool_call_id.map(String::from),
                tool_name: tool_name.to_string(),
                phase: ToolUiPhase::Succeeded,
                headline: headline.to_string(),
                detail_lines: vec![format!("路径: {}", path)],
                image_paths: Vec::new(),
            video_paths: Vec::new(),
                args_excerpt: Some(args_excerpt),
                output_excerpt: None,
            }
        }
        "run_shell_command" => ToolUiBlock {
            tool_call_id: tool_call_id.map(String::from),
            tool_name: tool_name.to_string(),
            phase: ToolUiPhase::Succeeded,
            headline: "命令已执行".to_string(),
            detail_lines: vec![format!(
                "命令: {}",
                string_arg(request, "command").unwrap_or("<unknown>")
            )],
            image_paths: Vec::new(),
            video_paths: Vec::new(),
            args_excerpt: Some(args_excerpt),
            output_excerpt: Some(truncate_output_for_tool_ui(output, 3600)),
        },
        _ => ToolUiBlock {
            tool_call_id: tool_call_id.map(String::from),
            tool_name: tool_name.to_string(),
            phase: ToolUiPhase::Succeeded,
            headline: "工具执行完成".to_string(),
            detail_lines: Vec::new(),
            image_paths: Vec::new(),
            video_paths: Vec::new(),
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
        "glob" => output.to_string(),
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
        "grep" => output.to_string(),
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
        "generate_image" => format!(
            "[tool] 图片生成完成。\n{}",
            truncate_for_preview(output, 1200)
        ),
        "generate_video" => format!(
            "[tool] 视频生成完成。\n{}",
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
        "apply_patch" => format!(
            "[tool] 已应用补丁 {}",
            apply_patch_path(request).unwrap_or("<unknown>")
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

fn generated_image_paths_from_output(output: &str) -> Vec<String> {
    generated_media_paths_from_output(output, &["path:", "image_ref:", "read_file_path:"])
}

fn generated_video_paths_from_output(output: &str) -> Vec<String> {
    generated_media_paths_from_output(output, &["path:", "video_ref:", "read_file_path:"])
}

fn generated_media_paths_from_output(output: &str, prefixes: &[&str]) -> Vec<String> {
    let mut paths = Vec::new();
    for line in output.lines() {
        let trimmed = line.trim();
        let Some((_, path)) = prefixes
            .iter()
            .find_map(|prefix| trimmed.strip_prefix(prefix).map(|value| (*prefix, value.trim())))
        else {
            continue;
        };
        if path.is_empty() {
            continue;
        }
        if !paths.iter().any(|existing| existing == path) {
            paths.push(path.to_string());
        }
    }
    paths
}

#[cfg(test)]
mod tests {
    use super::{
        ToolUiRequest, build_tool_result_block, tool_approval_block, tool_request_args_excerpt,
    };
    use serde_json::{Value, json};

    #[test]
    fn shell_tool_args_excerpt_keeps_reason_field() {
        let excerpt = tool_request_args_excerpt(&ToolUiRequest::new(
            "run_shell_command",
            json!({ "command": "echo hello", "reason": "smoke test" }),
        ));
        let parsed: Value = serde_json::from_str(&excerpt).expect("args excerpt json");
        assert_eq!(
            parsed,
            json!({ "command": "echo hello", "reason": "smoke test" })
        );
    }

    #[test]
    fn tool_result_block_keeps_tool_call_id_for_shell() {
        let block = build_tool_result_block(
            &ToolUiRequest::new(
                "run_shell_command",
                json!({ "command": "echo hello", "reason": "smoke test" }),
            ),
            "run_shell_command",
            Some("call_00_demo"),
            "hello\n",
        );

        assert_eq!(block.tool_call_id.as_deref(), Some("call_00_demo"));
        assert_eq!(block.tool_name, "run_shell_command");
        assert_eq!(block.headline, "命令已执行");
        assert_eq!(
            block.args_excerpt.as_deref(),
            Some("{\n  \"command\": \"echo hello\",\n  \"reason\": \"smoke test\"\n}")
        );
    }

    #[test]
    fn generate_image_result_block_shows_generated_path() {
        let output = "[generated image]\npath: C:/Users/pc/AppData/Roaming/SpiritAgent/generated-images/example.png\nmime_type: image/png\nmodel: image-model";
        let block = build_tool_result_block(
            &ToolUiRequest::new("generate_image", json!({ "prompt": "画一张图" })),
            "generate_image",
            Some("tool-call-image"),
            output,
        );

        assert_eq!(block.headline, "图片生成完成");
        assert_eq!(
            block.detail_lines,
            vec!["路径: C:/Users/pc/AppData/Roaming/SpiritAgent/generated-images/example.png"]
        );
        assert_eq!(
            block.image_paths,
            vec!["C:/Users/pc/AppData/Roaming/SpiritAgent/generated-images/example.png"]
        );
        assert!(
            block
                .output_excerpt
                .as_deref()
                .is_some_and(|text| text.contains("path:"))
        );
    }

    #[test]
    fn generate_video_result_block_shows_managed_uri() {
        let output = "[generated video]\nvideo_ref: spirit://generated/video/example.mp4\nread_file_path: spirit://generated/video/example.mp4\nmime_type: video/mp4\nmodel: video-model";
        let block = build_tool_result_block(
            &ToolUiRequest::new("generate_video", json!({ "prompt": "生成一段视频" })),
            "generate_video",
            Some("tool-call-video"),
            output,
        );

        assert_eq!(block.headline, "视频生成完成");
        assert_eq!(
            block.detail_lines,
            vec!["路径: spirit://generated/video/example.mp4"]
        );
        assert_eq!(
            block.video_paths,
            vec!["spirit://generated/video/example.mp4"]
        );
    }

    #[test]
    fn tool_approval_block_uses_shell_reason_as_headline() {
        let block = tool_approval_block(
            "run_shell_command",
            Some("call_00_demo"),
            "理由: 查看构建输出\n高风险工具调用: shell\n终端: Command Prompt (cmd.exe)\n命令: echo hi",
            true,
        );

        assert_eq!(block.headline, "查看构建输出");
        assert_eq!(
            block.detail_lines,
            vec![
                "高风险工具调用: shell".to_string(),
                "终端: Command Prompt (cmd.exe)".to_string(),
                "命令: echo hi".to_string(),
                "快捷键: Y 允许一次 / N 拒绝 / T 信任并持久化".to_string(),
            ]
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

    #[test]
    fn glob_tool_block_shows_pattern_detail_and_output_excerpt() {
        let output = "[glob]\npattern: src/**/*.ts\nmatches: 2\n\nsrc/app.ts\nsrc/lib/util.ts\n";
        let block = build_tool_result_block(
            &ToolUiRequest::new("glob", json!({ "pattern": "src/**/*.ts" })),
            "glob",
            Some("call_02_glob"),
            output,
        );

        assert_eq!(block.tool_call_id.as_deref(), Some("call_02_glob"));
        assert_eq!(block.headline, "文件匹配完成");
        assert_eq!(block.detail_lines, vec!["模式: src/**/*.ts".to_string()]);
        assert!(
            block
                .output_excerpt
                .as_deref()
                .is_some_and(|text| text.contains("src/app.ts"))
        );
    }
}
