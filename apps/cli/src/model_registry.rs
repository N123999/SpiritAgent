use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::{
    env, fs,
    path::{Path, PathBuf},
    str::FromStr,
};

pub const DEFAULT_API_BASE: &str = "https://api.openai.com/v1";
const ENV_API_KEY: &str = "SPIRIT_API_KEY";
const KEYRING_SERVICE: &str = "SpiritAgent";
const KEYRING_ACCOUNT_API_KEY: &str = "openai_api_key";

/// 与 Desktop `DesktopModelProvider` 及 `config.json` 的 `provider` 字段对齐。
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ModelProvider {
    Deepseek,
    Kimi,
    Minimax,
    Alibaba,
    Custom,
}

impl ModelProvider {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Deepseek => "deepseek",
            Self::Kimi => "kimi",
            Self::Minimax => "minimax",
            Self::Alibaba => "alibaba",
            Self::Custom => "custom",
        }
    }
}

impl FromStr for ModelProvider {
    type Err = String;

    fn from_str(value: &str) -> std::result::Result<Self, Self::Err> {
        match value.trim().to_ascii_lowercase().as_str() {
            "deepseek" => Ok(Self::Deepseek),
            "kimi" => Ok(Self::Kimi),
            "minimax" => Ok(Self::Minimax),
            "alibaba" => Ok(Self::Alibaba),
            "custom" => Ok(Self::Custom),
            other => Err(format!("不支持的 provider: {other}")),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelProfile {
    pub name: String,
    #[serde(rename = "apiBase", alias = "api_base")]
    pub api_base: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub provider: Option<ModelProvider>,
    #[serde(
        rename = "reasoningEffort",
        alias = "reasoning_effort",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub reasoning_effort: Option<String>,
    #[serde(flatten, default, skip_serializing_if = "Map::is_empty")]
    pub extra: Map<String, Value>,
}

impl ModelProfile {
    pub fn supports_vision_input(&self) -> bool {
        if let Some(capabilities) = self.explicit_capabilities() {
            return capabilities.iter().any(|capability| capability == "vision");
        }

        match self.provider {
            Some(ModelProvider::Deepseek) => false,
            Some(ModelProvider::Kimi) => is_kimi_vision_model(&self.name),
            Some(ModelProvider::Minimax)
            | Some(ModelProvider::Alibaba)
            | Some(ModelProvider::Custom)
            | None => true,
        }
    }

    pub fn supports_image_generation(&self) -> bool {
        self.explicit_capabilities().is_some_and(|capabilities| {
            capabilities
                .iter()
                .any(|capability| capability == "imageGeneration")
        })
    }

    pub fn explicit_capabilities(&self) -> Option<Vec<String>> {
        let raw = self.extra.get("capabilities")?.as_array()?;
        let capabilities = raw
            .iter()
            .filter_map(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToOwned::to_owned)
            .collect::<Vec<_>>();
        if capabilities.is_empty() {
            None
        } else {
            Some(capabilities)
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    pub models: Vec<ModelProfile>,
    #[serde(rename = "activeModel", alias = "active_model")]
    pub active_model: String,
    #[serde(
        rename = "imageGenerationModel",
        alias = "image_generation_model",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub image_generation_model: Option<String>,
    #[serde(
        rename = "uiLocale",
        alias = "ui_locale",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub ui_locale: Option<String>,
    #[serde(flatten, default, skip_serializing_if = "Map::is_empty")]
    pub extra: Map<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct LegacyAppConfig {
    api_base: String,
    models: Vec<String>,
    active_model: String,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            models: vec![ModelProfile {
                name: "gpt-4o-mini".to_string(),
                api_base: DEFAULT_API_BASE.to_string(),
                provider: None,
                reasoning_effort: None,
                extra: Map::new(),
            }],
            active_model: "gpt-4o-mini".to_string(),
            image_generation_model: None,
            ui_locale: None,
            extra: Map::new(),
        }
    }
}

impl AppConfig {
    pub fn active_model_profile(&self) -> Option<&ModelProfile> {
        self.models.iter().find(|m| m.name == self.active_model)
    }

    pub fn active_model_profile_mut(&mut self) -> Option<&mut ModelProfile> {
        self.models.iter_mut().find(|m| m.name == self.active_model)
    }

    pub fn image_generation_model_profile(&self) -> Option<&ModelProfile> {
        let name = self.image_generation_model.as_deref()?;
        self.models.iter().find(|m| m.name == name)
    }

    pub fn has_model(&self, name: &str) -> bool {
        self.models.iter().any(|m| m.name == name)
    }

    pub fn add_model(&mut self, profile: ModelProfile) {
        self.models.push(profile);
    }
}

pub fn config_file_path() -> PathBuf {
    if let Ok(appdata) = env::var("APPDATA") {
        return PathBuf::from(appdata)
            .join("SpiritAgent")
            .join("config.json");
    }

    if let Ok(home) = env::var("USERPROFILE") {
        return PathBuf::from(home)
            .join(".spirit-agent")
            .join("config.json");
    }

    PathBuf::from(".spirit-agent.config.json")
}

pub fn load_config() -> Result<AppConfig> {
    let path = config_file_path();
    if !Path::new(&path).exists() {
        let cfg = AppConfig::default();
        save_config(&cfg)?;
        return Ok(cfg);
    }

    let content =
        fs::read_to_string(&path).with_context(|| format!("读取配置失败: {}", path.display()))?;

    deserialize_config(&content, &path)
}

fn deserialize_config(content: &str, path: &Path) -> Result<AppConfig> {
    if let Ok(mut cfg) = serde_json::from_str::<AppConfig>(content) {
        normalize_config(&mut cfg);
        return Ok(cfg);
    }

    let legacy: LegacyAppConfig = serde_json::from_str(content)
        .with_context(|| format!("解析配置失败: {}", path.display()))?;
    let mut migrated = AppConfig {
        models: legacy
            .models
            .into_iter()
            .map(|name| ModelProfile {
                name,
                api_base: legacy.api_base.clone(),
                provider: None,
                reasoning_effort: None,
                extra: Map::new(),
            })
            .collect(),
        active_model: legacy.active_model,
        image_generation_model: None,
        ui_locale: None,
        extra: Map::new(),
    };
    normalize_config(&mut migrated);
    save_config(&migrated)?;
    Ok(migrated)
}

pub fn save_config(cfg: &AppConfig) -> Result<()> {
    let path = config_file_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .with_context(|| format!("创建配置目录失败: {}", parent.display()))?;
    }

    let content = serialize_config(cfg)?;
    fs::write(&path, content).with_context(|| format!("写入配置失败: {}", path.display()))?;
    Ok(())
}

fn serialize_config(cfg: &AppConfig) -> Result<String> {
    Ok(serde_json::to_string_pretty(cfg)?)
}

fn normalize_config(cfg: &mut AppConfig) {
    if cfg.models.is_empty() {
        cfg.models = AppConfig::default().models;
    }

    if !cfg.models.iter().any(|m| m.name == cfg.active_model) {
        cfg.active_model = cfg.models[0].name.clone();
    }

    cfg.image_generation_model =
        normalize_image_generation_model(cfg.image_generation_model.take(), cfg.models.as_slice());

    for model in &mut cfg.models {
        if model.api_base.trim().is_empty() {
            model.api_base = DEFAULT_API_BASE.to_string();
        }
        model.reasoning_effort = normalize_optional_string(model.reasoning_effort.take());
        model.extra.remove("transportImplementation");
        model.extra.remove("transport_implementation");
    }
}

fn normalize_image_generation_model(
    value: Option<String>,
    models: &[ModelProfile],
) -> Option<String> {
    let name = normalize_optional_string(value)?;
    let profile = models.iter().find(|model| model.name == name)?;
    if profile.supports_image_generation() {
        Some(name)
    } else {
        None
    }
}

fn normalize_optional_string(value: Option<String>) -> Option<String> {
    let trimmed = value?.trim().to_string();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed)
    }
}

fn is_kimi_vision_model(model: &str) -> bool {
    let normalized = model.trim().to_ascii_lowercase();
    normalized == "kimi-k2.5"
        || normalized.starts_with("kimi-k2.5-")
        || normalized == "kimi-k2.6"
        || normalized.starts_with("kimi-k2.6-")
}

#[cfg(test)]
mod tests {
    use super::{deserialize_config, serialize_config};
    use serde_json::Value;
    use std::path::Path;

