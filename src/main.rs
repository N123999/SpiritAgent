use anyhow::{Context, Result, anyhow};
use clap::{Parser, Subcommand};
use crossterm::{
    event::{self, Event, KeyCode, KeyEventKind, KeyModifiers, MouseEventKind},
    execute,
    event::{DisableMouseCapture, EnableMouseCapture},
    terminal::{EnterAlternateScreen, LeaveAlternateScreen, disable_raw_mode, enable_raw_mode},
};
use ratatui::{
    Terminal,
    backend::{Backend, CrosstermBackend},
};
use std::{
    env, io,
    sync::mpsc::{self, Receiver, TryRecvError},
    thread,
    time::Duration,
};
mod model_registry;
mod llm_client;
mod ui;
use llm_client::{LlmMessage, query_openai_compatible};
use model_registry::{
    AppConfig, DEFAULT_API_BASE, ModelProfile, config_file_path, has_model_api_key, keyring_entry,
    load_config, remove_model_api_key, save_config, save_model_api_key,
};

const ENV_API_KEY: &str = "SPIRIT_API_KEY";

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
    /// 模型管理
    Model {
        #[command(subcommand)]
        action: ModelAction,
    },
    /// 配置管理
    Config {
        #[command(subcommand)]
        action: ConfigAction,
    },
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

#[derive(Subcommand)]
enum ModelAction {
    /// 列出模型
    List,
    /// 添加模型（包含端点和密钥）
    Add {
        name: String,
        #[arg(long)]
        api_base: Option<String>,
        #[arg(long)]
        key: Option<String>,
    },
    /// 删除模型
    Remove { name: String },
    /// 切换当前模型
    Use { name: String },
    /// 显示当前模型
    Current,
}

#[derive(Subcommand)]
enum ConfigAction {
    /// 查看配置
    Show,
    /// 设置 API Base URL
    SetBase { url: String },
    /// API Key 管理（系统安全凭据）
    Key {
        #[command(subcommand)]
        action: KeyAction,
    },
}

#[derive(Subcommand)]
enum KeyAction {
    /// 写入 API Key（不提供参数时会安全输入）
    Set {
        /// API Key（可选，建议留空后按提示输入）
        value: Option<String>,
    },
    /// 删除已保存 API Key
    Remove,
    /// 查看 API Key 状态
    Status,
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
        Some(Commands::Model { action }) => {
            handle_model_cli(action)?;
        }
        Some(Commands::Config { action }) => {
            handle_config_cli(action)?;
        }
        None => {
            run_tui()?;
        }
    }

    Ok(())
}

pub(crate) struct ChatMessage {
    pub(crate) role: MessageRole,
    pub(crate) content: String,
}

pub(crate) enum MessageRole {
    User,
    Agent,
}

pub(crate) struct App {
    pub(crate) input: String,
    pub(crate) input_cursor: usize,
    pub(crate) messages: Vec<ChatMessage>,
    llm_history: Vec<LlmMessage>,
    pub(crate) config: AppConfig,
    slash_commands: Vec<String>,
    pub(crate) slash_suggestions: Vec<String>,
    pub(crate) selected_suggestion: usize,
    pub(crate) model_picker_active: bool,
    pub(crate) model_picker_index: usize,
    pub(crate) history_offset_from_bottom: usize,
    pub(crate) pending_response: Option<Receiver<Result<String, String>>>,
    mouse_capture_enabled: bool,
    mouse_capture_requested: Option<bool>,
    should_quit: bool,
}

