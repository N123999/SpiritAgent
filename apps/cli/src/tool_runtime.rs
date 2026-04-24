use anyhow::{Context, Result, anyhow};
use encoding_rs::GBK;
use grep_regex::RegexMatcherBuilder;
use grep_searcher::{Searcher, sinks::UTF8};
use ignore::{DirEntry, WalkBuilder};
use reqwest::{Url, blocking::Client, header};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    collections::BTreeSet,
    env, fs,
    path::{Path, PathBuf},
    process::Command,
    time::Duration,
};

#[cfg(target_os = "windows")]
use windows_sys::Win32::{
    Foundation::{CloseHandle, HANDLE, INVALID_HANDLE_VALUE},
    System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, PROCESSENTRY32W, Process32FirstW, Process32NextW,
        TH32CS_SNAPPROCESS,
    },
};

use crate::logging;
use crate::{
    ask_questions::AskQuestionsRequest,
    mcp::spirit_agent_data_dir,
    plan::USER_PLAN_FILE_NAME,
    rules::USER_RULE_FILE_NAME,
    skills::SKILLS_DIR_NAME,
};

const PERMISSIONS_FILE: &str = "tool-permissions.json";
const MAX_COMMAND_OUTPUT_CHARS: usize = 16_000;
const MAX_SEARCH_RESULTS: usize = 80;
const MAX_SEARCH_MATCHES_PER_FILE: usize = 3;
const MAX_SEARCH_FILE_BYTES: u64 = 1_000_000;
const MAX_READ_LINES_DEFAULT: usize = 200;
const MAX_DIRECTORY_LIST_RESULTS: usize = 4_000;
const MAX_WEB_FETCH_OUTPUT_CHARS: usize = 24_000;
const WEB_FETCH_TIMEOUT_SECS: u64 = 20;
const BROWSER_USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36";
const EDIT_FILE_LOG_PREVIEW_CHARS: usize = 180;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct RunSubagentRequest {
    pub task: String,
    pub success_criteria: Option<String>,
    pub context_summary: Option<String>,
    #[serde(default)]
    pub files_to_inspect: Vec<String>,
    pub expected_output: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub enum ToolRequest {
    Shell {
        command: String,
    },
    McpTool {
        server: String,
        display_name: String,
        tool_name: String,
        arguments: Value,
    },
    WebFetch {
        url: String,
    },
    ListDirectory {
        path: String,
    },
    ReadFile {
        path: String,
        start_line: Option<usize>,
        end_line: Option<usize>,
    },
    Search {
        query: String,
    },
    CreateFile {
        path: String,
        content: String,
    },
    EditFile {
        path: String,
        old_text: String,
        new_text: String,
    },
    DeleteFile {
        path: String,
    },
    RunSubagent {
        request: RunSubagentRequest,
    },
    AskQuestions {
        questions: AskQuestionsRequest,
    },
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub enum TrustTarget {
    ShellCommand(String),
    ExternalReadPath(String),
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub enum AuthorizationDecision {
    Allowed,
    NeedApproval {
        prompt: String,
        trust_target: Option<TrustTarget>,
    },
    NeedQuestions {
        questions: AskQuestionsRequest,
    },
}

#[derive(Default, Serialize, Deserialize)]
struct ToolPermissionStore {
    trusted_shell_commands: Vec<String>,
    trusted_external_read_paths: Vec<String>,
}

pub struct ToolRuntime {
    workspace_root: PathBuf,
    spirit_data_dir: PathBuf,
    permission_store_path: PathBuf,
    permissions: ToolPermissionStore,
    shell_context: ShellContext,
}

#[derive(Clone, Copy)]
enum ShellKind {
    Cmd,
    PowerShell,
    Posix,
}

#[derive(Clone)]
struct ShellContext {
    display_name: String,
    executable: String,
    kind: ShellKind,
}

fn append_shell_section(out: &mut String, title: &str, body: &str, empty_placeholder: &str) {
    use std::fmt::Write;
    let _ = write!(out, "── {} ──\n", title);
    if body.trim().is_empty() {
        let _ = writeln!(out, "{}", empty_placeholder);
    } else {
        out.push_str(body);
        if !body.ends_with('\n') {
            out.push('\n');
        }
    }
    out.push('\n');
}

/// 供模型与 TUI 共用的 shell 结果正文（取代 [shell]/[stdout] 标签堆叠）。
fn format_shell_tool_transcript(
    shell_name: &str,
    workspace: &str,
    command: &str,
    exit_code: i32,
    stdout: &str,
    stderr: &str,
) -> String {
    use std::fmt::Write;
    let mut s = String::new();
    let _ = writeln!(s, "终端      {}", shell_name);
    let _ = writeln!(s, "工作目录  {}", workspace);
    let _ = writeln!(s, "命令      {}", command);
    let _ = writeln!(s, "退出码    {}", exit_code);
    s.push('\n');
    append_shell_section(&mut s, "标准输出", stdout, "（无输出）");
    append_shell_section(&mut s, "标准错误", stderr, "（无输出）");
    s
}

impl ToolRuntime {
    pub fn new() -> Self {
        let workspace_root = env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
        Self::new_for_workspace(workspace_root)
    }

    pub fn new_for_workspace(workspace_root: PathBuf) -> Self {
        Self::new_with_spirit_dir(workspace_root, spirit_agent_data_dir())
    }

    fn new_with_spirit_dir(workspace_root: PathBuf, spirit_data_dir: PathBuf) -> Self {
        let permission_store_path = permissions_file_path();
        let permissions = load_permissions(&permission_store_path).unwrap_or_default();
        let shell_context = ShellContext::detect();

        Self {
            workspace_root,
            spirit_data_dir,
            permission_store_path,
            permissions,
            shell_context,
        }
    }

    #[cfg(test)]
    fn new_for_workspace_and_spirit_dir(workspace_root: PathBuf, spirit_data_dir: PathBuf) -> Self {
        Self::new_with_spirit_dir(workspace_root, spirit_data_dir)
    }

    pub fn parse_tool_command(&self, message: &str) -> Result<ToolRequest> {
        let raw = message
            .strip_prefix("/tool")
            .ok_or_else(|| anyhow!("命令必须以 /tool 开头"))?
            .trim();

        if raw.is_empty() {
            return Err(anyhow!(
                "用法:\n/tool shell <command>\n/tool web <url>\n/tool list <absolute-dir>\n/tool read <path> [start] [end]\n/tool search <query>"
            ));
        }

        let tokens = tokenize(raw);
        let sub = tokens
            .first()
            .map(|s| s.as_str())
            .ok_or_else(|| anyhow!("缺少子命令"))?;

        match sub {
            "shell" => {
                let cmd = raw.strip_prefix("shell").map(str::trim).unwrap_or("");
                if cmd.is_empty() {
                    return Err(anyhow!("用法: /tool shell <command>"));
                }
                Ok(ToolRequest::Shell {
                    command: cmd.to_string(),
                })
            }
            "web" => {
                if tokens.len() < 2 {
                    return Err(anyhow!("用法: /tool web <url>"));
                }
                Ok(ToolRequest::WebFetch {
                    url: tokens[1].clone(),
                })
            }
            "list" => {
                if tokens.len() < 2 {
                    return Err(anyhow!("用法: /tool list <absolute-dir>"));
                }
                Ok(ToolRequest::ListDirectory {
                    path: tokens[1].clone(),
                })
            }
            "read" => {
                if tokens.len() < 2 {
                    return Err(anyhow!("用法: /tool read <path> [start] [end]"));
                }

                let path = tokens[1].clone();
                let start_line = if tokens.len() >= 3 {
                    Some(
                        tokens[2]
                            .parse::<usize>()
                            .with_context(|| format!("start line 非法: {}", tokens[2]))?,
                    )
                } else {
                    None
                };

                let end_line = if tokens.len() >= 4 {
                    Some(
                        tokens[3]
                            .parse::<usize>()
                            .with_context(|| format!("end line 非法: {}", tokens[3]))?,
                    )
                } else {
                    None
                };

                Ok(ToolRequest::ReadFile {
                    path,
                    start_line,
                    end_line,
                })
            }
            "search" => {
                let q = raw.strip_prefix("search").map(str::trim).unwrap_or("");
                if q.is_empty() {
                    return Err(anyhow!("用法: /tool search <query>"));
                }
                Ok(ToolRequest::Search {
                    query: q.to_string(),
                })
            }
            _ => Err(anyhow!(
                "未知 /tool 子命令: {}\n可用: shell | web | list | read | search",
                sub
            )),
        }
    }

    pub fn authorize(&self, request: &ToolRequest) -> Result<AuthorizationDecision> {
        match request {
            ToolRequest::McpTool { .. } => {
                Err(anyhow!("MCP 工具权限检查应由 WorkspaceToolExecutor 处理"))
            }
            ToolRequest::Shell { command } => {
                if self
                    .permissions
                    .trusted_shell_commands
                    .iter()
                    .any(|c| c == command)
                {
                    return Ok(AuthorizationDecision::Allowed);
                }

                Ok(AuthorizationDecision::NeedApproval {
                    prompt: format!(
                        "高风险工具调用: shell\n终端: {}\n命令: {}\n\n输入 y 允许一次，n 拒绝，t 信任并持久化。",
                        self.shell_context.display_name, command
                    ),
                    trust_target: Some(TrustTarget::ShellCommand(command.clone())),
                })
            }
            ToolRequest::WebFetch { url } => Ok(AuthorizationDecision::NeedApproval {
                prompt: format!(
                    "高风险工具调用: 抓取网页\nURL: {}\n\n正文将进入对话；请确认来源可信，恶意页面可能提示词注入。\n\n输入 y 允许一次，n 拒绝。",
                    url
                ),
                trust_target: None,
            }),
            ToolRequest::ListDirectory { path } => {
                let canonical = self.resolve_existing_absolute_directory(path)?;
                Ok(self.authorize_external_read_path(&canonical, "遍历工作目录外目录"))
            }
            ToolRequest::ReadFile { path, .. } => {
                let canonical = self.resolve_existing_path(path)?;
                Ok(self.authorize_external_read_path(&canonical, "读取工作目录外文件"))
            }
            ToolRequest::Search { .. } => Ok(AuthorizationDecision::Allowed),
            ToolRequest::RunSubagent { .. } => Ok(AuthorizationDecision::Allowed),
            ToolRequest::AskQuestions { questions } => Ok(AuthorizationDecision::NeedQuestions {
                questions: questions.clone(),
            }),
            ToolRequest::CreateFile { path, content } => Ok(AuthorizationDecision::NeedApproval {
                prompt: format!(
                    "高风险工具调用: 创建文件\n路径: {}\n内容长度: {} 字符\n\n输入 y 允许一次，n 拒绝。",
                    path,
                    content.chars().count()
                ),
                trust_target: None,
            }),
            ToolRequest::EditFile {
                path,
                old_text,
                new_text,
            } => Ok(AuthorizationDecision::NeedApproval {
                prompt: format!(
                    "高风险工具调用: 编辑文件（精确替换）\n路径: {}\n旧文本长度: {} 字符\n新文本长度: {} 字符\n\n输入 y 允许一次，n 拒绝。",
                    path,
                    old_text.chars().count(),
                    new_text.chars().count()
                ),
                trust_target: None,
            }),
            ToolRequest::DeleteFile { path } => Ok(AuthorizationDecision::NeedApproval {
                prompt: format!(
                    "高风险工具调用: 删除文件\n路径: {}\n\n输入 y 允许一次，n 拒绝。",
                    path
                ),
                trust_target: None,
            }),
        }
    }

    pub fn trust(&mut self, target: &TrustTarget) -> Result<()> {
        match target {
            TrustTarget::ShellCommand(cmd) => {
                if !self
                    .permissions
                    .trusted_shell_commands
                    .iter()
                    .any(|c| c == cmd)
                {
                    self.permissions.trusted_shell_commands.push(cmd.clone());
                }
            }
            TrustTarget::ExternalReadPath(path) => {
                if !self
                    .permissions
                    .trusted_external_read_paths
                    .iter()
                    .any(|p| p == path)
                {
                    self.permissions
                        .trusted_external_read_paths
                        .push(path.clone());
                }
            }
        }

        save_permissions(&self.permission_store_path, &self.permissions)
    }

    pub fn execute(&self, request: &ToolRequest) -> Result<String> {
        match request {
            ToolRequest::McpTool { .. } => {
                Err(anyhow!("MCP 工具执行应由 WorkspaceToolExecutor 处理"))
            }
            ToolRequest::Shell { command } => self.execute_shell(command),
            ToolRequest::WebFetch { url } => self.execute_web_fetch(url),
            ToolRequest::ListDirectory { path } => self.execute_list_directory(path),
            ToolRequest::ReadFile {
                path,
                start_line,
                end_line,
            } => self.execute_read(path, *start_line, *end_line),
            ToolRequest::Search { query } => self.execute_search(query),
            ToolRequest::AskQuestions { .. } => {
                Err(anyhow!("ask_questions 应由运行时挂起并等待用户填写，不应直接执行"))
            }
            ToolRequest::CreateFile { path, content } => self.execute_create_file(path, content),
            ToolRequest::EditFile {
                path,
                old_text,
                new_text,
            } => self.execute_edit_file(path, old_text, new_text),
            ToolRequest::DeleteFile { path } => self.execute_delete_file(path),
            ToolRequest::RunSubagent { .. } => Err(anyhow!(
                "run_subagent 应由 Agent runtime 接管，不应落到宿主 ToolRuntime::execute"
            )),
        }
    }

    pub fn tool_definition_environment_json(&self) -> Value {
        json!({
            "shellDisplayName": self.shell_context.display_name,
            "shellCommandParameterDescription": self.shell_context.command_parameter_description(),
        })
    }

    pub fn request_from_function_call(name: &str, arguments_json: &str) -> Result<ToolRequest> {
        let args: Value = serde_json::from_str(arguments_json)
            .with_context(|| format!("工具参数 JSON 解析失败: {}", arguments_json))?;

        match name {
            "run_shell_command" => {
                let command = args
                    .get("command")
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .filter(|s| !s.is_empty())
                    .ok_or_else(|| anyhow!("run_shell_command 缺少 command"))?;
                Ok(ToolRequest::Shell {
                    command: command.to_string(),
                })
            }
            "web_fetch" => {
                let url = args
                    .get("url")
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .filter(|s| !s.is_empty())
                    .ok_or_else(|| anyhow!("web_fetch 缺少 url"))?;
                Ok(ToolRequest::WebFetch {
                    url: url.to_string(),
                })
            }
            "list_directory_files" => {
                let path = args
                    .get("path")
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .filter(|s| !s.is_empty())
                    .ok_or_else(|| anyhow!("list_directory_files 缺少 path"))?;
                Ok(ToolRequest::ListDirectory {
                    path: path.to_string(),
                })
            }
            "read_file" => {
                let path = args
                    .get("path")
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .filter(|s| !s.is_empty())
                    .ok_or_else(|| anyhow!("read_file 缺少 path"))?;
                let start_line = args
                    .get("start_line")
                    .and_then(Value::as_u64)
                    .map(|v| v as usize);
                let end_line = args
                    .get("end_line")
                    .and_then(Value::as_u64)
                    .map(|v| v as usize);
                Ok(ToolRequest::ReadFile {
                    path: path.to_string(),
                    start_line,
                    end_line,
                })
            }
            "search_files" => {
                let query = args
                    .get("query")
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .filter(|s| !s.is_empty())
                    .ok_or_else(|| anyhow!("search_files 缺少 query"))?;
                Ok(ToolRequest::Search {
                    query: query.to_string(),
                })
            }
            "run_subagent" => {
                let task = required_string_arg(&args, "run_subagent", "task")?;
                Ok(ToolRequest::RunSubagent {
                    request: RunSubagentRequest {
                        task: task.to_string(),
                        success_criteria: optional_string_arg(&args, "success_criteria")?,
                        context_summary: optional_string_arg(&args, "context_summary")?,
                        files_to_inspect: optional_string_array_arg(&args, "files_to_inspect")?,
                        expected_output: optional_string_arg(&args, "expected_output")?,
                    },
                })
            }
            "ask_questions" => {
                let request: AskQuestionsRequest = serde_json::from_value(args)
                    .context("ask_questions 参数结构无效")?;
                request.validate()?;
                Ok(ToolRequest::AskQuestions { questions: request })
            }
            "create_file" => {
                let path = required_string_arg(&args, "create_file", "path")?;
                let content = required_string_arg(&args, "create_file", "content")?;
                Ok(ToolRequest::CreateFile {
                    path: path.to_string(),
                    content: content.to_string(),
                })
            }
            "edit_file" => {
                let path = required_string_arg(&args, "edit_file", "path")?;
                let old_text = required_string_arg(&args, "edit_file", "old_text")?;
                let new_text = required_string_arg(&args, "edit_file", "new_text")?;
                Ok(ToolRequest::EditFile {
                    path: path.to_string(),
                    old_text: old_text.to_string(),
                    new_text: new_text.to_string(),
                })
            }
            "delete_file" => {
                let path = required_string_arg(&args, "delete_file", "path")?;
                Ok(ToolRequest::DeleteFile {
                    path: path.to_string(),
                })
            }
            _ => Err(anyhow!("未知工具名: {}", name)),
        }
    }

    fn execute_shell(&self, command: &str) -> Result<String> {
        let output = match self.shell_context.kind {
            ShellKind::Cmd => Command::new(&self.shell_context.executable)
                .args(["/C", &format!("chcp 65001 >nul & {}", command)])
                .current_dir(&self.workspace_root)
                .output()
                .with_context(|| format!("执行命令失败: {}", command))?,
            ShellKind::PowerShell => Command::new(&self.shell_context.executable)
                .args(["-NoLogo", "-NoProfile", "-Command", command])
                .current_dir(&self.workspace_root)
                .output()
                .with_context(|| format!("执行命令失败: {}", command))?,
            ShellKind::Posix => Command::new(&self.shell_context.executable)
                .args(["-lc", command])
                .current_dir(&self.workspace_root)
                .output()
                .with_context(|| format!("执行命令失败: {}", command))?,
        };

        let stdout = decode_command_output(&output.stdout);
        let stderr = decode_command_output(&output.stderr);
        let code = output.status.code().unwrap_or(-1);
        let mut combined = format_shell_tool_transcript(
            &self.shell_context.display_name,
            &self.workspace_root.display().to_string(),
            command,
            code,
            &stdout,
            &stderr,
        );

        if combined.chars().count() > MAX_COMMAND_OUTPUT_CHARS {
            combined = truncate_chars(&combined, MAX_COMMAND_OUTPUT_CHARS);
            combined.push_str("\n\n...<输出已截断>");
        }

        Ok(combined)
    }

    fn execute_web_fetch(&self, url: &str) -> Result<String> {
        let parsed_url = parse_web_fetch_url(url)?;
        let client = Client::builder()
            .timeout(Duration::from_secs(WEB_FETCH_TIMEOUT_SECS))
            .redirect(reqwest::redirect::Policy::limited(10))
            .build()
            .context("创建 web_fetch HTTP 客户端失败")?;

        let response = client
            .get(parsed_url.clone())
            .header(header::USER_AGENT, BROWSER_USER_AGENT)
            .header(
                header::ACCEPT,
                "text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.5",
            )
            .header(header::ACCEPT_LANGUAGE, "zh-CN,zh;q=0.9,en;q=0.8")
            .send()
            .with_context(|| format!("抓取网页失败: {}", parsed_url))?;

        let status = response.status();
        let final_url = response.url().clone();
        let content_type = response
            .headers()
            .get(header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("unknown")
            .to_string();

        let raw = response
            .text()
            .with_context(|| format!("读取网页内容失败: {}", final_url))?;

        let extracted = extract_web_text(&raw, &content_type);
        let normalized = normalize_web_text(&extracted);
        let preview = truncate_chars(&normalized, MAX_WEB_FETCH_OUTPUT_CHARS);

        Ok(format!(
            "[web]\nurl: {}\nfinal_url: {}\nstatus: {}\ncontent_type: {}\nuser_agent: {}\ncontent_chars: {}\ntruncated: {}\n\ncontent\n{}{}",
            parsed_url,
            final_url,
            status,
            content_type,
            BROWSER_USER_AGENT,
            normalized.chars().count(),
            if normalized.chars().count() > MAX_WEB_FETCH_OUTPUT_CHARS {
                "true"
            } else {
                "false"
            },
            preview,
            if normalized.chars().count() > MAX_WEB_FETCH_OUTPUT_CHARS {
                "\n\n...<网页内容已截断>"
            } else {
                ""
            }
        ))
    }

    fn execute_list_directory(&self, path: &str) -> Result<String> {
        let root = self.resolve_existing_absolute_directory(path)?;
        let mut files = Vec::new();
        let mut directories = Vec::new();
        let mut skipped_dirs = 0usize;
        let mut skipped_symlinks = 0usize;
        let mut truncated = false;

        let entries = match fs::read_dir(&root) {
            Ok(v) => v,
            Err(_) => {
                skipped_dirs += 1;
                return Ok(format!(
                    "[list]\npath: {}\nfiles: 0\ntruncated: false\nskipped_dirs: {}\nskipped_symlinks: {}\n\n（无法读取目录）",
                    root.display(),
                    skipped_dirs,
                    skipped_symlinks,
                ));
            }
        };

        for entry in entries.flatten() {
            let file_type = match entry.file_type() {
                Ok(v) => v,
                Err(_) => continue,
            };
            let entry_path = entry.path();

            if file_type.is_symlink() {
                skipped_symlinks += 1;
            } else if file_type.is_dir() {
                directories.push(entry_path);
            } else if file_type.is_file() {
                files.push(entry_path);
                if files.len() >= MAX_DIRECTORY_LIST_RESULTS {
                    truncated = true;
                    break;
                }
            }
        }

        directories.sort();
        files.sort();

        let mut out = format!(
            "[list]\npath: {}\ndirectories: {}\nfiles: {}\ntruncated: {}\nskipped_dirs: {}\nskipped_symlinks: {}\n\n",
            root.display(),
            directories.len(),
            files.len(),
            if truncated { "true" } else { "false" },
            skipped_dirs,
            skipped_symlinks,
        );

        if directories.is_empty() && files.is_empty() {
            out.push_str("（目录为空）");
        } else {
            if !directories.is_empty() {
                out.push_str("directories\n");
                for dir in directories {
                    out.push_str(&format!("{}\n", dir.display()));
                }
                out.push_str("\n");
            }

            if !files.is_empty() {
                out.push_str("files\n");
                for file in files {
                    out.push_str(&format!("{}\n", file.display()));
                }
            }
        }

        if truncated {
            out.push_str(&format!(
                "\n...<结果已截断，最多列出 {} 个文件>",
                MAX_DIRECTORY_LIST_RESULTS
            ));
        }

        Ok(out)
    }

    fn execute_read(
        &self,
        path: &str,
        start_line: Option<usize>,
        end_line: Option<usize>,
    ) -> Result<String> {
        let canonical = self.resolve_existing_path(path)?;
        let content = fs::read_to_string(&canonical)
            .with_context(|| format!("读取文件失败: {}", canonical.display()))?;

        let start = start_line.unwrap_or(1);
        if start == 0 {
            return Err(anyhow!("line 从 1 开始"));
        }

        let end = end_line.unwrap_or(start + MAX_READ_LINES_DEFAULT - 1);
        if end < start {
            return Err(anyhow!("end line 不能小于 start line"));
        }

        let lines = content.lines().collect::<Vec<_>>();
        let max_line = lines.len().max(1);
        let s = start.min(max_line);
        let e = end.min(max_line);

        let mut out = format!(
            "[read]\npath: {}\nrange: {}-{}\n\n",
            canonical.display(),
            s,
            e
        );
        for idx in s..=e {
            if let Some(line) = lines.get(idx - 1) {
                out.push_str(&format!("{:>6} | {}\n", idx, line));
            }
        }

        Ok(out)
    }

    fn execute_search(&self, query: &str) -> Result<String> {
        let needle = query.trim();
        if needle.is_empty() {
            return Err(anyhow!("search query 不能为空"));
        }

        let matcher = RegexMatcherBuilder::new()
            .fixed_strings(true)
            .case_insensitive(true)
            .build(needle)
            .map_err(|err| anyhow!("构建搜索模式失败: {}", err))?;
        let mut files = BTreeSet::new();
        let mut hits = Vec::new();
        let mut walker = WalkBuilder::new(&self.workspace_root);
        walker
            .current_dir(&self.workspace_root)
            .hidden(false)
            .require_git(false)
            .max_filesize(Some(MAX_SEARCH_FILE_BYTES))
            .filter_entry(Self::search_entry_allowed);

        for entry in walker.build() {
            let entry = match entry {
                Ok(entry) => entry,
                Err(_) => continue,
            };

            if !entry.file_type().is_some_and(|file_type| file_type.is_file()) {
                continue;
            }

            let path = entry.path();
            let rel = path.strip_prefix(&self.workspace_root).unwrap_or(path);
            let rel_display = rel.display().to_string();
            let mut file_match_count = 0usize;

            let search_result = Searcher::new().search_path(
                &matcher,
                path,
                UTF8(|line_number, line| {
                    files.insert(rel_display.clone());

                    if hits.len() < MAX_SEARCH_RESULTS
                        && file_match_count < MAX_SEARCH_MATCHES_PER_FILE
                    {
                        hits.push(format!(
                            "{}:{} | {}",
                            rel_display,
                            line_number,
                            truncate_chars(Self::normalize_search_line(line), 180)
                        ));
                    }

                    file_match_count += 1;
                    Ok(hits.len() < MAX_SEARCH_RESULTS
                        && file_match_count < MAX_SEARCH_MATCHES_PER_FILE)
                }),
            );

            if search_result.is_err() {
                continue;
            }

            if hits.len() >= MAX_SEARCH_RESULTS {
                break;
            }
        }

        if files.is_empty() {
            return Ok(format!("[tool] 搜索: {}\n未搜索到文件", query));
        }

        let mut out = format!("[tool] 搜索: {}\n命中片段\n", query);
        for hit in &hits {
            out.push_str(&format!("{}\n", hit));
        }
        out.push_str("\n涉及文件\n");
        for file in files {
            out.push_str(&format!("{}\n", file));
        }
        Ok(out)
    }

fn search_entry_allowed(entry: &DirEntry) -> bool {
    if !entry.file_type().is_some_and(|file_type| file_type.is_dir()) {
        return true;
    }

    let Some(name) = entry.file_name().to_str() else {
        return true;
    };

    !matches!(name, ".git" | "target" | "node_modules")
}

fn normalize_search_line(line: &str) -> &str {
    line.trim_end_matches(['\r', '\n']).trim()
}

    fn execute_create_file(&self, path: &str, content: &str) -> Result<String> {
        let target = self.resolve_workspace_target_path(path)?;
        if target.exists() {
            return Err(anyhow!("文件已存在: {}", target.display()));
        }

        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent)
                .with_context(|| format!("创建目录失败: {}", parent.display()))?;
        }

        fs::write(&target, content)
            .with_context(|| format!("创建文件失败: {}", target.display()))?;
        Ok(format!(
            "[write]\naction: create_file\npath: {}\nchars: {}",
            target.display(),
            content.chars().count()
        ))
    }

    fn execute_edit_file(&self, path: &str, old_text: &str, new_text: &str) -> Result<String> {
        if old_text.is_empty() {
            return Err(anyhow!("edit_file 的 old_text 不能为空"));
        }

        let target = self.resolve_existing_workspace_file(path)?;
        let source = fs::read_to_string(&target)
            .with_context(|| format!("读取文件失败: {}", target.display()))?;
        logging::log_event(&format!(
            "[tool:edit_file] start path={} source_chars={} source_lines={} source_line_endings={} old_chars={} old_lines={} old_line_endings={} new_chars={} new_lines={} new_line_endings={} old_preview={} new_preview={}",
            target.display(),
            source.chars().count(),
            source.lines().count(),
            line_ending_style(&source),
            old_text.chars().count(),
            old_text.lines().count(),
            line_ending_style(old_text),
            new_text.chars().count(),
            new_text.lines().count(),
            line_ending_style(new_text),
            escaped_preview(old_text, EDIT_FILE_LOG_PREVIEW_CHARS),
            escaped_preview(new_text, EDIT_FILE_LOG_PREVIEW_CHARS)
        ));
        let occurrences = source.match_indices(old_text).count();
        if occurrences == 0 {
            let normalized_source = normalize_line_endings(&source);
            let normalized_old = normalize_line_endings(old_text);
            let normalized_hits = normalized_source.match_indices(&normalized_old).count();
            let trimmed_old = old_text.trim();
            let trimmed_hits = if trimmed_old.is_empty() {
                0
            } else {
                source.match_indices(trimmed_old).count()
            };
            let first_line = first_non_empty_line(old_text).unwrap_or("");
            let last_line = last_non_empty_line(old_text).unwrap_or("");
            let first_line_hits = if first_line.is_empty() {
                0
            } else {
                source.match_indices(first_line).count()
            };
            let last_line_hits = if last_line.is_empty() {
                0
            } else {
                source.match_indices(last_line).count()
            };
            logging::log_event(&format!(
                "[tool:edit_file] exact_match=0 path={} normalized_newline_hits={} trimmed_hits={} first_line_hits={} last_line_hits={} first_line={} last_line={}",
                target.display(),
                normalized_hits,
                trimmed_hits,
                first_line_hits,
                last_line_hits,
                escaped_preview(first_line, EDIT_FILE_LOG_PREVIEW_CHARS / 2),
                escaped_preview(last_line, EDIT_FILE_LOG_PREVIEW_CHARS / 2)
            ));

            if normalized_hits == 1 {
                if let Some((updated, matched_line_endings, replacement_line_endings)) =
                    replace_single_match_allowing_newline_differences(&source, old_text, new_text)
                {
                    fs::write(&target, updated)
                        .with_context(|| format!("写入文件失败: {}", target.display()))?;
                    logging::log_event(&format!(
                        "[tool:edit_file] success path={} match_mode=normalized_newlines matched_line_endings={} replacement_line_endings={} old_chars={} new_chars={}",
                        target.display(),
                        matched_line_endings,
                        replacement_line_endings,
                        old_text.chars().count(),
                        new_text.chars().count()
                    ));
                    return Ok(format!(
                        "[write]\naction: edit_file\npath: {}\nreplaced_once: true\nmatch_mode: normalized_newlines\nold_chars: {}\nnew_chars: {}",
                        target.display(),
                        old_text.chars().count(),
                        new_text.chars().count()
                    ));
                }
                logging::log_event(&format!(
                    "[tool:edit_file] normalized_newline_match_detected_but_mapping_failed path={}",
                    target.display()
                ));
            }

            return Err(anyhow!(
                "edit_file 失败：old_text 未匹配到目标文件内容（详情已写入 CLI 日志，可用 /log 查看）"
            ));
        }
        if occurrences > 1 {
            logging::log_event(&format!(
                "[tool:edit_file] ambiguous_match path={} exact_hits={} old_preview={}",
                target.display(),
                occurrences,
                escaped_preview(old_text, EDIT_FILE_LOG_PREVIEW_CHARS)
            ));
            return Err(anyhow!(
                "edit_file 失败：old_text 命中 {} 处，请提供更精确片段（详情已写入 CLI 日志，可用 /log 查看）",
                occurrences
            ));
        }

        let updated = source.replacen(old_text, new_text, 1);
        fs::write(&target, updated)
            .with_context(|| format!("写入文件失败: {}", target.display()))?;
        logging::log_event(&format!(
            "[tool:edit_file] success path={} exact_hits=1 old_chars={} new_chars={}",
            target.display(),
            old_text.chars().count(),
            new_text.chars().count()
        ));
        Ok(format!(
            "[write]\naction: edit_file\npath: {}\nreplaced_once: true\nold_chars: {}\nnew_chars: {}",
            target.display(),
            old_text.chars().count(),
            new_text.chars().count()
        ))
    }

    fn execute_delete_file(&self, path: &str) -> Result<String> {
        let target = self.resolve_existing_workspace_file(path)?;
        fs::remove_file(&target).with_context(|| format!("删除文件失败: {}", target.display()))?;
        Ok(format!(
            "[write]\naction: delete_file\npath: {}",
            target.display()
        ))
    }

    fn authorize_external_read_path(
        &self,
        canonical: &Path,
        prompt_title: &str,
    ) -> AuthorizationDecision {
        if self.is_inside_workspace(canonical)
            || self.is_inside_spirit_managed_user_area(canonical)
        {
            return AuthorizationDecision::Allowed;
        }

        let canonical_text = canonical.display().to_string();
        if self
            .permissions
            .trusted_external_read_paths
            .iter()
            .any(|p| p == &canonical_text)
        {
            return AuthorizationDecision::Allowed;
        }

        AuthorizationDecision::NeedApproval {
            prompt: format!(
                "高风险工具调用: {}\n路径: {}\n\n输入 y 允许一次，n 拒绝，t 信任并持久化。",
                prompt_title, canonical_text
            ),
            trust_target: Some(TrustTarget::ExternalReadPath(canonical_text)),
        }
    }

    fn resolve_existing_path(&self, input: &str) -> Result<PathBuf> {
        let raw = PathBuf::from(input);
        let joined = if raw.is_absolute() {
            raw
        } else {
            self.workspace_root.join(raw)
        };

        joined
            .canonicalize()
            .with_context(|| format!("路径不存在或无法访问: {}", joined.display()))
    }

    fn resolve_existing_absolute_directory(&self, input: &str) -> Result<PathBuf> {
        let trimmed = input.trim();
        if trimmed.is_empty() {
            return Err(anyhow!("path 不能为空"));
        }

        let raw = PathBuf::from(trimmed);
        if !raw.is_absolute() {
            return Err(anyhow!(
                "list_directory_files 仅接受 absolute path: {}",
                trimmed
            ));
        }

        let canonical = raw
            .canonicalize()
            .with_context(|| format!("路径不存在或无法访问: {}", raw.display()))?;
        if !canonical.is_dir() {
            return Err(anyhow!("目标不是目录: {}", canonical.display()));
        }
        Ok(canonical)
    }

    fn is_inside_workspace(&self, path: &Path) -> bool {
        match self.workspace_root.canonicalize() {
            Ok(root) => path_has_prefix(path, &root),
            Err(_) => false,
        }
    }

    fn is_inside_spirit_managed_user_area(&self, path: &Path) -> bool {
        let user_rule = normalize_path_lossy(&self.spirit_data_dir.join(USER_RULE_FILE_NAME)).ok();
        if user_rule.as_ref().is_some_and(|allowed| path_has_prefix(path, allowed)) {
            return true;
        }

        let user_plan = normalize_path_lossy(&self.spirit_data_dir.join(USER_PLAN_FILE_NAME)).ok();
        if user_plan.as_ref().is_some_and(|allowed| path_has_prefix(path, allowed)) {
            return true;
        }

        let skills_root = normalize_path_lossy(&self.spirit_data_dir.join(SKILLS_DIR_NAME)).ok();
        skills_root
            .as_ref()
            .is_some_and(|allowed| path_has_prefix(path, allowed))
    }

    fn is_allowed_write_path(&self, path: &Path) -> bool {
        self.is_inside_workspace(path) || self.is_inside_spirit_managed_user_area(path)
    }

    fn resolve_workspace_target_path(&self, input: &str) -> Result<PathBuf> {
        let raw = PathBuf::from(input.trim());
        if input.trim().is_empty() {
            return Err(anyhow!("path 不能为空"));
        }

        let joined = if raw.is_absolute() {
            raw
        } else {
            self.workspace_root.join(raw)
        };

        let normalized = normalize_path_lossy(&joined)?;
        if !self.is_allowed_write_path(&normalized) {
            return Err(anyhow!(
                "仅允许修改工作目录内文件，或 Spirit 托管的用户规则/plan/skills 路径: {}",
                normalized.display()
            ));
        }

        Ok(normalized)
    }

    fn resolve_existing_workspace_file(&self, input: &str) -> Result<PathBuf> {
        let path = self.resolve_existing_path(input)?;
        if !self.is_allowed_write_path(&path) {
            return Err(anyhow!(
                "仅允许修改工作目录内文件，或 Spirit 托管的用户规则/plan/skills 路径: {}",
                path.display()
            ));
        }
        if !path.is_file() {
            return Err(anyhow!("目标不是文件: {}", path.display()));
        }
        Ok(path)
    }
}

fn required_string_arg<'a>(args: &'a Value, tool: &str, key: &str) -> Result<&'a str> {
    args.get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| anyhow!("{} 缺少 {}", tool, key))
}

