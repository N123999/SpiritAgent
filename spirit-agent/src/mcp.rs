use anyhow::{Context, Result, anyhow};
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    env, fs,
    path::{Path, PathBuf},
};

const MCP_CONFIG_FILE_NAME: &str = "mcp.json";
const WORKSPACE_MCP_DIR: &str = ".vscode";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum McpConfigScope {
    User,
    Workspace,
}

impl std::fmt::Display for McpConfigScope {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::User => write!(f, "user"),
            Self::Workspace => write!(f, "workspace"),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
pub struct McpConfigFile {
    #[serde(default)]
    pub servers: BTreeMap<String, McpServerConfig>,
}

impl McpConfigFile {
    pub fn is_empty(&self) -> bool {
        self.servers.is_empty()
    }

    pub fn merged_with(&self, workspace: &Self) -> (Self, BTreeMap<String, McpConfigScope>) {
        let mut merged_servers = self.servers.clone();
        let mut sources = self
            .servers
            .keys()
            .map(|name| (name.clone(), McpConfigScope::User))
            .collect::<BTreeMap<_, _>>();

        for (name, cfg) in &workspace.servers {
            merged_servers.insert(name.clone(), cfg.clone());
            sources.insert(name.clone(), McpConfigScope::Workspace);
        }

        (
            Self {
                servers: merged_servers,
            },
            sources,
        )
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct McpServerConfig {
    #[serde(default)]
    pub display_name: Option<String>,
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default)]
    pub trusted: bool,
    #[serde(default)]
    pub capabilities: McpCapabilityToggles,
    #[serde(flatten)]
    pub transport: McpTransportConfig,
}

impl McpServerConfig {
    pub fn display_label(&self, fallback_name: &str) -> String {
        self.display_name
            .clone()
            .unwrap_or_else(|| fallback_name.to_string())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct McpCapabilityToggles {
    #[serde(default = "default_true")]
    pub tools: bool,
    #[serde(default = "default_true")]
    pub resources: bool,
    #[serde(default = "default_true")]
    pub prompts: bool,
}

impl Default for McpCapabilityToggles {
    fn default() -> Self {
        Self {
            tools: true,
            resources: true,
            prompts: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum McpTransportConfig {
    Stdio {
        command: String,
        #[serde(default)]
        args: Vec<String>,
        #[serde(default)]
        env: BTreeMap<String, String>,
        #[serde(default)]
        cwd: Option<String>,
        #[serde(default)]
        timeout_ms: Option<u64>,
    },
    Http {
        url: String,
        #[serde(default)]
        headers: BTreeMap<String, String>,
        #[serde(default)]
        timeout_ms: Option<u64>,
    },
}

impl McpTransportConfig {
    pub fn summary(&self) -> String {
        match self {
            Self::Stdio {
                command,
                args,
                cwd,
                timeout_ms,
                ..
            } => {
                let args_text = if args.is_empty() {
                    String::new()
                } else {
                    format!(" {}", args.join(" "))
                };
                let cwd_text = cwd
                    .as_deref()
                    .map(|v| format!(", cwd={}", v))
                    .unwrap_or_default();
                let timeout_text = timeout_ms
                    .map(|v| format!(", timeout={}ms", v))
                    .unwrap_or_default();
                format!("stdio {}{}{}{}", command, args_text, cwd_text, timeout_text)
            }
            Self::Http {
                url, timeout_ms, ..
            } => {
                let timeout_text = timeout_ms
                    .map(|v| format!(", timeout={}ms", v))
                    .unwrap_or_default();
                format!("http {}{}", url, timeout_text)
            }
        }
    }
}

#[derive(Debug, Clone)]
pub struct LoadedMcpConfig {
    pub user_path: PathBuf,
    pub workspace_path: PathBuf,
    pub user_config: McpConfigFile,
    pub workspace_config: McpConfigFile,
    pub merged: McpConfigFile,
    pub server_sources: BTreeMap<String, McpConfigScope>,
}

pub fn user_mcp_config_path() -> PathBuf {
    if let Ok(appdata) = env::var("APPDATA") {
        return PathBuf::from(appdata)
            .join("SpiritAgent")
            .join(MCP_CONFIG_FILE_NAME);
    }

    if let Ok(home) = env::var("USERPROFILE") {
        return PathBuf::from(home)
            .join(".spirit-agent")
            .join(MCP_CONFIG_FILE_NAME);
    }

    PathBuf::from(format!(".spirit-agent.{}", MCP_CONFIG_FILE_NAME))
}

pub fn workspace_mcp_config_path(workspace_root: &Path) -> PathBuf {
    workspace_root.join(WORKSPACE_MCP_DIR).join(MCP_CONFIG_FILE_NAME)
}

pub fn load_merged_mcp_config(workspace_root: &Path) -> Result<LoadedMcpConfig> {
    let user_path = user_mcp_config_path();
    let workspace_path = workspace_mcp_config_path(workspace_root);
    let user_config = load_mcp_config_file(&user_path)?.unwrap_or_default();
    let workspace_config = load_mcp_config_file(&workspace_path)?.unwrap_or_default();
    let (merged, server_sources) = user_config.merged_with(&workspace_config);

    Ok(LoadedMcpConfig {
        user_path,
        workspace_path,
        user_config,
        workspace_config,
        merged,
        server_sources,
    })
}

pub fn save_mcp_config(path: &Path, config: &McpConfigFile, overwrite: bool) -> Result<()> {
    if path.exists() && !overwrite {
        return Err(anyhow!(
            "配置文件已存在: {}。如需覆盖，请使用 force。",
            path.display()
        ));
    }

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .with_context(|| format!("创建 MCP 配置目录失败: {}", parent.display()))?;
    }

    let content = serde_json::to_string_pretty(config)?;
    fs::write(path, content).with_context(|| format!("写入 MCP 配置失败: {}", path.display()))
}

pub fn example_github_mcp_config() -> McpConfigFile {
    let mut env = BTreeMap::new();
    env.insert(
        "GITHUB_PERSONAL_ACCESS_TOKEN".to_string(),
        "${env:GITHUB_PERSONAL_ACCESS_TOKEN}".to_string(),
    );

    let github = McpServerConfig {
        display_name: Some("GitHub MCP".to_string()),
        enabled: true,
        trusted: false,
        capabilities: McpCapabilityToggles::default(),
        transport: McpTransportConfig::Stdio {
            command: "npx".to_string(),
            args: vec![
                "-y".to_string(),
                "@modelcontextprotocol/server-github".to_string(),
            ],
            env,
            cwd: None,
            timeout_ms: Some(20_000),
        },
    };

    let mut servers = BTreeMap::new();
    servers.insert("github".to_string(), github);
    McpConfigFile { servers }
}

pub fn resolve_env_value(value: &str) -> Result<String> {
    if let Some(var_name) = value
        .strip_prefix("${env:")
        .and_then(|rest| rest.strip_suffix('}'))
    {
        if var_name.trim().is_empty() {
            return Err(anyhow!("非法环境变量占位符: {}", value));
        }

        return env::var(var_name)
            .with_context(|| format!("缺少环境变量 {}（来自 MCP 配置）", var_name));
    }

    Ok(value.to_string())
}

pub fn resolve_env_map(env_map: &BTreeMap<String, String>) -> Result<BTreeMap<String, String>> {
    env_map
        .iter()
        .map(|(key, value)| Ok((key.clone(), resolve_env_value(value)?)))
        .collect()
}

fn load_mcp_config_file(path: &Path) -> Result<Option<McpConfigFile>> {
    if !path.exists() {
        return Ok(None);
    }

    let content = fs::read_to_string(path)
        .with_context(|| format!("读取 MCP 配置失败: {}", path.display()))?;
    let config = serde_json::from_str::<McpConfigFile>(&content)
        .with_context(|| format!("解析 MCP 配置失败: {}", path.display()))?;
    Ok(Some(config))
}

fn default_true() -> bool {
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn workspace_config_overrides_same_named_server() {
        let mut user = McpConfigFile::default();
        user.servers.insert(
            "github".to_string(),
            McpServerConfig {
                display_name: Some("User GitHub".to_string()),
                enabled: true,
                trusted: false,
                capabilities: McpCapabilityToggles::default(),
                transport: McpTransportConfig::Stdio {
                    command: "npx".to_string(),
                    args: vec!["user".to_string()],
                    env: BTreeMap::new(),
                    cwd: None,
                    timeout_ms: None,
                },
            },
        );

        let mut workspace = McpConfigFile::default();
        workspace.servers.insert(
            "github".to_string(),
            McpServerConfig {
                display_name: Some("Workspace GitHub".to_string()),
                enabled: false,
                trusted: true,
                capabilities: McpCapabilityToggles {
                    tools: true,
                    resources: false,
                    prompts: false,
                },
                transport: McpTransportConfig::Stdio {
                    command: "uvx".to_string(),
                    args: vec!["workspace".to_string()],
                    env: BTreeMap::new(),
                    cwd: None,
                    timeout_ms: None,
                },
            },
        );

        let (merged, sources) = user.merged_with(&workspace);
        let server = merged.servers.get("github").expect("github server exists");

        assert!(!server.enabled);
        assert!(server.trusted);
        assert_eq!(sources.get("github"), Some(&McpConfigScope::Workspace));
        match &server.transport {
            McpTransportConfig::Stdio { command, args, .. } => {
                assert_eq!(command, "uvx");
                assert_eq!(args, &vec!["workspace".to_string()]);
            }
            other => panic!("unexpected transport: {other:?}"),
        }
    }

    #[test]
    fn resolve_plain_and_placeholder_env_values() {
        assert_eq!(resolve_env_value("literal").expect("literal resolves"), "literal");

        let path_value = resolve_env_value("${env:PATH}").expect("PATH should exist");
        assert!(!path_value.trim().is_empty());
    }

    #[test]
    fn github_template_points_to_real_package_shape() {
        let cfg = example_github_mcp_config();
        let github = cfg.servers.get("github").expect("github config exists");

        match &github.transport {
            McpTransportConfig::Stdio { command, args, env, .. } => {
                assert_eq!(command, "npx");
                assert!(args.contains(&"@modelcontextprotocol/server-github".to_string()));
                assert_eq!(
                    env.get("GITHUB_PERSONAL_ACCESS_TOKEN"),
                    Some(&"${env:GITHUB_PERSONAL_ACCESS_TOKEN}".to_string())
                );
            }
            other => panic!("unexpected transport: {other:?}"),
        }
    }
}