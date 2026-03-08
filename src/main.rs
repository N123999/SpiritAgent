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
    env, fs, io,
    path::Path,
    sync::mpsc::{self, Receiver, TryRecvError},
    thread,
    time::{Duration, Instant},
};
mod model_registry;
mod llm_client;
mod logging;
mod tool_runtime;
mod chat_store;
mod ui;
use llm_client::{
    LlmMessage, StreamEvent, ToolAgentState, ToolAgentStep, append_tool_result_message,
    compact_history_manual, compact_summary_text, is_context_overflow_error, start_tool_agent_state,
    stream_assistant_from_messages, stream_openai_compatible, tool_agent_next_step,
};
use model_registry::{
    AppConfig, DEFAULT_API_BASE, ModelProfile, config_file_path, has_model_api_key, keyring_entry,
    load_config, remove_model_api_key, save_config, save_model_api_key,
};
use tool_runtime::{AuthorizationDecision, ToolRequest, ToolRuntime, TrustTarget};
use chat_store::{display_name as chat_display_name, list_chat_files, load_chat, save_chat};

const ENV_API_KEY: &str = "SPIRIT_API_KEY";
const STREAM_EVENT_BUDGET_PER_TICK: usize = 128;
const STREAM_STALL_TIMEOUT: Duration = Duration::from_secs(20);
const TOOL_MEMORY_PREFIX: &str = "[TOOL_MEMORY]";
const TOOL_MEMORY_MAX_ENTRIES: usize = 24;
const TOOL_MEMORY_SNIPPET_CHARS: usize = 1200;

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
    logging::init_logging();
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
    pub(crate) chat_picker_active: bool,
    pub(crate) chat_picker_index: usize,
    pub(crate) chat_picker_files: Vec<String>,
    pub(crate) image_picker_active: bool,
    pub(crate) image_picker_index: usize,
    pub(crate) image_picker_files: Vec<String>,
    pub(crate) history_offset_from_bottom: usize,
    pub(crate) pending_response: Option<Receiver<StreamEvent>>,
    pub(crate) pending_assistant_msg_index: Option<usize>,
    pending_started_at: Option<Instant>,
    pending_last_event_at: Option<Instant>,
    stream_chunk_counter: usize,
    pending_user_turn: Option<String>,
    pending_image_paths: Vec<String>,
    thinking_spinner_index: usize,
    thinking_text: String,
    tool_runtime: ToolRuntime,
    pending_tool_approval: Option<PendingToolApproval>,
    pending_tool_agent_step: Option<Receiver<Result<ToolAgentStepResult, String>>>,
    mouse_capture_enabled: bool,
    mouse_capture_requested: Option<bool>,
    should_quit: bool,
}

struct PendingToolApproval {
    request: ToolRequest,
    trust_target: Option<TrustTarget>,
    continuation: Option<ToolApprovalContinuation>,
}

struct ToolApprovalContinuation {
    state: ToolAgentState,
    tool_call_id: String,
    tool_name: String,
}

struct ToolAgentStepResult {
    state: ToolAgentState,
    step: ToolAgentStep,
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
            "/compact".to_string(),
            "/chat".to_string(),
            "/chat save".to_string(),
            "/chat save <path>".to_string(),
            "/chat load <file>".to_string(),
            "/image <path> [prompt]".to_string(),
            "/image pick".to_string(),
            "/image clear".to_string(),
            "/tool shell <command>".to_string(),
            "/tool read <path> [start] [end]".to_string(),
            "/tool search <query>".to_string(),
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
            chat_picker_active: false,
            chat_picker_index: 0,
            chat_picker_files: vec![],
            image_picker_active: false,
            image_picker_index: 0,
            image_picker_files: vec![],
            history_offset_from_bottom: 0,
            pending_response: None,
            pending_assistant_msg_index: None,
            pending_started_at: None,
            pending_last_event_at: None,
            stream_chunk_counter: 0,
            pending_user_turn: None,
            pending_image_paths: vec![],
            thinking_spinner_index: 0,
            thinking_text: String::new(),
            tool_runtime: ToolRuntime::new(),
            pending_tool_approval: None,
            pending_tool_agent_step: None,
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

    fn open_chat_picker(&mut self) {
        match list_chat_files() {
            Ok(files) => {
                if files.is_empty() {
                    self.messages.push(ChatMessage {
                        role: MessageRole::Agent,
                        content: "没有已保存对话。可先使用 /chat save 保存当前会话。".to_string(),
                    });
                    return;
                }

                self.chat_picker_files = files
                    .iter()
                    .map(|p| chat_display_name(p.as_path()))
                    .collect();
                self.chat_picker_index = 0;
                self.chat_picker_active = true;
                self.model_picker_active = false;
                self.set_input(String::new());
                self.refresh_suggestions();
            }
            Err(err) => {
                self.messages.push(ChatMessage {
                    role: MessageRole::Agent,
                    content: format!("读取会话列表失败: {}", err),
                });
            }
        }
    }

    fn cancel_chat_picker(&mut self) {
        self.chat_picker_active = false;
    }

    fn select_next_chat(&mut self) {
        if self.chat_picker_files.is_empty() {
            return;
        }
        self.chat_picker_index = (self.chat_picker_index + 1) % self.chat_picker_files.len();
    }

    fn select_prev_chat(&mut self) {
        if self.chat_picker_files.is_empty() {
            return;
        }
        if self.chat_picker_index == 0 {
            self.chat_picker_index = self.chat_picker_files.len() - 1;
        } else {
            self.chat_picker_index -= 1;
        }
    }

    fn confirm_chat_picker(&mut self) {
        let Some(selected) = self.chat_picker_files.get(self.chat_picker_index).cloned() else {
            self.chat_picker_active = false;
            return;
        };
        self.chat_picker_active = false;
        self.load_chat_by_path(&selected);
    }