impl App {
    fn new() -> Self {
        let config = load_config().unwrap_or_else(|_| AppConfig::default());
        let slash_commands = vec![
            "/help".to_string(),
            "/clear".to_string(),
            "/quit".to_string(),
            "/exit".to_string(),
            "/mouse".to_string(),
            "/mouse on".to_string(),
            "/mouse off".to_string(),
            "/model".to_string(),
            "/model list".to_string(),
            "/model use <name>".to_string(),
            "/model add <name> <api_base> <api_key>".to_string(),
            "/model remove <name>".to_string(),
            "/api-base".to_string(),
            "/api-base show".to_string(),
            "/api-base set <url>".to_string(),
        ];
        Self {
            input: String::new(),
            input_cursor: 0,
            messages: vec![ChatMessage {
                role: MessageRole::Agent,
                content:
                    format!(
                        "欢迎来到 SpiritAgent。\n当前模型: {}\n输入内容按 Enter 发送；输入 /help 查看指令。",
                        config.active_model
                    ),
            }],
            llm_history: vec![],
            config,
            slash_suggestions: vec![],
            slash_commands,
            selected_suggestion: 0,
            model_picker_active: false,
            model_picker_index: 0,
            history_offset_from_bottom: 0,
            pending_response: None,
            mouse_capture_enabled: false,
            mouse_capture_requested: None,
            should_quit: false,
        }
    }

    fn request_mouse_capture(&mut self, enabled: bool) {
        self.mouse_capture_requested = Some(enabled);
    }

    fn take_mouse_capture_request(&mut self) -> Option<bool> {
        self.mouse_capture_requested.take()
    }

    fn open_model_picker(&mut self) {
        if self.config.models.is_empty() {
            self.messages.push(ChatMessage {
                role: MessageRole::Agent,
                content: "当前没有可选模型，请先 /model add <name> <api_base> <api_key>。"
                    .to_string(),
            });
            return;
        }

        self.model_picker_index = self
            .config
            .models
            .iter()
            .position(|m| m.name == self.config.active_model)
            .unwrap_or(0);
        self.model_picker_active = true;
        self.set_input(String::new());
        self.refresh_suggestions();
    }

    fn input_len_chars(&self) -> usize {
        self.input.chars().count()
    }

    fn clamp_cursor(&mut self) {
        self.input_cursor = self.input_cursor.min(self.input_len_chars());
    }

    fn cursor_byte_index(&self) -> usize {
        if self.input_cursor == 0 {
            return 0;
        }

        self.input
            .char_indices()
            .nth(self.input_cursor)
            .map(|(idx, _)| idx)
            .unwrap_or(self.input.len())
    }

    fn set_input(&mut self, value: String) {
        self.input = value;
        self.input_cursor = self.input_len_chars();
    }

    fn move_cursor_left(&mut self) {
        if self.input_cursor > 0 {
            self.input_cursor -= 1;
        }
    }

    fn move_cursor_right(&mut self) {
        let len = self.input_len_chars();
        if self.input_cursor < len {
            self.input_cursor += 1;
        }
    }

    fn move_cursor_home(&mut self) {
        self.input_cursor = 0;
    }

    fn move_cursor_end(&mut self) {
        self.input_cursor = self.input_len_chars();
    }

    fn insert_char_at_cursor(&mut self, ch: char) {
        let idx = self.cursor_byte_index();
        self.input.insert(idx, ch);
        self.input_cursor += 1;
    }

    fn backspace_at_cursor(&mut self) {
        if self.input_cursor == 0 {
            return;
        }
        self.move_cursor_left();
        let idx = self.cursor_byte_index();
        self.input.remove(idx);
    }

    fn delete_at_cursor(&mut self) {
        if self.input_cursor >= self.input_len_chars() {
            return;
        }
        let idx = self.cursor_byte_index();
        self.input.remove(idx);
    }

    fn cancel_model_picker(&mut self) {
        self.model_picker_active = false;
    }

    fn select_next_model(&mut self) {
        if self.config.models.is_empty() {
            return;
        }
        self.model_picker_index = (self.model_picker_index + 1) % self.config.models.len();
    }

    fn select_prev_model(&mut self) {
        if self.config.models.is_empty() {
            return;
        }
        if self.model_picker_index == 0 {
            self.model_picker_index = self.config.models.len() - 1;
        } else {
            self.model_picker_index -= 1;
        }
    }

    fn confirm_model_picker(&mut self) {
        let Some(selected) = self
            .config
            .models
            .get(self.model_picker_index)
            .map(|m| m.name.clone())
        else {
            self.model_picker_active = false;
            return;
        };

        self.config.active_model = selected.clone();
        if let Err(err) = save_config(&self.config) {
            self.messages.push(ChatMessage {
                role: MessageRole::Agent,
                content: format!("模型切换成功但保存失败: {}", err),
            });
        } else {
            self.messages.push(ChatMessage {
                role: MessageRole::Agent,
                content: format!("已切换当前模型为: {}", selected),
            });
        }
        self.model_picker_active = false;
    }

