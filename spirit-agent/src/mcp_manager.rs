use anyhow::{Context, Result, anyhow};
use rmcp::{
    ServiceExt,
    model::{CallToolRequestParams, GetPromptRequestParams, ReadResourceRequestParams},
    transport::{ConfigureCommandExt, TokioChildProcess},
};
use serde_json::{Map, Value};
use std::{
    collections::BTreeMap,
    env,
    path::{Path, PathBuf},
    time::Duration,
};
use tokio::{process::Command, runtime::Builder as RuntimeBuilder};

use crate::mcp::{
    LoadedMcpConfig, McpCapabilityToggles, McpConfigScope, McpServerConfig, McpTransportConfig,
    load_merged_mcp_config, resolve_env_map,
};

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum McpServerRuntimeState {
    Disabled,
    NeedsTrust,
    Ready,
}

impl McpServerRuntimeState {
    pub fn label(&self) -> &'static str {
        match self {
            Self::Disabled => "disabled",
            Self::NeedsTrust => "needs-trust",
            Self::Ready => "ready",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ManagedMcpServer {
    pub name: String,
    pub display_name: String,
    pub source: McpConfigScope,
    pub enabled: bool,
    pub trusted: bool,
    pub capabilities: McpCapabilityToggles,
    pub transport: McpTransportConfig,
    pub state: McpServerRuntimeState,
}

impl ManagedMcpServer {
    pub fn transport_summary(&self) -> String {
        self.transport.summary()
    }

    pub fn capability_summary(&self) -> String {
        let mut enabled = Vec::new();
        if self.capabilities.tools {
            enabled.push("tools");
        }
        if self.capabilities.resources {
            enabled.push("resources");
        }
        if self.capabilities.prompts {
            enabled.push("prompts");
        }
        if enabled.is_empty() {
            "none".to_string()
        } else {
            enabled.join(", ")
        }
    }
}

pub struct McpManager {
    workspace_root: PathBuf,
    user_config_path: PathBuf,
    workspace_config_path: PathBuf,
    servers: BTreeMap<String, ManagedMcpServer>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct McpDiscoveredTool {
    pub name: String,
    pub title: Option<String>,
    pub description: Option<String>,
    pub input_schema: Value,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct McpDiscoveredResource {
    pub uri: String,
    pub name: String,
    pub title: Option<String>,
    pub description: Option<String>,
    pub mime_type: Option<String>,
    pub size: Option<u32>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct McpDiscoveredPromptArgument {
    pub name: String,
    pub title: Option<String>,
    pub description: Option<String>,
    pub required: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct McpDiscoveredPrompt {
    pub name: String,
    pub title: Option<String>,
    pub description: Option<String>,
    pub arguments: Vec<McpDiscoveredPromptArgument>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct McpServerInspection {
    pub name: String,
    pub display_name: String,
    pub source: McpConfigScope,
    pub protocol_version: String,
    pub server_name: String,
    pub server_title: Option<String>,
    pub server_version: String,
    pub server_description: Option<String>,
    pub instructions: Option<String>,
    pub supports_tools: bool,
    pub supports_resources: bool,
    pub supports_prompts: bool,
    pub supports_logging: bool,
    pub supports_completions: bool,
    pub tools_list_changed: bool,
    pub resources_list_changed: bool,
    pub prompts_list_changed: bool,
    pub tools_count: usize,
    pub resources_count: usize,
    pub resource_templates_count: usize,
    pub prompts_count: usize,
}

impl McpManager {
    pub fn load(workspace_root: impl Into<PathBuf>) -> Result<Self> {
        let workspace_root = workspace_root.into();
        let loaded = load_merged_mcp_config(&workspace_root)?;
        Ok(Self::from_loaded_config(workspace_root, loaded))
    }

    pub fn from_loaded_config(workspace_root: PathBuf, loaded: LoadedMcpConfig) -> Self {
        let mut servers = BTreeMap::new();
        for (name, config) in loaded.merged.servers {
            let source = loaded
                .server_sources
                .get(&name)
                .copied()
                .unwrap_or(McpConfigScope::User);
            servers.insert(name.clone(), build_managed_server(name, source, config));
        }

        Self {
            workspace_root,
            user_config_path: loaded.user_path,
            workspace_config_path: loaded.workspace_path,
            servers,
        }
    }

    pub fn workspace_root(&self) -> &std::path::Path {
        &self.workspace_root
    }

    pub fn user_config_path(&self) -> &std::path::Path {
        &self.user_config_path
    }

    pub fn workspace_config_path(&self) -> &std::path::Path {
        &self.workspace_config_path
    }

    pub fn servers(&self) -> std::collections::btree_map::Values<'_, String, ManagedMcpServer> {
        self.servers.values()
    }

    pub fn get(&self, name: &str) -> Option<&ManagedMcpServer> {
        self.servers.get(name)
    }

    pub fn ensure_started(&mut self, name: &str) -> Result<()> {
        let server = self.require_server(name)?;

        match server.state {
            McpServerRuntimeState::Disabled => Err(anyhow!(
                "MCP server {} 已禁用，请先在 mcp.json 中启用。",
                name
            )),
            McpServerRuntimeState::NeedsTrust => Err(anyhow!(
                "MCP server {} 尚未信任，请先执行 `spirit-agent mcp trust {}`。",
                name,
                name
            )),
            McpServerRuntimeState::Ready => Ok(()),
        }
    }

    pub fn inspect_server(&self, name: &str) -> Result<McpServerInspection> {
        let server = self.require_connectable_server(name)?.clone();
        let workspace_root = self.workspace_root.clone();
        self.block_on(async move {
            let client = connect_stdio_client(&workspace_root, &server).await?;
            let peer_info = client
                .peer_info()
                .cloned()
                .ok_or_else(|| anyhow!("MCP server 未返回 initialize 结果: {}", server.name))?;

            let supports_tools = server.capabilities.tools && peer_info.capabilities.tools.is_some();
            let supports_resources =
                server.capabilities.resources && peer_info.capabilities.resources.is_some();
            let supports_prompts =
                server.capabilities.prompts && peer_info.capabilities.prompts.is_some();

            let tools_count = if supports_tools {
                client.list_all_tools().await?.len()
            } else {
                0
            };
            let (resources_count, resource_templates_count) = if supports_resources {
                (
                    client.list_all_resources().await?.len(),
                    client.list_all_resource_templates().await?.len(),
                )
            } else {
                (0, 0)
            };
            let prompts_count = if supports_prompts {
                client.list_all_prompts().await?.len()
            } else {
                0
            };
            let _ = client.cancel().await;

            Ok(McpServerInspection {
                name: server.name.clone(),
                display_name: server.display_name.clone(),
                source: server.source,
                protocol_version: peer_info.protocol_version.to_string(),
                server_name: peer_info.server_info.name,
                server_title: peer_info.server_info.title,
                server_version: peer_info.server_info.version,
                server_description: peer_info.server_info.description,
                instructions: peer_info.instructions,
                supports_tools,
                supports_resources,
                supports_prompts,
                supports_logging: peer_info.capabilities.logging.is_some(),
                supports_completions: peer_info.capabilities.completions.is_some(),
                tools_list_changed: peer_info
                    .capabilities
                    .tools
                    .as_ref()
                    .and_then(|cap| cap.list_changed)
                    .unwrap_or(false),
                resources_list_changed: peer_info
                    .capabilities
                    .resources
                    .as_ref()
                    .and_then(|cap| cap.list_changed)
                    .unwrap_or(false),
                prompts_list_changed: peer_info
                    .capabilities
                    .prompts
                    .as_ref()
                    .and_then(|cap| cap.list_changed)
                    .unwrap_or(false),
                tools_count,
                resources_count,
                resource_templates_count,
                prompts_count,
            })
        })
    }

    pub fn list_tools(&self, name: &str) -> Result<Vec<McpDiscoveredTool>> {
        let server = self.require_connectable_server(name)?.clone();
        let workspace_root = self.workspace_root.clone();
        self.block_on(async move {
            let client = connect_stdio_client(&workspace_root, &server).await?;
            let peer_info = client
                .peer_info()
                .cloned()
                .ok_or_else(|| anyhow!("MCP server 未返回 initialize 结果: {}", server.name))?;
            if !(server.capabilities.tools && peer_info.capabilities.tools.is_some()) {
                let _ = client.cancel().await;
                return Ok(Vec::new());
            }

            let tools = client
                .list_all_tools()
                .await?
                .into_iter()
                .map(|tool| McpDiscoveredTool {
                    name: tool.name.into_owned(),
                    title: tool.title,
                    description: tool.description.map(|d| d.into_owned()),
                    input_schema: Value::Object(tool.input_schema.as_ref().clone()),
                })
                .collect();
            let _ = client.cancel().await;
            Ok(tools)
        })
    }

    pub fn list_resources(&self, name: &str) -> Result<Vec<McpDiscoveredResource>> {
        let server = self.require_connectable_server(name)?.clone();
        let workspace_root = self.workspace_root.clone();
        self.block_on(async move {
            let client = connect_stdio_client(&workspace_root, &server).await?;
            let peer_info = client
                .peer_info()
                .cloned()
                .ok_or_else(|| anyhow!("MCP server 未返回 initialize 结果: {}", server.name))?;
            if !(server.capabilities.resources && peer_info.capabilities.resources.is_some()) {
                let _ = client.cancel().await;
                return Ok(Vec::new());
            }

            let resources = client
                .list_all_resources()
                .await?
                .into_iter()
                .map(|resource| McpDiscoveredResource {
                    uri: resource.raw.uri,
                    name: resource.raw.name,
                    title: resource.raw.title,
                    description: resource.raw.description,
                    mime_type: resource.raw.mime_type,
                    size: resource.raw.size,
                })
                .collect();
            let _ = client.cancel().await;
            Ok(resources)
        })
    }

    pub fn list_prompts(&self, name: &str) -> Result<Vec<McpDiscoveredPrompt>> {
        let server = self.require_connectable_server(name)?.clone();
        let workspace_root = self.workspace_root.clone();
        self.block_on(async move {
            let client = connect_stdio_client(&workspace_root, &server).await?;
            let peer_info = client
                .peer_info()
                .cloned()
                .ok_or_else(|| anyhow!("MCP server 未返回 initialize 结果: {}", server.name))?;
            if !(server.capabilities.prompts && peer_info.capabilities.prompts.is_some()) {
                let _ = client.cancel().await;
                return Ok(Vec::new());
            }

            let prompts = client
                .list_all_prompts()
                .await?
                .into_iter()
                .map(|prompt| McpDiscoveredPrompt {
                    name: prompt.name,
                    title: prompt.title,
                    description: prompt.description,
                    arguments: prompt
                        .arguments
                        .unwrap_or_default()
                        .into_iter()
                        .map(|arg| McpDiscoveredPromptArgument {
                            name: arg.name,
                            title: arg.title,
                            description: arg.description,
                            required: arg.required.unwrap_or(false),
                        })
                        .collect(),
                })
                .collect();
            let _ = client.cancel().await;
            Ok(prompts)
        })
    }

    pub fn read_resource(&self, name: &str, uri: &str) -> Result<Value> {
        let server = self.require_connectable_server(name)?.clone();
        let workspace_root = self.workspace_root.clone();
        let uri = uri.to_string();
        self.block_on(async move {
            let client = connect_stdio_client(&workspace_root, &server).await?;
            let result = client
                .read_resource(ReadResourceRequestParams::new(uri))
                .await
                .context("读取 MCP resource 失败")?;
            let _ = client.cancel().await;
            Ok(serde_json::to_value(result)?)
        })
    }

    pub fn call_tool(
        &self,
        name: &str,
        tool_name: &str,
        arguments: Option<Map<String, Value>>,
    ) -> Result<Value> {
        let server = self.require_connectable_server(name)?.clone();
        let workspace_root = self.workspace_root.clone();
        let tool_name = tool_name.to_string();
        self.block_on(async move {
            let client = connect_stdio_client(&workspace_root, &server).await?;
            let mut request = CallToolRequestParams::new(tool_name);
            if let Some(args) = arguments {
                request = request.with_arguments(args);
            }
            let result = client.call_tool(request).await.context("调用 MCP tool 失败")?;
            let _ = client.cancel().await;
            Ok(serde_json::to_value(result)?)
        })
    }

    pub fn get_prompt(
        &self,
        name: &str,
        prompt_name: &str,
        arguments: Option<Map<String, Value>>,
    ) -> Result<Value> {
        let server = self.require_connectable_server(name)?.clone();
        let workspace_root = self.workspace_root.clone();
        let prompt_name = prompt_name.to_string();
        self.block_on(async move {
            let client = connect_stdio_client(&workspace_root, &server).await?;
            let mut request = GetPromptRequestParams::new(prompt_name);
            if let Some(args) = arguments {
                request = request.with_arguments(args);
            }
            let result = client.get_prompt(request).await.context("读取 MCP prompt 失败")?;
            let _ = client.cancel().await;
            Ok(serde_json::to_value(result)?)
        })
    }

    fn block_on<T>(&self, fut: impl std::future::Future<Output = Result<T>>) -> Result<T> {
        let runtime = RuntimeBuilder::new_current_thread()
            .enable_all()
            .build()
            .context("创建 MCP tokio runtime 失败")?;
        runtime.block_on(fut)
    }

    fn require_server(&self, name: &str) -> Result<&ManagedMcpServer> {
        self.servers
            .get(name)
            .ok_or_else(|| anyhow!("未知 MCP server: {}", name))
    }

    fn require_connectable_server(&self, name: &str) -> Result<&ManagedMcpServer> {
        let server = self.require_server(name)?;
        match server.state {
            McpServerRuntimeState::Disabled => Err(anyhow!(
                "MCP server {} 已禁用，请先执行 `spirit-agent mcp enable {}`。",
                name,
                name
            )),
            McpServerRuntimeState::NeedsTrust => Err(anyhow!(
                "MCP server {} 尚未信任，请先执行 `spirit-agent mcp trust {}`。",
                name,
                name
            )),
            McpServerRuntimeState::Ready => Ok(server),
        }
    }
}

fn build_managed_server(
    name: String,
    source: McpConfigScope,
    config: McpServerConfig,
) -> ManagedMcpServer {
    let state = if !config.enabled {
        McpServerRuntimeState::Disabled
    } else if !config.trusted {
        McpServerRuntimeState::NeedsTrust
    } else {
        McpServerRuntimeState::Ready
    };

    let display_name = config.display_label(&name);

    ManagedMcpServer {
        name,
        display_name,
        source,
        enabled: config.enabled,
        trusted: config.trusted,
        capabilities: config.capabilities,
        transport: config.transport,
        state,
    }
}

async fn connect_stdio_client(
    workspace_root: &Path,
    server: &ManagedMcpServer,
) -> Result<rmcp::service::RunningService<rmcp::RoleClient, ()>> {
    let timeout = timeout_for_server(server);
    tokio::time::timeout(timeout, async {
        let transport = build_stdio_transport(workspace_root, server)?;
        let client = ().serve(transport).await.context("初始化 MCP 会话失败")?;
        Ok(client)
    })
    .await
    .map_err(|_| anyhow!("连接 MCP server 超时（{} ms）: {}", timeout.as_millis(), server.name))?
}

fn build_stdio_transport(workspace_root: &Path, server: &ManagedMcpServer) -> Result<TokioChildProcess> {
    let McpTransportConfig::Stdio {
        command,
        args,
        env,
        cwd,
        ..
    } = &server.transport
    else {
        return Err(anyhow!(
            "当前仅支持 stdio MCP server，{} 使用的是非 stdio transport",
            server.name
        ));
    };

    let resolved_env = resolve_env_map(env)?;
    let resolved_cwd = resolve_stdio_cwd(workspace_root, cwd.as_deref());
    let resolved_command = resolve_stdio_command(command)?;
    let transport = TokioChildProcess::new(Command::new(&resolved_command).configure(|cmd| {
        cmd.args(args);
        cmd.current_dir(&resolved_cwd);
        if !resolved_env.is_empty() {
            cmd.envs(resolved_env.iter().map(|(key, value)| (key, value)));
        }
    }))
    .with_context(|| format!("启动 stdio MCP server 失败: {}", server.transport_summary()))?;

    Ok(transport)
}

fn resolve_stdio_cwd(workspace_root: &Path, cwd: Option<&str>) -> PathBuf {
    match cwd {
        Some(path) => {
            let candidate = PathBuf::from(path);
            if candidate.is_absolute() {
                candidate
            } else {
                workspace_root.join(candidate)
            }
        }
        None => workspace_root.to_path_buf(),
    }
}

fn resolve_stdio_command(command: &str) -> Result<PathBuf> {
    let candidate = PathBuf::from(command);

    if candidate.is_absolute() || candidate.components().count() > 1 {
        return resolve_command_candidate(&candidate)
            .ok_or_else(|| anyhow!("找不到 MCP 可执行文件: {}", candidate.display()));
    }

    #[cfg(windows)]
    {
        if let Some(resolved) = resolve_command_in_path_windows(command) {
            return Ok(resolved);
        }
    }

    Ok(candidate)
}

fn resolve_command_candidate(path: &Path) -> Option<PathBuf> {
    #[cfg(windows)]
    {
        if path.extension().is_none() {
            for ext in windows_pathexts() {
                let candidate = PathBuf::from(format!("{}{}", path.display(), ext));
                if candidate.exists() {
                    return Some(candidate);
                }
            }
        }
    }

    if path.exists() {
        return Some(path.to_path_buf());
    }

    None
}

#[cfg(windows)]
fn resolve_command_in_path_windows(command: &str) -> Option<PathBuf> {
    for dir in env::split_paths(&env::var_os("PATH")?) {
        let base = dir.join(command);
        if let Some(resolved) = resolve_command_candidate(&base) {
            return Some(resolved);
        }
    }
    None
}

#[cfg(windows)]
fn windows_pathexts() -> Vec<String> {
    let mut exts = env::var("PATHEXT")
        .unwrap_or_else(|_| ".COM;.EXE;.BAT;.CMD".to_string())
        .split(';')
        .filter_map(|ext| {
            let trimmed = ext.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_ascii_lowercase())
            }
        })
        .collect::<Vec<_>>();

    if !exts.iter().any(|ext| ext == ".cmd") {
        exts.push(".cmd".to_string());
    }
    if !exts.iter().any(|ext| ext == ".bat") {
        exts.push(".bat".to_string());
    }
    exts
}

fn timeout_for_server(server: &ManagedMcpServer) -> Duration {
    let timeout_ms = match &server.transport {
        McpTransportConfig::Stdio { timeout_ms, .. } | McpTransportConfig::Http { timeout_ms, .. } => {
            timeout_ms.unwrap_or(20_000)
        }
    };
    Duration::from_millis(timeout_ms)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mcp::{McpCapabilityToggles, McpConfigFile, McpServerConfig, McpTransportConfig};

    #[test]
    fn manager_marks_untrusted_enabled_server_as_needs_trust() {
        let mut merged = McpConfigFile::default();
        merged.servers.insert(
            "github".to_string(),
            McpServerConfig {
                display_name: Some("GitHub MCP".to_string()),
                enabled: true,
                trusted: false,
                capabilities: McpCapabilityToggles::default(),
                transport: McpTransportConfig::Stdio {
                    command: "npx".to_string(),
                    args: vec![],
                    env: BTreeMap::new(),
                    cwd: None,
                    timeout_ms: None,
                },
            },
        );

        let loaded = LoadedMcpConfig {
            user_path: PathBuf::from("user-mcp.json"),
            workspace_path: PathBuf::from("workspace-mcp.json"),
            user_config: McpConfigFile::default(),
            workspace_config: McpConfigFile::default(),
            merged,
            server_sources: BTreeMap::from([(
                "github".to_string(),
                McpConfigScope::Workspace,
            )]),
        };
        let manager = McpManager::from_loaded_config(PathBuf::from("."), loaded);
        let github = manager.get("github").expect("github exists");

        assert_eq!(github.state, McpServerRuntimeState::NeedsTrust);
        assert_eq!(github.source, McpConfigScope::Workspace);
    }

    #[test]
    fn resolve_relative_stdio_cwd_under_workspace() {
        let workspace = PathBuf::from("C:/workspace/spirit-agent");
        let resolved = resolve_stdio_cwd(&workspace, Some("tools/github"));
        assert_eq!(resolved, PathBuf::from("C:/workspace/spirit-agent/tools/github"));
    }
}