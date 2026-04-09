use anyhow::Result;
use clap::{Parser, Subcommand};
use crossterm::{
    event::{
        self, DisableBracketedPaste, DisableMouseCapture, EnableBracketedPaste, EnableMouseCapture,
        Event, KeyCode, KeyEventKind, KeyModifiers, KeyboardEnhancementFlags, MouseButton,
        MouseEventKind, PopKeyboardEnhancementFlags, PushKeyboardEnhancementFlags,
    },
    execute,
    terminal::{
        EnterAlternateScreen, LeaveAlternateScreen, disable_raw_mode, enable_raw_mode,
        supports_keyboard_enhancement,
    },
};
use ratatui::{
    Terminal,
    backend::{Backend, CrosstermBackend},
};
use std::{io, time::Duration};

use spirit_agent::{
    ConfigCommand, KeyCommand, McpCommand, ModelCommand, TuiShell, handle_config_cli,
    handle_mcp_cli, handle_model_cli, logging, ui,
};

const MAX_EVENT_BATCH_PER_TICK: usize = 2048;

#[cfg(target_os = "windows")]
use windows_sys::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_LSHIFT, VK_RSHIFT};

#[derive(Parser)]
#[command(name = "spirit")]
#[command(about = "Spirit Agent — AI 生产力 Agent 工具", long_about = None)]
struct Cli {
    #[arg(short, long, default_value = "false")]
    verbose: bool,

    #[command(subcommand)]
    command: Option<Commands>,
}

#[derive(Subcommand)]
enum Commands {
    Run {
        #[arg(short, long)]
        task: String,
    },
    Skills,
    Schedule {
        #[command(subcommand)]
        action: ScheduleAction,
    },
    Interactive,
    Model {
        #[command(subcommand)]
        action: ModelAction,
    },
    Config {
        #[command(subcommand)]
        action: ConfigAction,
    },
    Mcp {
        #[command(subcommand)]
        action: McpAction,
    },
}

#[derive(Subcommand)]
enum ScheduleAction {
    List,
    Add {
        name: String,
        cron: String,
        task: String,
    },
    Remove {
        name: String,
    },
}

#[derive(Subcommand)]
enum ModelAction {
    List,
    Add {
        name: String,
        #[arg(long)]
        api_base: Option<String>,
        #[arg(long)]
        key: Option<String>,
    },
    Remove {
        name: String,
    },
    Use {
        name: String,
    },
    Current,
}

#[derive(Subcommand)]
enum ConfigAction {
    Show,
    SetBase {
        url: String,
    },
    Key {
        #[command(subcommand)]
        action: KeyAction,
    },
}

#[derive(Subcommand)]
enum KeyAction {
    Set { value: Option<String> },
    Remove,
    Status,
}

#[derive(Subcommand)]
enum McpAction {
    List,
    Show,
    Init {
        #[arg(long, default_value_t = false)]
        force: bool,
    },
    Enable {
        name: String,
    },
    Disable {
        name: String,
    },
    Inspect {
        name: String,
    },
    Tools {
        name: String,
    },
    CallTool {
        name: String,
        tool: String,
        #[arg(long)]
        args_json: Option<String>,
    },
    Resources {
        name: String,
    },
    Prompts {
        name: String,
    },
    ReadResource {
        name: String,
        uri: String,
    },
    GetPrompt {
        name: String,
        prompt: String,
        #[arg(long)]
        args_json: Option<String>,
    },
}

fn main() -> Result<()> {
    spirit_agent::logging::init_logging();
    let cli = Cli::parse();

    if cli.verbose {
        println!("Verbose 模式已开启");
    }

    match cli.command {
        Some(Commands::Run { task }) => {
            println!("执行任务: {}", task);
        }
        Some(Commands::Skills) => {
            println!("可用技能:");
            println!("  - file: 文件操作");
            println!("  - shell: 执行 shell 命令");
            println!("  - schedule: 定时任务");
        }
        Some(Commands::Schedule { action }) => match action {
            ScheduleAction::List => println!("定时任务列表:"),
            ScheduleAction::Add { name, cron, task } => {
                println!("添加定时任务: {} ({}), 任务: {}", name, cron, task);
            }
            ScheduleAction::Remove { name } => println!("删除定时任务: {}", name),
        },
        Some(Commands::Interactive) => run_tui()?,
        Some(Commands::Model { action }) => handle_model_cli(into_model_command(action))?,
        Some(Commands::Config { action }) => handle_config_cli(into_config_command(action))?,
        Some(Commands::Mcp { action }) => handle_mcp_cli(into_mcp_command(action))?,
        None => run_tui()?,
    }

    Ok(())
}

