use crate::view::{ChatMessage, ToolUiPhase};

const SUBAGENT_SPINNER_PREFIXES: [&str; 4] = ["| ", "/ ", "- ", "\\ "];

pub fn strip_subagent_spinner_prefix(text: &str) -> String {
    let trimmed = text.trim();
    for prefix in SUBAGENT_SPINNER_PREFIXES {
        if let Some(rest) = trimmed.strip_prefix(prefix) {
            return rest.trim().to_string();
        }
    }
    trimmed.to_string()
}

fn is_emoticon_colon(text: &str, colon_idx: usize) -> bool {
    text.as_bytes()
        .get(colon_idx + 1)
        .is_some_and(|next| b")D(P/\\]oO0-3".contains(next))
}

fn last_status_colon_index(text: &str) -> Option<usize> {
    let mut colon_idx = text
        .rfind(':')
        .into_iter()
        .chain(text.rfind('：'))
        .max()
        .unwrap_or(usize::MAX);
    if colon_idx == usize::MAX {
        return None;
    }
    while colon_idx > 0 && is_emoticon_colon(text, colon_idx) {
        let prev_ascii = text[..colon_idx].rfind(':');
        let prev_full = text[..colon_idx].rfind('：');
        colon_idx = prev_ascii.into_iter().chain(prev_full).max().unwrap_or(0);
        if colon_idx == 0 {
            return None;
        }
    }
    Some(colon_idx)
}

fn is_subagent_runtime_status_tail(after: &str) -> bool {
    let tail = after.trim();
    if tail.is_empty() {
        return false;
    }
    if tail.starts_with("The")
        || tail.starts_with("Sub")
        || tail.starts_with("Sp")
        || tail.starts_with("Thinking")
        || tail.starts_with("Compressing")
        || tail.starts_with("运行")
        || tail.starts_with("等待")
        || tail.starts_with("正在")
    {
        return true;
    }
    if tail.starts_with("The user wants") || tail.starts_with("The user is") {
        return true;
    }
    if matches!(tail, "运行中" | "已完成" | "成功" | "完成") {
        return true;
    }
    if tail.starts_with("等待") {
        return true;
    }
    // Short CJK-only progress fragments (e.g. "成功", "正在执行") — not English reasoning.
    tail.chars().count() <= 16 && !tail.chars().any(|ch| ch.is_ascii_alphabetic())
}

fn is_parent_subagent_completion_surface_text(text: &str) -> bool {
    text.contains("子智能体已完成") || text.contains("输出如下")
}

/// Mirrors Desktop `isSubagentStatusSurfaceText` for runtime status lines.
pub fn is_subagent_status_surface_text(text: &str) -> bool {
    let normalized = text.trim();
    if normalized.is_empty() {
        return false;
    }
    if is_parent_subagent_completion_surface_text(normalized) {
        return false;
    }
    if normalized.contains("**") || normalized.contains("\n#") {
        return false;
    }
    if normalized.contains('\n') || normalized.contains('\r') {
        return false;
    }

    let without_spinner = strip_subagent_spinner_prefix(normalized);
    if without_spinner == "Thinking..." || without_spinner == "Compressing..." {
        return true;
    }
    if without_spinner.ends_with(": 运行中") || without_spinner.ends_with("： 运行中") {
        return true;
    }
    if without_spinner.contains(": 等待") || without_spinner.contains("： 等待") {
        return true;
    }

    let colon_idx = match last_status_colon_index(&without_spinner) {
        Some(idx) if idx > 0 => idx,
        _ => return false,
    };
    let before = without_spinner[..colon_idx].trim();
    let after = if let Some(rest) = without_spinner[colon_idx..].strip_prefix(':') {
        rest.trim()
    } else if let Some(rest) = without_spinner[colon_idx..].strip_prefix('：') {
        rest.trim()
    } else {
        return false;
    };

    if after.is_empty() || before.len() < 4 || after.starts_with("```") {
        return false;
    }
    if is_parent_subagent_completion_surface_text(before) {
        return false;
    }
    if without_spinner.chars().count() > 220 {
        return false;
    }
    if after.contains('。')
        || after.contains('！')
        || after.contains('？')
        || after.contains('；')
        || after.contains('*')
        || after.contains('•')
        || after.contains(". ")
        || after.contains("?")
        || after.contains('!')
    {
        return false;
    }
    if !is_subagent_runtime_status_tail(after) {
        return false;
    }
    after.chars().count() <= 200
}

pub fn parse_pending_subagent_status_text(text: &str) -> Option<String> {
    let status = strip_subagent_spinner_prefix(text);
    if status.is_empty() || status == "Thinking..." || status == "Compressing..." {
        return None;
    }
    if !is_subagent_status_surface_text(&status) {
        return None;
    }
    Some(status)
}

pub fn has_active_run_subagent_tool_in_messages(messages: &[ChatMessage]) -> bool {
    messages.iter().any(|message| {
        message
            .tool_block
            .as_ref()
            .is_some_and(|tool| {
                tool.tool_name == "run_subagent"
                    && matches!(
                        tool.phase,
                        ToolUiPhase::Preview | ToolUiPhase::Running | ToolUiPhase::PendingApproval
                    )
            })
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::view::ToolUiBlock;

    #[test]
    fn detects_runtime_subagent_status_lines() {
        assert!(is_subagent_status_surface_text(
            "输出 \"Spirit 牛逼\" 这句话，不要做任何其他事情。: 运行中"
        ));
        assert!(is_subagent_status_surface_text(
            "请输出\"Spirit 牛逼\"这句话。: The"
        ));
        assert!(!is_subagent_status_surface_text("Spirit 牛逼"));
    }

    #[test]
    fn rejects_prose_with_sentence_punctuation_after_colon() {
        assert!(!is_subagent_status_surface_text(
            "输出\"你好\"两个字。: The user is asking me to output \"你好\" (two Chinese characters meaning \"hello\"). This is a very simple and straightforward request."
        ));
    }

    #[test]
    fn active_run_subagent_tool_hides_standalone_status_surface() {
        let messages = vec![ChatMessage::with_tool_block(
            MessageRole::Agent,
            String::new(),
            ToolUiBlock {
                tool_call_id: Some("tc-1".to_string()),
                tool_name: "run_subagent".to_string(),
                phase: ToolUiPhase::Running,
                headline: "SubAgent".to_string(),
                detail_lines: vec![],
                image_paths: vec![],
                video_paths: vec![],
                args_excerpt: None,
                output_excerpt: None,
            },
        )];
        assert!(has_active_run_subagent_tool_in_messages(&messages));
    }
}
