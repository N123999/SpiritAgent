use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::{
    env, fs,
    path::{Path, PathBuf},
};

pub const DEFAULT_API_BASE: &str = "https://api.openai.com/v1";
const ENV_API_KEY: &str = "SPIRIT_API_KEY";
const KEYRING_SERVICE: &str = "SpiritAgent";
const KEYRING_ACCOUNT_API_KEY: &str = "openai_api_key";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelProfile {
    pub name: String,
    pub api_base: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    pub models: Vec<ModelProfile>,
    pub active_model: String,
    pub ui_locale: Option<String>,
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
            }],
            active_model: "gpt-4o-mini".to_string(),
            ui_locale: None,
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

    if let Ok(mut cfg) = serde_json::from_str::<AppConfig>(&content) {
        normalize_config(&mut cfg);
        return Ok(cfg);
    }

    let legacy: LegacyAppConfig = serde_json::from_str(&content)
        .with_context(|| format!("解析配置失败: {}", path.display()))?;
    let mut migrated = AppConfig {
        models: legacy
            .models
            .into_iter()
            .map(|name| ModelProfile {
                name,
                api_base: legacy.api_base.clone(),
            })
            .collect(),
        active_model: legacy.active_model,
        ui_locale: None,
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

    let content = serde_json::to_string_pretty(cfg)?;
    fs::write(&path, content).with_context(|| format!("写入配置失败: {}", path.display()))?;
    Ok(())
}

fn normalize_config(cfg: &mut AppConfig) {
    if cfg.models.is_empty() {
        *cfg = AppConfig::default();
        return;
    }

    if !cfg.models.iter().any(|m| m.name == cfg.active_model) {
        cfg.active_model = cfg.models[0].name.clone();
    }

    for model in &mut cfg.models {
        if model.api_base.trim().is_empty() {
            model.api_base = DEFAULT_API_BASE.to_string();
        }
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