    fn current_slash_query(&self) -> Option<&str> {
        if !self.input.starts_with('/') {
            return None;
        }

        Some(self.input.trim_end())
    }

    fn refresh_suggestions(&mut self) {
        let Some(query) = self.current_slash_query().map(ToString::to_string) else {
            self.slash_suggestions.clear();
            self.selected_suggestion = 0;
            return;
        };

        self.slash_suggestions = self
            .slash_commands
            .iter()
            .filter(|cmd| cmd.starts_with(&query))
            .cloned()
            .collect();

        if self.slash_suggestions.is_empty() {
            self.slash_suggestions = contextual_slash_suggestions(query)
                .into_iter()
                .map(ToString::to_string)
                .collect();
        }

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
            self.set_input(selected.to_string());
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

        if self.pending_response.is_some() {
            self.messages.push(ChatMessage {
                role: MessageRole::Agent,
                content: "上一条回复仍在生成中，请稍候。".to_string(),
            });
            return;
        }

        self.messages.push(ChatMessage {
            role: MessageRole::User,
            content: message.clone(),
        });

        if message.starts_with('/') {
            self.handle_slash_command(&message);
        } else {
            self.llm_history.push(LlmMessage {
                role: "user",
                content: message.clone(),
            });
            self.start_background_llm_request(message);
        }

        self.set_input(String::new());
        self.refresh_suggestions();
    }

    fn start_background_llm_request(&mut self, user_message: String) {
        let cfg = self.config.clone();
        let history = self
            .llm_history
            .iter()
            .rev()
            .take(20)
            .cloned()
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect::<Vec<_>>();
        let (tx, rx) = mpsc::channel();

        thread::spawn(move || {
            let result = query_openai_compatible(&cfg, &history, &user_message)
                .map_err(|e| e.to_string());
            let _ = tx.send(result);
        });

        self.pending_response = Some(rx);
    }

    fn poll_pending_response(&mut self) {
        let Some(rx) = &self.pending_response else {
            return;
        };

        match rx.try_recv() {
            Ok(Ok(reply)) => {
                self.messages.push(ChatMessage {
                    role: MessageRole::Agent,
                    content: reply,
                });
                if let Some(last) = self.messages.last() {
                    self.llm_history.push(LlmMessage {
                        role: "assistant",
                        content: last.content.clone(),
                    });
                }
                self.pending_response = None;
            }
            Ok(Err(err)) => {
                self.messages.push(ChatMessage {
                    role: MessageRole::Agent,
                    content: format!("LLM 调用失败: {}", err),
                });
                self.pending_response = None;
            }
            Err(TryRecvError::Disconnected) => {
                self.messages.push(ChatMessage {
                    role: MessageRole::Agent,
                    content: "LLM 请求线程异常中断。".to_string(),
                });
                self.pending_response = None;
            }
            Err(TryRecvError::Empty) => {}
        }
    }

    fn scroll_history_up(&mut self, lines: usize) {
        self.history_offset_from_bottom = self.history_offset_from_bottom.saturating_add(lines);
    }

    fn scroll_history_down(&mut self, lines: usize) {
        self.history_offset_from_bottom = self.history_offset_from_bottom.saturating_sub(lines);
    }

    fn scroll_history_to_top(&mut self) {
        self.history_offset_from_bottom = usize::MAX;
    }

    fn scroll_history_to_bottom(&mut self) {
        self.history_offset_from_bottom = 0;
    }