    fn open_image_picker(&mut self) {
        match list_local_image_files() {
            Ok(files) => {
                if files.is_empty() {
                    self.messages.push(ChatMessage {
                        role: MessageRole::Agent,
                        content:
                            "当前目录未发现图片文件。可直接用 /image <path> 添加绝对或相对路径。"
                                .to_string(),
                    });
                    return;
                }

                self.image_picker_files = files;
                self.image_picker_index = 0;
                self.image_picker_active = true;
                self.model_picker_active = false;
                self.chat_picker_active = false;
                self.set_input(String::new());
                self.refresh_suggestions();
            }
            Err(err) => {
                self.messages.push(ChatMessage {
                    role: MessageRole::Agent,
                    content: format!("读取图片列表失败: {}", err),
                });
            }
        }
    }

    fn cancel_image_picker(&mut self) {
        self.image_picker_active = false;
    }

    fn select_next_image(&mut self) {
        if self.image_picker_files.is_empty() {
            return;
        }
        self.image_picker_index = (self.image_picker_index + 1) % self.image_picker_files.len();
    }

    fn select_prev_image(&mut self) {
        if self.image_picker_files.is_empty() {
            return;
        }
        if self.image_picker_index == 0 {
            self.image_picker_index = self.image_picker_files.len() - 1;
        } else {
            self.image_picker_index -= 1;
        }
    }

    fn confirm_image_picker(&mut self) {
        let Some(selected) = self.image_picker_files.get(self.image_picker_index).cloned() else {
            self.image_picker_active = false;
            return;
        };

        self.image_picker_active = false;
        self.pending_image_paths.push(selected.clone());
        self.messages.push(ChatMessage {
            role: MessageRole::Agent,
            content: format!(
                "已添加图片到待发送队列（{} 张）: {}",
                self.pending_image_paths.len(),
                selected
            ),
        });
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

        if self.pending_tool_approval.is_some() {
            self.scroll_history_to_bottom();
            self.messages.push(ChatMessage {
                role: MessageRole::User,
                content: message.clone(),
            });
            self.handle_tool_approval_input(&message);
            self.set_input(String::new());
            self.refresh_suggestions();
            return;
        }

        // Sending a new message should always bring the viewport back to live bottom.
        self.scroll_history_to_bottom();

        if self.pending_response.is_some() || self.pending_tool_agent_step.is_some() {
            self.messages.push(ChatMessage {
                role: MessageRole::Agent,
                content: "上一条回复仍在处理中，请稍候。".to_string(),
            });
            return;
        }

        let mut user_content = message.clone();
        if !message.starts_with('/') && !self.pending_image_paths.is_empty() {
            user_content.push_str(&format!(
                "\n[attached images: {}]",
                self.pending_image_paths.join(", ")
            ));
        }

        self.messages.push(ChatMessage {
            role: MessageRole::User,
            content: user_content,
        });

        if message.starts_with('/') {
            self.handle_slash_command(&message);
        } else {
            self.send_user_turn(message.clone(), None);
        }

        self.set_input(String::new());
        self.refresh_suggestions();
    }

    fn send_user_turn(&mut self, text: String, explicit_images: Option<Vec<String>>) {
        let images = explicit_images.unwrap_or_else(|| std::mem::take(&mut self.pending_image_paths));
        self.pending_user_turn = Some(text.clone());
        self.thinking_spinner_index = 0;
        self.llm_history.push(LlmMessage {
            role: "user",
            content: text.clone(),
            image_paths: images,
        });
        let state = start_tool_agent_state(&self.llm_history, &text);
        self.start_tool_agent_step_async(state);
    }

    fn handle_tool_approval_input(&mut self, message: &str) {
        let decision = message.trim().to_lowercase();
        let Some(pending) = self.pending_tool_approval.take() else {
            return;
        };

        match decision.as_str() {
            "y" => self.execute_tool_request_with_continuation(&pending.request, pending.continuation),
            "n" => {
                if let Some(mut cont) = pending.continuation {
                    append_tool_result_message(
                        &mut cont.state,
                        &cont.tool_call_id,
                        "[denied by user] tool call rejected by user approval policy",
                    );
                    self.messages.push(ChatMessage {
                        role: MessageRole::Agent,
                        content: format!(
                            "已拒绝模型工具调用: {}。将继续让模型在无该工具条件下完成任务。",
                            cont.tool_name
                        ),
                    });
                    self.start_tool_agent_step_async(cont.state);
                } else {
                    self.messages.push(ChatMessage {
                        role: MessageRole::Agent,
                        content: "已拒绝本次工具调用。".to_string(),
                    });
                }
            }
            "t" => {
                if let Some(target) = pending.trust_target {
                    if let Err(err) = self.tool_runtime.trust(&target) {
                        self.messages.push(ChatMessage {
                            role: MessageRole::Agent,
                            content: format!("信任规则保存失败: {}", err),
                        });
                    } else {
                        self.messages.push(ChatMessage {
                            role: MessageRole::Agent,
                            content: "已加入信任白名单并持久化。".to_string(),
                        });
                    }
                }
                self.execute_tool_request_with_continuation(&pending.request, pending.continuation);
            }
            _ => {
                // Any non y/n/t input is interpreted as user guidance:
                // deny the tool call and continue the dialogue with this new user instruction.
                if let Some(mut cont) = pending.continuation {
                    append_tool_result_message(
                        &mut cont.state,
                        &cont.tool_call_id,
                        "[denied by user] tool call rejected by user guidance",
                    );
                    cont.state
                        .messages
                        .push(serde_json::json!({"role": "user", "content": message}));

                    self.llm_history.push(LlmMessage {
                        role: "user",
                        content: message.to_string(),
                        image_paths: vec![],
                    });
                    self.pending_user_turn = Some(message.to_string());
                    self.messages.push(ChatMessage {
                        role: MessageRole::Agent,
                        content:
                            "已按你的输入拒绝本次高风险工具调用，并将该输入作为新指令继续处理。"
                                .to_string(),
                    });
                    self.start_tool_agent_step_async(cont.state);
                    return;
                }

                self.llm_history.push(LlmMessage {
                    role: "user",
                    content: message.to_string(),
                    image_paths: vec![],
                });
                self.pending_user_turn = Some(message.to_string());
                self.messages.push(ChatMessage {
                    role: MessageRole::Agent,
                    content:
                        "已拒绝本次高风险工具调用，并将该输入作为新指令继续处理。".to_string(),
                });

                let state = start_tool_agent_state(&self.llm_history, message);
                self.start_tool_agent_step_async(state);
            }
        }
    }

