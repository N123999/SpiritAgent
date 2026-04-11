use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::mcp::{McpCapabilityToggles, McpTransportConfig};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum McpServerRuntimeState {
    Disabled,
    Ready,
}

impl McpServerRuntimeState {
    pub fn label(&self) -> &'static str {
        match self {
            Self::Disabled => "disabled",
            Self::Ready => "ready",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagedMcpServer {
    pub name: String,
    pub display_name: String,
    pub enabled: bool,
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

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpDiscoveredTool {
    pub name: String,
    pub title: Option<String>,
    pub description: Option<String>,
    pub input_schema: Value,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpDiscoveredResource {
    pub uri: String,
    pub name: String,
    pub title: Option<String>,
    pub description: Option<String>,
    pub mime_type: Option<String>,
    pub size: Option<u32>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpDiscoveredPromptArgument {
    pub name: String,
    pub title: Option<String>,
    pub description: Option<String>,
    pub required: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpDiscoveredPrompt {
    pub name: String,
    pub title: Option<String>,
    pub description: Option<String>,
    pub arguments: Vec<McpDiscoveredPromptArgument>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpServerInspection {
    pub name: String,
    pub display_name: String,
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
