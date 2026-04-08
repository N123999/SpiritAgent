use anyhow::{Result, anyhow};
use std::{collections::BTreeMap, path::PathBuf};

use crate::mcp::{
    LoadedMcpConfig, McpCapabilityToggles, McpConfigScope, McpServerConfig, McpTransportConfig,
    load_merged_mcp_config,
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
        let server = self
            .servers
            .get(name)
            .ok_or_else(|| anyhow!("未知 MCP server: {}", name))?;

        match server.state {
            McpServerRuntimeState::Disabled => Err(anyhow!(
                "MCP server {} 已禁用，请先在 mcp.json 中启用。",
                name
            )),
            McpServerRuntimeState::NeedsTrust => Err(anyhow!(
                "MCP server {} 尚未信任，本轮仅完成配置与管理骨架。",
                name
            )),
            McpServerRuntimeState::Ready => Err(anyhow!(
                "MCP server runtime 尚未接入，本轮仅完成配置与管理骨架: {}",
                name
            )),
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
}