fn optional_string_arg(args: &Value, key: &str) -> Result<Option<String>> {
    match args.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(value) => value
            .as_str()
            .map(str::trim)
            .filter(|text| !text.is_empty())
            .map(|text| Some(text.to_string()))
            .ok_or_else(|| anyhow!("{} 必须是非空字符串", key)),
    }
}

fn optional_string_array_arg(args: &Value, key: &str) -> Result<Vec<String>> {
    let Some(value) = args.get(key) else {
        return Ok(Vec::new());
    };
    let Some(items) = value.as_array() else {
        return Err(anyhow!("{} 必须是字符串数组", key));
    };

    let mut out = Vec::new();
    for item in items {
        let text = item
            .as_str()
            .map(str::trim)
            .filter(|entry| !entry.is_empty())
            .ok_or_else(|| anyhow!("{} 必须只包含非空字符串", key))?;
        out.push(text.to_string());
    }
    Ok(out)
}

fn parse_web_fetch_url(url: &str) -> Result<Url> {
    let parsed = Url::parse(url).with_context(|| format!("非法 URL: {}", url))?;
    match parsed.scheme() {
        "http" | "https" => Ok(parsed),
        other => Err(anyhow!(
            "web_fetch 仅支持 http/https，当前 scheme: {}",
            other
        )),
    }
}

