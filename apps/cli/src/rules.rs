use anyhow::{Context, Result, anyhow};
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    env, fs,
    path::{Path, PathBuf},
};

use crate::mcp::spirit_agent_data_dir;

pub const WORKSPACE_RULE_FILE_NAME: &str = "AGENTS.md";
pub const USER_RULE_FILE_NAME: &str = "rule.md";
pub const CREATE_RULE_USAGE: &str = "用法: /create-rule [repo|user] <需求描述>";
const RULES_STATE_FILE_NAME: &str = "rules-state.json";
const RULE_PREVIEW_MAX_LINES: usize = 8;
const RULE_PREVIEW_MAX_CHARS: usize = 1_200;
const CREATE_RULE_RESPONSE_START: &str = "<spirit-rule-file>";
const CREATE_RULE_RESPONSE_END: &str = "</spirit-rule-file>";

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RuleScope {
    Workspace,
    User,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CreateRuleRequest {
    pub scope: RuleScope,
    pub prompt: String,
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

pub fn user_rule_path() -> PathBuf {
    spirit_agent_data_dir().join(USER_RULE_FILE_NAME)
}

pub fn rule_path_for_scope(workspace_root: &Path, scope: RuleScope) -> PathBuf {
    match scope {
        RuleScope::Workspace => workspace_rule_path(workspace_root),
        RuleScope::User => user_rule_path(),
    }
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

pub fn parse_create_rule_request(input: &str) -> Result<CreateRuleRequest> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Err(anyhow!(CREATE_RULE_USAGE));
    }

    if let Some((scope, remainder)) = parse_leading_rule_scope(trimmed) {
        let prompt = remainder.trim();
        if prompt.is_empty() {
            return Err(anyhow!(CREATE_RULE_USAGE));
        }

        return Ok(CreateRuleRequest {
            scope,
            prompt: prompt.to_string(),
        });
    }

    Ok(CreateRuleRequest {
        scope: RuleScope::Workspace,
        prompt: trimmed.to_string(),
    })
}

pub fn build_create_rule_prompt(
    workspace_root: &Path,
    request: &CreateRuleRequest,
    existing_content: Option<&str>,
) -> String {
    let scope_label = rule_scope_label(request.scope);
    let target_path = rule_path_for_scope(workspace_root, request.scope);
    let scope_hint = match request.scope {
        RuleScope::Workspace => {
            "优先写清当前仓库或模块的目录边界、代码风格、验证命令和禁止事项。"
        }
        RuleScope::User => "优先写清跨仓库通用的个人偏好、默认工作方式和沟通习惯。",
    };
    let existing_section = match existing_content.map(str::trim).filter(|value| !value.is_empty()) {
        Some(content) => format!(
            "当前目标文件已存在。请保留仍然有效的约束，删除重复或过时内容，并输出完整重写版本。\n<existing-rule-file>\n{}\n</existing-rule-file>",
            content
        ),
        None => "当前目标文件不存在，请从零开始生成一份完整文件。".to_string(),
    };

    format!(
        "你正在为 Spirit Agent 编写一份{scope_label}规则文件。\n\n目标信息:\n- scope: {scope_label}\n- target_path: {target_path}\n- workspace_root: {workspace_root}\n- 文件格式: Markdown\n\n用户需求:\n{user_prompt}\n\n写作要求:\n1. 直接输出可落盘的完整文件，不要输出解释、前言、后记、diff 或代码围栏。\n2. 必须把完整文件放在 {start_tag} 和 {end_tag} 标签内。\n3. 文件第一行必须是一级标题。\n4. 文件必须包含这些二级标题：`## 适用范围`、`## 执行优先级`、`## 工程约束`、`## 工作流程`、`## 验证与交付`。\n5. 规则必须具体、可执行、可验证，避免空泛口号。\n6. 如果需求不完整，补足合理默认值，不要留下 TODO、占位符或“按需补充”。\n7. 不要调用任何工具，也不要向用户反问。\n8. {scope_hint}\n\n现有内容:\n{existing_section}\n\n输出格式:\n{start_tag}\n# Spirit Agent 规则\n## 适用范围\n- ...\n{end_tag}",
        target_path = target_path.display(),
        workspace_root = workspace_root.display(),
        user_prompt = request.prompt,
        start_tag = CREATE_RULE_RESPONSE_START,
        end_tag = CREATE_RULE_RESPONSE_END,
    )
}

pub fn extract_generated_rule_content(response: &str) -> Result<String> {
    if let Some(tagged) = extract_tagged_rule_content(response)? {
        return normalize_generated_rule_content(&tagged);
    }

    if let Some(fenced) = extract_fenced_rule_content(response) {
        return normalize_generated_rule_content(&fenced);
    }

    normalize_generated_rule_content(response)
}

pub fn save_rule_document(path: &Path, content: &str) -> Result<PathBuf> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .with_context(|| format!("创建规则目录失败: {}", parent.display()))?;
    }

    fs::write(path, content).with_context(|| format!("写入规则文件失败: {}", path.display()))?;
    Ok(path.to_path_buf())
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

