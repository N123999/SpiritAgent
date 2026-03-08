use anyhow::{Context, Result, anyhow};
use encoding_rs::GBK;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    collections::BTreeSet,
    env, fs,
    path::{Path, PathBuf},
    process::Command,
};

const PERMISSIONS_FILE: &str = "tool-permissions.json";
const MAX_COMMAND_OUTPUT_CHARS: usize = 16_000;
const MAX_SEARCH_RESULTS: usize = 80;
const MAX_SEARCH_FILE_BYTES: u64 = 1_000_000;
const MAX_READ_LINES_DEFAULT: usize = 200;

#[derive(Clone)]
pub enum ToolRequest {
    Shell { command: String },
    ReadFile {
        path: String,
        start_line: Option<usize>,
        end_line: Option<usize>,
    },
    Search { query: String },
    CreateFile { path: String, content: String },
    UpdateFile { path: String, content: String },
    DeleteFile { path: String },
}

#[derive(Clone)]
pub enum TrustTarget {
    ShellCommand(String),
    ExternalReadPath(String),
}

pub enum AuthorizationDecision {
    Allowed,
    NeedApproval {
        prompt: String,
        trust_target: Option<TrustTarget>,
    },
}

#[derive(Default, Serialize, Deserialize)]
struct ToolPermissionStore {
    trusted_shell_commands: Vec<String>,
    trusted_external_read_paths: Vec<String>,
}

pub struct ToolRuntime {
    workspace_root: PathBuf,
    permission_store_path: PathBuf,
    permissions: ToolPermissionStore,
}

impl ToolRuntime {
    pub fn new() -> Self {
        let workspace_root = env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
        let permission_store_path = permissions_file_path();
        let permissions = load_permissions(&permission_store_path).unwrap_or_default();

        Self {
            workspace_root,
            permission_store_path,
            permissions,
        }
    }

