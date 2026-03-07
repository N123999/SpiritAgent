use anyhow::Result;
use clap::{Parser, Subcommand};
use crossterm::{
    event::{self, Event, KeyCode, KeyEventKind, KeyModifiers},
    execute,
    terminal::{EnterAlternateScreen, LeaveAlternateScreen, disable_raw_mode, enable_raw_mode},
};
use ratatui::{
    Terminal,
    backend::{Backend, CrosstermBackend},
    layout::{Constraint, Direction, Layout},
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{Block, Borders, Paragraph, Wrap},
};
use std::{io, time::Duration};

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
    /// 运行 Agent 任务
    Run {
        /// 任务描述
        #[arg(short, long)]
        task: String,
    },
    /// 列出可用的 Agent 技能
    Skills,
    /// 定时任务管理
    Schedule {
        #[command(subcommand)]
        action: ScheduleAction,
    },
    /// 交互模式
    Interactive,
}

#[derive(Subcommand)]
enum ScheduleAction {
    /// 列出所有定时任务
    List,
    /// 添加新的定时任务
    Add {
        /// 任务名称
        name: String,
        /// Cron 表达式
        cron: String,
        /// 任务内容
        task: String,
    },
    /// 删除定时任务
    Remove {
        /// 任务名称
        name: String,
    },
}

fn main() -> Result<()> {
    let cli = Cli::parse();

    if cli.verbose {
        println!("🔍 Verbose 模式已开启");
    }

    match cli.command {
        Some(Commands::Run { task }) => {
            println!("🚀 执行任务: {}", task);
            // TODO: 调用 Agent 执行任务
        }
        Some(Commands::Skills) => {
            println!("📋 可用技能:");
            println!("  - file: 文件操作");
            println!("  - shell: 执行 shell 命令");
            println!("  - schedule: 定时任务");
            // TODO: 动态加载技能
        }
        Some(Commands::Schedule { action }) => match action {
            ScheduleAction::List => {
                println!("📅 定时任务列表:");
                // TODO: 读取并显示定时任务
            }
            ScheduleAction::Add { name, cron, task } => {
                println!("➕ 添加定时任务: {} ({}), 任务: {}", name, cron, task);
                // TODO: 保存定时任务配置
            }
            ScheduleAction::Remove { name } => {
                println!("🗑️ 删除定时任务: {}", name);
                // TODO: 删除定时任务
            }
        },
        Some(Commands::Interactive) => {
            run_tui()?;
        }
        None => {
            run_tui()?;
        }
    }

    Ok(())
}

struct ChatMessage {
    role: MessageRole,
    content: String,
}

enum MessageRole {
    User,
    Agent,
}

struct App {
    input: String,
    messages: Vec<ChatMessage>,
    slash_commands: Vec<&'static str>,
    slash_suggestions: Vec<&'static str>,
    selected_suggestion: usize,
    should_quit: bool,
}

impl App {
    fn new() -> Self {
        let slash_commands = vec!["/help", "/clear", "/quit", "/exit"];
        Self {
            input: String::new(),
            messages: vec![ChatMessage {
                role: MessageRole::Agent,
                content:
                    "欢迎来到 SpiritAgent。输入内容并按 Enter 发送，输入 /help 查看指令。".to_string(),
            }],
            slash_suggestions: slash_commands.clone(),
            slash_commands,
            selected_suggestion: 0,
            should_quit: false,
        }
    }

    fn current_slash_query(&self) -> Option<&str> {
        if !self.input.starts_with('/') || self.input.contains(' ') {
            return None;
        }

        Some(&self.input)
    }

    fn refresh_suggestions(&mut self) {
        let Some(query) = self.current_slash_query() else {
            self.slash_suggestions.clear();
            self.selected_suggestion = 0;
            return;
        };

        self.slash_suggestions = self
            .slash_commands
            .iter()
            .copied()
            .filter(|cmd| cmd.starts_with(query))
            .collect();

        if self.selected_suggestion >= self.slash_suggestions.len() {
            self.selected_suggestion = 0;
        }
    }

    fn select_next_suggestion(&mut self) {
        if self.slash_suggestions.is_empty() {
            return;
        }

        self.selected_suggestion = (self.selected_suggestion + 1) % self.slash_suggestions.len();
    }

    fn select_prev_suggestion(&mut self) {
        if self.slash_suggestions.is_empty() {
            return;
        }

        if self.selected_suggestion == 0 {
            self.selected_suggestion = self.slash_suggestions.len() - 1;
        } else {
            self.selected_suggestion -= 1;
        }
    }