fn extract_web_text(raw: &str, content_type: &str) -> String {
    let content_type = content_type.to_ascii_lowercase();
    if content_type.contains("html") || looks_like_html(raw) {
        return html2text::from_read(raw.as_bytes(), 100).unwrap_or_else(|_| raw.to_string());
    }
    raw.to_string()
}

fn looks_like_html(raw: &str) -> bool {
    let prefix = raw
        .chars()
        .take(512)
        .collect::<String>()
        .to_ascii_lowercase();
    prefix.contains("<html")
        || prefix.contains("<!doctype html")
        || prefix.contains("<body")
        || prefix.contains("<head")
}

fn normalize_web_text(text: &str) -> String {
    let normalized = text.replace("\r\n", "\n").replace('\r', "\n");
    let mut out = Vec::new();
    let mut blank_run = 0usize;

    for line in normalized.lines() {
        let trimmed = line.trim_end();
        if trimmed.trim().is_empty() {
            blank_run += 1;
            if blank_run <= 1 {
                out.push(String::new());
            }
            continue;
        }

        blank_run = 0;
        out.push(trimmed.trim_matches('\u{feff}').to_string());
    }

    let result = out.join("\n").trim().to_string();
    if result.is_empty() {
        "（网页内容为空）".to_string()
    } else {
        result
    }
}