fn into_model_command(action: ModelAction) -> ModelCommand {
    match action {
        ModelAction::List => ModelCommand::List,
        ModelAction::Add {
            name,
            api_base,
            key,
        } => ModelCommand::Add {
            name,
            api_base,
            key,
        },
        ModelAction::Remove { name } => ModelCommand::Remove { name },
        ModelAction::Use { name } => ModelCommand::Use { name },
        ModelAction::Current => ModelCommand::Current,
    }
}

fn into_config_command(action: ConfigAction) -> ConfigCommand {
    match action {
        ConfigAction::Show => ConfigCommand::Show,
        ConfigAction::SetBase { url } => ConfigCommand::SetBase { url },
        ConfigAction::Key { action } => ConfigCommand::Key {
            action: into_key_command(action),
        },
    }
}

fn into_key_command(action: KeyAction) -> KeyCommand {
    match action {
        KeyAction::Set { value } => KeyCommand::Set { value },
        KeyAction::Remove => KeyCommand::Remove,
        KeyAction::Status => KeyCommand::Status,
    }
}

fn into_mcp_command(action: McpAction) -> McpCommand {
    match action {
        McpAction::List => McpCommand::List,
        McpAction::Show => McpCommand::Show,
        McpAction::Init { force } => McpCommand::Init { force },
        McpAction::Enable { name } => McpCommand::Enable { name },
        McpAction::Disable { name } => McpCommand::Disable { name },
        McpAction::Inspect { name } => McpCommand::Inspect { name },
        McpAction::Tools { name } => McpCommand::Tools { name },
        McpAction::CallTool {
            name,
            tool,
            args_json,
        } => McpCommand::CallTool {
            name,
            tool,
            args_json,
        },
        McpAction::Resources { name } => McpCommand::Resources { name },
        McpAction::Prompts { name } => McpCommand::Prompts { name },
        McpAction::ReadResource { name, uri } => McpCommand::ReadResource { name, uri },
        McpAction::GetPrompt {
            name,
            prompt,
            args_json,
        } => McpCommand::GetPrompt {
            name,
            prompt,
            args_json,
        },
    }
}

fn run_tui() -> Result<()> {
    enable_raw_mode()?;
    let mut stdout = io::stdout();
    execute!(stdout, EnterAlternateScreen)?;

    let backend = CrosstermBackend::new(stdout);
    let mut terminal = Terminal::new(backend)?;
    let supports_keyboard_enhancement = matches!(supports_keyboard_enhancement(), Ok(true));
    logging::log_event(&format!(
        "[keyboard] supports_keyboard_enhancement={} platform=windows",
        supports_keyboard_enhancement
    ));

    if supports_keyboard_enhancement {
        execute!(
            terminal.backend_mut(),
            PushKeyboardEnhancementFlags(
                KeyboardEnhancementFlags::DISAMBIGUATE_ESCAPE_CODES
                    | KeyboardEnhancementFlags::REPORT_ALL_KEYS_AS_ESCAPE_CODES
                    | KeyboardEnhancementFlags::REPORT_ALTERNATE_KEYS
                    | KeyboardEnhancementFlags::REPORT_EVENT_TYPES
            )
        )?;
    }

    execute!(terminal.backend_mut(), EnableBracketedPaste)?;

    let run_result = run_app(&mut terminal);

    let _ = disable_raw_mode();
    if supports_keyboard_enhancement {
        let _ = execute!(
            terminal.backend_mut(),
            PopKeyboardEnhancementFlags,
            DisableBracketedPaste,
            LeaveAlternateScreen,
            DisableMouseCapture
        );
    } else {
        let _ = execute!(
            terminal.backend_mut(),
            DisableBracketedPaste,
            LeaveAlternateScreen,
            DisableMouseCapture
        );
    }
    let _ = terminal.show_cursor();
    run_result
}

