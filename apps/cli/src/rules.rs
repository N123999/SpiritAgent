use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    env, fs,
    path::{Path, PathBuf},
};

use crate::mcp::spirit_agent_data_dir;

pub const WORKSPACE_RULE_FILE_NAME: &str = "AGENTS.md";
pub const USER_RULE_FILE_NAME: &str = "rule.md";
const RULES_STATE_FILE_NAME: &str = "rules-state.json";

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

pub fn user_rule_path() -> PathBuf {
    spirit_agent_data_dir().join(USER_RULE_FILE_NAME)
}

pub fn rules_state_file_path() -> PathBuf {
    spirit_agent_data_dir().join(RULES_STATE_FILE_NAME)
}

pub fn default_rule_sources(workspace_root: &Path) -> Vec<RuleSource> {
    let workspace_path = workspace_rule_path(workspace_root);
    let user_path = user_rule_path();

    vec![
        RuleSource {
            id: stable_rule_id(&workspace_path),
            scope: RuleScope::Workspace,
            title: "工作区规则".to_string(),
            path: workspace_path,
        },
        RuleSource {
            id: stable_rule_id(&user_path),
            scope: RuleScope::User,
            title: "用户规则".to_string(),
            path: user_path,
        },
    ]
}

pub fn load_rule_state() -> Result<RuleStateFile> {
    let path = rules_state_file_path();
    if !path.exists() {
        return Ok(RuleStateFile::default());
    }

    let content =
        fs::read_to_string(&path).with_context(|| format!("读取规则状态失败: {}", path.display()))?;
    serde_json::from_str(&content)
        .with_context(|| format!("解析规则状态失败: {}", path.display()))
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
    let preview = Some(RulePreview {
        excerpt: content.clone(),
        truncated: false,
    });

    Ok(RuleEntry {
        source,
        exists: true,
        enabled,
        content: Some(content),
        preview,
    })
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
    use std::{
        sync::{Mutex, OnceLock},
        time::{SystemTime, UNIX_EPOCH},
    };

    static ENV_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

    fn env_lock() -> &'static Mutex<()> {
        ENV_LOCK.get_or_init(|| Mutex::new(()))
    }

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
    fn user_rule_path_lives_under_spirit_agent_data_dir() {
        let _guard = env_lock().lock().expect("env lock");
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
        let _guard = env_lock().lock().expect("env lock");
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
        let _guard = env_lock().lock().expect("env lock");
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

        assert_eq!(saved_path, appdata.join("SpiritAgent").join(RULES_STATE_FILE_NAME));
        assert_eq!(loaded, state);
    }

    #[test]
    fn discover_rule_entries_defaults_existing_rules_to_enabled() {
        let _guard = env_lock().lock().expect("env lock");
        let workspace_root = temp_test_dir("discover-default-enabled-workspace");
        let appdata = temp_test_dir("discover-default-enabled-appdata");
        unsafe {
            env::set_var("APPDATA", &appdata);
            env::remove_var("USERPROFILE");
        }
        fs::write(workspace_rule_path(&workspace_root), "# repo rule\nrepo body")
            .expect("write workspace rule");
        fs::create_dir_all(appdata.join("SpiritAgent")).expect("create appdata dir");
        fs::write(user_rule_path(), "# user rule\nuser body").expect("write user rule");

        let entries = discover_rule_entries(&workspace_root, &RuleStateFile::default())
            .expect("discover rules");

        assert_eq!(entries.len(), 2);
        assert!(entries.iter().all(|entry| entry.exists));
        assert!(entries.iter().all(|entry| entry.enabled));
        assert!(entries
            .iter()
            .all(|entry| entry.content.as_ref().is_some_and(|content| !content.is_empty())));
    }

    #[test]
    fn discover_rule_entries_applies_disabled_override() {
        let _guard = env_lock().lock().expect("env lock");
        let workspace_root = temp_test_dir("discover-override-workspace");
        let appdata = temp_test_dir("discover-override-appdata");
        unsafe {
            env::set_var("APPDATA", &appdata);
            env::remove_var("USERPROFILE");
        }

        let workspace_path = workspace_rule_path(&workspace_root);
        fs::write(&workspace_path, "# repo rule\nrepo body").expect("write workspace rule");
        let mut state = RuleStateFile::default();
        state.set_enabled(stable_rule_id(&workspace_path), false);

        let entries = discover_rule_entries(&workspace_root, &state).expect("discover rules");
        let workspace_entry = entries
            .iter()
            .find(|entry| entry.source.scope == RuleScope::Workspace)
            .expect("workspace entry");

        assert!(workspace_entry.exists);
        assert!(!workspace_entry.enabled);
    }

    #[test]
    fn discover_rule_entries_returns_missing_sources() {
        let _guard = env_lock().lock().expect("env lock");
        let workspace_root = temp_test_dir("discover-missing-workspace");
        let appdata = temp_test_dir("discover-missing-appdata");
        unsafe {
            env::set_var("APPDATA", &appdata);
            env::remove_var("USERPROFILE");
        }

        let entries = discover_rule_entries(&workspace_root, &RuleStateFile::default())
            .expect("discover rules");

        assert_eq!(entries.len(), 2);
        assert!(entries.iter().all(|entry| !entry.exists));
        assert!(entries.iter().all(|entry| !entry.enabled));
        assert!(entries.iter().all(|entry| entry.content.is_none()));
    }
}