    #[test]
    fn preserves_unknown_top_level_and_model_fields() {
        let config = r#"
{
  "models": [
    {
            "name": "agent-test-model",
            "apiBase": "https://example.invalid/v1",
            "provider": "custom",
            "transportImplementation": "ai-sdk",
      "reasoningEffort": "minimal"
    }
  ],
    "activeModel": "agent-test-model",
    "imageGenerationModel": "agent-test-model",
  "uiLocale": "zh-CN",
  "windowsMica": true,
  "recentWorkspaces": ["D:/SpiritAgent", "D:/Other"],
  "dreams": {
    "enabled": true,
        "collectorModel": "collector-test-model",
    "debugMode": true
  }
}
"#;

        let parsed = deserialize_config(config, Path::new("config.json")).expect("parse config");
        let serialized = serialize_config(&parsed).expect("serialize config");
        let json: Value = serde_json::from_str(&serialized).expect("json value");

        assert_eq!(json.get("windowsMica").and_then(Value::as_bool), Some(true));
        assert_eq!(
            json.get("recentWorkspaces")
                .and_then(Value::as_array)
                .map(|items| items.len()),
            Some(2)
        );
        assert_eq!(
            json.get("dreams")
                .and_then(|dreams| dreams.get("collectorModel"))
                .and_then(Value::as_str),
            Some("collector-test-model")
        );
        assert_eq!(
            json.get("models")
                .and_then(Value::as_array)
                .and_then(|models| models.first())
                .and_then(|model| model.get("transportImplementation"))
                .and_then(Value::as_str),
            None
        );
        assert_eq!(
            json.get("models")
                .and_then(Value::as_array)
                .and_then(|models| models.first())
                .and_then(|model| model.get("reasoningEffort"))
                .and_then(Value::as_str),
            Some("minimal")
        );
        assert_eq!(
            json.get("imageGenerationModel").and_then(Value::as_str),
            None
        );
    }

