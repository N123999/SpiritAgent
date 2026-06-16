//! 与 `packages/host-internal/src/model-provider-presets.json` 同源（TUI 预设根 URL 与顺序）。

use crate::model_registry::ModelTransportKind;
use serde::Deserialize;
use std::sync::OnceLock;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ModelProviderPresetsFile {
    #[allow(dead_code)]
    default_custom_api_base: String,
    preset_api_base_by_provider: std::collections::BTreeMap<String, String>,
    picker_order: Vec<String>,
}

static PRESETS: OnceLock<ModelProviderPresetsFile> = OnceLock::new();

fn presets() -> &'static ModelProviderPresetsFile {
    PRESETS.get_or_init(|| {
        serde_json::from_str(include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../packages/host-internal/src/model-provider-presets.json"
        )))
        .expect("parse packages/host-internal/src/model-provider-presets.json")
    })
}

/// `selected` 与底部表单「提供商」选项索引一致，且与 JSON 中 `pickerOrder` 对齐。
pub(crate) fn model_add_preset_api_base_by_choice_index(selected: usize) -> Option<String> {
    let p = presets();
    let id = p.picker_order.get(selected)?;
    if id == "custom" {
        return None;
    }
    p.preset_api_base_by_provider.get(id).cloned()
}

pub(crate) fn model_add_preset_api_base_by_provider(provider: crate::model_registry::ModelProvider) -> Option<String> {
    if provider == crate::model_registry::ModelProvider::Custom {
        return None;
    }
    presets()
        .preset_api_base_by_provider
        .get(provider.as_str())
        .cloned()
}

pub(crate) fn model_add_default_custom_api_base(
    transport_kind: ModelTransportKind,
) -> String {
    let p = presets();
    match transport_kind {
        ModelTransportKind::OpenAiCompatible | ModelTransportKind::OpenResponses => {
            p.default_custom_api_base.clone()
        }
        ModelTransportKind::Anthropic => p
            .preset_api_base_by_provider
            .get("anthropic")
            .cloned()
            .unwrap_or_else(|| p.default_custom_api_base.clone()),
        ModelTransportKind::Bedrock => p
            .preset_api_base_by_provider
            .get("amazon-bedrock")
            .cloned()
            .unwrap_or_else(|| p.default_custom_api_base.clone()),
    }
}

pub(crate) fn azure_api_base_from_resource_name(resource_name: &str) -> String {
    let trimmed = resource_name.trim();
    if trimmed.is_empty() {
        return "https://YOUR_RESOURCE_NAME.openai.azure.com/openai/v1".to_string();
    }
    format!("https://{trimmed}.openai.azure.com/openai/v1")
}

pub(crate) fn model_add_picker_order_ids() -> &'static [String] {
    &presets().picker_order
}

pub(crate) fn model_add_provider_id_at_choice_index(selected: usize) -> Option<&'static str> {
    presets().picker_order.get(selected).map(String::as_str)
}

pub(crate) fn model_add_provider_at_choice_index(
    selected: usize,
) -> Option<crate::model_registry::ModelProvider> {
    let id = model_add_provider_id_at_choice_index(selected)?;
    if id == "custom" {
        return Some(crate::model_registry::ModelProvider::Custom);
    }
    id.parse().ok()
}

pub(crate) fn model_add_requires_manual_single_provider(
    provider: crate::model_registry::ModelProvider,
) -> bool {
    matches!(
        provider,
        crate::model_registry::ModelProvider::Azure
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preset_bases_match_canonical_order() {
        assert_eq!(
            model_add_preset_api_base_by_choice_index(0).as_deref(),
            Some("https://api.openai.com/v1")
        );
        assert_eq!(
            model_add_preset_api_base_by_choice_index(1).as_deref(),
            Some("https://generativelanguage.googleapis.com/v1beta")
        );
        assert_eq!(
            model_add_preset_api_base_by_choice_index(2).as_deref(),
            Some("https://api.x.ai/v1")
        );
        assert_eq!(
            model_add_preset_api_base_by_choice_index(3).as_deref(),
            Some("https://api.anthropic.com/v1")
        );
        assert_eq!(
            model_add_preset_api_base_by_choice_index(4).as_deref(),
            Some("https://api.deepseek.com/v1")
        );
        assert_eq!(
            model_add_preset_api_base_by_choice_index(5).as_deref(),
            Some("https://ai-gateway.vercel.sh/v1")
        );
        assert_eq!(
            model_add_preset_api_base_by_choice_index(6).as_deref(),
            Some("https://openrouter.ai/api/v1")
        );
        assert_eq!(
            model_add_preset_api_base_by_choice_index(7).as_deref(),
            Some("https://api.moonshot.cn/v1")
        );
        assert_eq!(
            model_add_preset_api_base_by_choice_index(8).as_deref(),
            Some("https://dashscope.aliyuncs.com/compatible-mode/v1")
        );
        assert_eq!(
            model_add_preset_api_base_by_choice_index(9).as_deref(),
            Some("https://api.minimaxi.com/v1")
        );
        assert_eq!(
            model_add_preset_api_base_by_choice_index(10).as_deref(),
            Some("https://ark.cn-beijing.volces.com/api/v3")
        );
        assert_eq!(
            model_add_preset_api_base_by_choice_index(11).as_deref(),
            Some("https://YOUR_RESOURCE_NAME.openai.azure.com/openai/v1")
        );
        assert_eq!(
            model_add_preset_api_base_by_choice_index(12).as_deref(),
            Some("https://bedrock.us-east-1.amazonaws.com")
        );
        assert!(model_add_preset_api_base_by_choice_index(13).is_none());
    }

    #[test]
    fn preset_api_base_by_provider_returns_google_api_base() {
        assert_eq!(
            super::model_add_preset_api_base_by_provider(crate::model_registry::ModelProvider::Google)
                .as_deref(),
            Some("https://generativelanguage.googleapis.com/v1beta")
        );
        assert!(super::model_add_preset_api_base_by_provider(
            crate::model_registry::ModelProvider::Custom
        )
        .is_none());
    }

    #[test]
    fn custom_default_base_follows_transport_kind() {
        assert_eq!(
            model_add_default_custom_api_base(ModelTransportKind::OpenAiCompatible),
            "https://api.openai.com/v1"
        );
        assert_eq!(
            model_add_default_custom_api_base(ModelTransportKind::Anthropic),
            "https://api.anthropic.com/v1"
        );
    }
}