impl ShellContext {
    fn detect() -> Self {
        #[cfg(target_os = "windows")]
        {
            return detect_windows_shell_context();
        }

        #[cfg(not(target_os = "windows"))]
        {
            detect_posix_shell_context()
        }
    }

    fn command_parameter_description(&self) -> String {
        match self.kind {
            ShellKind::Cmd => format!(
                "The command to execute in {}. Prefer cmd.exe syntax such as dir, type, where, findstr, and cd. Do not assume Bash commands like find, ls, grep, or cat.",
                self.display_name
            ),
            ShellKind::PowerShell => format!(
                "The command to execute in {}. Prefer PowerShell syntax such as Get-ChildItem, Select-String, Get-Content, Set-Location, and Test-Path. Do not assume Bash-only syntax.",
                self.display_name
            ),
            ShellKind::Posix => format!(
                "The command to execute in {}. Prefer POSIX shell syntax such as ls, find, grep, cat, pwd, and cd.",
                self.display_name
            ),
        }
    }
}

#[cfg(not(target_os = "windows"))]
fn detect_posix_shell_context() -> ShellContext {
    let shell_path = env::var("SHELL").unwrap_or_else(|_| "sh".to_string());
    let shell_name = Path::new(&shell_path)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("sh")
        .to_string();

    ShellContext {
        display_name: format!("POSIX shell ({})", shell_name),
        executable: shell_path,
        kind: ShellKind::Posix,
    }
}