    #[test]
    fn normalizing_empty_models_keeps_unknown_desktop_fields() {
        let config = r#"
{
  "models": [],
  "activeModel": "",
  "windowsMica": false,
  "dreams": {
    "enabled": true,
    "debugMode": false
  }
}
"#;

        let parsed = deserialize_config(config, Path::new("config.json")).expect("parse config");
        let serialized = serialize_config(&parsed).expect("serialize config");
        let json: Value = serde_json::from_str(&serialized).expect("json value");

        assert_eq!(
            json.get("windowsMica").and_then(Value::as_bool),
            Some(false)
        );
        assert_eq!(
            json.get("dreams")
                .and_then(|dreams| dreams.get("enabled"))
                .and_then(Value::as_bool),
            Some(true)
        );
        assert!(
            json.get("models")
                .and_then(Value::as_array)
                .is_some_and(|models| !models.is_empty())
        );
    }

    #[test]
    fn model_profile_supports_vision_only_for_kimi_k2_and_non_explicit_providers() {
        let kimi_k2 = super::ModelProfile {
            name: "kimi-k2.6".to_string(),
            api_base: "https://api.moonshot.cn/v1".to_string(),
            provider: Some(super::ModelProvider::Kimi),
            reasoning_effort: None,
            extra: serde_json::Map::new(),
        };
        let kimi_other = super::ModelProfile {
            name: "kimi-k2-turbo-preview".to_string(),
            api_base: "https://api.moonshot.cn/v1".to_string(),
            provider: Some(super::ModelProvider::Kimi),
            reasoning_effort: None,
            extra: serde_json::Map::new(),
        };
        let deepseek = super::ModelProfile {
            name: "deepseek-v4-pro".to_string(),
            api_base: "https://api.deepseek.com/v1".to_string(),
            provider: Some(super::ModelProvider::Deepseek),
            reasoning_effort: None,
            extra: serde_json::Map::new(),
        };
        let custom = super::ModelProfile {
            name: "my-custom-model".to_string(),
            api_base: "https://example.invalid/v1".to_string(),
            provider: Some(super::ModelProvider::Custom),
            reasoning_effort: None,
            extra: serde_json::Map::new(),
        };

        assert!(kimi_k2.supports_vision_input());
        assert!(!kimi_other.supports_vision_input());
        assert!(!deepseek.supports_vision_input());
        assert!(custom.supports_vision_input());
    }

    #[test]
    fn explicit_capabilities_override_provider_vision_inference() {
        let mut deepseek = super::ModelProfile {
            name: "deepseek-v4-pro".to_string(),
            api_base: "https://api.deepseek.com/v1".to_string(),
            provider: Some(super::ModelProvider::Deepseek),
            reasoning_effort: None,
            extra: serde_json::Map::new(),
        };
        deepseek.extra.insert(
            "capabilities".to_string(),
            serde_json::json!(["chat", "vision"]),
        );

        let mut custom = super::ModelProfile {
            name: "my-custom-model".to_string(),
            api_base: "https://example.invalid/v1".to_string(),
            provider: Some(super::ModelProvider::Custom),
            reasoning_effort: None,
            extra: serde_json::Map::new(),
        };
        custom
            .extra
            .insert("capabilities".to_string(), serde_json::json!(["chat"]));

        assert!(deepseek.supports_vision_input());
        assert!(!custom.supports_vision_input());
    }