fn run_app<B: Backend + io::Write>(terminal: &mut Terminal<B>) -> Result<()> {
    let mut shell = TuiShell::new();
    shell.refresh_suggestions();
    execute!(terminal.backend_mut(), EnableMouseCapture)?;

    while !shell.should_quit() {
        shell.poll_runtime();
        shell.handle_stream_stall_timeout();
        shell.tick();
        terminal.draw(|frame| {
            ui::draw_ui(frame, &mut shell);
        })?;

        if !event::poll(Duration::from_millis(100))? {
            continue;
        }

        let mut events = vec![event::read()?];
        while events.len() < MAX_EVENT_BATCH_PER_TICK && event::poll(Duration::from_millis(0))? {
            events.push(event::read()?);
        }

        process_event_batch(&mut shell, events);
    }

    Ok(())
}

fn process_event_batch(shell: &mut TuiShell, events: Vec<Event>) {
    let mut pending_text = String::new();
    let mut bracketed_paste_chars = 0usize;
    let mut bracketed_paste_lines = 0usize;

    for evt in events {
        match evt {
            Event::Resize(_, _) => continue,
            Event::Mouse(mouse) => {
                flush_pending_text(shell, &mut pending_text);
                match mouse.kind {
                    MouseEventKind::ScrollUp => shell.scroll_history_up(3),
                    MouseEventKind::ScrollDown => shell.scroll_history_down(3),
                    MouseEventKind::Down(MouseButton::Left) => {
                        shell.conversation_left_down(mouse.column, mouse.row);
                    }
                    MouseEventKind::Drag(MouseButton::Left) => {
                        shell.conversation_left_drag(mouse.column, mouse.row);
                    }
                    MouseEventKind::Up(MouseButton::Left) => {
                        shell.conversation_left_up();
                    }
                    MouseEventKind::Up(MouseButton::Right) => {
                        if let Err(e) = shell.copy_conversation_selection() {
                            logging::log_event(&format!("clipboard copy failed: {}", e));
                        }
                    }
                    _ => {}
                }
            }
            Event::Paste(text) => {
                if shell.is_model_picker_active()
                    || shell.is_chat_picker_active()
                    || shell.is_image_picker_active()
                {
                    continue;
                }
                let normalized = normalize_pasted_text(&text);
                bracketed_paste_chars += normalized.chars().count();
                bracketed_paste_lines += normalized.lines().count().max(1);
                pending_text.push_str(&normalized);
            }
            Event::Key(key) => {
                if !matches!(key.kind, KeyEventKind::Press | KeyEventKind::Repeat) {
                    continue;
                }

                if !shell.is_model_picker_active()
                    && !shell.is_chat_picker_active()
                    && !shell.is_image_picker_active()
                    && !shell.is_bottom_form_active()
                    && pending_text.is_empty()
                    && matches!(key.code, KeyCode::Char('!'))
                    && !key.modifiers.contains(KeyModifiers::CONTROL)
                    && shell.can_enter_shell_mode()
                {
                    flush_pending_text(shell, &mut pending_text);
                    shell.enter_shell_mode();
                    continue;
                }

                if !shell.is_model_picker_active()
                    && !shell.is_chat_picker_active()
                    && !shell.is_image_picker_active()
                    && let Some(ch) = batched_text_char(&key)
                {
                    pending_text.push(ch);
                    continue;
                }

                flush_pending_text(shell, &mut pending_text);
                process_key_event(shell, key);
            }
            _ => {}
        }
    }

    flush_pending_text(shell, &mut pending_text);
    if bracketed_paste_chars > 0 {
        logging::log_event(&format!(
            "[paste] chars={} lines={}",
            bracketed_paste_chars,
            bracketed_paste_lines.max(1)
        ));
    }
}

fn flush_pending_text(shell: &mut TuiShell, pending_text: &mut String) {
    if pending_text.is_empty() {
        return;
    }

    if shell.is_bottom_form_active() {
        shell.bottom_form_insert_text(pending_text);
    } else {
        shell.insert_text_at_cursor(pending_text);
        shell.clamp_cursor();
        shell.refresh_suggestions();
    }
    pending_text.clear();
}