    fn apply_selected_suggestion(&mut self) {
        if let Some(selected) = self.slash_suggestions.get(self.selected_suggestion) {
            self.input = (*selected).to_string();
            self.refresh_suggestions();
        }
    }

    fn is_slash_mode_active(&self) -> bool {
        self.current_slash_query().is_some()
    }

    fn submit_input(&mut self) {
        let message = self.input.trim().to_string();
        if message.is_empty() {
            return;
        }

        self.messages.push(ChatMessage {
            role: MessageRole::User,
            content: message.clone(),
        });

        if message == "/quit" || message == "/exit" {
            self.messages.push(ChatMessage {
                role: MessageRole::Agent,
                content: "收到，SpiritAgent 即将退出。".to_string(),
            });
            self.should_quit = true;
        } else if message == "/help" {
            self.messages.push(ChatMessage {
                role: MessageRole::Agent,
                content: "可用指令: /help, /quit, /clear".to_string(),
            });
        } else if message == "/clear" {
            self.messages.clear();
            self.messages.push(ChatMessage {
                role: MessageRole::Agent,
                content: "对话历史已清空。".to_string(),
            });
        } else {
            self.messages.push(ChatMessage {
                role: MessageRole::Agent,
                content: format!(
                    "已收到: \"{}\"。\n下一步可以接入真实 LLM、工具调用、任务编排和 CI/CD 执行。",
                    message
                ),
            });
        }

        self.input.clear();
        self.refresh_suggestions();
    }
}

fn run_tui() -> Result<()> {
    enable_raw_mode()?;
    let mut stdout = io::stdout();
    execute!(stdout, EnterAlternateScreen)?;

    let backend = CrosstermBackend::new(stdout);
    let mut terminal = Terminal::new(backend)?;

    let run_result = run_app(&mut terminal);

    disable_raw_mode()?;
    execute!(terminal.backend_mut(), LeaveAlternateScreen)?;
    terminal.show_cursor()?;

    run_result
}

fn run_app<B: Backend>(terminal: &mut Terminal<B>) -> Result<()> {
    let mut app = App::new();
    app.refresh_suggestions();

    while !app.should_quit {
        terminal.draw(|frame| draw_ui(frame, &app))?;

        if event::poll(Duration::from_millis(100))? {
            let Event::Key(key) = event::read()? else {
                continue;
            };

            if !matches!(key.kind, KeyEventKind::Press | KeyEventKind::Repeat) {
                continue;
            }

            let slash_mode = app.is_slash_mode_active() && !app.slash_suggestions.is_empty();

            match key.code {
                KeyCode::Esc => app.should_quit = true,
                KeyCode::Char('c') if key.modifiers.contains(KeyModifiers::CONTROL) => {
                    app.should_quit = true;
                }
                KeyCode::Up if slash_mode => app.select_prev_suggestion(),
                KeyCode::Down if slash_mode => app.select_next_suggestion(),
                KeyCode::Tab if slash_mode => app.apply_selected_suggestion(),
                KeyCode::Enter => app.submit_input(),
                KeyCode::Backspace => {
                    app.input.pop();
                    app.refresh_suggestions();
                }
                KeyCode::Char(ch) => {
                    if !key.modifiers.contains(KeyModifiers::CONTROL) {
                        app.input.push(ch);
                        app.refresh_suggestions();
                    }
                }
                _ => {}
            }
        }
    }

    Ok(())
}

