//! TUI manual shell mode helpers.

const LOCAL_SHELL_TOOL_CALL_PREFIX: &str = "local-shell-";

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

pub(crate) fn is_local_tool_call_id(id: &str) -> bool {
    id.starts_with(LOCAL_SHELL_TOOL_CALL_PREFIX)
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
        assert!(is_local_tool_call_id("local-shell-7"));
        assert!(!is_local_tool_call_id("call_123"));
    }

    #[test]
    fn shell_mode_exits_on_backspace_only_when_input_is_empty() {
        assert!(should_exit_shell_mode_on_backspace("", 0, true));
        assert!(!should_exit_shell_mode_on_backspace("echo", 4, true));
        assert!(!should_exit_shell_mode_on_backspace("", 0, false));
    }
}
