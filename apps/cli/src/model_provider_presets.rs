//! 与 `packages/host-internal/src/model-provider-presets.json` 同源（TUI 预设根 URL 与顺序）。

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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preset_bases_match_canonical_order() {
        assert_eq!(
            model_add_preset_api_base_by_choice_index(0).as_deref(),
            Some("https://api.deepseek.com/v1")
        );
        assert_eq!(
            model_add_preset_api_base_by_choice_index(1).as_deref(),
            Some("https://api.moonshot.cn/v1")
        );
        assert_eq!(
            model_add_preset_api_base_by_choice_index(2).as_deref(),
            Some("https://api.minimaxi.com/v1")
        );
        assert!(model_add_preset_api_base_by_choice_index(3).is_none());
    }
}
