//! 读取 Desktop 共用的 `model-catalog-cache`，为 Gateway/OpenRouter 模型解析展示名。

use std::{
    collections::{HashMap, HashSet},
    fs,
    path::PathBuf,
};

use serde::Deserialize;
use sha2::{Digest, Sha256};

use crate::mcp::spirit_agent_data_dir;
use crate::model_registry::{ModelProfile, ModelProvider};

const CACHE_DIR_NAME: &str = "model-catalog-cache";

fn normalize_openai_api_base(base_url: &str) -> String {
    base_url.trim().trim_end_matches('/').to_string()
}

fn model_catalog_hint_key(provider: &str, transport_kind: &str, api_base: &str) -> String {
    let base = normalize_openai_api_base(api_base);
    format!("{provider}::{transport_kind}::{base}")
}

fn model_catalog_cache_file_path(hint_key: &str) -> PathBuf {
    let hash = Sha256::digest(hint_key.as_bytes());
    let hex = hash
        .iter()
        .take(16)
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    spirit_agent_data_dir()
        .join(CACHE_DIR_NAME)
        .join(format!("{hex}.json"))
}

fn provider_uses_catalog_display(provider: ModelProvider) -> bool {
    matches!(
        provider,
        ModelProvider::VercelAiGateway | ModelProvider::Openrouter
    )
}

fn format_model_display_name_from_id(model_id: &str) -> String {
    let normalized = model_id
        .trim()
        .replace(['-', ':', '/'], " ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    if normalized.is_empty() {
        return model_id.to_string();
    }
    normalized
        .split(' ')
        .map(|word| {
            let mut chars = word.chars();
            match chars.next() {
                None => String::new(),
                Some(first) => {
                    let mut formatted = String::new();
                    formatted.extend(first.to_uppercase());
                    formatted.extend(chars);
                    formatted
                }
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

#[derive(Debug, Deserialize)]
struct ModelCatalogCacheEntry {
    #[serde(rename = "modelCatalog", default)]
    model_catalog: Option<Vec<PreviewCatalogItem>>,
}

#[derive(Debug, Deserialize)]
struct PreviewCatalogItem {
    id: String,
    #[serde(rename = "displayName", default)]
    display_name: Option<String>,
}

fn read_display_names_for_hint(hint_key: &str) -> HashMap<String, String> {
    let path = model_catalog_cache_file_path(hint_key);
    let raw = match fs::read_to_string(&path) {
        Ok(value) => value,
        Err(_) => return HashMap::new(),
    };
    let parsed: ModelCatalogCacheEntry = match serde_json::from_str(&raw) {
        Ok(value) => value,
        Err(_) => return HashMap::new(),
    };
    let mut titles = HashMap::new();
    for item in parsed.model_catalog.unwrap_or_default() {
        let id = item.id.trim();
        if id.is_empty() {
            continue;
        }
        let display = item
            .display_name
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or(id);
        titles.insert(id.to_string(), display.to_string());
    }
    titles
}

/// 按 config 批量读缓存；每个 `(provider, transport, apiBase)` 组合最多读盘一次。
pub fn build_model_display_titles(models: &[ModelProfile]) -> HashMap<String, String> {
    let mut titles = HashMap::new();
    let mut cache_by_hint: HashMap<String, HashMap<String, String>> = HashMap::new();
    let mut loaded_hints = HashSet::new();

    for model in models {
        let Some(provider) = model.provider else {
            let formatted = format_model_display_name_from_id(&model.name);
            if formatted != model.name {
                titles.insert(model.name.clone(), formatted);
            }
            continue;
        };
        if provider_uses_catalog_display(provider) {
            let transport = model.transport_kind().as_str();
            let hint_key = model_catalog_hint_key(provider.as_str(), transport, &model.api_base);
            if loaded_hints.insert(hint_key.clone()) {
                let display_names = read_display_names_for_hint(&hint_key);
                cache_by_hint.insert(hint_key.clone(), display_names);
            }

            let Some(display_names) = cache_by_hint.get(&hint_key) else {
                continue;
            };
            let display = display_names
                .get(&model.name)
                .cloned()
                .unwrap_or_else(|| model.name.clone());
            if display != model.name {
                titles.insert(model.name.clone(), display);
            }
            continue;
        }

        let formatted = format_model_display_name_from_id(&model.name);
        if formatted != model.name {
            titles.insert(model.name.clone(), formatted);
        }
    }

    titles
}

pub fn model_display_title<'a>(
    model_name: &'a str,
    display_titles: &'a HashMap<String, String>,
) -> &'a str {
    display_titles
        .get(model_name)
        .map(String::as_str)
        .unwrap_or(model_name)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::env;

    #[test]
    fn model_catalog_cache_file_path_matches_desktop_layout() {
        let hint = "vercel-ai-gateway::openai-compatible::https://gateway.example/v1";
        let path = model_catalog_cache_file_path(hint);
        assert!(path.to_string_lossy().contains("model-catalog-cache"));
        assert_eq!(path.extension().and_then(|ext| ext.to_str()), Some("json"));
    }

    #[test]
    fn read_display_names_for_hint_parses_model_catalog() {
        let dir = env::temp_dir().join(format!(
            "spirit-model-catalog-display-test-{}",
            std::process::id()
        ));
        let hint = "openrouter::openai-compatible::https://openrouter.ai/api/v1";
        let previous = env::var("APPDATA").ok();
        // SAFETY: test-only isolation of SpiritAgent data dir.
        unsafe {
            env::set_var("APPDATA", &dir);
        }
        let path = model_catalog_cache_file_path(hint);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).expect("cache dir");
        }
        fs::write(
            &path,
            r#"{"apiBase":"https://openrouter.ai/api/v1","fetchedAtUnixMs":1,"modelIds":["anthropic/claude-sonnet-4"],"modelCatalog":[{"id":"anthropic/claude-sonnet-4","displayName":"Claude Sonnet 4"}]}"#,
        )
        .expect("write cache");
        let titles = read_display_names_for_hint(hint);
        unsafe {
            if let Some(value) = previous {
                env::set_var("APPDATA", value);
            } else {
                env::remove_var("APPDATA");
            }
        }
        let _ = fs::remove_dir_all(dir);

        assert_eq!(
            titles.get("anthropic/claude-sonnet-4").map(String::as_str),
            Some("Claude Sonnet 4")
        );
    }

    #[test]
    fn build_model_display_titles_formats_non_gateway_providers() {
        let models = vec![ModelProfile {
            name: "gpt-4o-mini".to_string(),
            api_base: "https://api.openai.com/v1".to_string(),
            provider: Some(ModelProvider::Openai),
            reasoning_effort: None,
            extra: serde_json::Map::new(),
        }];
        let titles = build_model_display_titles(&models);
        assert_eq!(
            titles.get("gpt-4o-mini").map(String::as_str),
            Some("Gpt 4o Mini")
        );
    }

    #[test]
    fn format_model_display_name_from_id_replaces_separators() {
        assert_eq!(
            format_model_display_name_from_id("anthropic/claude-sonnet-4"),
            "Anthropic Claude Sonnet 4"
        );
    }
}
