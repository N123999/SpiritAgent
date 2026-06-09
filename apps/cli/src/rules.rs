use anyhow::{Context, Result, anyhow};
use rust_i18n::t;
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    env, fs,
    path::{Path, PathBuf},
};

use crate::mcp::spirit_agent_data_dir;

pub const SPIRIT_DIR_NAME: &str = ".spirit";
pub const WORKSPACE_SPIRIT_RULE_FILE_NAME: &str = "rule.md";
pub const WORKSPACE_RULE_FILE_NAME: &str = "AGENTS.md";
pub const USER_RULE_FILE_NAME: &str = "rule.md";
const RULES_STATE_FILE_NAME: &str = "rules-state.json";
const RULE_PREVIEW_MAX_LINES: usize = 8;
const RULE_PREVIEW_MAX_CHARS: usize = 1_200;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RuleScope {
    Workspace,
    User,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuleSource {
    pub id: String,
    pub scope: RuleScope,
    pub title: String,
    /// Short label for the rules form checkbox row (path-like, not necessarily absolute).
    pub short_label: String,
    pub path: PathBuf,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RulePreview {
    pub excerpt: String,
    #[serde(default)]
    pub truncated: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuleEntry {
    pub source: RuleSource,
    pub exists: bool,
    pub enabled: bool,
    pub content: Option<String>,
    pub preview: Option<RulePreview>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnabledRule {
    pub id: String,
    pub scope: RuleScope,
    pub title: String,
    pub path: PathBuf,
    pub content: String,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuleStateFile {
    #[serde(default)]
    pub enabled_overrides: BTreeMap<String, bool>,
}

impl RuleStateFile {
    pub fn enabled_override(&self, rule_id: &str) -> Option<bool> {
        self.enabled_overrides.get(rule_id).copied()
    }

    pub fn set_enabled(&mut self, rule_id: impl Into<String>, enabled: bool) {
        self.enabled_overrides.insert(rule_id.into(), enabled);
    }
}

pub fn workspace_rule_path(workspace_root: &Path) -> PathBuf {
    workspace_root.join(WORKSPACE_RULE_FILE_NAME)
}

/// Spirit 专用仓库级规则路径（创建 `/create-rule` 与规则 UI 的默认工作区目标）。
pub fn workspace_spirit_rule_path(workspace_root: &Path) -> PathBuf {
    workspace_root
        .join(SPIRIT_DIR_NAME)
        .join(WORKSPACE_SPIRIT_RULE_FILE_NAME)
}

pub fn user_rule_path() -> PathBuf {
    spirit_agent_data_dir().join(USER_RULE_FILE_NAME)
}

pub fn rule_path_for_scope(workspace_root: &Path, scope: RuleScope) -> PathBuf {
    match scope {
        RuleScope::Workspace => workspace_spirit_rule_path(workspace_root),
        RuleScope::User => user_rule_path(),
    }
}

/// 确保存在 `.spirit` 目录，便于后续写入 `workspace_spirit_rule_path`。
pub fn ensure_workspace_spirit_dir(workspace_root: &Path) -> Result<()> {
    let dir = workspace_root.join(SPIRIT_DIR_NAME);
    if dir.exists() {
        return Ok(());
    }
    fs::create_dir_all(&dir).with_context(|| format!("创建 .spirit 目录失败: {}", dir.display()))
}

pub fn rules_state_file_path() -> PathBuf {
    spirit_agent_data_dir().join(RULES_STATE_FILE_NAME)
}

pub fn default_rule_sources(workspace_root: &Path) -> Vec<RuleSource> {
    let spirit_path = workspace_spirit_rule_path(workspace_root);
    let agents_path = workspace_rule_path(workspace_root);
    let user_path = user_rule_path();

    vec![
        RuleSource {
            id: stable_rule_id(&spirit_path),
            scope: RuleScope::Workspace,
            title: t!("form.rules.title.workspace_spirit").into_owned(),
            short_label: t!("form.rules.short.spirit").into_owned(),
            path: spirit_path,
        },
        RuleSource {
            id: stable_rule_id(&agents_path),
            scope: RuleScope::Workspace,
            title: t!("form.rules.title.workspace_agents").into_owned(),
            short_label: t!("form.rules.short.agents").into_owned(),
            path: agents_path,
        },
        RuleSource {
            id: stable_rule_id(&user_path),
            scope: RuleScope::User,
            title: t!("form.rules.section.user").into_owned(),
            short_label: t!("form.rules.short.user").into_owned(),
            path: user_path,
        },
    ]
}

pub fn load_rule_state() -> Result<RuleStateFile> {
    let path = rules_state_file_path();
    if !path.exists() {
        return Ok(RuleStateFile::default());
    }

    let content = fs::read_to_string(&path)
        .with_context(|| format!("读取规则状态失败: {}", path.display()))?;
    serde_json::from_str(&content).with_context(|| format!("解析规则状态失败: {}", path.display()))
}

pub fn save_rule_state(state: &RuleStateFile) -> Result<PathBuf> {
    let path = rules_state_file_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .with_context(|| format!("创建规则状态目录失败: {}", parent.display()))?;
    }

    let content = serde_json::to_string_pretty(state)?;
    fs::write(&path, content).with_context(|| format!("写入规则状态失败: {}", path.display()))?;
    Ok(path)
}

pub fn discover_rule_entries(
    workspace_root: &Path,
    state: &RuleStateFile,
) -> Result<Vec<RuleEntry>> {
    default_rule_sources(workspace_root)
        .into_iter()
        .map(|source| discover_rule_entry(source, state))
        .collect()
}

pub fn enabled_rules(entries: &[RuleEntry]) -> Vec<EnabledRule> {
    entries
        .iter()
        .filter(|entry| entry.exists && entry.enabled)
        .filter_map(|entry| {
            entry.content.as_ref().map(|content| EnabledRule {
                id: entry.source.id.clone(),
                scope: entry.source.scope,
                title: entry.source.title.clone(),
                path: entry.source.path.clone(),
                content: content.clone(),
            })
        })
        .collect()
}

pub fn rule_scope_label(scope: RuleScope) -> &'static str {
    match scope {
        RuleScope::Workspace => "工作区",
        RuleScope::User => "用户",
    }
}

fn discover_rule_entry(source: RuleSource, state: &RuleStateFile) -> Result<RuleEntry> {
    if !source.path.exists() {
        return Ok(RuleEntry {
            enabled: state.enabled_override(&source.id).unwrap_or(false),
            exists: false,
            content: None,
            preview: None,
            source,
        });
    }

    let content = fs::read_to_string(&source.path)
        .with_context(|| format!("读取规则文件失败: {}", source.path.display()))?;
    let enabled = state.enabled_override(&source.id).unwrap_or(true);
    let preview = Some(build_rule_preview(&content));

    Ok(RuleEntry {
        source,
        exists: true,
        enabled,
        content: Some(content),
        preview,
    })
}

fn build_rule_preview(content: &str) -> RulePreview {
    let mut excerpt_lines = Vec::new();
    let mut used_chars = 0usize;
    let mut truncated = false;

    for (index, line) in content.lines().enumerate() {
        if index >= RULE_PREVIEW_MAX_LINES {
            truncated = true;
            break;
        }

        let line_chars = line.chars().count();
        let separator = if excerpt_lines.is_empty() { 0 } else { 1 };
        if used_chars + separator + line_chars > RULE_PREVIEW_MAX_CHARS {
            let remaining = RULE_PREVIEW_MAX_CHARS.saturating_sub(used_chars + separator);
            if remaining > 0 {
                excerpt_lines.push(truncate_chars(line, remaining));
            }
            truncated = true;
            break;
        }

        excerpt_lines.push(line.to_string());
        used_chars = used_chars.saturating_add(separator + line_chars);
    }

    if !truncated && content.lines().count() <= RULE_PREVIEW_MAX_LINES {
        truncated = content.chars().count() > RULE_PREVIEW_MAX_CHARS;
    }

    RulePreview {
        excerpt: excerpt_lines.join("\n").trim_end().to_string(),
        truncated,
    }
}

fn truncate_chars(text: &str, count: usize) -> String {
    if count == 0 {
        return String::new();
    }

    let total = text.chars().count();
    let mut out = text.chars().take(count).collect::<String>();
    if total > count && !out.is_empty() {
        out.push('…');
    }
    out
}

fn stable_rule_id(path: &Path) -> String {
    let absolute = if path.is_absolute() {
        path.to_path_buf()
    } else {
        env::current_dir()
            .unwrap_or_else(|_| PathBuf::from("."))
            .join(path)
    };

    absolute
        .canonicalize()
        .unwrap_or(absolute)
        .to_string_lossy()
        .replace('\\', "/")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::shared_env_lock;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_test_dir(label: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time")
            .as_nanos();
        let dir = env::temp_dir().join(format!("spirit-agent-rules-{label}-{unique}"));
        fs::create_dir_all(&dir).expect("create temp dir");
        dir
    }

    #[test]
    fn workspace_rule_path_points_to_agents_md() {
        let root = PathBuf::from("C:/workspace/demo");
        let path = workspace_rule_path(&root);

        assert_eq!(path, root.join(WORKSPACE_RULE_FILE_NAME));
    }

    #[test]
    fn workspace_spirit_rule_path_points_under_dot_spirit() {
        let root = PathBuf::from("C:/workspace/demo");
        let path = workspace_spirit_rule_path(&root);

        assert_eq!(
            path,
            root.join(SPIRIT_DIR_NAME)
                .join(WORKSPACE_SPIRIT_RULE_FILE_NAME)
        );
    }

    #[test]
    fn user_rule_path_lives_under_spirit_agent_data_dir() {
        let _guard = shared_env_lock()
            .lock()
            .unwrap_or_else(|err| err.into_inner());
        let appdata = temp_test_dir("user-rule-path");
        unsafe {
            env::set_var("APPDATA", &appdata);
            env::remove_var("USERPROFILE");
        }

        let path = user_rule_path();

        assert_eq!(path, appdata.join("SpiritAgent").join(USER_RULE_FILE_NAME));
    }

    #[test]
    fn load_rule_state_returns_default_when_missing() {
        let _guard = shared_env_lock()
            .lock()
            .unwrap_or_else(|err| err.into_inner());
        let appdata = temp_test_dir("load-state-default");
        unsafe {
            env::set_var("APPDATA", &appdata);
            env::remove_var("USERPROFILE");
        }

        let state = load_rule_state().expect("load default state");

        assert_eq!(state, RuleStateFile::default());
    }

    #[test]
    fn save_rule_state_round_trips_overrides() {
        let _guard = shared_env_lock()
            .lock()
            .unwrap_or_else(|err| err.into_inner());
        let appdata = temp_test_dir("save-state-roundtrip");
        unsafe {
            env::set_var("APPDATA", &appdata);
            env::remove_var("USERPROFILE");
        }

        let mut state = RuleStateFile::default();
        state.set_enabled("repo-rule", false);
        state.set_enabled("user-rule", true);
        let saved_path = save_rule_state(&state).expect("save state");
        let loaded = load_rule_state().expect("load state");

        assert_eq!(
            saved_path,
            appdata.join("SpiritAgent").join(RULES_STATE_FILE_NAME)
        );
        assert_eq!(loaded, state);
    }

    #[test]
    fn discover_rule_entries_defaults_existing_rules_to_enabled() {
        let _guard = shared_env_lock()
            .lock()
            .unwrap_or_else(|err| err.into_inner());
        let workspace_root = temp_test_dir("discover-default-enabled-workspace");
        let appdata = temp_test_dir("discover-default-enabled-appdata");
        unsafe {
            env::set_var("APPDATA", &appdata);
            env::remove_var("USERPROFILE");
        }
        fs::create_dir_all(workspace_root.join(SPIRIT_DIR_NAME)).expect("create .spirit");
        fs::write(
            workspace_spirit_rule_path(&workspace_root),
            "# spirit rule\nspirit body",
        )
        .expect("write spirit rule");
        fs::write(
            workspace_rule_path(&workspace_root),
            "# agents rule\nagents body",
        )
        .expect("write agents rule");
        fs::create_dir_all(appdata.join("SpiritAgent")).expect("create appdata dir");
        fs::write(user_rule_path(), "# user rule\nuser body").expect("write user rule");

        let entries = discover_rule_entries(&workspace_root, &RuleStateFile::default())
            .expect("discover rules");

        assert_eq!(entries.len(), 3);
        assert!(entries.iter().all(|entry| entry.exists));
        assert!(entries.iter().all(|entry| entry.enabled));
        assert!(entries.iter().all(|entry| {
            entry
                .content
                .as_ref()
                .is_some_and(|content| !content.is_empty())
        }));
    }

    #[test]
    fn discover_rule_entries_applies_disabled_override() {
        let _guard = shared_env_lock()
            .lock()
            .unwrap_or_else(|err| err.into_inner());
        let workspace_root = temp_test_dir("discover-override-workspace");
        let appdata = temp_test_dir("discover-override-appdata");
        unsafe {
            env::set_var("APPDATA", &appdata);
            env::remove_var("USERPROFILE");
        }

        fs::create_dir_all(workspace_root.join(SPIRIT_DIR_NAME)).expect("create .spirit");
        let spirit_path = workspace_spirit_rule_path(&workspace_root);
        fs::write(&spirit_path, "# spirit rule\nbody").expect("write spirit rule");
        let mut state = RuleStateFile::default();
        state.set_enabled(stable_rule_id(&spirit_path), false);

        let entries = discover_rule_entries(&workspace_root, &state).expect("discover rules");
        let spirit_entry = entries
            .iter()
            .find(|entry| entry.source.path == spirit_path)
            .expect("spirit entry");

        assert!(spirit_entry.exists);
        assert!(!spirit_entry.enabled);
    }

    #[test]
    fn discover_rule_entries_returns_missing_sources() {
        let _guard = shared_env_lock()
            .lock()
            .unwrap_or_else(|err| err.into_inner());
        let workspace_root = temp_test_dir("discover-missing-workspace");
        let appdata = temp_test_dir("discover-missing-appdata");
        unsafe {
            env::set_var("APPDATA", &appdata);
            env::remove_var("USERPROFILE");
        }

        let entries = discover_rule_entries(&workspace_root, &RuleStateFile::default())
            .expect("discover rules");

        assert_eq!(entries.len(), 3);
        assert!(entries.iter().all(|entry| !entry.exists));
        assert!(entries.iter().all(|entry| !entry.enabled));
        assert!(entries.iter().all(|entry| entry.content.is_none()));
    }

    #[test]
    fn enabled_rules_only_keeps_existing_enabled_entries() {
        let entries = vec![
            RuleEntry {
                source: RuleSource {
                    id: "repo".to_string(),
                    scope: RuleScope::Workspace,
                    title: "工作区规则".to_string(),
                    short_label: ".spirit/rule.md".to_string(),
                    path: PathBuf::from("C:/workspace/.spirit/rule.md"),
                },
                exists: true,
                enabled: true,
                content: Some("repo body".to_string()),
                preview: None,
            },
            RuleEntry {
                source: RuleSource {
                    id: "user".to_string(),
                    scope: RuleScope::User,
                    title: "用户规则".to_string(),
                    short_label: "rule.md".to_string(),
                    path: PathBuf::from("C:/users/demo/AppData/Roaming/SpiritAgent/rule.md"),
                },
                exists: true,
                enabled: false,
                content: Some("user body".to_string()),
                preview: None,
            },
            RuleEntry {
                source: RuleSource {
                    id: "missing".to_string(),
                    scope: RuleScope::Workspace,
                    title: "缺失规则".to_string(),
                    short_label: "AGENTS.md".to_string(),
                    path: PathBuf::from("C:/workspace/MISSING.md"),
                },
                exists: false,
                enabled: true,
                content: None,
                preview: None,
            },
        ];

        let enabled = enabled_rules(&entries);

        assert_eq!(enabled.len(), 1);
        assert_eq!(enabled[0].id, "repo");
        assert_eq!(enabled[0].content, "repo body");
    }

    #[test]
    fn discover_rule_entries_builds_truncated_preview_for_long_content() {
        let _guard = shared_env_lock()
            .lock()
            .unwrap_or_else(|err| err.into_inner());
        let workspace_root = temp_test_dir("discover-preview-workspace");
        let appdata = temp_test_dir("discover-preview-appdata");
        unsafe {
            env::set_var("APPDATA", &appdata);
            env::remove_var("USERPROFILE");
        }

        let long_content = (0..12)
            .map(|index| format!("line-{index}: {}", "x".repeat(180)))
            .collect::<Vec<_>>()
            .join("\n");
        fs::create_dir_all(workspace_root.join(SPIRIT_DIR_NAME)).expect("create .spirit");
        fs::write(workspace_spirit_rule_path(&workspace_root), &long_content)
            .expect("write spirit rule");

        let entries = discover_rule_entries(&workspace_root, &RuleStateFile::default())
            .expect("discover rules");
        let preview = entries
            .iter()
            .find(|entry| entry.source.path == workspace_spirit_rule_path(&workspace_root))
            .and_then(|entry| entry.preview.as_ref())
            .expect("spirit preview");

        assert!(preview.truncated);
        assert!(preview.excerpt.lines().count() <= RULE_PREVIEW_MAX_LINES);
        assert!(preview.excerpt.chars().count() <= RULE_PREVIEW_MAX_CHARS + 1);
    }

}
