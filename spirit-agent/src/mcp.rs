use anyhow::{Context, Result, anyhow};
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    collections::hash_map::DefaultHasher,
    env, fs,
    hash::{Hash, Hasher},
    path::{Path, PathBuf},
};

const MCP_CONFIG_FILE_NAME: &str = "mcp.json";
const APP_DATA_DIR_NAME: &str = "SpiritAgent";
const WORKSPACE_MCP_DIR_NAME: &str = "workspaces";

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
pub struct McpConfigFile {
    #[serde(default)]
    pub servers: BTreeMap<String, McpServerConfig>,
}

impl McpConfigFile {
    pub fn is_empty(&self) -> bool {
        self.servers.is_empty()
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
    pub path: PathBuf,
    pub config: McpConfigFile,
}

pub fn spirit_agent_data_dir() -> PathBuf {
    if let Ok(appdata) = env::var("APPDATA") {
        return PathBuf::from(appdata).join(APP_DATA_DIR_NAME);
    }

    if let Ok(home) = env::var("USERPROFILE") {
        return PathBuf::from(home).join(".spirit-agent");
    }

    PathBuf::from(".spirit-agent")
}

pub fn workspace_mcp_config_path(workspace_root: &Path) -> PathBuf {
    spirit_agent_data_dir()
        .join(WORKSPACE_MCP_DIR_NAME)
        .join(workspace_storage_key(workspace_root))
        .join(MCP_CONFIG_FILE_NAME)
}

pub fn load_mcp_config(workspace_root: &Path) -> Result<LoadedMcpConfig> {
    let path = workspace_mcp_config_path(workspace_root);
    let config = load_mcp_config_file(&path)?.unwrap_or_default();
    Ok(LoadedMcpConfig { path, config })
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
    let mut servers = BTreeMap::new();
    servers.insert("github".to_string(), github_preset_config(false));
    McpConfigFile { servers }
}

pub fn add_mcp_server(
    workspace_root: &Path,
    name: &str,
    server_config: McpServerConfig,
) -> Result<PathBuf> {
    let server_name = name.trim();
    if server_name.is_empty() {
        return Err(anyhow!("MCP server 名称不能为空"));
    }

    let LoadedMcpConfig { path, mut config } = load_mcp_config(workspace_root)?;
    if config.servers.contains_key(server_name) {
        return Err(anyhow!("MCP server 已存在: {}", server_name));
    }

    config
        .servers
        .insert(server_name.to_string(), server_config);
    save_mcp_config(&path, &config, true)?;
    Ok(path)
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

pub fn set_server_trusted(workspace_root: &Path, name: &str, trusted: bool) -> Result<PathBuf> {
    mutate_existing_server(workspace_root, name, |server| {
        server.trusted = trusted;
    })
}

pub fn set_server_enabled(workspace_root: &Path, name: &str, enabled: bool) -> Result<PathBuf> {
    mutate_existing_server(workspace_root, name, |server| {
        server.enabled = enabled;
    })
}

fn mutate_existing_server(
    workspace_root: &Path,
    name: &str,
    mutator: impl FnOnce(&mut McpServerConfig),
) -> Result<PathBuf> {
    let LoadedMcpConfig { path, mut config } = load_mcp_config(workspace_root)?;
    let server = config
        .servers
        .get_mut(name)
        .ok_or_else(|| anyhow!("未找到 MCP server: {}", name))?;
    mutator(server);
    save_mcp_config(&path, &config, true)?;
    Ok(path)
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

fn workspace_storage_key(workspace_root: &Path) -> String {
    let mut hasher = DefaultHasher::new();
    workspace_root.hash(&mut hasher);
    let hash = hasher.finish();
    let stem = workspace_root
        .file_name()
        .and_then(|name| name.to_str())
        .map(sanitize_path_component)
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| "workspace".to_string());
    format!("{}-{:016x}", stem, hash)
}

fn sanitize_path_component(input: &str) -> String {
    input
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() {
                ch.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect::<String>()
        .trim_matches('-')
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn load_config_reads_single_workspace_file() {
        let workspace_root = unique_test_workspace("single-config");
        let path = workspace_mcp_config_path(&workspace_root);
        let mut config = McpConfigFile::default();
        config.servers.insert(
            "github".to_string(),
            McpServerConfig {
                display_name: Some("GitHub MCP".to_string()),
                enabled: false,
                trusted: true,
                capabilities: McpCapabilityToggles {
                    tools: true,
                    resources: false,
                    prompts: false,
                },
                transport: McpTransportConfig::Stdio {
                    command: "uvx".to_string(),
                    args: vec!["server".to_string()],
                    env: BTreeMap::new(),
                    cwd: None,
                    timeout_ms: None,
                },
            },
        );
        save_mcp_config(&path, &config, true).expect("seed config file");

        let loaded = load_mcp_config(&workspace_root).expect("load config");
        let server = loaded
            .config
            .servers
            .get("github")
            .expect("github server exists");

        assert_eq!(loaded.path, path);
        assert!(!server.enabled);
        assert!(server.trusted);
        match &server.transport {
            McpTransportConfig::Stdio { command, args, .. } => {
                assert_eq!(command, "uvx");
                assert_eq!(args, &vec!["server".to_string()]);
            }
            other => panic!("unexpected transport: {other:?}"),
        }

        if let Some(parent) = path.parent() {
            let _ = fs::remove_dir_all(parent);
        }
    }

    #[test]
    fn resolve_plain_and_placeholder_env_values() {
        assert_eq!(
            resolve_env_value("literal").expect("literal resolves"),
            "literal"
        );

        let path_value = resolve_env_value("${env:PATH}").expect("PATH should exist");
        assert!(!path_value.trim().is_empty());
    }

    #[test]
    fn github_template_points_to_real_package_shape() {
        let cfg = example_github_mcp_config();
        let github = cfg.servers.get("github").expect("github config exists");

        match &github.transport {
            McpTransportConfig::Stdio {
                command, args, env, ..
            } => {
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

    #[test]
    fn trust_mutation_updates_workspace_config_file() {
        let workspace_root = unique_test_workspace("trust-mutation");
        let path = workspace_mcp_config_path(&workspace_root);
        let mut config = McpConfigFile::default();
        config.servers.insert(
            "github".to_string(),
            McpServerConfig {
                display_name: Some("GitHub MCP".to_string()),
                enabled: true,
                trusted: false,
                capabilities: McpCapabilityToggles::default(),
                transport: McpTransportConfig::Stdio {
                    command: "npx".to_string(),
                    args: vec!["-y".to_string()],
                    env: BTreeMap::new(),
                    cwd: None,
                    timeout_ms: None,
                },
            },
        );
        save_mcp_config(&path, &config, true).expect("seed config file");

        let updated_path =
            set_server_trusted(&workspace_root, "github", true).expect("update trust");
        let updated = load_mcp_config(&workspace_root).expect("reload config");
        let github = updated
            .config
            .servers
            .get("github")
            .expect("github config exists");

        assert_eq!(updated_path, path);
        assert!(github.trusted);

        if let Some(parent) = path.parent() {
            let _ = fs::remove_dir_all(parent);
        }
    }

    #[test]
    fn workspace_config_path_lives_under_spirit_agent_data_dir() {
        let workspace_root = PathBuf::from("C:/workspace/spirit-agent");
        let path = workspace_mcp_config_path(&workspace_root);

        assert!(path.starts_with(spirit_agent_data_dir()));
        assert!(path.ends_with(MCP_CONFIG_FILE_NAME));
        assert!(
            path.components()
                .any(|component| component.as_os_str() == WORKSPACE_MCP_DIR_NAME)
        );
    }

    fn unique_test_workspace(tag: &str) -> PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("time ok")
            .as_nanos();
        std::env::temp_dir().join(format!("spirit-agent-{tag}-{nanos}"))
    }
}

fn github_preset_config(trusted: bool) -> McpServerConfig {
    let mut env = BTreeMap::new();
    env.insert(
        "GITHUB_PERSONAL_ACCESS_TOKEN".to_string(),
        "${env:GITHUB_PERSONAL_ACCESS_TOKEN}".to_string(),
    );

    McpServerConfig {
        display_name: Some("GitHub MCP".to_string()),
        enabled: true,
        trusted,
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
    }
}