    fn handle_slash_command(&mut self, message: &str) {
        let parts: Vec<&str> = message.split_whitespace().collect();
        let Some(cmd) = parts.first().copied() else {
            return;
        };

        match cmd {
            "/quit" | "/exit" => {
                self.messages.push(ChatMessage {
                    role: MessageRole::Agent,
                    content: "收到，SpiritAgent 即将退出。".to_string(),
                });
                self.should_quit = true;
            }
            "/help" => {
                self.messages.push(ChatMessage {
                    role: MessageRole::Agent,
                    content: format!(
                        "可用指令:\n- /help\n- /clear\n- /quit\n- /mouse [on|off]\n- /model [list|use <name>|add <name> <api_base> <api_key>|remove <name>]\n- /api-base [show|set <url>]\n\nAPI Key 来源优先级: {} > 模型专属 keyring > 全局 keyring。",
                        ENV_API_KEY
                    ),
                });
            }
            "/clear" => {
                self.messages.clear();
                self.messages.push(ChatMessage {
                    role: MessageRole::Agent,
                    content: "对话历史已清空。".to_string(),
                });
            }
            "/model" => {
                self.handle_model_slash(&parts[1..]);
            }
            "/mouse" => {
                self.handle_mouse_slash(&parts[1..]);
            }
            "/api-base" => {
                self.handle_api_base_slash(&parts[1..]);
            }
            _ => {
                self.messages.push(ChatMessage {
                    role: MessageRole::Agent,
                    content: "未知斜杠命令，输入 /help 查看可用指令。".to_string(),
                });
            }
        }
    }

    fn handle_mouse_slash(&mut self, args: &[&str]) {
        match args {
            [] => {
                self.messages.push(ChatMessage {
                    role: MessageRole::Agent,
                    content: format!(
                        "鼠标模式当前: {}。/mouse on 开启滚轮，/mouse off 关闭以便终端拖拽复制。",
                        if self.mouse_capture_enabled {
                            "on"
                        } else {
                            "off"
                        }
                    ),
                });
            }
            ["on"] => {
                self.request_mouse_capture(true);
                self.messages.push(ChatMessage {
                    role: MessageRole::Agent,
                    content: "已开启鼠标滚轮模式（终端拖拽复制可能受限）。".to_string(),
                });
            }
            ["off"] => {
                self.request_mouse_capture(false);
                self.messages.push(ChatMessage {
                    role: MessageRole::Agent,
                    content: "已关闭鼠标捕获（可恢复终端拖拽复制）。".to_string(),
                });
            }
            _ => {
                self.messages.push(ChatMessage {
                    role: MessageRole::Agent,
                    content: "用法: /mouse [on|off]".to_string(),
                });
            }
        }
    }

    fn handle_model_slash(&mut self, args: &[&str]) {
        match args {
            [] => {
                self.open_model_picker();
            }
            ["list"] => {
                let list = self
                    .config
                    .models
                    .iter()
                    .map(|m| format!("{} ({})", m.name, m.api_base))
                    .collect::<Vec<_>>()
                    .join(", ");
                self.messages.push(ChatMessage {
                    role: MessageRole::Agent,
                    content: format!("当前模型: {}\n模型列表: {}", self.config.active_model, list),
                });
            }
            ["use", model] => {
                if !self.config.has_model(model) {
                    self.messages.push(ChatMessage {
                        role: MessageRole::Agent,
                        content: format!(
                            "模型不存在: {}，先用 /model add {} <api_base> <api_key>",
                            model, model
                        ),
                    });
                    return;
                }
                self.config.active_model = (*model).to_string();
                if let Err(err) = save_config(&self.config) {
                    self.messages.push(ChatMessage {
                        role: MessageRole::Agent,
                        content: format!("切换成功但保存失败: {}", err),
                    });
                } else {
                    self.messages.push(ChatMessage {
                        role: MessageRole::Agent,
                        content: format!("已切换当前模型为: {}", model),
                    });
                }
            }
            ["add", model, api_base, api_key] => {
                if self.config.has_model(model) {
                    self.messages.push(ChatMessage {
                        role: MessageRole::Agent,
                        content: format!("模型已存在: {}", model),
                    });
                    return;
                }

                self.config.add_model(ModelProfile {
                    name: (*model).to_string(),
                    api_base: (*api_base).to_string(),
                });
                if let Err(err) = save_model_api_key(model, api_key) {
                    self.messages.push(ChatMessage {
                        role: MessageRole::Agent,
                        content: format!("模型已添加，但密钥保存失败: {}", err),
                    });
                    return;
                }

                if let Err(err) = save_config(&self.config) {
                    self.messages.push(ChatMessage {
                        role: MessageRole::Agent,
                        content: format!("添加成功但保存失败: {}", err),
                    });
                } else {
                    self.messages.push(ChatMessage {
                        role: MessageRole::Agent,
                        content: format!("已添加模型: {} (api_base: {})", model, api_base),
                    });
                }
            }
            ["remove", model] => {
                if *model == self.config.active_model {
                    self.messages.push(ChatMessage {
                        role: MessageRole::Agent,
                        content: "不能删除当前使用中的模型，请先 /model use 切换。".to_string(),
                    });
                    return;
                }

                let before = self.config.models.len();
                self.config.models.retain(|m| m.name != *model);
                if self.config.models.len() == before {
                    self.messages.push(ChatMessage {
                        role: MessageRole::Agent,
                        content: format!("模型不存在: {}", model),
                    });
                    return;
                }

                if let Err(err) = save_config(&self.config) {
                    self.messages.push(ChatMessage {
                        role: MessageRole::Agent,
                        content: format!("删除成功但保存失败: {}", err),
                    });
                } else {
                    let _ = remove_model_api_key(model);
                    self.messages.push(ChatMessage {
                        role: MessageRole::Agent,
                        content: format!("已删除模型: {}", model),
                    });
                }
            }
            _ => {
                self.messages.push(ChatMessage {
                    role: MessageRole::Agent,
                    content:
                        "用法: /model [list|use <name>|add <name> <api_base> <api_key>|remove <name>]"
                            .to_string(),
                });
            }
        }
    }