    fn start_tool_agent_step_async(&mut self, state: ToolAgentState) {
        let cfg = self.config.clone();
        let (tx, rx) = mpsc::channel::<Result<ToolAgentStepResult, String>>();
        self.thinking_spinner_index = 0;
        self.thinking_text.clear();

        thread::spawn(move || {
            let mut state = state;
            let tools = ToolRuntime::tool_definitions_json();
            let result = tool_agent_next_step(&cfg, &mut state, &tools)
                .map(|step| ToolAgentStepResult { state, step })
                .map_err(|e| e.to_string());
            let _ = tx.send(result);
        });

        self.pending_tool_agent_step = Some(rx);
    }

    fn poll_pending_tool_agent_step(&mut self) {
        let Some(rx) = &self.pending_tool_agent_step else {
            return;
        };

        match rx.try_recv() {
            Ok(Ok(ToolAgentStepResult { mut state, step })) => {
                self.pending_tool_agent_step = None;
                match step {
                    ToolAgentStep::FinalResponseReady => {
                        self.start_background_final_stream(state.messages);
                    }
                    ToolAgentStep::ToolCall(call) => {
                        let request = match ToolRuntime::request_from_function_call(
                            &call.name,
                            &call.arguments,
                        ) {
                            Ok(r) => r,
                            Err(err) => {
                                append_tool_result_message(
                                    &mut state,
                                    &call.id,
                                    &format!("[tool schema error] {}", err),
                                );
                                self.start_tool_agent_step_async(state);
                                return;
                            }
                        };

                        match self.tool_runtime.authorize(&request) {
                            Ok(AuthorizationDecision::Allowed) => {
                                let tool_output = match self.tool_runtime.execute(&request) {
                                    Ok(result) => {
                                        self.persist_tool_memory(&request, &result);
                                        self.messages.push(ChatMessage {
                                            role: MessageRole::Agent,
                                            content: format_tool_ui_message(
                                                &request,
                                                &call.name,
                                                &result,
                                            ),
                                        });
                                        result
                                    }
                                    Err(err) => {
                                        let e = format!("[tool error] {}", err);
                                        self.messages.push(ChatMessage {
                                            role: MessageRole::Agent,
                                            content: format!("模型工具调用执行失败: {}", err),
                                        });
                                        e
                                    }
                                };
                                append_tool_result_message(&mut state, &call.id, &tool_output);
                                self.start_tool_agent_step_async(state);
                            }
                            Ok(AuthorizationDecision::NeedApproval {
                                prompt,
                                trust_target,
                            }) => {
                                self.pending_tool_approval = Some(PendingToolApproval {
                                    request,
                                    trust_target,
                                    continuation: Some(ToolApprovalContinuation {
                                        state,
                                        tool_call_id: call.id,
                                        tool_name: call.name,
                                    }),
                                });
                                self.messages.push(ChatMessage {
                                    role: MessageRole::Agent,
                                    content: prompt,
                                });
                            }
                            Err(err) => {
                                append_tool_result_message(
                                    &mut state,
                                    &call.id,
                                    &format!("[authorization error] {}", err),
                                );
                                self.start_tool_agent_step_async(state);
                            }
                        }
                    }
                }
            }
            Ok(Err(err)) => {
                self.pending_tool_agent_step = None;
                if self.try_fallback_to_text_only_and_retry(&err) {
                    return;
                }
                if self.try_auto_compact_and_retry(&err) {
                    return;
                }
                self.messages.push(ChatMessage {
                    role: MessageRole::Agent,
                    content: format!("LLM 调用失败: {}", err),
                });
            }
            Err(TryRecvError::Empty) => {}
            Err(TryRecvError::Disconnected) => {
                self.pending_tool_agent_step = None;
                self.messages.push(ChatMessage {
                    role: MessageRole::Agent,
                    content: "LLM 后台任务异常中断。".to_string(),
                });
            }
        }
    }

    fn start_background_final_stream(&mut self, messages: Vec<serde_json::Value>) {
        let cfg = self.config.clone();
        let (tx, rx) = mpsc::channel::<StreamEvent>();
        self.thinking_spinner_index = 0;
        self.thinking_text.clear();

        self.messages.push(ChatMessage {
            role: MessageRole::Agent,
            content: String::new(),
        });
        self.pending_assistant_msg_index = Some(self.messages.len() - 1);
        self.pending_response = Some(rx);

        let now = Instant::now();
        self.pending_started_at = Some(now);
        self.pending_last_event_at = Some(now);
        self.stream_chunk_counter = 0;

        thread::spawn(move || {
            stream_assistant_from_messages(&cfg, &messages, &tx);
        });
    }

    fn start_background_llm_request(&mut self, user_message: String) {
        let cfg = self.config.clone();
        let history = self.llm_history.clone();
        let (tx, rx) = mpsc::channel::<StreamEvent>();
        self.thinking_spinner_index = 0;
        self.thinking_text.clear();

        // Insert an empty assistant bubble so stream chunks can render immediately.
        self.messages.push(ChatMessage {
            role: MessageRole::Agent,
            content: String::new(),
        });
        self.pending_assistant_msg_index = Some(self.messages.len() - 1);

        thread::spawn(move || {
            stream_openai_compatible(&cfg, &history, &user_message, &tx);
        });

        self.pending_response = Some(rx);
        let now = Instant::now();
        self.pending_started_at = Some(now);
        self.pending_last_event_at = Some(now);
        self.stream_chunk_counter = 0;
        logging::log_event("stream started");
    }