fn parse_leading_rule_scope(input: &str) -> Option<(RuleScope, &str)> {
    const USER_PREFIXES: &[&str] = &[
        "user",
        "user-level",
        "用户级规则",
        "用户级",
        "用户规则",
        "用户",
        "全局规则",
        "全局",
        "个人规则",
        "个人",
    ];
    const WORKSPACE_PREFIXES: &[&str] = &[
        "repo",
        "repository",
        "workspace",
        "repo-level",
        "workspace-level",
        "仓库级规则",
        "仓库级",
        "仓库规则",
        "仓库",
        "工作区规则",
        "工作区",
        "项目规则",
        "项目",
    ];

    match_prefix(input, USER_PREFIXES)
        .map(|rest| (RuleScope::User, rest))
        .or_else(|| match_prefix(input, WORKSPACE_PREFIXES).map(|rest| (RuleScope::Workspace, rest)))
}

fn match_prefix<'a>(input: &'a str, prefixes: &[&str]) -> Option<&'a str> {
    prefixes.iter().find_map(|prefix| {
        let remainder = input.strip_prefix(prefix)?;
        if remainder.is_empty() {
            return Some(remainder);
        }

        let first = remainder.chars().next()?;
        if first.is_whitespace() || matches!(first, ':' | '：' | '-' | '，' | ',' | ';' | '；') {
            return Some(remainder.trim_start_matches(|ch: char| {
                ch.is_whitespace() || matches!(ch, ':' | '：' | '-' | '，' | ',' | ';' | '；')
            }));
        }

        None
    })
}

fn extract_tagged_rule_content(response: &str) -> Result<Option<String>> {
    let trimmed = response.trim();
    let Some(start) = trimmed.find(CREATE_RULE_RESPONSE_START) else {
        if trimmed.contains(CREATE_RULE_RESPONSE_END) {
            return Err(anyhow!("规则输出缺少开始标签"));
        }
        return Ok(None);
    };

    let after_start = &trimmed[start + CREATE_RULE_RESPONSE_START.len()..];
    let Some(end) = after_start.find(CREATE_RULE_RESPONSE_END) else {
        return Err(anyhow!("规则输出缺少结束标签"));
    };

    Ok(Some(after_start[..end].to_string()))
}

fn extract_fenced_rule_content(response: &str) -> Option<String> {
    let trimmed = response.trim();
    let start = trimmed.find("```")?;
    let after_start = &trimmed[start + 3..];
    let after_language = after_start
        .strip_prefix("markdown")
        .or_else(|| after_start.strip_prefix("md"))
        .unwrap_or(after_start);
    let after_newline = after_language
        .strip_prefix("\r\n")
        .or_else(|| after_language.strip_prefix('\n'))
        .or_else(|| after_language.strip_prefix('\r'))
        .unwrap_or(after_language);
    let end = after_newline.find("```")?;
    Some(after_newline[..end].to_string())
}