fn batched_text_char(key: &crossterm::event::KeyEvent) -> Option<char> {
    match key.code {
        KeyCode::Char(ch) if !key.modifiers.contains(KeyModifiers::CONTROL) => Some(ch),
        _ => None,
    }
}

fn process_key_event(shell: &mut TuiShell, key: crossterm::event::KeyEvent) {
    if shell.is_model_picker_active() {
        match key.code {
            KeyCode::Esc => shell.cancel_model_picker(),
            KeyCode::Up => shell.select_prev_model(),
            KeyCode::Down => shell.select_next_model(),
            KeyCode::Enter => shell.confirm_model_picker(),
            KeyCode::Char('c') if key.modifiers.contains(KeyModifiers::CONTROL) => {
                shell.request_quit();
            }
            _ => {}
        }
        return;
    }

    if shell.is_chat_picker_active() {
        match key.code {
            KeyCode::Esc => shell.cancel_chat_picker(),
            KeyCode::Up => shell.select_prev_chat(),
            KeyCode::Down => shell.select_next_chat(),
            KeyCode::Enter => shell.confirm_chat_picker(),
            KeyCode::Char('c') if key.modifiers.contains(KeyModifiers::CONTROL) => {
                shell.request_quit();
            }
            _ => {}
        }
        return;
    }

    if shell.is_image_picker_active() {
        match key.code {
            KeyCode::Esc => shell.cancel_image_picker(),
            KeyCode::Up => shell.select_prev_image(),
            KeyCode::Down => shell.select_next_image(),
            KeyCode::Enter => shell.confirm_image_picker(),
            KeyCode::Char('c') if key.modifiers.contains(KeyModifiers::CONTROL) => {
                shell.request_quit();
            }
            _ => {}
        }
        return;
    }

    if shell.is_bottom_form_active() {
        match key.code {
            KeyCode::Esc => shell.cancel_bottom_form(),
            KeyCode::Up => shell.select_prev_bottom_form_field(),
            KeyCode::Down => shell.select_next_bottom_form_field(),
            KeyCode::Left => shell.bottom_form_move_left(),
            KeyCode::Right => shell.bottom_form_move_right(),
            KeyCode::Home => shell.bottom_form_move_home(),
            KeyCode::End => shell.bottom_form_move_end(),
            KeyCode::Enter if enter_should_insert_newline(key.modifiers) => {
                shell.bottom_form_insert_char('\n');
            }
            KeyCode::Enter => shell.save_bottom_form(),
            KeyCode::Char(ch)
                if ch.eq_ignore_ascii_case(&'v')
                    && key.modifiers.contains(KeyModifiers::CONTROL) =>
            {
                if let Err(e) = shell.paste_bottom_form_from_clipboard() {
                    logging::log_event(&format!("clipboard paste failed: {}", e));
                }
            }
            KeyCode::Char('c') if key.modifiers.contains(KeyModifiers::CONTROL) => {
                shell.request_quit();
            }
            KeyCode::Backspace => shell.bottom_form_backspace(),
            KeyCode::Delete => shell.bottom_form_delete(),
            KeyCode::Char(ch) if !key.modifiers.contains(KeyModifiers::CONTROL) => {
                shell.bottom_form_insert_char(ch)
            }
            _ => {}
        }
        return;
    }

    let suggestion_mode =
        shell.is_input_suggestion_active() && !shell.view_model().slash_suggestions.is_empty();
    let should_insert_newline =
        matches!(key.code, KeyCode::Enter) && enter_should_insert_newline(key.modifiers);
    maybe_log_key_event(&key, should_insert_newline);

    match key.code {
        KeyCode::Esc => shell.request_quit(),
        KeyCode::Char(ch)
            if ch.eq_ignore_ascii_case(&'c')
                && key.modifiers.contains(KeyModifiers::CONTROL)
                && key.modifiers.contains(KeyModifiers::SHIFT) =>
        {
            if let Err(e) = shell.copy_conversation_selection() {
                logging::log_event(&format!("clipboard copy failed: {}", e));
            }
        }
        KeyCode::Char(ch)
            if ch.eq_ignore_ascii_case(&'v') && key.modifiers.contains(KeyModifiers::CONTROL) =>
        {
            if let Err(e) = shell.paste_from_clipboard() {
                logging::log_event(&format!("clipboard paste failed: {}", e));
            }
        }
        KeyCode::Char('c') if key.modifiers.contains(KeyModifiers::CONTROL) => shell.request_quit(),
        KeyCode::Char('o') if key.modifiers.contains(KeyModifiers::CONTROL) => {
            shell.toggle_aux_details()
        }
        KeyCode::Up if suggestion_mode => shell.select_prev_suggestion(),
        KeyCode::Down if suggestion_mode => shell.select_next_suggestion(),
        KeyCode::Tab if suggestion_mode => shell.apply_selected_suggestion(),
        KeyCode::PageUp => shell.scroll_history_up(8),
        KeyCode::PageDown => shell.scroll_history_down(8),
        KeyCode::Home if key.modifiers.contains(KeyModifiers::CONTROL) => {
            shell.scroll_history_to_top()
        }
        KeyCode::End if key.modifiers.contains(KeyModifiers::CONTROL) => {
            shell.scroll_history_to_bottom()
        }
        KeyCode::Left => shell.move_cursor_left(),
        KeyCode::Right => shell.move_cursor_right(),
        KeyCode::Home => shell.move_cursor_home(),
        KeyCode::End => shell.move_cursor_end(),
        KeyCode::Enter if should_insert_newline => {
            shell.insert_newline_at_cursor();
            shell.clamp_cursor();
            shell.refresh_suggestions();
        }
        KeyCode::Enter
            if shell.is_file_reference_mode_active()
                && (shell.view_model().input_suggestion_loading
                    || !shell.view_model().slash_suggestions.is_empty()) =>
        {
            shell.confirm_selected_file_reference();
        }
        KeyCode::Enter => shell.submit_input(),
        KeyCode::Backspace if shell.should_exit_shell_mode_on_backspace() => {
            shell.exit_shell_mode();
        }
        KeyCode::Backspace => {
            shell.backspace_at_cursor();
            shell.clamp_cursor();
            shell.refresh_suggestions();
        }
        KeyCode::Delete => {
            shell.delete_at_cursor();
            shell.clamp_cursor();
            shell.refresh_suggestions();
        }
        KeyCode::Char(ch) => {
            if !key.modifiers.contains(KeyModifiers::CONTROL) {
                shell.insert_char_at_cursor(ch);
                shell.clamp_cursor();
                shell.refresh_suggestions();
            }
        }
        _ => {}
    }
}