    #[test]
    fn image_generation_model_requires_explicit_capability() {
        let config = r#"
{
    "models": [
        {
            "name": "chat-model",
            "apiBase": "https://example.invalid/v1",
            "capabilities": ["chat"]
        },
        {
            "name": "image-model",
            "apiBase": "https://example.invalid/v1",
            "capabilities": ["imageGeneration"]
        }
    ],
    "activeModel": "chat-model",
    "imageGenerationModel": "image-model"
}
"#;

        let parsed = deserialize_config(config, Path::new("config.json")).expect("parse config");
        assert_eq!(
            parsed.image_generation_model.as_deref(),
            Some("image-model")
        );

        let invalid = config.replace("image-model\"", "chat-model\"");
        let parsed = deserialize_config(&invalid, Path::new("config.json")).expect("parse config");
        assert_eq!(parsed.image_generation_model, None);
    }

    #[test]
    fn deserializes_alibaba_provider_from_desktop_config() {
        let config = r#"
{
    "models": [
        {
            "name": "qwen3.6-plus",
            "apiBase": "https://dashscope.aliyuncs.com/compatible-mode/v1",
            "provider": "alibaba",
            "reasoningEffort": "medium"
        }
    ],
    "activeModel": "qwen3.6-plus"
}
"#;

        let parsed = deserialize_config(config, Path::new("config.json")).expect("parse config");
        let active = parsed.active_model_profile().expect("active model");

        assert_eq!(active.provider, Some(super::ModelProvider::Alibaba));
        assert_eq!(active.reasoning_effort.as_deref(), Some("medium"));
    }
}

pub fn keyring_entry() -> Result<keyring::Entry> {
    keyring::Entry::new(KEYRING_SERVICE, KEYRING_ACCOUNT_API_KEY).context("初始化 keyring 条目失败")
}

fn keyring_entry_for_account(account: &str) -> Result<keyring::Entry> {
    keyring::Entry::new(KEYRING_SERVICE, account)
        .with_context(|| format!("初始化 keyring 条目失败: {}", account))
}

fn model_key_account(model_name: &str) -> String {
    format!("model::{}", model_name)
}

pub fn save_model_api_key(model_name: &str, api_key: &str) -> Result<()> {
    let entry = keyring_entry_for_account(&model_key_account(model_name))?;
    entry
        .set_password(api_key.trim())
        .with_context(|| format!("保存模型 {} 的 API Key 失败", model_name))
}

pub fn remove_model_api_key(model_name: &str) -> Result<()> {
    let entry = keyring_entry_for_account(&model_key_account(model_name))?;
    match entry.delete_password() {
        Ok(_) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(err) => Err(anyhow::anyhow!(
            "删除模型 {} 的 API Key 失败: {}",
            model_name,
            err
        )),
    }
}

pub fn has_model_api_key(model_name: &str) -> Result<bool> {
    let entry = keyring_entry_for_account(&model_key_account(model_name))?;
    match entry.get_password() {
        Ok(v) => Ok(!v.trim().is_empty()),
        Err(keyring::Error::NoEntry) => Ok(false),
        Err(err) => Err(anyhow::anyhow!(
            "读取模型 {} 的 API Key 失败: {}",
            model_name,
            err
        )),
    }
}

pub fn resolve_api_key_for_model(model_name: &str) -> Result<String> {
    if let Ok(value) = env::var(ENV_API_KEY) {
        let trimmed = value.trim();
        if !trimmed.is_empty() {
            return Ok(trimmed.to_string());
        }
    }

    if let Ok(value) = load_model_api_key_from_keyring(model_name) {
        return Ok(value);
    }

    load_api_key_from_keyring()
}

fn load_api_key_from_keyring() -> Result<String> {
    let entry = keyring_entry()?;
    entry
        .get_password()
        .context("读取 keyring 中的 API Key 失败")
}

fn load_model_api_key_from_keyring(model_name: &str) -> Result<String> {
    let entry = keyring_entry_for_account(&model_key_account(model_name))?;
    entry
        .get_password()
        .with_context(|| format!("读取模型 {} 的 API Key 失败", model_name))
}