fn normalize_generated_rule_content(content: &str) -> Result<String> {
    let normalized = content.replace("\r\n", "\n");
    let trimmed = normalized.trim();
    if trimmed.is_empty() {
        return Err(anyhow!("模型未返回规则内容"));
    }
    if !trimmed.starts_with('#') {
        return Err(anyhow!("规则内容必须以 Markdown 一级标题开头"));
    }

    Ok(format!("{}\n", trimmed))
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

    #[test]
    fn enabled_rules_only_keeps_existing_enabled_entries() {
        let entries = vec![
            RuleEntry {
                source: RuleSource {
                    id: "repo".to_string(),
                    scope: RuleScope::Workspace,
                    title: "工作区规则".to_string(),
                    path: PathBuf::from("C:/workspace/AGENTS.md"),
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
        let _guard = env_lock().lock().expect("env lock");
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
        fs::write(workspace_rule_path(&workspace_root), &long_content)
            .expect("write workspace rule");

        let entries = discover_rule_entries(&workspace_root, &RuleStateFile::default())
            .expect("discover rules");
        let preview = entries
            .iter()
            .find(|entry| entry.source.scope == RuleScope::Workspace)
            .and_then(|entry| entry.preview.as_ref())
            .expect("workspace preview");

        assert!(preview.truncated);
        assert!(preview.excerpt.lines().count() <= RULE_PREVIEW_MAX_LINES);
        assert!(preview.excerpt.chars().count() <= RULE_PREVIEW_MAX_CHARS + 1);
    }

    #[test]
    fn parse_create_rule_request_defaults_to_workspace_scope() {
        let request = parse_create_rule_request("补充当前仓库的测试要求").expect("parse request");

        assert_eq!(request.scope, RuleScope::Workspace);
        assert_eq!(request.prompt, "补充当前仓库的测试要求");
    }

    #[test]
    fn parse_create_rule_request_recognizes_user_scope_prefixes() {
        let request = parse_create_rule_request("用户级：强调简洁回答和先查代码").expect("parse request");

        assert_eq!(request.scope, RuleScope::User);
        assert_eq!(request.prompt, "强调简洁回答和先查代码");
    }

    #[test]
    fn parse_create_rule_request_requires_prompt_after_scope() {
        let error = parse_create_rule_request("repo").expect_err("missing prompt should fail");

        assert_eq!(error.to_string(), CREATE_RULE_USAGE);
    }

    #[test]
    fn build_create_rule_prompt_mentions_existing_content_and_tags() {
        let workspace_root = PathBuf::from("C:/workspace/demo");
        let request = CreateRuleRequest {
            scope: RuleScope::Workspace,
            prompt: "补充构建命令和禁止事项".to_string(),
        };

        let prompt = build_create_rule_prompt(&workspace_root, &request, Some("# Old\nbody"));

        assert!(prompt.contains(CREATE_RULE_RESPONSE_START));
        assert!(prompt.contains(CREATE_RULE_RESPONSE_END));
        assert!(prompt.contains("<existing-rule-file>"));
        assert!(prompt.contains("补充构建命令和禁止事项"));
        assert!(prompt.contains("AGENTS.md"));
    }

    #[test]
    fn extract_generated_rule_content_prefers_tagged_block() {
        let response = "说明文字\n<spirit-rule-file>\n# Spirit Agent 规则\n## 适用范围\n- foo\n</spirit-rule-file>\n补充说明";

        let content = extract_generated_rule_content(response).expect("extract content");

        assert_eq!(content, "# Spirit Agent 规则\n## 适用范围\n- foo\n");
    }

    #[test]
    fn extract_generated_rule_content_accepts_fenced_markdown() {
        let response = "```markdown\n# Spirit Agent 规则\n## 适用范围\n- foo\n```";

        let content = extract_generated_rule_content(response).expect("extract fenced content");

        assert_eq!(content, "# Spirit Agent 规则\n## 适用范围\n- foo\n");
    }

    #[test]
    fn extract_generated_rule_content_rejects_missing_heading() {
        let error = extract_generated_rule_content("普通说明文字").expect_err("missing heading");

        assert_eq!(error.to_string(), "规则内容必须以 Markdown 一级标题开头");
    }

    #[test]
    fn save_rule_document_creates_parent_directory() {
        let root = temp_test_dir("save-rule-document");
        let path = root.join("nested").join("AGENTS.md");

        let saved = save_rule_document(&path, "# Spirit Agent 规则\n").expect("save rule document");

        assert_eq!(saved, path);
        assert_eq!(fs::read_to_string(saved).expect("read saved rule"), "# Spirit Agent 规则\n");
    }
}