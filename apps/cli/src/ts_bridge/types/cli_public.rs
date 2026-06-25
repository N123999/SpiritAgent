use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::{plan::PlanMetadata, rules::RuleEntry, skills::SkillEntry};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CliHostMetadataSnapshot {
    pub rule_entries: Vec<RuleEntry>,
    pub skill_entries: Vec<SkillEntry>,
    pub plan_metadata: PlanMetadata,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CliExtensionToolEntry {
    pub name: String,
    pub description: String,
    pub approval_mode: Option<String>,
    pub execution_mode: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CliExtensionSettingOptionEntry {
    pub value: String,
    pub label: String,
    pub description: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CliExtensionDesktopCssEntry {
    pub path: String,
    pub media: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CliExtensionCliUiHookTokensEntry {
    pub foreground: Option<String>,
    pub border: Option<String>,
    pub accent: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CliExtensionCliUiHookEntry {
    pub slot: String,
    pub variant: Option<String>,
    pub tokens: Option<CliExtensionCliUiHookTokensEntry>,
    pub prefix: Option<String>,
    pub suffix: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CliExtensionDesktopContributes {
    pub css: Option<Vec<CliExtensionDesktopCssEntry>>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CliExtensionCliContributes {
    pub hooks: Option<Vec<CliExtensionCliUiHookEntry>>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CliExtensionSettingEntry {
    pub key: String,
    pub r#type: String,
    pub title: String,
    pub description: Option<String>,
    pub placeholder: Option<String>,
    pub required: Option<bool>,
    pub default_value: Option<Value>,
    pub options: Option<Vec<CliExtensionSettingOptionEntry>>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CliExtensionSecretSlotEntry {
    pub key: String,
    pub title: String,
    pub description: Option<String>,
    pub required: Option<bool>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CliExtensionContributes {
    pub tools: Option<Vec<CliExtensionToolEntry>>,
    pub desktop: Option<CliExtensionDesktopContributes>,
    pub cli: Option<CliExtensionCliContributes>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CliExtensionEntry {
    pub id: String,
    pub display_name: String,
    pub version: String,
    pub description: Option<String>,
    pub author: Option<String>,
    pub homepage: Option<String>,
    pub main: Option<String>,
    pub supported_hosts: Vec<String>,
    pub activation_events: Option<Vec<String>>,
    pub requested_capabilities: Option<Vec<String>>,
    pub contributes: Option<CliExtensionContributes>,
    pub settings_schema: Option<Vec<CliExtensionSettingEntry>>,
    pub secret_slots: Option<Vec<CliExtensionSecretSlotEntry>>,
    pub archive_file_name: Option<String>,
    pub installed_at_unix_ms: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CliMarketplaceCatalogItem {
    pub extension_id: String,
    pub package_name: String,
    pub status: String,
    pub featured: bool,
    pub default_version: String,
    pub default_channel: String,
    pub default_review_status: String,
    pub detail_path: String,
    pub display_name: String,
    pub description: String,
    pub author: Option<String>,
    pub homepage_url: Option<String>,
    pub repository_url: Option<String>,
    pub keywords: Vec<String>,
    pub supported_hosts: Vec<String>,
    pub requested_capabilities: Vec<String>,
    pub icon_url: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CliMarketplaceVersionChangelog {
    pub summary: String,
    pub body: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CliMarketplaceDetailVersion {
    pub version: String,
    pub channel: String,
    pub review_status: String,
    pub display_name: String,
    pub description: String,
    pub author: Option<String>,
    pub homepage_url: Option<String>,
    pub repository_url: Option<String>,
    pub keywords: Vec<String>,
    pub supported_hosts: Vec<String>,
    pub requested_capabilities: Vec<String>,
    pub icon_url: Option<String>,
    pub published_at: Option<String>,
    pub tarball_url: Option<String>,
    pub integrity: Option<String>,
    pub shasum: Option<String>,
    pub changelog: Option<CliMarketplaceVersionChangelog>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CliMarketplaceDetail {
    pub extension_id: String,
    pub package_name: String,
    pub status: String,
    pub featured: bool,
    pub default_version: String,
    pub readme_path: String,
    pub versions: Vec<CliMarketplaceDetailVersion>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CliMarketplacePreparedInstall {
    pub extension_id: String,
    pub package_name: String,
    pub display_name: String,
    pub description: String,
    pub version: String,
    pub channel: String,
    pub review_status: String,
    pub supported_hosts: Vec<String>,
    pub supports_current_host: bool,
    pub tarball_url: Option<String>,
    pub integrity: Option<String>,
    pub shasum: Option<String>,
    pub source_file_name: String,
    pub catalog_item: CliMarketplaceCatalogItem,
    pub detail: CliMarketplaceDetail,
}
