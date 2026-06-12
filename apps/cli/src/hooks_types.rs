use serde::Deserialize;
use serde::Serialize;
use serde_json::Map;

#[derive(Debug, Deserialize)]
pub struct HookListItem {
    pub id: String,
    pub scope: String,
    pub event: String,
    pub index: u64,
    pub command: String,
    #[serde(rename = "configPath")]
    pub config_path: String,
    pub timeout: Option<u64>,
    #[serde(rename = "failClosed")]
    pub fail_closed: Option<bool>,
    pub matcher: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct SaveHookEntryRequest {
    pub scope: String,
    pub event: String,
    pub command: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub timeout: Option<u64>,
    #[serde(rename = "failClosed", skip_serializing_if = "Option::is_none")]
    pub fail_closed: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub matcher: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct HooksValidationEntry {
    pub scope: String,
    pub event: String,
    pub index: u64,
    pub command: String,
    #[serde(rename = "resolvedPath")]
    pub resolved_path: String,
    pub exists: bool,
}

#[derive(Debug, Deserialize)]
pub struct HooksValidationReport {
    #[serde(rename = "userConfigPath")]
    pub user_config_path: String,
    #[serde(rename = "workspaceConfigPath")]
    pub workspace_config_path: Option<String>,
    pub summary: Map<String, serde_json::Value>,
    pub entries: Vec<HooksValidationEntry>,
}