#[cfg(target_os = "windows")]
fn detect_windows_shell_context() -> ShellContext {
    let parent_name = detect_windows_parent_process_name().unwrap_or_default();
    let parent_lower = parent_name.to_ascii_lowercase();

    match parent_lower.as_str() {
        "pwsh.exe" | "pwsh" => ShellContext {
            display_name: "PowerShell (pwsh)".to_string(),
            executable: "pwsh".to_string(),
            kind: ShellKind::PowerShell,
        },
        "powershell.exe" | "powershell" => ShellContext {
            display_name: "Windows PowerShell".to_string(),
            executable: "powershell".to_string(),
            kind: ShellKind::PowerShell,
        },
        "bash.exe" | "bash" | "sh.exe" | "sh" | "zsh.exe" | "zsh" => ShellContext {
            display_name: format!("POSIX shell ({})", strip_windows_exe_suffix(&parent_name)),
            executable: strip_windows_exe_suffix(&parent_name).to_string(),
            kind: ShellKind::Posix,
        },
        "cmd.exe" | "cmd" => ShellContext {
            display_name: "Command Prompt (cmd.exe)".to_string(),
            executable: env::var("ComSpec").unwrap_or_else(|_| "cmd".to_string()),
            kind: ShellKind::Cmd,
        },
        _ if env::var_os("PSModulePath").is_some() && env::var_os("PROMPT").is_none() => {
            ShellContext {
                display_name: "Windows PowerShell".to_string(),
                executable: "powershell".to_string(),
                kind: ShellKind::PowerShell,
            }
        }
        _ => ShellContext {
            display_name: "Command Prompt (cmd.exe)".to_string(),
            executable: env::var("ComSpec").unwrap_or_else(|_| "cmd".to_string()),
            kind: ShellKind::Cmd,
        },
    }
}