    pub fn parse_tool_command(&self, message: &str) -> Result<ToolRequest> {
        let raw = message
            .strip_prefix("/tool")
            .ok_or_else(|| anyhow!("命令必须以 /tool 开头"))?
            .trim();

        if raw.is_empty() {
            return Err(anyhow!(
                "用法:\n/tool shell <command>\n/tool read <path> [start] [end]\n/tool search <query>"
            ));
        }

        let tokens = tokenize(raw);
        let sub = tokens
            .first()
            .map(|s| s.as_str())
            .ok_or_else(|| anyhow!("缺少子命令"))?;

        match sub {
            "shell" => {
                let cmd = raw
                    .strip_prefix("shell")
                    .map(str::trim)
                    .unwrap_or("");
                if cmd.is_empty() {
                    return Err(anyhow!("用法: /tool shell <command>"));
                }
                Ok(ToolRequest::Shell {
                    command: cmd.to_string(),
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
                let q = raw
                    .strip_prefix("search")
                    .map(str::trim)
                    .unwrap_or("");
                if q.is_empty() {
                    return Err(anyhow!("用法: /tool search <query>"));
                }
                Ok(ToolRequest::Search {
                    query: q.to_string(),
                })
            }
            _ => Err(anyhow!(
                "未知 /tool 子命令: {}\n可用: shell | read | search",
                sub
            )),
        }
    }

    pub fn authorize(&self, request: &ToolRequest) -> Result<AuthorizationDecision> {
        match request {
            ToolRequest::Shell { command } => {
                if self.permissions.trusted_shell_commands.iter().any(|c| c == command) {
                    return Ok(AuthorizationDecision::Allowed);
                }

                Ok(AuthorizationDecision::NeedApproval {
                    prompt: format!(
                        "高风险工具调用: shell\n命令: {}\n\n输入 y 允许一次，n 拒绝，t 信任并持久化。",
                        command
                    ),
                    trust_target: Some(TrustTarget::ShellCommand(command.clone())),
                })
            }
            ToolRequest::ReadFile { path, .. } => {
                let canonical = self.resolve_existing_path(path)?;
                if self.is_inside_workspace(&canonical) {
                    return Ok(AuthorizationDecision::Allowed);
                }

                let canonical_text = canonical.display().to_string();
                if self
                    .permissions
                    .trusted_external_read_paths
                    .iter()
                    .any(|p| p == &canonical_text)
                {
                    return Ok(AuthorizationDecision::Allowed);
                }

                Ok(AuthorizationDecision::NeedApproval {
                    prompt: format!(
                        "高风险工具调用: 读取工作目录外文件\n路径: {}\n\n输入 y 允许一次，n 拒绝，t 信任并持久化。",
                        canonical_text
                    ),
                    trust_target: Some(TrustTarget::ExternalReadPath(canonical_text)),
                })
            }
            ToolRequest::Search { .. } => Ok(AuthorizationDecision::Allowed),
            ToolRequest::CreateFile { path, content } => Ok(AuthorizationDecision::NeedApproval {
                prompt: format!(
                    "高风险工具调用: 创建文件\n路径: {}\n内容长度: {} 字符\n\n输入 y 允许一次，n 拒绝。",
                    path,
                    content.chars().count()
                ),
                trust_target: None,
            }),
            ToolRequest::UpdateFile { path, content } => Ok(AuthorizationDecision::NeedApproval {
                prompt: format!(
                    "高风险工具调用: 修改文件\n路径: {}\n新内容长度: {} 字符\n\n输入 y 允许一次，n 拒绝。",
                    path,
                    content.chars().count()
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
                if !self.permissions.trusted_shell_commands.iter().any(|c| c == cmd) {
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
            ToolRequest::Shell { command } => self.execute_shell(command),
            ToolRequest::ReadFile {
                path,
                start_line,
                end_line,
            } => self.execute_read(path, *start_line, *end_line),
            ToolRequest::Search { query } => self.execute_search(query),
            ToolRequest::CreateFile { path, content } => self.execute_create_file(path, content),
            ToolRequest::UpdateFile { path, content } => self.execute_update_file(path, content),
            ToolRequest::DeleteFile { path } => self.execute_delete_file(path),
        }
    }

    pub fn tool_definitions_json() -> Value {
        json!([
            {
                "type": "function",
                "function": {
                    "name": "run_shell_command",
                    "description": "Execute a shell command in the workspace directory. This is high risk and may require user approval.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "command": {
                                "type": "string",
                                "description": "The shell command to execute."
                            }
                        },
                        "required": ["command"],
                        "additionalProperties": false
                    }
                }
            },
            {
                "type": "function",
                "function": {
                    "name": "read_file",
                    "description": "Read file contents. Files inside workspace are allowed directly, outside files may require user approval.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "path": { "type": "string" },
                            "start_line": { "type": "integer", "minimum": 1 },
                            "end_line": { "type": "integer", "minimum": 1 }
                        },
                        "required": ["path"],
                        "additionalProperties": false
                    }
                }
            },
            {
                "type": "function",
                "function": {
                    "name": "search_files",
                    "description": "Search text in files under the workspace directory only.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "query": { "type": "string" }
                        },
                        "required": ["query"],
                        "additionalProperties": false
                    }
                }
            },
            {
                "type": "function",
                "function": {
                    "name": "create_file",
                    "description": "Create a new file inside the workspace. Fails if the file already exists.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "path": { "type": "string" },
                            "content": { "type": "string" }
                        },
                        "required": ["path", "content"],
                        "additionalProperties": false
                    }
                }
            },
            {
                "type": "function",
                "function": {
                    "name": "update_file",
                    "description": "Replace the full contents of an existing file inside the workspace.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "path": { "type": "string" },
                            "content": { "type": "string" }
                        },
                        "required": ["path", "content"],
                        "additionalProperties": false
                    }
                }
            },
            {
                "type": "function",
                "function": {
                    "name": "delete_file",
                    "description": "Delete an existing file inside the workspace.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "path": { "type": "string" }
                        },
                        "required": ["path"],
                        "additionalProperties": false
                    }
                }
            }
        ])
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
            "create_file" => {
                let path = required_string_arg(&args, "create_file", "path")?;
                let content = required_string_arg(&args, "create_file", "content")?;
                Ok(ToolRequest::CreateFile {
                    path: path.to_string(),
                    content: content.to_string(),
                })
            }
            "update_file" => {
                let path = required_string_arg(&args, "update_file", "path")?;
                let content = required_string_arg(&args, "update_file", "content")?;
                Ok(ToolRequest::UpdateFile {
                    path: path.to_string(),
                    content: content.to_string(),
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
        let output = if cfg!(target_os = "windows") {
            Command::new("cmd")
                .args(["/C", &format!("chcp 65001 >nul & {}", command)])
                .current_dir(&self.workspace_root)
                .output()
                .with_context(|| format!("执行命令失败: {}", command))?
        } else {
            Command::new("sh")
                .args(["-lc", command])
                .current_dir(&self.workspace_root)
                .output()
                .with_context(|| format!("执行命令失败: {}", command))?
        };

            let stdout = decode_command_output(&output.stdout);
            let stderr = decode_command_output(&output.stderr);
        let mut combined = format!(
            "[shell]\nworkspace: {}\ncommand: {}\nexit_code: {}\n\n[stdout]\n{}\n\n[stderr]\n{}",
            self.workspace_root.display(),
            command,
            output.status.code().unwrap_or(-1),
            stdout,
            stderr
        );

        if combined.chars().count() > MAX_COMMAND_OUTPUT_CHARS {
            combined = truncate_chars(&combined, MAX_COMMAND_OUTPUT_CHARS);
            combined.push_str("\n\n...<输出已截断>");
        }

        Ok(combined)
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

        let mut out = format!("[read]\npath: {}\nrange: {}-{}\n\n", canonical.display(), s, e);
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

        let needle_lower = needle.to_lowercase();
        let mut files = BTreeSet::new();
        let mut stack = vec![self.workspace_root.clone()];

        while let Some(dir) = stack.pop() {
            let entries = match fs::read_dir(&dir) {
                Ok(v) => v,
                Err(_) => continue,
            };

            for entry in entries.flatten() {
                let path = entry.path();
                let name = path.file_name().and_then(|s| s.to_str()).unwrap_or("");

                if path.is_dir() {
                    if name == ".git" || name == "target" || name == "node_modules" {
                        continue;
                    }
                    stack.push(path);
                    continue;
                }

                if !path.is_file() {
                    continue;
                }

                let meta = match entry.metadata() {
                    Ok(v) => v,
                    Err(_) => continue,
                };
                if meta.len() > MAX_SEARCH_FILE_BYTES {
                    continue;
                }

                let text = match fs::read_to_string(&path) {
                    Ok(v) => v,
                    Err(_) => continue,
                };

                for line in text.lines() {
                    if line.to_lowercase().contains(&needle_lower) {
                        let rel = path.strip_prefix(&self.workspace_root).unwrap_or(&path);
                        files.insert(rel.display().to_string());
                        break;
                    }
                }

                if files.len() >= MAX_SEARCH_RESULTS {
                    break;
                }
            }

            if files.len() >= MAX_SEARCH_RESULTS {
                break;
            }
        }

        if files.is_empty() {
            return Ok(format!("[tool] 搜索: {}\n未搜索到文件", query));
        }

        let mut out = format!("[tool] 搜索: {}\n搜索到文件\n", query);
        for file in files {
            out.push_str(&format!("{}\n", file));
        }
        Ok(out)
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

    fn execute_update_file(&self, path: &str, content: &str) -> Result<String> {
        let target = self.resolve_existing_workspace_file(path)?;
        fs::write(&target, content)
            .with_context(|| format!("写入文件失败: {}", target.display()))?;
        Ok(format!(
            "[write]\naction: update_file\npath: {}\nchars: {}",
            target.display(),
            content.chars().count()
        ))
    }

    fn execute_delete_file(&self, path: &str) -> Result<String> {
        let target = self.resolve_existing_workspace_file(path)?;
        fs::remove_file(&target)
            .with_context(|| format!("删除文件失败: {}", target.display()))?;
        Ok(format!("[write]\naction: delete_file\npath: {}", target.display()))
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

    fn is_inside_workspace(&self, path: &Path) -> bool {
        match self.workspace_root.canonicalize() {
            Ok(root) => path.starts_with(root),
            Err(_) => false,
        }
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
        let root = self
            .workspace_root
            .canonicalize()
            .with_context(|| format!("工作目录无法访问: {}", self.workspace_root.display()))?;

        if !normalized.starts_with(&root) {
            return Err(anyhow!("仅允许修改工作目录内文件: {}", normalized.display()));
        }

        Ok(normalized)
    }

    fn resolve_existing_workspace_file(&self, input: &str) -> Result<PathBuf> {
        let path = self.resolve_existing_path(input)?;
        if !self.is_inside_workspace(&path) {
            return Err(anyhow!("仅允许修改工作目录内文件: {}", path.display()));
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

fn normalize_path_lossy(path: &Path) -> Result<PathBuf> {
    if path.exists() {
        return path
            .canonicalize()
            .with_context(|| format!("路径无法访问: {}", path.display()));
    }

    let parent = path
        .parent()
        .ok_or_else(|| anyhow!("路径缺少父目录: {}", path.display()))?;
    let parent = parent
        .canonicalize()
        .with_context(|| format!("父目录不存在或无法访问: {}", parent.display()))?;
    let file_name = path
        .file_name()
        .ok_or_else(|| anyhow!("路径缺少文件名: {}", path.display()))?;
    Ok(parent.join(file_name))
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
