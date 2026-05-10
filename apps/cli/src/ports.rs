use anyhow::Result;
#[cfg(feature = "tui")]
use rust_i18n::t;
use serde::{Deserialize, Deserializer, Serialize};
use std::path::PathBuf;

use crate::model_registry::AppConfig;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssistantAuxArchiveEntry {
    pub message_index: usize,
    pub thinking: Option<String>,
    pub compaction: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SubagentSessionStatus {
    Running,
    Completed,
    Failed,
    Blocked,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubagentSessionSummary {
    pub session_id: String,
    pub parent_tool_call_id: String,
    pub title: String,
    pub status: SubagentSessionStatus,
    pub started_at_unix_ms: u64,
    pub updated_at_unix_ms: u64,
    pub completed_at_unix_ms: Option<u64>,
    pub latest_message: Option<String>,
    pub final_output: Option<String>,
    pub error: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum LlmContentPart {
    Text { text: String },
    Image { path: String },
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchivedLlmMessage {
    pub role: String,
    pub content: Vec<LlmContentPart>,
}

impl ArchivedLlmMessage {
    pub fn from_text_and_images(role: String, content: String, image_paths: Vec<String>) -> Self {
        let mut parts = Vec::new();
        if !content.is_empty() {
            parts.push(LlmContentPart::Text { text: content });
        }
        for path in image_paths {
            parts.push(LlmContentPart::Image { path });
        }
        Self {
            role,
            content: parts,
        }
    }

    pub fn text_content(&self) -> String {
        self.content
            .iter()
            .filter_map(|part| match part {
                LlmContentPart::Text { text } => Some(text.as_str()),
                LlmContentPart::Image { .. } => None,
            })
            .collect::<String>()
    }

    pub fn image_paths(&self) -> Vec<String> {
        self.content
            .iter()
            .filter_map(|part| match part {
                LlmContentPart::Image { path } => Some(path.clone()),
                LlmContentPart::Text { .. } => None,
            })
            .collect()
    }
}

impl<'de> Deserialize<'de> for ArchivedLlmMessage {
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct CurrentArchivedLlmMessage {
            role: String,
            content: Vec<LlmContentPart>,
        }

        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct LegacyArchivedLlmMessage {
            role: String,
            content: String,
            #[serde(default)]
            image_paths: Vec<String>,
        }

        #[derive(Deserialize)]
        #[serde(untagged)]
        enum ArchivedLlmMessageRepr {
            Current(CurrentArchivedLlmMessage),
            Legacy(LegacyArchivedLlmMessage),
        }

        match ArchivedLlmMessageRepr::deserialize(deserializer)? {
            ArchivedLlmMessageRepr::Current(message) => Ok(Self {
                role: message.role,
                content: message.content,
            }),
            ArchivedLlmMessageRepr::Legacy(message) => Ok(Self::from_text_and_images(
                message.role,
                message.content,
                message.image_paths,
            )),
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubagentSessionArchiveEntry {
    pub summary: SubagentSessionSummary,
    #[serde(default)]
    pub llm_history: Vec<ArchivedLlmMessage>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatArchive {
    pub messages: Vec<(String, String)>,
    pub assistant_aux: Vec<AssistantAuxArchiveEntry>,
    pub llm_history: Vec<ArchivedLlmMessage>,
    #[serde(default)]
    pub subagent_sessions: Vec<SubagentSessionArchiveEntry>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub desktop_messages: Option<Vec<crate::rewind::ConversationMessageSnapshot>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rewind: Option<serde_json::Value>,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum McpStatusState {
    #[default]
    Idle,
    Loading,
    Ready,
    Error,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpStatusSnapshot {
    pub revision: u64,
    pub state: McpStatusState,
    pub configured_servers: usize,
    pub loaded_servers: usize,
    pub cached_tools: usize,
    pub last_error: Option<String>,
}

impl McpStatusSnapshot {
    pub fn welcome_line(&self) -> String {
        #[cfg(feature = "tui")]
        {
            return match self.state {
                McpStatusState::Idle => t!("mcp.status.idle").into_owned(),
                McpStatusState::Loading => {
                    if self.configured_servers == 0 {
                        t!("mcp.status.unconfigured").into_owned()
                    } else {
                        t!("mcp.status.loading", count = self.configured_servers).into_owned()
                    }
                }
                McpStatusState::Ready => {
                    if self.configured_servers == 0 {
                        t!("mcp.status.unconfigured").into_owned()
                    } else {
                        t!(
                            "mcp.status.ready",
                            loaded = self.loaded_servers,
                            tools = self.cached_tools
                        )
                        .into_owned()
                    }
                }
                McpStatusState::Error => {
                    if self.configured_servers == 0 {
                        t!("mcp.status.unconfigured").into_owned()
                    } else {
                        t!(
                            "mcp.status.error",
                            loaded = self.loaded_servers,
                            configured = self.configured_servers
                        )
                        .into_owned()
                    }
                }
            };
        }

        #[cfg(not(feature = "tui"))]
        match self.state {
            McpStatusState::Idle => "MCP: 尚未开始加载。".to_string(),
            McpStatusState::Loading => {
                if self.configured_servers == 0 {
                    "MCP: 未配置服务器。".to_string()
                } else {
                    format!("MCP: 正在后台加载 {} 个服务器...", self.configured_servers)
                }
            }
            McpStatusState::Ready => {
                if self.configured_servers == 0 {
                    "MCP: 未配置服务器。".to_string()
                } else {
                    format!(
                        "MCP: 已加载 {} 个 MCP 服务器（缓存 {} 个工具）。",
                        self.loaded_servers, self.cached_tools
                    )
                }
            }
            McpStatusState::Error => {
                if self.configured_servers == 0 {
                    "MCP: 未配置服务器。".to_string()
                } else {
                    format!(
                        "MCP: 已加载 {}/{} 个 MCP 服务器。",
                        self.loaded_servers, self.configured_servers
                    )
                }
            }
        }
    }
}

pub trait AppPaths: Send + Sync {
    fn workspace_root(&self) -> PathBuf;
    fn config_file(&self) -> PathBuf;
    fn chats_dir(&self) -> PathBuf;
    fn permissions_file(&self) -> PathBuf;
    fn log_file(&self) -> PathBuf;
}

pub trait ConfigStore: Send + Sync {
    fn load(&self) -> Result<AppConfig>;
    fn save(&self, config: &AppConfig) -> Result<()>;
}

pub trait SecretStore: Send + Sync {
    fn load_global_api_key(&self) -> Result<Option<String>>;
    fn save_global_api_key(&self, api_key: &str) -> Result<()>;
    fn remove_global_api_key(&self) -> Result<()>;
    fn load_model_api_key(&self, model_name: &str) -> Result<Option<String>>;
    fn save_model_api_key(&self, model_name: &str, api_key: &str) -> Result<()>;
    fn remove_model_api_key(&self, model_name: &str) -> Result<()>;
    fn has_model_api_key(&self, model_name: &str) -> Result<bool>;
}

pub trait ChatRepository: Send + Sync {
    fn list(&self) -> Result<Vec<String>>;
    fn save(&self, path: Option<&str>, archive: &ChatArchive) -> Result<PathBuf>;
    fn load(&self, path: &str) -> Result<ChatArchive>;
}