#[cfg(target_os = "windows")]
fn strip_windows_exe_suffix(name: &str) -> &str {
    name.strip_suffix(".exe")
        .or_else(|| name.strip_suffix(".EXE"))
        .unwrap_or(name)
}

#[cfg(target_os = "windows")]
fn detect_windows_parent_process_name() -> Option<String> {
    unsafe {
        let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if snapshot == INVALID_HANDLE_VALUE {
            return None;
        }

        let result = find_parent_process_name(snapshot, std::process::id());
        let _ = CloseHandle(snapshot);
        result
    }
}

#[cfg(target_os = "windows")]
unsafe fn find_parent_process_name(snapshot: HANDLE, current_pid: u32) -> Option<String> {
    let mut entry: PROCESSENTRY32W = unsafe { std::mem::zeroed() };
    entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;

    if unsafe { Process32FirstW(snapshot, &mut entry) } == 0 {
        return None;
    }

    let mut parent_pid = None;
    loop {
        if entry.th32ProcessID == current_pid {
            parent_pid = Some(entry.th32ParentProcessID);
            break;
        }

        if unsafe { Process32NextW(snapshot, &mut entry) } == 0 {
            break;
        }
    }

    let parent_pid = parent_pid?;
    let mut entry: PROCESSENTRY32W = unsafe { std::mem::zeroed() };
    entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
    if unsafe { Process32FirstW(snapshot, &mut entry) } == 0 {
        return None;
    }

    loop {
        if entry.th32ProcessID == parent_pid {
            return Some(wide_process_name_to_string(&entry.szExeFile));
        }

        if unsafe { Process32NextW(snapshot, &mut entry) } == 0 {
            break;
        }
    }

    None
}