    fn handle_api_base_slash(&mut self, args: &[&str]) {
        match args {
            [] | ["show"] => {
                let current_base = self
                    .config
                    .active_model_profile()
                    .map(|m| m.api_base.as_str())
                    .unwrap_or(DEFAULT_API_BASE);
                self.messages.push(ChatMessage {
                    role: MessageRole::Agent,
                    content: format!("当前 API Base: {}", current_base),
                });
            }
            ["set", url] => {
                if let Some(active) = self.config.active_model_profile_mut() {
                    active.api_base = (*url).to_string();
                }
                if let Err(err) = save_config(&self.config) {
                    self.messages.push(ChatMessage {
                        role: MessageRole::Agent,
                        content: format!("设置成功但保存失败: {}", err),
                    });
                } else {
                    self.messages.push(ChatMessage {
                        role: MessageRole::Agent,
                        content: format!("已更新 API Base: {}", url),
                    });
                }
            }
            _ => {
                self.messages.push(ChatMessage {
                    role: MessageRole::Agent,
                    content: "用法: /api-base [show|set <url>]".to_string(),
                });
            }
        }
    }
}

fn handle_model_cli(action: ModelAction) -> Result<()> {
    let mut cfg = load_config()?;

    match action {
        ModelAction::List => {
            println!("当前模型: {}", cfg.active_model);
            println!("模型列表:");
            for model in &cfg.models {
                let key_saved = has_model_api_key(&model.name).unwrap_or(false);
                println!(
                    "  - {}\n    api_base: {}\n    key: {}",
                    model.name,
                    model.api_base,
                    if key_saved { "已保存" } else { "未保存" }
                );
            }
        }
        ModelAction::Add {
            name,
            api_base,
            key,
        } => {
            if cfg.has_model(&name) {
                println!("模型已存在: {}", name);
            } else {
                let api_base = api_base.unwrap_or_else(|| DEFAULT_API_BASE.to_string());
                let key_value = match key {
                    Some(v) => v,
                    None => rpassword::prompt_password("请输入该模型 API Key: ")
                        .context("读取 API Key 输入失败")?,
                };
                if key_value.trim().is_empty() {
                    return Err(anyhow!("API Key 不能为空"));
                }

                cfg.add_model(ModelProfile {
                    name: name.clone(),
                    api_base: api_base.clone(),
                });
                save_model_api_key(&name, &key_value)?;
                save_config(&cfg)?;
                println!("已添加模型: {}", name);
                println!("api_base: {}", api_base);
            }
        }
        ModelAction::Remove { name } => {
            if name == cfg.active_model {
                return Err(anyhow!("不能删除当前模型，请先切换到其他模型"));
            }
            let before = cfg.models.len();
            cfg.models.retain(|m| m.name != name);
            if cfg.models.len() == before {
                println!("模型不存在: {}", name);
            } else {
                save_config(&cfg)?;
                let _ = remove_model_api_key(&name);
                println!("已删除模型: {}", name);
            }
        }
        ModelAction::Use { name } => {
            if !cfg.has_model(&name) {
                return Err(anyhow!("模型不存在，请先添加: {}", name));
            }
            cfg.active_model = name.clone();
            save_config(&cfg)?;
            println!("已切换当前模型为: {}", name);
        }
        ModelAction::Current => {
            println!("当前模型: {}", cfg.active_model);
        }
    }

    Ok(())
}

