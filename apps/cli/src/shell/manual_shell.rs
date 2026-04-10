//! TUI manual shell mode helpers.

use serde_json::json;
use rust_i18n::t;

use crate::view::{ToolUiBlock, ToolUiPhase};

const LOCAL_SHELL_TOOL_CALL_PREFIX: &str = "local-shell-";
const SHELL_TOOL_NAME: &str = "run_shell_command";
const SHELL_OUTPUT_MAX_CHARS: usize = 3600;
const SHELL_ERROR_MAX_CHARS: usize = 2000;

pub(crate) fn should_enter_shell_mode(
    trigger: char,
    input: &str,
    cursor: usize,
    shell_mode_active: bool,
) -> bool {
    trigger == '!' && !shell_mode_active && input.is_empty() && cursor == 0
}

pub(crate) fn should_exit_shell_mode_on_backspace(
    input: &str,
    cursor: usize,
    shell_mode_active: bool,
) -> bool {
    shell_mode_active && input.is_empty() && cursor == 0
}

pub(crate) fn local_tool_call_id(sequence: usize) -> String {
    format!("{}{sequence}", LOCAL_SHELL_TOOL_CALL_PREFIX)
}

pub(crate) fn is_local_tool_call_id(id: &str) -> bool {
    id.starts_with(LOCAL_SHELL_TOOL_CALL_PREFIX)
}

pub(crate) fn running_block(tool_call_id: &str, command: &str) -> ToolUiBlock {
    ToolUiBlock {
        tool_call_id: Some(tool_call_id.to_string()),
        tool_name: SHELL_TOOL_NAME.to_string(),
        phase: ToolUiPhase::Running,
        headline: t!("shell.manual.running").into_owned(),
        detail_lines: vec![t!("shell.manual.command_detail", command = command).into_owned()],
        args_excerpt: Some(args_excerpt(command)),
        output_excerpt: None,
    }
}

pub(crate) fn success_block(tool_call_id: &str, command: &str, output: &str) -> ToolUiBlock {
    ToolUiBlock {
        tool_call_id: Some(tool_call_id.to_string()),
        tool_name: SHELL_TOOL_NAME.to_string(),
        phase: ToolUiPhase::Succeeded,
        headline: t!("shell.manual.success").into_owned(),
        detail_lines: vec![t!("shell.manual.command_detail", command = command).into_owned()],
        args_excerpt: Some(args_excerpt(command)),
        output_excerpt: Some(truncate_chars(output, SHELL_OUTPUT_MAX_CHARS)),
    }
}

pub(crate) fn failed_block(tool_call_id: &str, command: &str, error: &str) -> ToolUiBlock {
    ToolUiBlock {
        tool_call_id: Some(tool_call_id.to_string()),
        tool_name: SHELL_TOOL_NAME.to_string(),
        phase: ToolUiPhase::Failed,
        headline: t!("shell.manual.failed").into_owned(),
        detail_lines: vec![t!("shell.manual.command_detail", command = command).into_owned()],
        args_excerpt: Some(args_excerpt(command)),
        output_excerpt: Some(truncate_chars(error, SHELL_ERROR_MAX_CHARS)),
    }
}

fn args_excerpt(command: &str) -> String {
    serde_json::to_string_pretty(&json!({ "command": command }))
        .unwrap_or_else(|_| "{}".to_string())
}

fn truncate_chars(text: &str, max_chars: usize) -> String {
    if text.chars().count() <= max_chars {
        return text.to_string();
    }

    let mut result = text.chars().take(max_chars).collect::<String>();
    result.push_str(t!("shell.manual.output_truncated").as_ref());
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shell_mode_only_enters_on_leading_bang() {
        assert!(should_enter_shell_mode('!', "", 0, false));
        assert!(!should_enter_shell_mode('!', "echo", 4, false));
        assert!(!should_enter_shell_mode('!', "", 0, true));
        assert!(!should_enter_shell_mode('/', "", 0, false));
    }

    #[test]
    fn local_tool_call_ids_are_detectable() {
        let id = local_tool_call_id(7);
        assert!(is_local_tool_call_id(&id));
        assert!(!is_local_tool_call_id("call_123"));
    }

    #[test]
    fn shell_mode_exits_on_backspace_only_when_input_is_empty() {
        assert!(should_exit_shell_mode_on_backspace("", 0, true));
        assert!(!should_exit_shell_mode_on_backspace("echo", 4, true));
        assert!(!should_exit_shell_mode_on_backspace("", 0, false));
    }
}