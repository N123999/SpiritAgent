use anyhow::Result;
use clap::{Parser, Subcommand};
use crossterm::{
    event::{self, Event, KeyCode, KeyEventKind, KeyModifiers, MouseButton, MouseEventKind},
    execute,
    event::{DisableMouseCapture, EnableMouseCapture},
    terminal::{EnterAlternateScreen, LeaveAlternateScreen, disable_raw_mode, enable_raw_mode},
};
use ratatui::{
    Terminal,
    backend::{Backend, CrosstermBackend},
};
use std::{io, time::Duration};

use spirit_agent::{
    ConfigCommand, KeyCommand, ModelCommand, TuiShell, handle_config_cli, handle_model_cli,
    logging, ui,
};

#[derive(Parser)]
#[command(name = "spirit-agent")]
#[command(about = "AI 生产力 Agent 工具", long_about = None)]
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
    Remove { name: String },
    Use { name: String },
    Current,
}

#[derive(Subcommand)]
enum ConfigAction {
    Show,
    SetBase { url: String },
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

fn run_tui() -> Result<()> {
    enable_raw_mode()?;
    let mut stdout = io::stdout();
    execute!(stdout, EnterAlternateScreen)?;

    let backend = CrosstermBackend::new(stdout);
    let mut terminal = Terminal::new(backend)?;
    let run_result = run_app(&mut terminal);

    let _ = disable_raw_mode();
    let _ = execute!(terminal.backend_mut(), LeaveAlternateScreen, DisableMouseCapture);
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

        let evt = event::read()?;
        if let Event::Mouse(mouse) = &evt {
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
            continue;
        }

        let Event::Key(key) = evt else {
            continue;
        };

        if !matches!(key.kind, KeyEventKind::Press | KeyEventKind::Repeat) {
            continue;
        }

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
            continue;
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
            continue;
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
            continue;
        }

        let slash_mode = shell.is_slash_mode_active() && !shell.view_model().slash_suggestions.is_empty();

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
            KeyCode::Char('c') if key.modifiers.contains(KeyModifiers::CONTROL) => shell.request_quit(),
            KeyCode::Up if slash_mode => shell.select_prev_suggestion(),
            KeyCode::Down if slash_mode => shell.select_next_suggestion(),
            KeyCode::Tab if slash_mode => shell.apply_selected_suggestion(),
            KeyCode::PageUp => shell.scroll_history_up(8),
            KeyCode::PageDown => shell.scroll_history_down(8),
            KeyCode::Home if key.modifiers.contains(KeyModifiers::CONTROL) => shell.scroll_history_to_top(),
            KeyCode::End if key.modifiers.contains(KeyModifiers::CONTROL) => shell.scroll_history_to_bottom(),
            KeyCode::Left => shell.move_cursor_left(),
            KeyCode::Right => shell.move_cursor_right(),
            KeyCode::Home => shell.move_cursor_home(),
            KeyCode::End => shell.move_cursor_end(),
            KeyCode::Enter => shell.submit_input(),
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

    Ok(())
}