#[cfg(target_os = "windows")]
fn wide_process_name_to_string(name: &[u16]) -> String {
    let len = name.iter().position(|ch| *ch == 0).unwrap_or(name.len());
    String::from_utf16_lossy(&name[..len])
}

fn normalize_path_lossy(path: &Path) -> Result<PathBuf> {
    if path.exists() {
        return path
            .canonicalize()
            .with_context(|| format!("路径无法访问: {}", path.display()));
    }

    let mut missing_components = Vec::new();
    let mut cursor = path;
    while !cursor.exists() {
        let file_name = cursor
            .file_name()
            .ok_or_else(|| anyhow!("路径缺少文件名: {}", path.display()))?;
        missing_components.push(file_name.to_os_string());
        cursor = cursor
            .parent()
            .ok_or_else(|| anyhow!("路径缺少可访问父目录: {}", path.display()))?;
    }

    let mut normalized = cursor
        .canonicalize()
        .with_context(|| format!("父目录不存在或无法访问: {}", cursor.display()))?;
    for component in missing_components.iter().rev() {
        normalized.push(component);
    }
    Ok(normalized)
}

fn path_has_prefix(path: &Path, prefix: &Path) -> bool {
    let normalized_path = path_compare_key(path);
    let normalized_prefix = path_compare_key(prefix);
    normalized_path == normalized_prefix
        || normalized_path.starts_with(&(normalized_prefix + "/"))
}

fn path_compare_key(path: &Path) -> String {
    let mut normalized = path.to_string_lossy().replace('\\', "/");
    if let Some(stripped) = normalized.strip_prefix("//?/UNC/") {
        normalized = format!("//{}", stripped);
    } else if let Some(stripped) = normalized.strip_prefix("//?/") {
        normalized = stripped.to_string();
    }
    normalized.trim_end_matches('/').to_string()
}

fn decode_command_output(bytes: &[u8]) -> String {
    if let Ok(s) = String::from_utf8(bytes.to_vec()) {
        return s;
    }

    #[cfg(target_os = "windows")]
    {
        let (cow, _, had_errors) = GBK.decode(bytes);
        if !had_errors {
            return cow.into_owned();
        }
    }

    String::from_utf8_lossy(bytes).to_string()
}

fn tokenize(input: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut buf = String::new();
    let mut in_quotes = false;

    for ch in input.chars() {
        match ch {
            '"' => {
                in_quotes = !in_quotes;
            }
            c if c.is_whitespace() && !in_quotes => {
                if !buf.is_empty() {
                    tokens.push(buf.clone());
                    buf.clear();
                }
            }
            _ => buf.push(ch),
        }
    }

    if !buf.is_empty() {
        tokens.push(buf);
    }

    tokens
}

fn truncate_chars(text: &str, max_chars: usize) -> String {
    let mut out = String::new();
    for (i, ch) in text.chars().enumerate() {
        if i >= max_chars {
            break;
        }
        out.push(ch);
    }

    out
}

fn escaped_preview(text: &str, max_chars: usize) -> String {
    let escaped: String = text.chars().flat_map(|ch| ch.escape_default()).collect();
    let preview = truncate_chars(&escaped, max_chars);
    if escaped.chars().count() > max_chars {
        format!("{}...", preview)
    } else {
        preview
    }
}

fn normalize_line_endings(text: &str) -> String {
    text.replace("\r\n", "\n").replace('\r', "\n")
}

fn line_ending_style(text: &str) -> &'static str {
    let has_crlf = text.contains("\r\n");
    let normalized = text.replace("\r\n", "");
    let has_lf = normalized.contains('\n');
    let has_cr = normalized.contains('\r');
    match (has_crlf, has_lf, has_cr) {
        (false, false, false) => "none",
        (true, false, false) => "crlf",
        (false, true, false) => "lf",
        (false, false, true) => "cr",
        _ => "mixed",
    }
}

fn first_non_empty_line(text: &str) -> Option<&str> {
    text.lines().find(|line| !line.trim().is_empty())
}

fn last_non_empty_line(text: &str) -> Option<&str> {
    text.lines().rev().find(|line| !line.trim().is_empty())
}

fn replace_single_match_allowing_newline_differences(
    source: &str,
    old_text: &str,
    new_text: &str,
) -> Option<(String, &'static str, &'static str)> {
    let normalized_source = normalize_line_endings(source);
    let normalized_old = normalize_line_endings(old_text);
    let mut matches = normalized_source.match_indices(&normalized_old);
    let (normalized_start, _) = matches.next()?;
    if matches.next().is_some() {
        return None;
    }

    let mapping = normalized_byte_offsets_to_source_byte_offsets(source);
    let normalized_end = normalized_start + normalized_old.len();
    let source_start = *mapping.get(normalized_start)?;
    let source_end = *mapping.get(normalized_end)?;
    let matched_slice = source.get(source_start..source_end)?;
    let preferred_line_endings = preferred_line_ending_style(matched_slice, source);
    let replacement = rewrite_line_endings(new_text, preferred_line_endings);
    let replacement_line_endings = line_ending_style(&replacement);

    let mut updated = String::with_capacity(source.len() - matched_slice.len() + replacement.len());
    updated.push_str(&source[..source_start]);
    updated.push_str(&replacement);
    updated.push_str(&source[source_end..]);
    Some((
        updated,
        line_ending_style(matched_slice),
        replacement_line_endings,
    ))
}

fn normalized_byte_offsets_to_source_byte_offsets(source: &str) -> Vec<usize> {
    let bytes = source.as_bytes();
    let mut mapping = Vec::with_capacity(bytes.len() + 1);
    mapping.push(0);

    let mut index = 0;
    while index < bytes.len() {
        match bytes[index] {
            b'\r' if index + 1 < bytes.len() && bytes[index + 1] == b'\n' => {
                mapping.push(index + 2);
                index += 2;
            }
            b'\r' => {
                mapping.push(index + 1);
                index += 1;
            }
            _ => {
                mapping.push(index + 1);
                index += 1;
            }
        }
    }

    mapping
}

fn preferred_line_ending_style<'a>(matched_slice: &'a str, source: &'a str) -> &'static str {
    match line_ending_style(matched_slice) {
        "none" | "mixed" => match line_ending_style(source) {
            "crlf" => "crlf",
            "lf" => "lf",
            "cr" => "cr",
            _ => "lf",
        },
        style => style,
    }
}

fn rewrite_line_endings(text: &str, target_style: &str) -> String {
    let normalized = normalize_line_endings(text);
    match target_style {
        "crlf" => normalized.replace("\n", "\r\n"),
        "cr" => normalized.replace('\n', "\r"),
        _ => normalized,
    }
}

fn permissions_file_path() -> PathBuf {
    if let Ok(appdata) = env::var("APPDATA") {
        return PathBuf::from(appdata)
            .join("SpiritAgent")
            .join(PERMISSIONS_FILE);
    }

    if let Ok(home) = env::var("USERPROFILE") {
        return PathBuf::from(home)
            .join(".spirit-agent")
            .join(PERMISSIONS_FILE);
    }

    PathBuf::from(format!(".spirit-agent.{}", PERMISSIONS_FILE))
}

