use std::env;

use rust_i18n::t;

use crate::model_registry::AppConfig;

pub const DEFAULT_UI_LOCALE: &str = "en";
pub const ENV_UI_LANG: &str = "SPIRIT_UI_LANG";
pub const SUPPORTED_UI_LOCALES: [&str; 2] = ["en", "zh-CN"];

pub fn apply_ui_locale(config: &AppConfig) {
    rust_i18n::set_locale(&resolve_ui_locale(config));
}

pub fn resolve_ui_locale(config: &AppConfig) -> String {
    env::var(ENV_UI_LANG)
        .ok()
        .as_deref()
        .or(config.ui_locale.as_deref())
        .and_then(parse_ui_locale)
        .unwrap_or_else(|| DEFAULT_UI_LOCALE.to_string())
}

pub fn normalize_ui_locale(locale: &str) -> String {
    parse_ui_locale(locale).unwrap_or_else(|| DEFAULT_UI_LOCALE.to_string())
}

pub fn parse_ui_locale(locale: &str) -> Option<String> {
    match locale.trim().to_ascii_lowercase().as_str() {
        "zh" | "zh-cn" | "zh_cn" | "zh-hans" | "zh_hans" => Some("zh-CN".to_string()),
        "en" | "en-us" | "en_us" | "en-gb" | "en_gb" => Some("en".to_string()),
        _ => None,
    }
}

pub fn supported_ui_locales() -> &'static [&'static str] {
    &SUPPORTED_UI_LOCALES
}

pub fn language_display_name(locale: &str) -> String {
    match normalize_ui_locale(locale).as_str() {
        "zh-CN" => t!("ui.picker.languages.simplified_chinese").into_owned(),
        _ => t!("ui.picker.languages.english").into_owned(),
    }
}

pub fn is_welcome_message(content: &str) -> bool {
    supported_ui_locales()
        .iter()
        .any(|locale| content.starts_with(t!("tui.welcome.prefix", locale = *locale).as_ref()))
}