fn handle_config_cli(action: ConfigAction) -> Result<()> {
    let mut cfg = load_config()?;

    match action {
        ConfigAction::Show => {
            println!("配置文件: {}", config_file_path().display());
            println!("active_model: {}", cfg.active_model);
            println!("models:");
            for model in &cfg.models {
                let key_saved = has_model_api_key(&model.name).unwrap_or(false);
                println!(
                    "  - {} (api_base: {}, key: {})",
                    model.name,
                    model.api_base,
                    if key_saved { "已保存" } else { "未保存" }
                );
            }
            println!("环境变量 {}: {}", ENV_API_KEY, if env::var(ENV_API_KEY).is_ok() { "已设置" } else { "未设置" });
            let keyring_saved = match keyring_entry() {
                Ok(entry) => entry
                    .get_password()
                    .map(|v| !v.trim().is_empty())
                    .unwrap_or(false),
                Err(_) => false,
            };
            println!(
                "系统安全凭据(keyring): {}",
                if keyring_saved { "已保存" } else { "未保存" }
            );
            println!("API Key 读取优先级: {} > keyring", ENV_API_KEY);
        }
        ConfigAction::SetBase { url } => {
            if let Some(active) = cfg.active_model_profile_mut() {
                active.api_base = url.clone();
            }
            save_config(&cfg)?;
            println!("已更新当前模型 API Base: {}", url);
        }
        ConfigAction::Key { action } => {
            handle_key_cli(action)?;
        }
    }

    Ok(())
}