    fn is_busy(&self) -> bool {
        self.pending_response.is_some() || self.pending_tool_agent_step.is_some()
    }

    fn tick_thinking_spinner(&mut self) {
        if self.is_busy() {
            self.thinking_spinner_index = (self.thinking_spinner_index + 1) % 4;
        } else {
            self.thinking_spinner_index = 0;
        }
    }

    pub(crate) fn thinking_status_text(&self) -> Option<String> {
        if !self.is_busy() {
            return None;
        }

        let frame = match self.thinking_spinner_index % 4 {
            0 => '|',
            1 => '/',
            2 => '-',
            _ => '\\',
        };
        Some(format!("{} Thinking...", frame))
    }

    pub(crate) fn thinking_content_text(&self) -> Option<&str> {
        if !self.is_busy() || self.thinking_text.trim().is_empty() {
            return None;
        }
        Some(self.thinking_text.as_str())
    }

    fn poll_pending_response(&mut self) {
        let Some(rx) = &self.pending_response else {
            return;
        };

        let mut completed = false;
        let mut assistant_done = false;
        let mut processed = 0usize;

        loop {
            if processed >= STREAM_EVENT_BUDGET_PER_TICK {
                break;
            }

            match rx.try_recv() {
                Ok(StreamEvent::ThinkingChunk(thinking)) => {
                    self.pending_last_event_at = Some(Instant::now());
                    self.thinking_text.push_str(&thinking);
                    processed += 1;
                }
                Ok(StreamEvent::Chunk(chunk)) => {
                    self.pending_last_event_at = Some(Instant::now());
                    self.stream_chunk_counter = self.stream_chunk_counter.saturating_add(1);
                    if let Some(idx) = self.pending_assistant_msg_index {
                        if let Some(msg) = self.messages.get_mut(idx) {
                            msg.content.push_str(&chunk);
                        }
                    }

                    if self.stream_chunk_counter % 100 == 0 {
                        logging::log_event(&format!(
                            "stream chunks={} offset={} input_len={}",
                            self.stream_chunk_counter,
                            self.history_offset_from_bottom,
                            self.input.chars().count()
                        ));
                    }

                    processed += 1;
                }
                Ok(StreamEvent::HistoryCompacted {
                    new_history,
                    dropped_messages,
                }) => {
                    self.pending_last_event_at = Some(Instant::now());
                    self.llm_history = new_history;
                    let summary_preview = compact_summary_text(&self.llm_history)
                        .map(|s| truncate_for_preview(&s, 400))
                        .unwrap_or_else(|| "<无摘要内容>".to_string());
                    self.messages.push(ChatMessage {
                        role: MessageRole::Agent,
                        content: format!(
                            "检测到上下文超限，已调用模型生成/更新压缩摘要并重试（本轮合并 {} 条历史消息）。\n\n压缩摘要预览:\n{}",
                            dropped_messages,
                            summary_preview
                        ),
                    });
                    processed += 1;
                }
                Ok(StreamEvent::Done) => {
                    self.pending_last_event_at = Some(Instant::now());
                    if let Some(idx) = self.pending_assistant_msg_index {
                        if let Some(msg) = self.messages.get(idx) {
                            self.llm_history.push(LlmMessage {
                                role: "assistant",
                                content: msg.content.clone(),
                                image_paths: vec![],
                            });
                        }
                    }
                    completed = true;
                    logging::log_event(&format!(
                        "stream done chunks={} elapsed_ms={}",
                        self.stream_chunk_counter,
                        self.pending_started_at
                            .map(|s| s.elapsed().as_millis())
                            .unwrap_or(0)
                    ));
                    assistant_done = true;
                    self.thinking_text.clear();
                    break;
                }
                Ok(StreamEvent::Error(err)) => {
                    self.pending_last_event_at = Some(Instant::now());
                    if self.try_fallback_to_text_only_and_retry(&err) {
                        if let Some(idx) = self.pending_assistant_msg_index {
                            if let Some(msg) = self.messages.get_mut(idx)
                                && msg.content.trim().is_empty()
                            {
                                msg.content =
                                    "当前模型不支持图片输入，已自动去除图片并重试。".to_string();
                            }
                        }
                        completed = true;
                        self.thinking_text.clear();
                        logging::log_event(&format!(
                            "stream vision unsupported -> auto text-only retry: {}",
                            err
                        ));
                        break;
                    }

                    if self.try_auto_compact_and_retry(&err) {
                        if let Some(idx) = self.pending_assistant_msg_index {
                            if let Some(msg) = self.messages.get_mut(idx)
                                && msg.content.trim().is_empty()
                            {
                                msg.content =
                                    "检测到上下文超限，已自动压缩并重试当前请求。".to_string();
                            }
                        }
                        completed = true;
                        self.thinking_text.clear();
                        logging::log_event(&format!("stream overflow -> auto compact retry: {}", err));
                        break;
                    }

                    if let Some(idx) = self.pending_assistant_msg_index {
                        if let Some(msg) = self.messages.get_mut(idx) {
                            if msg.content.trim().is_empty() {
                                msg.content = format!("LLM 调用失败: {}", err);
                            } else {
                                msg.content.push_str(&format!("\n\n[Error] {}", err));
                            }
                        }
                    } else {
                        self.messages.push(ChatMessage {
                            role: MessageRole::Agent,
                            content: format!("LLM 调用失败: {}", err),
                        });
                    }
                    completed = true;
                    self.thinking_text.clear();
                    logging::log_event(&format!("stream error: {}", err));
                    break;
                }
                Err(TryRecvError::Disconnected) => {
                    if let Some(idx) = self.pending_assistant_msg_index {
                        if let Some(msg) = self.messages.get_mut(idx) {
                            if msg.content.trim().is_empty() {
                                msg.content = "LLM 请求线程异常中断。".to_string();
                            }
                        }
                    }
                    completed = true;
                    self.thinking_text.clear();
                    logging::log_event("stream disconnected");
                    break;
                }
                Err(TryRecvError::Empty) => break,
            }
        }

        if completed {
            self.pending_response = None;
            self.pending_assistant_msg_index = None;
            self.pending_started_at = None;
            self.pending_last_event_at = None;
            self.stream_chunk_counter = 0;
            if assistant_done {
                self.pending_user_turn = None;
            }
        }
    }