fn draw_ui(frame: &mut ratatui::Frame<'_>, app: &App) {
    let show_suggestions = app.input.starts_with('/');

    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints(if show_suggestions {
            vec![
                Constraint::Length(8),
                Constraint::Min(5),
                Constraint::Length(3),
                Constraint::Length(5),
                Constraint::Length(1),
            ]
        } else {
            vec![
                Constraint::Length(8),
                Constraint::Min(6),
                Constraint::Length(3),
                Constraint::Length(1),
            ]
        })
        .split(frame.area());

    let logo = Paragraph::new(vec![
        Line::from(" ███████╗██████╗ ██╗██████╗ ██╗████████╗ █████╗  ██████╗ ███████╗███╗   ██╗████████╗"),
        Line::from(" ██╔════╝██╔══██╗██║██╔══██╗██║╚══██╔══╝██╔══██╗██╔════╝ ██╔════╝████╗  ██║╚══██╔══╝"),
        Line::from(" ███████╗██████╔╝██║██████╔╝██║   ██║   ███████║██║  ███╗█████╗  ██╔██╗ ██║   ██║   "),
        Line::from(" ╚════██║██╔═══╝ ██║██╔══██╗██║   ██║   ██╔══██║██║   ██║██╔══╝  ██║╚██╗██║   ██║   "),
        Line::from(" ███████║██║     ██║██║  ██║██║   ██║   ██║  ██║╚██████╔╝███████╗██║ ╚████║   ██║   "),
        Line::from(" ╚══════╝╚═╝     ╚═╝╚═╝  ╚═╝╚═╝   ╚═╝   ╚═╝  ╚═╝ ╚═════╝ ╚══════╝╚═╝  ╚═══╝   ╚═╝   "),
    ])
    .block(Block::default().borders(Borders::ALL).title("SpiritAgent"))
    .style(Style::default().fg(Color::Cyan));
    frame.render_widget(logo, chunks[0]);

    let history_lines = build_history_lines(app, chunks[1].height.saturating_sub(2) as usize);
    let history = Paragraph::new(history_lines)
        .block(Block::default().borders(Borders::ALL).title("Conversation"))
        .wrap(Wrap { trim: false });
    frame.render_widget(history, chunks[1]);

    let input = Paragraph::new(app.input.as_str())
        .block(Block::default().borders(Borders::ALL).title("Input"))
        .style(Style::default().fg(Color::Yellow));
    frame.render_widget(input, chunks[2]);

    if show_suggestions {
        let suggestions = build_suggestion_lines(app, 3);
        let suggestions_widget = Paragraph::new(suggestions)
            .block(Block::default().borders(Borders::ALL).title("Slash Commands"))
            .wrap(Wrap { trim: true });
        frame.render_widget(suggestions_widget, chunks[3]);
    }

    let help = Paragraph::new(Line::from(vec![
        Span::styled("Enter", Style::default().add_modifier(Modifier::BOLD)),
        Span::raw(" send  |  "),
        Span::styled("Tab", Style::default().add_modifier(Modifier::BOLD)),
        Span::raw(" complete  |  "),
        Span::styled("Up/Down", Style::default().add_modifier(Modifier::BOLD)),
        Span::raw(" pick  |  "),
        Span::styled("Esc / Ctrl+C", Style::default().add_modifier(Modifier::BOLD)),
        Span::raw(" quit"),
    ]));
    let help_idx = if show_suggestions { 4 } else { 3 };
    frame.render_widget(help, chunks[help_idx]);
}

fn build_history_lines(app: &App, max_lines: usize) -> Vec<Line<'static>> {
    let mut lines = Vec::new();

    for msg in &app.messages {
        let (prefix, color) = match msg.role {
            MessageRole::User => ("You", Color::Green),
            MessageRole::Agent => ("Spirit", Color::Cyan),
        };

        lines.push(Line::from(vec![
            Span::styled(
                format!("{}> ", prefix),
                Style::default().fg(color).add_modifier(Modifier::BOLD),
            ),
            Span::raw(msg.content.clone()),
        ]));
    }

    if lines.len() > max_lines && max_lines > 0 {
        lines.split_off(lines.len() - max_lines)
    } else {
        lines
    }
}

fn build_suggestion_lines(app: &App, max_items: usize) -> Vec<Line<'static>> {
    if !app.input.starts_with('/') {
        return vec![Line::from("输入 / 触发命令补全")];
    }

    if app.slash_suggestions.is_empty() {
        return vec![Line::from("没有匹配的命令")];
    }

    let selected = app.selected_suggestion;
    let total = app.slash_suggestions.len();
    let window = max_items.max(1);
    let start = if selected + 1 > window {
        selected + 1 - window
    } else {
        0
    };
    let end = (start + window).min(total);

    let mut lines = Vec::new();
    for idx in start..end {
        let cmd = app.slash_suggestions[idx];
        let is_selected = idx == selected;
        let marker = if is_selected { "> " } else { "  " };
        let style = if is_selected {
            Style::default()
                .fg(Color::Cyan)
                .add_modifier(Modifier::BOLD | Modifier::REVERSED)
        } else {
            Style::default().fg(Color::White)
        };

        lines.push(Line::from(Span::styled(
            format!("{}{}", marker, cmd),
            style,
        )));
    }

    lines
}