fn handle_key_cli(action: KeyAction) -> Result<()> {
    match action {
        KeyAction::Set { value } => {
            let key = match value {
                Some(v) => v,
                None => rpassword::prompt_password("请输入 API Key: ")
                    .context("读取 API Key 输入失败")?,
            };

            if key.trim().is_empty() {
                return Err(anyhow!("API Key 不能为空"));
            }

            let entry = keyring_entry()?;
            entry
                .set_password(key.trim())
                .context("写入 keyring 失败")?;
            println!("已写入 API Key 到系统安全凭据。{}
优先级仍为环境变量 > keyring。", ENV_API_KEY);
        }
        KeyAction::Remove => {
            let entry = keyring_entry()?;
            match entry.delete_password() {
                Ok(_) => println!("已删除 keyring 中保存的 API Key。"),
                Err(keyring::Error::NoEntry) => println!("keyring 中没有已保存的 API Key。"),
                Err(err) => return Err(anyhow!("删除 keyring API Key 失败: {}", err)),
            }
        }
        KeyAction::Status => {
            let env_set = env::var(ENV_API_KEY)
                .ok()
                .map(|s| !s.trim().is_empty())
                .unwrap_or(false);

            let keyring_set = match keyring_entry() {
                Ok(entry) => match entry.get_password() {
                    Ok(v) => !v.trim().is_empty(),
                    Err(keyring::Error::NoEntry) => false,
                    Err(err) => {
                        println!("keyring 状态读取失败: {}", err);
                        false
                    }
                },
                Err(err) => {
                    println!("keyring 初始化失败: {}", err);
                    false
                }
            };

            println!("{}: {}", ENV_API_KEY, if env_set { "已设置" } else { "未设置" });
            println!(
                "系统安全凭据(keyring): {}",
                if keyring_set { "已保存" } else { "未保存" }
            );
            println!("当前读取优先级: {} > keyring", ENV_API_KEY);
        }
    }

    Ok(())
}

fn run_tui() -> Result<()> {
    enable_raw_mode()?;
    let mut stdout = io::stdout();
    execute!(stdout, EnterAlternateScreen)?;

    let backend = CrosstermBackend::new(stdout);
    let mut terminal = Terminal::new(backend)?;

    let run_result = run_app(&mut terminal);

    disable_raw_mode()?;
    execute!(terminal.backend_mut(), LeaveAlternateScreen, DisableMouseCapture)?;
    terminal.show_cursor()?;

    run_result
}

fn run_app<B: Backend + io::Write>(terminal: &mut Terminal<B>) -> Result<()> {
    let mut app = App::new();
    app.refresh_suggestions();

    while !app.should_quit {
        if let Some(enable_mouse) = app.take_mouse_capture_request() {
            if enable_mouse {
                execute!(terminal.backend_mut(), EnableMouseCapture)?;
            } else {
                execute!(terminal.backend_mut(), DisableMouseCapture)?;
            }
            app.mouse_capture_enabled = enable_mouse;
        }

        app.poll_pending_response();
        terminal.draw(|frame| ui::draw_ui(frame, &app))?;

        if event::poll(Duration::from_millis(100))? {
            let evt = event::read()?;

            if let Event::Mouse(mouse) = &evt {
                if app.mouse_capture_enabled {
                    match mouse.kind {
                        MouseEventKind::ScrollUp => app.scroll_history_up(3),
                        MouseEventKind::ScrollDown => app.scroll_history_down(3),
                        _ => {}
                    }
                }
                continue;
            }

            let Event::Key(key) = evt else {
                continue;
            };

            if !matches!(key.kind, KeyEventKind::Press | KeyEventKind::Repeat) {
                continue;
            }

            if app.model_picker_active {
                match key.code {
                    KeyCode::Esc => app.cancel_model_picker(),
                    KeyCode::Up => app.select_prev_model(),
                    KeyCode::Down => app.select_next_model(),
                    KeyCode::Enter => app.confirm_model_picker(),
                    KeyCode::Char('c') if key.modifiers.contains(KeyModifiers::CONTROL) => {
                        app.should_quit = true;
                    }
                    _ => {}
                }
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
                KeyCode::PageUp => app.scroll_history_up(8),
                KeyCode::PageDown => app.scroll_history_down(8),
                KeyCode::Home if key.modifiers.contains(KeyModifiers::CONTROL) => {
                    app.scroll_history_to_top();
                }
                KeyCode::End if key.modifiers.contains(KeyModifiers::CONTROL) => {
                    app.scroll_history_to_bottom();
                }
                KeyCode::Left => app.move_cursor_left(),
                KeyCode::Right => app.move_cursor_right(),
                KeyCode::Home => app.move_cursor_home(),
                KeyCode::End => app.move_cursor_end(),
                KeyCode::Enter => app.submit_input(),
                KeyCode::Backspace => {
                    app.backspace_at_cursor();
                    app.clamp_cursor();
                    app.refresh_suggestions();
                }
                KeyCode::Delete => {
                    app.delete_at_cursor();
                    app.clamp_cursor();
                    app.refresh_suggestions();
                }
                KeyCode::Char(ch) => {
                    if !key.modifiers.contains(KeyModifiers::CONTROL) {
                        app.insert_char_at_cursor(ch);
                        app.clamp_cursor();
                        app.refresh_suggestions();
                    }
                }
                _ => {}
            }
        }
    }

    Ok(())
}

fn contextual_slash_suggestions(query: String) -> Vec<&'static str> {
    let q = query.trim_end();

    if q == "/model" || q.starts_with("/model ") {
        return vec![
            "/model list",
            "/model use <name>",
            "/model add <name> <api_base> <api_key>",
            "/model remove <name>",
        ]
        .into_iter()
        .filter(|cmd| cmd.starts_with(q))
        .collect();
    }

    if q == "/api-base" || q.starts_with("/api-base ") {
        return vec!["/api-base show", "/api-base set <url>"]
            .into_iter()
            .filter(|cmd| cmd.starts_with(q))
            .collect();
    }

    Vec::new()
}