fn load_permissions(path: &Path) -> Result<ToolPermissionStore> {
    if !path.exists() {
        return Ok(ToolPermissionStore::default());
    }

    let content = fs::read_to_string(path)
        .with_context(|| format!("读取权限文件失败: {}", path.display()))?;
    let store = serde_json::from_str::<ToolPermissionStore>(&content)
        .with_context(|| format!("解析权限文件失败: {}", path.display()))?;
    Ok(store)
}

fn save_permissions(path: &Path, store: &ToolPermissionStore) -> Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .with_context(|| format!("创建权限目录失败: {}", parent.display()))?;
    }

    let content = serde_json::to_string_pretty(store)?;
    fs::write(path, content).with_context(|| format!("写入权限文件失败: {}", path.display()))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        fs,
        path::PathBuf,
        time::{SystemTime, UNIX_EPOCH},
    };

    #[test]
    fn normalized_newline_replacement_preserves_crlf_and_utf8() {
        let source = "头一行\r\n头二行\r\n尾行\r\n";
        let old_text = "头一行\n头二行\n";
        let new_text = "头一行\n插入行\n头二行\n";

        let (updated, matched_line_endings, replacement_line_endings) =
            replace_single_match_allowing_newline_differences(source, old_text, new_text)
                .expect("should replace with normalized newlines");

        assert_eq!(matched_line_endings, "crlf");
        assert_eq!(replacement_line_endings, "crlf");
        assert_eq!(updated, "头一行\r\n插入行\r\n头二行\r\n尾行\r\n");
    }

    #[test]
    fn normalized_newline_replacement_requires_unique_match() {
        let source = "alpha\r\nbeta\r\nalpha\r\nbeta\r\n";
        let old_text = "alpha\nbeta\n";

        assert!(replace_single_match_allowing_newline_differences(source, old_text, "z").is_none());
    }

    #[test]
    fn execute_search_is_case_insensitive_and_respects_ignores() {
        let workspace = make_temp_workspace("search-ripgrep");
        fs::create_dir_all(workspace.join("src")).expect("create src dir");
        fs::create_dir_all(workspace.join("target")).expect("create target dir");
        fs::create_dir_all(workspace.join("ignored-dir")).expect("create ignored dir");
        fs::write(workspace.join(".gitignore"), "ignored-dir/\n").expect("write gitignore");
        fs::write(workspace.join("src").join("app.txt"), "Needle in source\n").expect("write source file");
        fs::write(workspace.join("target").join("generated.txt"), "Needle in target\n")
            .expect("write target file");
        fs::write(workspace.join("ignored-dir").join("skip.txt"), "Needle in ignored dir\n")
            .expect("write ignored file");

        let result = ToolRuntime::new_for_workspace(workspace.clone())
            .execute_search("needle")
            .expect("search should succeed");

        let expected_src = PathBuf::from("src").join("app.txt").display().to_string();
        let expected_target = PathBuf::from("target")
            .join("generated.txt")
            .display()
            .to_string();
        let expected_ignored = PathBuf::from("ignored-dir")
            .join("skip.txt")
            .display()
            .to_string();

        assert!(result.contains(&expected_src));
        assert!(!result.contains(&expected_target));
        assert!(!result.contains(&expected_ignored));

        let _ = fs::remove_dir_all(workspace);
    }

    #[test]
    fn create_file_allows_spirit_user_skill_paths_and_creates_missing_dirs() {
        let workspace = make_temp_workspace("spirit-user-skill-write-workspace");
        let spirit_dir = make_temp_workspace("spirit-user-skill-write-data");
        let runtime = ToolRuntime::new_for_workspace_and_spirit_dir(workspace.clone(), spirit_dir.clone());
        let target = spirit_dir
            .join(SKILLS_DIR_NAME)
            .join(format!(
                "code-review-{}",
                SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .expect("system time before unix epoch")
                    .as_nanos()
            ))
            .join("SKILL.md");

        runtime
            .execute_create_file(
                target.to_str().expect("target path utf8"),
                "---\nname: code-review\ndescription: Review code\n---\n",
            )
            .expect("create spirit-managed skill file");

        assert!(target.is_file());

        let _ = fs::remove_dir_all(workspace);
        let _ = fs::remove_dir_all(spirit_dir);
        let _ = fs::remove_dir_all(target.parent().expect("skill dir"));
    }

    #[test]
    fn create_file_allows_spirit_user_plan_path() {
        let workspace = make_temp_workspace("spirit-user-plan-write-workspace");
        let spirit_dir = make_temp_workspace("spirit-user-plan-write-data");
        let runtime = ToolRuntime::new_for_workspace_and_spirit_dir(workspace.clone(), spirit_dir.clone());
        let target = spirit_dir.join(USER_PLAN_FILE_NAME);

        runtime
            .execute_create_file(
                target.to_str().expect("target path utf8"),
                "# Plan\n\n- implement phase 1\n",
            )
            .expect("create spirit-managed plan file");

        assert!(target.is_file());

        let _ = fs::remove_dir_all(workspace);
        let _ = fs::remove_dir_all(spirit_dir);
    }

    #[test]
    fn authorize_read_allows_spirit_user_skill_resources_without_external_prompt() {
        let workspace = make_temp_workspace("spirit-user-skill-read-workspace");
        let spirit_dir = make_temp_workspace("spirit-user-skill-read-data");
        let resource = spirit_dir
            .join(SKILLS_DIR_NAME)
            .join(format!(
                "code-review-read-{}",
                SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .expect("system time before unix epoch")
                    .as_nanos()
            ))
            .join("references")
            .join("checklist.md");
        fs::create_dir_all(resource.parent().expect("resource parent"))
            .expect("create resource parent");
        fs::write(&resource, "- inspect regression risk\n").expect("write resource");

        let runtime = ToolRuntime::new_for_workspace_and_spirit_dir(workspace.clone(), spirit_dir.clone());
        let decision = runtime
            .authorize(&ToolRequest::ReadFile {
                path: resource.to_string_lossy().to_string(),
                start_line: None,
                end_line: None,
            })
            .expect("authorize read");

        assert!(matches!(decision, AuthorizationDecision::Allowed));

        let _ = fs::remove_dir_all(workspace);
        let _ = fs::remove_dir_all(spirit_dir);
        let _ = fs::remove_dir_all(
            resource
                .parent()
                .expect("references dir")
                .parent()
                .expect("skill dir"),
        );
    }

    #[test]
    fn authorize_read_allows_spirit_user_plan_without_external_prompt() {
        let workspace = make_temp_workspace("spirit-user-plan-read-workspace");
        let spirit_dir = make_temp_workspace("spirit-user-plan-read-data");
        let plan_path = spirit_dir.join(USER_PLAN_FILE_NAME);
        fs::write(&plan_path, "# Plan\n\n- phase 1\n").expect("write plan");

        let runtime = ToolRuntime::new_for_workspace_and_spirit_dir(workspace.clone(), spirit_dir.clone());
        let decision = runtime
            .authorize(&ToolRequest::ReadFile {
                path: plan_path.to_string_lossy().to_string(),
                start_line: None,
                end_line: None,
            })
            .expect("authorize read");

        assert!(matches!(decision, AuthorizationDecision::Allowed));

        let _ = fs::remove_dir_all(workspace);
        let _ = fs::remove_dir_all(spirit_dir);
    }

    fn make_temp_workspace(prefix: &str) -> PathBuf {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time before unix epoch")
            .as_nanos();
        let path = std::env::temp_dir().join(format!("spirit-agent-{prefix}-{stamp}"));
        fs::create_dir_all(&path).expect("create temp workspace");
        path
    }
}