    fn handle_stream_stall_timeout(&mut self) {
        if self.pending_response.is_none() {
            return;
        }

        let Some(last_event) = self.pending_last_event_at else {
            return;
        };

        if last_event.elapsed() < STREAM_STALL_TIMEOUT {
            return;
        }

        if let Some(idx) = self.pending_assistant_msg_index {
            if let Some(msg) = self.messages.get_mut(idx) {
                if msg.content.trim().is_empty() {
                    msg.content = "流式响应超时，连接已中断。".to_string();
                } else {
                    msg.content.push_str("\n\n[stream timeout] 响应长时间无数据，已自动停止等待。");
                }
            }
        }

        self.pending_response = None;
        self.pending_assistant_msg_index = None;
        self.pending_started_at = None;
        self.pending_last_event_at = None;
        self.stream_chunk_counter = 0;
        self.thinking_text.clear();
        logging::log_event("stream timeout -> force close");
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
                        "可用指令:\n- /help\n- /clear\n- /quit\n- /mouse [on|off]\n- /model [list|use <name>|add <name> <api_base> <api_key>|remove <name>]\n- /api-base [show|set <url>]\n- /compact\n- /chat\n- /chat save [path]\n- /chat load <file>\n- /image <path> [prompt]\n- /image pick\n- /image clear\n- /tool shell <command>\n- /tool read <path> [start] [end]\n- /tool search <query>\n\n说明:\n- shell 命令执行统一需要审批（y/n/t）。\n- 读取工作目录外文件需要审批（y/n/t）。\n- /tool search 仅搜索工作目录内文件。\n- /chat 打开会话列表选择器。\n- /image pick 打开当前目录图片选择器。\n- /image 不带 prompt 时会把图片加入待发送队列。\n\nAPI Key 来源优先级: {} > 模型专属 keyring > 全局 keyring。",
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
            "/compact" => {
                self.handle_compact_slash();
            }
            "/chat" => {
                self.handle_chat_slash(message);
            }
            "/image" => {
                self.handle_image_slash(message);
            }
            "/tool" => {
                self.handle_tool_slash(message);
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

    fn handle_compact_slash(&mut self) {
        match compact_history_manual(&self.config, &mut self.llm_history) {
            Ok(result) => {
                if result.dropped_messages == 0 {
                    self.messages.push(ChatMessage {
                        role: MessageRole::Agent,
                        content: "当前可压缩历史较少，已跳过压缩。".to_string(),
                    });
                } else {
                    let summary_preview = compact_summary_text(&self.llm_history)
                        .map(|s| truncate_for_preview(&s, 600))
                        .unwrap_or_else(|| "<无摘要内容>".to_string());
                    self.messages.push(ChatMessage {
                        role: MessageRole::Agent,
                        content: format!(
                            "压缩完成：上下文消息 {} -> {}，已全量压缩为摘要并合并 {} 条历史消息（UI 历史保留不变）。\n\n压缩摘要预览:\n{}",
                            result.before_len,
                            result.after_len,
                            result.dropped_messages,
                            summary_preview
                        ),
                    });
                }
            }
            Err(err) => {
                self.messages.push(ChatMessage {
                    role: MessageRole::Agent,
                    content: format!("压缩失败: {}", err),
                });
            }
        }
    }

    fn handle_chat_slash(&mut self, message: &str) {
        let tail = message.strip_prefix("/chat").map(str::trim).unwrap_or("");
        if tail.is_empty() {
            self.open_chat_picker();
            return;
        }

        if tail == "save" {
            self.save_current_chat(None);
            return;
        }

        if let Some(path) = tail.strip_prefix("save ") {
            self.save_current_chat(Some(path.trim()));
            return;
        }

        if let Some(path) = tail.strip_prefix("load ") {
            self.load_chat_by_path(path.trim());
            return;
        }

        if tail == "load" {
            self.messages.push(ChatMessage {
                role: MessageRole::Agent,
                content: "用法: /chat load <file>".to_string(),
            });
            return;
        }

        self.messages.push(ChatMessage {
            role: MessageRole::Agent,
            content: "用法: /chat [save [path]|load <file>]".to_string(),
        });
    }

    fn handle_image_slash(&mut self, message: &str) {
        let tail = message
            .strip_prefix("/image")
            .map(str::trim)
            .unwrap_or("");

        if tail.is_empty() {
            self.messages.push(ChatMessage {
                role: MessageRole::Agent,
                content:
                    "用法: /image <path> [prompt] | /image pick | /image clear。若不带 prompt，会把图片加入待发送队列。"
                        .to_string(),
            });
            return;
        }

        if tail == "clear" {
            let cleared = self.pending_image_paths.len();
            self.pending_image_paths.clear();
            self.messages.push(ChatMessage {
                role: MessageRole::Agent,
                content: format!("已清空待发送图片队列（{} 张）。", cleared),
            });
            return;
        }

        if tail == "pick" {
            self.open_image_picker();
            return;
        }

        let (raw_path, prompt) = parse_image_path_and_prompt(tail);

        if raw_path.is_empty() {
            self.messages.push(ChatMessage {
                role: MessageRole::Agent,
                content: "用法: /image <path> [prompt]".to_string(),
            });
            return;
        }

        if !is_supported_image_path(raw_path) {
            self.messages.push(ChatMessage {
                role: MessageRole::Agent,
                content: "仅支持图片文件: .png .jpg .jpeg .webp .gif .bmp".to_string(),
            });
            return;
        }

        if !Path::new(raw_path).exists() {
            self.messages.push(ChatMessage {
                role: MessageRole::Agent,
                content: format!("图片不存在: {}", raw_path),
            });
            return;
        }

        if !prompt.is_empty() {
            if self.pending_response.is_some() || self.pending_tool_agent_step.is_some() {
                self.messages.push(ChatMessage {
                    role: MessageRole::Agent,
                    content: "上一条回复仍在处理中，请稍候。".to_string(),
                });
                return;
            }

            self.scroll_history_to_bottom();
            self.messages.push(ChatMessage {
                role: MessageRole::User,
                content: format!("{}\n[attached image] {}", prompt, raw_path),
            });
            self.send_user_turn(prompt.to_string(), Some(vec![raw_path.to_string()]));
            return;
        }

        self.pending_image_paths.push(raw_path.to_string());
        self.messages.push(ChatMessage {
            role: MessageRole::Agent,
            content: format!(
                "已添加图片到待发送队列（{} 张）。下一条普通消息会自动携带这些图片。",
                self.pending_image_paths.len()
            ),
        });
    }

    fn save_current_chat(&mut self, path: Option<&str>) {
        let messages = self
            .messages
            .iter()
            .map(|m| {
                (
                    match m.role {
                        MessageRole::User => "user".to_string(),
                        MessageRole::Agent => "assistant".to_string(),
                    },
                    m.content.clone(),
                )
            })
            .collect::<Vec<_>>();

        let llm = self
            .llm_history
            .iter()
            .map(|m| (m.role.to_string(), m.content.clone(), m.image_paths.clone()))
            .collect::<Vec<_>>();

        match save_chat(path, &messages, &llm) {
            Ok(saved_path) => {
                self.messages.push(ChatMessage {
                    role: MessageRole::Agent,
                    content: format!("会话已保存: {}", saved_path.display()),
                });
            }
            Err(err) => {
                self.messages.push(ChatMessage {
                    role: MessageRole::Agent,
                    content: format!("保存会话失败: {}", err),
                });
            }
        }
    }

    fn load_chat_by_path(&mut self, path: &str) {
        match load_chat(path) {
            Ok(loaded) => {
                let mut msgs = Vec::new();
                for (role, content) in loaded.messages {
                    let mapped_role = if role == "user" {
                        MessageRole::User
                    } else {
                        MessageRole::Agent
                    };
                    msgs.push(ChatMessage {
                        role: mapped_role,
                        content,
                    });
                }
                if msgs.is_empty() {
                    msgs.push(ChatMessage {
                        role: MessageRole::Agent,
                        content: "已加载空会话。".to_string(),
                    });
                }
                self.messages = msgs;

                self.llm_history = loaded
                    .llm_history
                    .into_iter()
                    .map(|(role, content, image_paths)| LlmMessage {
                        role: if role == "assistant" {
                            "assistant"
                        } else if role == "system" {
                            "system"
                        } else {
                            "user"
                        },
                        content,
                        image_paths,
                    })
                    .collect();

                self.scroll_history_to_bottom();
                self.messages.push(ChatMessage {
                    role: MessageRole::Agent,
                    content: format!("会话已加载: {}", path),
                });
            }
            Err(err) => {
                self.messages.push(ChatMessage {
                    role: MessageRole::Agent,
                    content: format!("加载会话失败: {}", err),
                });
            }
        }
    }

    fn handle_tool_slash(&mut self, message: &str) {
        if self.pending_tool_approval.is_some() {
            self.messages.push(ChatMessage {
                role: MessageRole::Agent,
                content: "当前有待确认的高风险工具调用。请先输入 y / n / t。".to_string(),
            });
            return;
        }

        let request = match self.tool_runtime.parse_tool_command(message) {
            Ok(req) => req,
            Err(err) => {
                self.messages.push(ChatMessage {
                    role: MessageRole::Agent,
                    content: format!("工具命令解析失败: {}", err),
                });
                return;
            }
        };

        match self.tool_runtime.authorize(&request) {
            Ok(AuthorizationDecision::Allowed) => {
                self.execute_tool_request(&request);
            }
            Ok(AuthorizationDecision::NeedApproval {
                prompt,
                trust_target,
            }) => {
                self.pending_tool_approval = Some(PendingToolApproval {
                    request,
                    trust_target,
                    continuation: None,
                });
                self.messages.push(ChatMessage {
                    role: MessageRole::Agent,
                    content: prompt,
                });
            }
            Err(err) => {
                self.messages.push(ChatMessage {
                    role: MessageRole::Agent,
                    content: format!("工具权限检查失败: {}", err),
                });
            }
        }
    }

    fn execute_tool_request(&mut self, request: &ToolRequest) {
        match self.tool_runtime.execute(request) {
            Ok(output) => {
                self.persist_tool_memory(request, &output);
                self.messages.push(ChatMessage {
                    role: MessageRole::Agent,
                    content: format_tool_ui_message(request, "manual", &output),
                });
            }
            Err(err) => {
                self.messages.push(ChatMessage {
                    role: MessageRole::Agent,
                    content: format!("工具执行失败: {}", err),
                });
            }
        }
    }

    fn execute_tool_request_with_continuation(
        &mut self,
        request: &ToolRequest,
        continuation: Option<ToolApprovalContinuation>,
    ) {
        match continuation {
            Some(mut cont) => {
                let output = match self.tool_runtime.execute(request) {
                    Ok(result) => {
                        self.persist_tool_memory(request, &result);
                        self.messages.push(ChatMessage {
                            role: MessageRole::Agent,
                            content: format_tool_ui_message(request, &cont.tool_name, &result),
                        });
                        result
                    }
                    Err(err) => {
                        let e = format!("[tool error] {}", err);
                        self.messages.push(ChatMessage {
                            role: MessageRole::Agent,
                            content: format!("模型工具调用执行失败: {}", err),
                        });
                        e
                    }
                };

                append_tool_result_message(&mut cont.state, &cont.tool_call_id, &output);
                self.start_tool_agent_step_async(cont.state);
            }
            None => self.execute_tool_request(request),
        }
    }

    fn persist_tool_memory(&mut self, request: &ToolRequest, output: &str) {
        let request_desc = match request {
            ToolRequest::ReadFile {
                path,
                start_line,
                end_line,
            } => format!(
                "read_file path={} start={} end={}",
                path,
                start_line
                    .map(|v| v.to_string())
                    .unwrap_or_else(|| "1".to_string()),
                end_line
                    .map(|v| v.to_string())
                    .unwrap_or_else(|| "default".to_string())
            ),
            ToolRequest::Search { query } => format!("search_files query={}", query),
            ToolRequest::Shell { command } => format!("run_shell_command command={}", command),
            ToolRequest::CreateFile { path, content } => format!(
                "create_file path={} chars={}",
                path,
                content.chars().count()
            ),
            ToolRequest::UpdateFile { path, content } => format!(
                "update_file path={} chars={}",
                path,
                content.chars().count()
            ),
            ToolRequest::DeleteFile { path } => format!("delete_file path={}", path),
        };

        let entry = format!(
            "{}\nrequest: {}\nresult_snippet:\n{}",
            TOOL_MEMORY_PREFIX,
            request_desc,
            truncate_for_preview(output, TOOL_MEMORY_SNIPPET_CHARS)
        );

        self.llm_history.push(LlmMessage {
            role: "system",
            content: entry,
            image_paths: vec![],
        });
        self.prune_tool_memories();
    }

    fn prune_tool_memories(&mut self) {
        let mut seen = 0usize;
        let total_tool_memories = self
            .llm_history
            .iter()
            .filter(|m| m.role == "system" && m.content.starts_with(TOOL_MEMORY_PREFIX))
            .count();

        if total_tool_memories <= TOOL_MEMORY_MAX_ENTRIES {
            return;
        }

        let remove_count = total_tool_memories - TOOL_MEMORY_MAX_ENTRIES;
        self.llm_history.retain(|m| {
            if m.role == "system" && m.content.starts_with(TOOL_MEMORY_PREFIX) {
                seen += 1;
                return seen > remove_count;
            }
            true
        });
    }

    fn try_auto_compact_and_retry(&mut self, err: &str) -> bool {
        if !is_context_overflow_error(err) {
            return false;
        }

        let Some(user_turn) = self.pending_user_turn.clone() else {
            self.messages.push(ChatMessage {
                role: MessageRole::Agent,
                content: format!("检测到上下文超限，但缺少可重试的用户轮次。原始错误: {}", err),
            });
            return false;
        };

        match compact_history_manual(&self.config, &mut self.llm_history) {
            Ok(result) => {
                if result.dropped_messages == 0 {
                    self.messages.push(ChatMessage {
                        role: MessageRole::Agent,
                        content: format!(
                            "检测到上下文超限，但历史已无法继续压缩。原始错误: {}",
                            err
                        ),
                    });
                    return false;
                }

                let summary_preview = compact_summary_text(&self.llm_history)
                    .map(|s| truncate_for_preview(&s, 500))
                    .unwrap_or_else(|| "<无摘要内容>".to_string());
                self.messages.push(ChatMessage {
                    role: MessageRole::Agent,
                    content: format!(
                        "检测到上下文超限，已自动压缩并重试：{} -> {}（压缩 {} 条）。\n\n压缩摘要预览:\n{}",
                        result.before_len,
                        result.after_len,
                        result.dropped_messages,
                        summary_preview
                    ),
                });

                let state = start_tool_agent_state(&self.llm_history, &user_turn);
                self.start_tool_agent_step_async(state);
                true
            }
            Err(compact_err) => {
                self.messages.push(ChatMessage {
                    role: MessageRole::Agent,
                    content: format!(
                        "上下文超限且自动压缩失败: {}\n原始错误: {}",
                        compact_err, err
                    ),
                });
                false
            }
        }
    }

    fn try_fallback_to_text_only_and_retry(&mut self, err: &str) -> bool {
        if !is_vision_unsupported_error(err) {
            return false;
        }

        let mut dropped = 0usize;
        let mut user_turn = self.pending_user_turn.clone();

        if let Some(last_user) = self
            .llm_history
            .iter_mut()
            .rev()
            .find(|m| m.role == "user" && !m.image_paths.is_empty())
        {
            dropped = last_user.image_paths.len();
            if user_turn.is_none() {
                user_turn = Some(last_user.content.clone());
            }
            last_user.image_paths.clear();
        }

        if dropped == 0 {
            return false;
        }

        let Some(turn) = user_turn else {
            return false;
        };

        self.messages.push(ChatMessage {
            role: MessageRole::Agent,
            content: format!(
                "当前模型/接口不支持图像输入，已自动降级为文本重试（忽略 {} 张图片）。",
                dropped
            ),
        });
        logging::log_event(&format!(
            "vision fallback -> retry as text-only, dropped_images={}, err={}",
            dropped, err
        ));

        let state = start_tool_agent_state(&self.llm_history, &turn);
        self.start_tool_agent_step_async(state);
        true
    }
}

fn format_tool_ui_message(request: &ToolRequest, tool_name: &str, output: &str) -> String {
    match request {
        ToolRequest::ReadFile {
            path,
            start_line,
            end_line,
        } => {
            let start = start_line.unwrap_or(1);
            let end = end_line
                .map(|v| v.to_string())
                .unwrap_or_else(|| "default".to_string());
            format!("[tool] 阅读文件 {} {} - {}", path, start, end)
        }
        ToolRequest::Search { .. } => output.to_string(),
        ToolRequest::CreateFile { path, .. } => format!("[tool] 已创建文件 {}", path),
        ToolRequest::UpdateFile { path, .. } => format!("[tool] 已更新文件 {}", path),
        ToolRequest::DeleteFile { path } => format!("[tool] 已删除文件 {}", path),
        _ => format!(
            "[tool] {} 执行完成。\n{}",
            tool_name,
            truncate_for_preview(output, 1200)
        ),
    }
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

    // Best-effort cleanup: never fail startup/exit just because restore commands can't run.
    let _ = disable_raw_mode();
    let _ = execute!(terminal.backend_mut(), LeaveAlternateScreen, DisableMouseCapture);
    let _ = terminal.show_cursor();

    run_result
}

fn run_app<B: Backend + io::Write>(terminal: &mut Terminal<B>) -> Result<()> {
    let mut app = App::new();
    app.refresh_suggestions();

    while !app.should_quit {
        if let Some(enable_mouse) = app.take_mouse_capture_request() {
            if enable_mouse && !app.mouse_capture_enabled {
                execute!(terminal.backend_mut(), EnableMouseCapture)?;
                app.mouse_capture_enabled = true;
            } else if !enable_mouse && app.mouse_capture_enabled {
                execute!(terminal.backend_mut(), DisableMouseCapture)?;
                app.mouse_capture_enabled = false;
            }
        }

        app.poll_pending_response();
        app.poll_pending_tool_agent_step();
        app.handle_stream_stall_timeout();
        app.tick_thinking_spinner();
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

            if app.chat_picker_active {
                match key.code {
                    KeyCode::Esc => app.cancel_chat_picker(),
                    KeyCode::Up => app.select_prev_chat(),
                    KeyCode::Down => app.select_next_chat(),
                    KeyCode::Enter => app.confirm_chat_picker(),
                    KeyCode::Char('c') if key.modifiers.contains(KeyModifiers::CONTROL) => {
                        app.should_quit = true;
                    }
                    _ => {}
                }
                continue;
            }

            if app.image_picker_active {
                match key.code {
                    KeyCode::Esc => app.cancel_image_picker(),
                    KeyCode::Up => app.select_prev_image(),
                    KeyCode::Down => app.select_next_image(),
                    KeyCode::Enter => app.confirm_image_picker(),
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

    if q == "/chat" || q.starts_with("/chat ") {
        return vec!["/chat", "/chat save", "/chat save <path>", "/chat load <file>"]
            .into_iter()
            .filter(|cmd| cmd.starts_with(q))
            .collect();
    }

    if q == "/image" || q.starts_with("/image ") {
        return vec!["/image <path> [prompt]", "/image pick", "/image clear"]
            .into_iter()
            .filter(|cmd| cmd.starts_with(q))
            .collect();
    }

    if q == "/tool" || q.starts_with("/tool ") {
        return vec![
            "/tool shell <command>",
            "/tool read <path> [start] [end]",
            "/tool search <query>",
        ]
        .into_iter()
        .filter(|cmd| cmd.starts_with(q))
        .collect();
    }

    Vec::new()
}

fn parse_image_path_and_prompt(input: &str) -> (&str, &str) {
    let tail = input.trim();
    if tail.is_empty() {
        return ("", "");
    }

    if let Some(quote) = tail.chars().next().filter(|c| *c == '"' || *c == '\'') {
        let rest = &tail[quote.len_utf8()..];
        if let Some(end) = rest.find(quote) {
            let path = rest[..end].trim();
            let prompt = rest[end + quote.len_utf8()..].trim();
            return (path, prompt);
        }
    }

    // Unquoted form: pick the shortest prefix that already looks like an image path.
    // This keeps prompt parsing intact while allowing spaces in file paths.
    for (idx, ch) in tail.char_indices() {
        if !ch.is_whitespace() {
            continue;
        }

        let candidate = tail[..idx].trim_end();
        if is_supported_image_path(candidate) {
            return (candidate, tail[idx..].trim_start());
        }
    }

    if is_supported_image_path(tail) {
        return (tail, "");
    }

    let mut parts = tail.splitn(2, ' ');
    let raw_path = parts.next().unwrap_or("").trim();
    let prompt = parts.next().map(str::trim).unwrap_or("");
    (raw_path, prompt)
}

fn is_supported_image_path(path: &str) -> bool {
    let ext = Path::new(path)
        .extension()
        .and_then(|s| s.to_str())
        .map(|s| s.to_ascii_lowercase());

    matches!(
        ext.as_deref(),
        Some("png") | Some("jpg") | Some("jpeg") | Some("webp") | Some("gif") | Some("bmp")
    )
}

fn is_vision_unsupported_error(err: &str) -> bool {
    let e = err.to_ascii_lowercase();
    let mentions_image = e.contains("image")
        || e.contains("vision")
        || e.contains("multimodal")
        || e.contains("content[1]")
        || e.contains("image_url")
        || e.contains("invalid_image")
        || e.contains("base64");
    let mentions_unsupported = e.contains("not support")
        || e.contains("unsupported")
        || e.contains("invalid")
        || e.contains("unknown")
        || e.contains("not allowed")
        || e.contains("must be string")
        || e.contains("failed to process")
        || e.contains("cannot process")
        || e.contains("decode");

    mentions_image && mentions_unsupported
}

fn list_local_image_files() -> Result<Vec<String>> {
    let cwd = env::current_dir().context("读取当前目录失败")?;
    let mut files = Vec::new();

    for entry in fs::read_dir(&cwd).context("遍历当前目录失败")? {
        let entry = entry.context("读取目录项失败")?;
        let path = entry.path();
        if !path.is_file() {
            continue;
        }

        let Some(path_str) = path.to_str() else {
            continue;
        };

        if !is_supported_image_path(path_str) {
            continue;
        }

        let display = path
            .strip_prefix(&cwd)
            .ok()
            .and_then(|p| p.to_str())
            .unwrap_or(path_str)
            .to_string();
        files.push(display);
    }

    files.sort_by_key(|s| s.to_ascii_lowercase());
    Ok(files)
}