fn enter_should_insert_newline(modifiers: KeyModifiers) -> bool {
    if modifiers.contains(KeyModifiers::CONTROL) {
        return false;
    }

    // Windows Terminal / ConPTY often omit SHIFT on Shift+Enter; `shift_pressed_fallback` fixes that.
    // Some builds map Shift+Enter to Alt+Enter instead.
    shift_pressed_fallback()
        || modifiers.contains(KeyModifiers::SHIFT)
        || modifiers.contains(KeyModifiers::ALT)
}

fn maybe_log_key_event(key: &crossterm::event::KeyEvent, should_insert_newline: bool) {
    if !matches!(key.code, KeyCode::Enter | KeyCode::Char('\\')) {
        return;
    }

    logging::log_event(&format!(
        "[keyboard] key={:?} shift_fallback={} insert_newline={}",
        key,
        shift_pressed_fallback(),
        should_insert_newline
    ));
}

fn normalize_pasted_text(text: &str) -> String {
    text.replace("\r\n", "\n").replace('\r', "\n")
}

#[cfg(target_os = "windows")]
fn shift_pressed_fallback() -> bool {
    unsafe {
        (GetAsyncKeyState(VK_LSHIFT as i32) as u16 & 0x8000) != 0
            || (GetAsyncKeyState(VK_RSHIFT as i32) as u16 & 0x8000) != 0
    }
}

#[cfg(not(target_os = "windows"))]
fn shift_pressed_fallback() -> bool {
    false
}
