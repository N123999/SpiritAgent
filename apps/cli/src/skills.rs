use anyhow::{Context, Result, anyhow};
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    env, fs,
    path::{Path, PathBuf},
};

use crate::{logging, mcp::spirit_agent_data_dir};

pub const SPIRIT_DIR_NAME: &str = ".spirit";
pub const AGENTS_DIR_NAME: &str = ".agents";
pub const SKILLS_DIR_NAME: &str = "skills";
pub const SKILL_FILE_NAME: &str = "SKILL.md";
const SKILLS_STATE_FILE_NAME: &str = "skills-state.json";
const SKILL_PREVIEW_MAX_LINES: usize = 8;
const SKILL_PREVIEW_MAX_CHARS: usize = 1_200;
const SKILL_NAME_MAX_CHARS: usize = 64;
const ACTIVE_SKILL_CONTENT_MAX_CHARS: usize = 12_000;
const ACTIVE_SKILL_RESOURCE_MAX_ENTRIES: usize = 24;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SkillScope {
    Workspace,
    User,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SkillRootKind {
    WorkspaceSpirit,
    WorkspaceAgents,
    User,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CreateSkillRequest {
    pub prompt: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillSource {
    pub id: String,
    pub scope: SkillScope,
    pub root_kind: SkillRootKind,
    pub name: String,
    pub description: String,
    pub short_label: String,
    pub path: PathBuf,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillPreview {
    pub excerpt: String,
    #[serde(default)]
    pub truncated: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillEntry {
    pub source: SkillSource,
    pub enabled: bool,
    pub content: String,
    pub preview: SkillPreview,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnabledSkillCatalogEntry {
    pub id: String,
    pub scope: SkillScope,
    pub name: String,
    pub description: String,
    pub path: PathBuf,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActiveSkillResourceEntry {
    pub kind: String,
    pub path: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActiveSkillPayload {
    pub id: String,
    pub scope: SkillScope,
    pub name: String,
    pub description: String,
    pub path: PathBuf,
    pub content: String,
    pub truncated: bool,
    #[serde(default)]
    pub resources: Vec<ActiveSkillResourceEntry>,
    #[serde(default)]
    pub resources_truncated: bool,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillStateFile {
    #[serde(default)]
    pub enabled_overrides: BTreeMap<String, bool>,
}

impl SkillStateFile {
    pub fn enabled_override(&self, skill_id: &str) -> Option<bool> {
        self.enabled_overrides.get(skill_id).copied()
    }

    pub fn set_enabled(&mut self, skill_id: impl Into<String>, enabled: bool) {
        self.enabled_overrides.insert(skill_id.into(), enabled);
    }
}

#[derive(Debug)]
struct ParsedSkillDocument {
    name: String,
    description: String,
    body: String,
}

#[derive(Debug, Default, Deserialize)]
struct ParsedSkillFrontmatter {
    name: Option<String>,
    description: Option<String>,
}

pub fn create_skill_usage() -> &'static str {
    "用法: /create-skill <自然语言需求>"
}

pub fn skills_usage() -> &'static str {
    "用法: /skills"
}

pub fn workspace_spirit_skills_dir(workspace_root: &Path) -> PathBuf {
    workspace_root.join(SPIRIT_DIR_NAME).join(SKILLS_DIR_NAME)
}

pub fn workspace_agents_skills_dir(workspace_root: &Path) -> PathBuf {
    workspace_root.join(AGENTS_DIR_NAME).join(SKILLS_DIR_NAME)
}

pub fn user_skills_dir() -> PathBuf {
    spirit_agent_data_dir().join(SKILLS_DIR_NAME)
}

pub fn skill_path_for_scope(workspace_root: &Path, scope: SkillScope, skill_name: &str) -> PathBuf {
    let root = match scope {
        SkillScope::Workspace => workspace_spirit_skills_dir(workspace_root),
        SkillScope::User => user_skills_dir(),
    };

    root.join(skill_name).join(SKILL_FILE_NAME)
}

pub fn skills_state_file_path() -> PathBuf {
    spirit_agent_data_dir().join(SKILLS_STATE_FILE_NAME)
}

pub fn load_skill_state() -> Result<SkillStateFile> {
    let path = skills_state_file_path();
    if !path.exists() {
        return Ok(SkillStateFile::default());
    }

    let content = fs::read_to_string(&path)
        .with_context(|| format!("读取技能状态失败: {}", path.display()))?;
    serde_json::from_str(&content)
        .with_context(|| format!("解析技能状态失败: {}", path.display()))
}

pub fn save_skill_state(state: &SkillStateFile) -> Result<PathBuf> {
    let path = skills_state_file_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .with_context(|| format!("创建技能状态目录失败: {}", parent.display()))?;
    }

    let content = serde_json::to_string_pretty(state)?;
    fs::write(&path, content).with_context(|| format!("写入技能状态失败: {}", path.display()))?;
    Ok(path)
}

pub fn discover_skill_entries(
    workspace_root: &Path,
    state: &SkillStateFile,
) -> Result<Vec<SkillEntry>> {
    let roots = [
        (
            workspace_spirit_skills_dir(workspace_root),
            SkillScope::Workspace,
            SkillRootKind::WorkspaceSpirit,
        ),
        (
            workspace_agents_skills_dir(workspace_root),
            SkillScope::Workspace,
            SkillRootKind::WorkspaceAgents,
        ),
        (user_skills_dir(), SkillScope::User, SkillRootKind::User),
    ];

    let mut discovered = BTreeMap::<String, SkillEntry>::new();
    for (root, scope, root_kind) in roots {
        for entry in discover_skills_in_root(&root, scope, root_kind, state)? {
            if let Some(existing) = discovered.get(&entry.source.name) {
                logging::log_event(&format!(
                    "[skills] shadowed skill name={} kept={} ignored={}",
                    entry.source.name,
                    existing.source.path.display(),
                    entry.source.path.display()
                ));
                continue;
            }

            discovered.insert(entry.source.name.clone(), entry);
        }
    }

    let mut entries = discovered.into_values().collect::<Vec<_>>();
    entries.sort_by(|left, right| {
        scope_rank(left.source.scope)
            .cmp(&scope_rank(right.source.scope))
            .then(left.source.name.cmp(&right.source.name))
            .then(left.source.path.cmp(&right.source.path))
    });
    Ok(entries)
}

pub fn enabled_skill_catalog(entries: &[SkillEntry]) -> Vec<EnabledSkillCatalogEntry> {
    entries
        .iter()
        .filter(|entry| entry.enabled)
        .map(|entry| EnabledSkillCatalogEntry {
            id: entry.source.id.clone(),
            scope: entry.source.scope,
            name: entry.source.name.clone(),
            description: entry.source.description.clone(),
            path: entry.source.path.clone(),
        })
        .collect()
}

pub fn build_active_skill_payload(entry: &SkillEntry) -> Result<ActiveSkillPayload> {
    let skill_root = entry
        .source
        .path
        .parent()
        .ok_or_else(|| anyhow!("skill 路径缺少父目录: {}", entry.source.path.display()))?;
    let (content, truncated) = truncate_active_skill_content(&entry.content);
    let (resources, resources_truncated) = collect_skill_resources(skill_root)?;

    Ok(ActiveSkillPayload {
        id: entry.source.id.clone(),
        scope: entry.source.scope,
        name: entry.source.name.clone(),
        description: entry.source.description.clone(),
        path: entry.source.path.clone(),
        content,
        truncated,
        resources,
        resources_truncated,
    })
}

pub fn build_activate_skill_user_turn(skill_name: &str, extra_note: &str) -> String {
    let trimmed = extra_note.trim();
    if trimmed.is_empty() {
        return format!("请按已激活的 skill \"{}\" 处理当前任务。", skill_name);
    }

    trimmed.to_string()
}

pub fn parse_create_skill_request(input: &str) -> Result<CreateSkillRequest> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Err(anyhow!(create_skill_usage()));
    }

    Ok(CreateSkillRequest {
        prompt: trimmed.to_string(),
    })
}

pub fn build_create_skill_user_turn(workspace_root: &Path, request: &CreateSkillRequest) -> String {
    let workspace_root_dir = workspace_spirit_skills_dir(workspace_root);
    let user_root_dir = user_skills_dir();

    format!(
        "你现在在处理一个 /create-skill 请求。\n\n目标:\n- default_scope: 工作区\n- workspace_skill_root: {workspace_root_dir}\n- user_skill_root: {user_root_dir}\n- workspace_root: {workspace_root}\n\n用户需求:\n{user_prompt}\n\n要求:\n- 先把它当成一次正常的 assistant 对话来处理，正常流式输出，不要伪装成后台静默生成器。\n- 默认创建到工作区 skill 根目录 {workspace_root_dir}；只有在用户明确要求“用户级 / 全局 / 跨仓库复用 / 写到用户目录”这类语义时，才改为用户目录 {user_root_dir}。\n- 用户级目标目录位于 Spirit 托管的用户目录；该路径虽在工作区外，但属于允许写入的托管范围。\n- 你需要先根据用户需求自行决定一个合适的 skill_name；名称必须是 1-64 个字符，只能使用小写字母、数字和连字符，不能以连字符开头或结尾，也不能包含连续连字符。\n- 最终目标目录名与 frontmatter `name` 必须完全等于你决定的 skill_name。\n- 最终文件路径必须是 `<选定根目录>/<skill_name>/SKILL.md`；不要写到其他位置。\n- 如果目标 Skill 已存在，先读取原有 `SKILL.md`，再基于现有内容压缩重写或收紧，不要在旧内容后面继续堆砌模板化废话。\n- `SKILL.md` 必须以 YAML frontmatter 开头，至少包含 `name` 和 `description`；正文使用 Markdown，重点写清“做什么、何时用、怎么做”。\n- `description` 要具体说明适用场景，便于 agent 在 catalog 中识别。\n- Skill 是给后续 agent/LLM 直接消费的能力说明，不是给人类流程管理看的。\n- 正文优先写步骤、输入输出示例、边界条件；避免空话、组织治理废话和泛泛 checklist。\n- 需要事实时先读取仓库内相关文件，不要臆造项目结构、技术栈、目录或既有工作流。\n- 如果技能需要引用其他文件，正文里使用相对路径表达，不要假设这些文件已经存在。\n- 如果你选择工作区 scope，优先提炼当前仓库内可复用的流程知识、约束和操作步骤，避免写成泛化的团队治理文档。\n- 如果你选择用户 scope，优先提炼跨仓库稳定复用的个人工作流、判断标准与执行步骤。\n- 写入仍会经过正常审批；不要假设自己已经拿到权限，也不要在工具成功前声称“已创建”或“已更新”。\n\n交付方式:\n- 如果你能直接在目标路径落盘，就在确认内容后使用 create_file 或 edit_file 写入。\n- 如果不能直接落盘，就把最终 `SKILL.md` 完整贴在回复里，并明确说明未写入。",
        workspace_root_dir = workspace_root_dir.display(),
        user_root_dir = user_root_dir.display(),
        workspace_root = workspace_root.display(),
        user_prompt = request.prompt,
    )
}

pub fn validate_skill_name(name: &str) -> Result<()> {
    if name.is_empty() || name.chars().count() > SKILL_NAME_MAX_CHARS {
        return Err(anyhow!(
            "skill-name 必须为 1-{} 个字符",
            SKILL_NAME_MAX_CHARS
        ));
    }
    if name.starts_with('-') || name.ends_with('-') {
        return Err(anyhow!("skill-name 不能以连字符开头或结尾"));
    }
    if name.contains("--") {
        return Err(anyhow!("skill-name 不能包含连续连字符"));
    }
    if !name
        .chars()
        .all(|ch| ch.is_ascii_lowercase() || ch.is_ascii_digit() || ch == '-')
    {
        return Err(anyhow!("skill-name 仅允许小写字母、数字和连字符"));
    }
    Ok(())
}

fn discover_skills_in_root(
    root: &Path,
    scope: SkillScope,
    root_kind: SkillRootKind,
    state: &SkillStateFile,
) -> Result<Vec<SkillEntry>> {
    if !root.exists() {
        return Ok(Vec::new());
    }
    if !root.is_dir() {
        logging::log_event(&format!(
            "[skills] scan root is not a directory: {}",
            root.display()
        ));
        return Ok(Vec::new());
    }

    let mut directories = fs::read_dir(root)
        .with_context(|| format!("读取技能目录失败: {}", root.display()))?
        .filter_map(|entry| entry.ok())
        .filter_map(|entry| match entry.file_type() {
            Ok(kind) if kind.is_dir() => Some(entry.path()),
            _ => None,
        })
        .collect::<Vec<_>>();
    directories.sort();

    let mut entries = Vec::new();
    for skill_dir in directories {
        let skill_path = skill_dir.join(SKILL_FILE_NAME);
        if !skill_path.is_file() {
            continue;
        }

        let Some(parsed) = parse_skill_document(&skill_path)? else {
            continue;
        };
        let short_label = short_label_for_skill(root_kind, &parsed.name);
        let source = SkillSource {
            id: stable_skill_id(&skill_path),
            scope,
            root_kind,
            name: parsed.name.clone(),
            description: parsed.description.clone(),
            short_label,
            path: skill_path,
        };
        let enabled = state.enabled_override(&source.id).unwrap_or(true);
        let preview = build_skill_preview(&parsed.body);
        entries.push(SkillEntry {
            source,
            enabled,
            content: parsed.body,
            preview,
        });
    }

    Ok(entries)
}

fn parse_skill_document(path: &Path) -> Result<Option<ParsedSkillDocument>> {
    let raw = fs::read_to_string(path)
        .with_context(|| format!("读取 skill 文件失败: {}", path.display()))?;
    let Some((frontmatter, body)) = split_skill_frontmatter(&raw) else {
        logging::log_event(&format!(
            "[skills] skipped missing frontmatter path={}",
            path.display()
        ));
        return Ok(None);
    };

    let (parsed, used_fallback) = match parse_skill_frontmatter(frontmatter) {
        Ok(value) => value,
        Err(err) => {
            logging::log_event(&format!(
                "[skills] skipped invalid frontmatter path={} error={}",
                path.display(),
                err
            ));
            return Ok(None);
        }
    };

    if used_fallback {
        logging::log_event(&format!(
            "[skills] lenient frontmatter parse path={}",
            path.display()
        ));
    }

    let Some(name) = parsed.name.map(|value| value.trim().to_string()) else {
        logging::log_event(&format!(
            "[skills] skipped missing name path={}",
            path.display()
        ));
        return Ok(None);
    };
    if name.is_empty() {
        logging::log_event(&format!(
            "[skills] skipped empty name path={}",
            path.display()
        ));
        return Ok(None);
    }

    let Some(description) = parsed.description.map(|value| value.trim().to_string()) else {
        logging::log_event(&format!(
            "[skills] skipped missing description path={}",
            path.display()
        ));
        return Ok(None);
    };
    if description.is_empty() {
        logging::log_event(&format!(
            "[skills] skipped empty description path={}",
            path.display()
        ));
        return Ok(None);
    }

    if let Err(err) = validate_skill_name(&name) {
        logging::log_event(&format!(
            "[skills] non-conforming name path={} name={} warning={}",
            path.display(),
            name,
            err
        ));
    }

    let directory_name = path
        .parent()
        .and_then(Path::file_name)
        .and_then(|value| value.to_str())
        .unwrap_or_default();
    if directory_name != name {
        logging::log_event(&format!(
            "[skills] name-directory mismatch path={} name={} directory={}",
            path.display(),
            name,
            directory_name
        ));
    }

    Ok(Some(ParsedSkillDocument {
        name,
        description,
        body: body.trim().to_string(),
    }))
}

fn split_skill_frontmatter(raw: &str) -> Option<(&str, &str)> {
    let content = raw.strip_prefix('\u{feff}').unwrap_or(raw);
    let mut segments = content.split_inclusive('\n');
    let first = segments.next()?;
    if first.trim_end_matches(['\r', '\n']) != "---" {
        return None;
    }

    let mut yaml_len = first.len();
    for segment in segments {
        if segment.trim_end_matches(['\r', '\n']) == "---" {
            let frontmatter = &content[first.len()..yaml_len];
            let body = content[yaml_len + segment.len()..].trim_start_matches(['\r', '\n']);
            return Some((frontmatter, body));
        }
        yaml_len += segment.len();
    }

    None
}

fn parse_skill_frontmatter(frontmatter: &str) -> Result<(ParsedSkillFrontmatter, bool)> {
    match serde_yaml::from_str::<ParsedSkillFrontmatter>(frontmatter) {
        Ok(value) => Ok((value, false)),
        Err(primary_err) => {
            let Some(fallback) = parse_skill_frontmatter_fallback(frontmatter) else {
                return Err(anyhow!(primary_err));
            };
            Ok((fallback, true))
        }
    }
}

fn parse_skill_frontmatter_fallback(frontmatter: &str) -> Option<ParsedSkillFrontmatter> {
    let mut parsed = ParsedSkillFrontmatter::default();
    for line in frontmatter.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        if line.starts_with(' ') || line.starts_with('\t') {
            continue;
        }

        if parsed.name.is_none() {
            if let Some(value) = trimmed.strip_prefix("name:") {
                parsed.name = Some(unquote_yaml_scalar(value.trim()));
                continue;
            }
        }

        if parsed.description.is_none() {
            if let Some(value) = trimmed.strip_prefix("description:") {
                parsed.description = Some(unquote_yaml_scalar(value.trim()));
                continue;
            }
        }
    }

    if parsed.name.is_none() && parsed.description.is_none() {
        None
    } else {
        Some(parsed)
    }
}

fn unquote_yaml_scalar(value: &str) -> String {
    let bytes = value.as_bytes();
    if bytes.len() >= 2
        && ((bytes[0] == b'"' && bytes[bytes.len() - 1] == b'"')
            || (bytes[0] == b'\'' && bytes[bytes.len() - 1] == b'\''))
    {
        return value[1..value.len() - 1].to_string();
    }
    value.to_string()
}

fn scope_rank(scope: SkillScope) -> u8 {
    match scope {
        SkillScope::Workspace => 0,
        SkillScope::User => 1,
    }
}

fn short_label_for_skill(root_kind: SkillRootKind, skill_name: &str) -> String {
    match root_kind {
        SkillRootKind::WorkspaceSpirit => {
            format!("{}/{}/{}/{}", SPIRIT_DIR_NAME, SKILLS_DIR_NAME, skill_name, SKILL_FILE_NAME)
        }
        SkillRootKind::WorkspaceAgents => {
            format!("{}/{}/{}/{}", AGENTS_DIR_NAME, SKILLS_DIR_NAME, skill_name, SKILL_FILE_NAME)
        }
        SkillRootKind::User => format!("{}/{}/{}", SKILLS_DIR_NAME, skill_name, SKILL_FILE_NAME),
    }
}

fn build_skill_preview(content: &str) -> SkillPreview {
    let mut excerpt_lines = Vec::new();
    let mut used_chars = 0usize;
    let mut truncated = false;

    for (index, line) in content.lines().enumerate() {
        if index >= SKILL_PREVIEW_MAX_LINES {
            truncated = true;
            break;
        }

        let line_chars = line.chars().count();
        let separator = if excerpt_lines.is_empty() { 0 } else { 1 };
        if used_chars + separator + line_chars > SKILL_PREVIEW_MAX_CHARS {
            let remaining = SKILL_PREVIEW_MAX_CHARS.saturating_sub(used_chars + separator);
            if remaining > 0 {
                excerpt_lines.push(truncate_chars(line, remaining));
            }
            truncated = true;
            break;
        }

        excerpt_lines.push(line.to_string());
        used_chars = used_chars.saturating_add(separator + line_chars);
    }

    if !truncated && content.lines().count() <= SKILL_PREVIEW_MAX_LINES {
        truncated = content.chars().count() > SKILL_PREVIEW_MAX_CHARS;
    }

    SkillPreview {
        excerpt: excerpt_lines.join("\n").trim_end().to_string(),
        truncated,
    }
}

fn truncate_active_skill_content(content: &str) -> (String, bool) {
    let chars = content.chars().collect::<Vec<_>>();
    if chars.len() <= ACTIVE_SKILL_CONTENT_MAX_CHARS {
        return (content.trim().to_string(), false);
    }

    let truncated = chars
        .into_iter()
        .take(ACTIVE_SKILL_CONTENT_MAX_CHARS)
        .collect::<String>();
    (
        format!(
            "{}\n\n...<skill content truncated>",
            truncated.trim_end()
        ),
        true,
    )
}

fn collect_skill_resources(skill_root: &Path) -> Result<(Vec<ActiveSkillResourceEntry>, bool)> {
    let mut resources = Vec::new();
    let mut truncated = false;

    for (kind, dirname) in [
        ("scripts", "scripts"),
        ("references", "references"),
        ("assets", "assets"),
    ] {
        let root = skill_root.join(dirname);
        if !root.is_dir() {
            continue;
        }

        let mut stack = vec![root.clone()];
        while let Some(current) = stack.pop() {
            let mut entries = fs::read_dir(&current)
                .with_context(|| format!("读取 skill 资源目录失败: {}", current.display()))?
                .filter_map(|entry| entry.ok())
                .collect::<Vec<_>>();
            entries.sort_by_key(|entry| entry.path());
            entries.reverse();

            for entry in entries {
                let path = entry.path();
                let file_type = match entry.file_type() {
                    Ok(file_type) => file_type,
                    Err(_) => continue,
                };
                if file_type.is_dir() {
                    stack.push(path);
                    continue;
                }
                if !file_type.is_file() {
                    continue;
                }

                if resources.len() >= ACTIVE_SKILL_RESOURCE_MAX_ENTRIES {
                    truncated = true;
                    return Ok((resources, truncated));
                }

                let relative = path
                    .strip_prefix(skill_root)
                    .unwrap_or(path.as_path())
                    .to_string_lossy()
                    .replace('\\', "/");
                resources.push(ActiveSkillResourceEntry {
                    kind: kind.to_string(),
                    path: relative,
                });
            }
        }
    }

    Ok((resources, truncated))
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

fn stable_skill_id(path: &Path) -> String {
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
    use std::{
        time::{SystemTime, UNIX_EPOCH},
    };

    fn temp_test_dir(label: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time")
            .as_nanos();
        let dir = env::temp_dir().join(format!("spirit-agent-skills-{label}-{unique}"));
        fs::create_dir_all(&dir).expect("create temp dir");
        dir
    }

    fn write_skill(root: &Path, name: &str, content: &str) -> PathBuf {
        let dir = root.join(name);
        fs::create_dir_all(&dir).expect("create skill dir");
        let path = dir.join(SKILL_FILE_NAME);
        fs::write(&path, content).expect("write skill file");
        path
    }

    fn sample_skill(name: &str, description: &str, body: &str) -> String {
        format!(
            "---\nname: {name}\ndescription: {description}\n---\n\n{body}\n"
        )
    }

    #[test]
    fn user_skills_dir_lives_under_spirit_agent_data_dir() {
        let _guard = shared_env_lock().lock().unwrap_or_else(|err| err.into_inner());
        let appdata = temp_test_dir("user-skills-dir");
        unsafe {
            env::set_var("APPDATA", &appdata);
            env::remove_var("USERPROFILE");
        }

        assert_eq!(user_skills_dir(), appdata.join("SpiritAgent").join(SKILLS_DIR_NAME));
    }

    #[test]
    fn save_skill_state_round_trips_overrides() {
        let _guard = shared_env_lock().lock().unwrap_or_else(|err| err.into_inner());
        let appdata = temp_test_dir("skill-state-roundtrip");
        unsafe {
            env::set_var("APPDATA", &appdata);
            env::remove_var("USERPROFILE");
        }

        let mut state = SkillStateFile::default();
        state.set_enabled("skill-a", false);
        state.set_enabled("skill-b", true);
        let path = save_skill_state(&state).expect("save skill state");

        assert_eq!(path, appdata.join("SpiritAgent").join(SKILLS_STATE_FILE_NAME));
        assert_eq!(load_skill_state().expect("load skill state"), state);
    }

    #[test]
    fn discover_skill_entries_prefers_workspace_spirit_over_agents_and_user() {
        let _guard = shared_env_lock().lock().unwrap_or_else(|err| err.into_inner());
        let workspace_root = temp_test_dir("discover-precedence-workspace");
        let appdata = temp_test_dir("discover-precedence-appdata");
        unsafe {
            env::set_var("APPDATA", &appdata);
            env::remove_var("USERPROFILE");
        }

        write_skill(
            &workspace_spirit_skills_dir(&workspace_root),
            "code-review",
            &sample_skill(
                "code-review",
                "Review code paths. Use when auditing diffs.",
                "# Workspace Spirit\n优先使用工作区原生 skill",
            ),
        );
        write_skill(
            &workspace_agents_skills_dir(&workspace_root),
            "code-review",
            &sample_skill(
                "code-review",
                "Fallback review skill.",
                "# Workspace Agents\n兼容根",
            ),
        );
        write_skill(
            &user_skills_dir(),
            "code-review",
            &sample_skill(
                "code-review",
                "User review skill.",
                "# User\n用户级",
            ),
        );

        let entries = discover_skill_entries(&workspace_root, &SkillStateFile::default())
            .expect("discover skills");

        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].source.root_kind, SkillRootKind::WorkspaceSpirit);
        assert!(entries[0].content.contains("工作区原生"));
    }

    #[test]
    fn discover_skill_entries_uses_enabled_override() {
        let _guard = shared_env_lock().lock().unwrap_or_else(|err| err.into_inner());
        let workspace_root = temp_test_dir("discover-enabled-workspace");
        let appdata = temp_test_dir("discover-enabled-appdata");
        unsafe {
            env::set_var("APPDATA", &appdata);
            env::remove_var("USERPROFILE");
        }

        let skill_path = write_skill(
            &workspace_spirit_skills_dir(&workspace_root),
            "data-analysis",
            &sample_skill(
                "data-analysis",
                "Analyze datasets when the user asks for data work.",
                "# Data Analysis\n1. Inspect the schema",
            ),
        );
        let mut state = SkillStateFile::default();
        state.set_enabled(stable_skill_id(&skill_path), false);

        let entries = discover_skill_entries(&workspace_root, &state).expect("discover skills");
        assert_eq!(entries.len(), 1);
        assert!(!entries[0].enabled);
    }

    #[test]
    fn discover_skill_entries_skips_missing_description() {
        let _guard = shared_env_lock().lock().unwrap_or_else(|err| err.into_inner());
        let workspace_root = temp_test_dir("discover-missing-description-workspace");
        let appdata = temp_test_dir("discover-missing-description-appdata");
        unsafe {
            env::set_var("APPDATA", &appdata);
            env::remove_var("USERPROFILE");
        }

        write_skill(
            &workspace_spirit_skills_dir(&workspace_root),
            "broken-skill",
            "---\nname: broken-skill\n---\n\n# Broken\n",
        );

        let entries = discover_skill_entries(&workspace_root, &SkillStateFile::default())
            .expect("discover skills");
        assert!(entries.is_empty());
    }

    #[test]
    fn discover_skill_entries_accepts_lenient_description_with_colon() {
        let _guard = shared_env_lock().lock().unwrap_or_else(|err| err.into_inner());
        let workspace_root = temp_test_dir("discover-lenient-yaml-workspace");
        let appdata = temp_test_dir("discover-lenient-yaml-appdata");
        unsafe {
            env::set_var("APPDATA", &appdata);
            env::remove_var("USERPROFILE");
        }

        write_skill(
            &workspace_spirit_skills_dir(&workspace_root),
            "pdf-processing",
            "---\nname: pdf-processing\ndescription: Use this skill when: the user asks about PDFs\n---\n\n# PDF\n",
        );

        let entries = discover_skill_entries(&workspace_root, &SkillStateFile::default())
            .expect("discover skills");
        assert_eq!(entries.len(), 1);
        assert_eq!(
            entries[0].source.description,
            "Use this skill when: the user asks about PDFs"
        );
    }

    #[test]
    fn enabled_skill_catalog_only_keeps_enabled_entries() {
        let entries = vec![
            SkillEntry {
                source: SkillSource {
                    id: "enabled".to_string(),
                    scope: SkillScope::Workspace,
                    root_kind: SkillRootKind::WorkspaceSpirit,
                    name: "code-review".to_string(),
                    description: "Review code.".to_string(),
                    short_label: ".spirit/skills/code-review/SKILL.md".to_string(),
                    path: PathBuf::from("C:/workspace/.spirit/skills/code-review/SKILL.md"),
                },
                enabled: true,
                content: "# Review".to_string(),
                preview: SkillPreview::default(),
            },
            SkillEntry {
                source: SkillSource {
                    id: "disabled".to_string(),
                    scope: SkillScope::User,
                    root_kind: SkillRootKind::User,
                    name: "data-analysis".to_string(),
                    description: "Analyze data.".to_string(),
                    short_label: "skills/data-analysis/SKILL.md".to_string(),
                    path: PathBuf::from("C:/users/demo/AppData/Roaming/SpiritAgent/skills/data-analysis/SKILL.md"),
                },
                enabled: false,
                content: "# Data".to_string(),
                preview: SkillPreview::default(),
            },
        ];

        let enabled = enabled_skill_catalog(&entries);
        assert_eq!(enabled.len(), 1);
        assert_eq!(enabled[0].name, "code-review");
    }

    #[test]
    fn parse_create_skill_request_preserves_natural_language_prompt() {
        let request = parse_create_skill_request("做一个用于代码审查 diff 的 Skill")
            .expect("parse create skill request");

        assert_eq!(request.prompt, "做一个用于代码审查 diff 的 Skill");
    }

    #[test]
    fn parse_create_skill_request_keeps_explicit_user_scope_intent_in_prompt() {
        let request = parse_create_skill_request("生成一个用户级 Skill，用于跨仓库代码审查")
            .expect("parse create skill request");

        assert!(request.prompt.contains("用户级 Skill"));
    }

    #[test]
    fn parse_create_skill_request_rejects_empty_prompt() {
        let error = parse_create_skill_request("   ").expect_err("empty prompt should fail");

        assert!(error.to_string().contains("/create-skill"));
    }

    #[test]
    fn build_create_skill_user_turn_mentions_default_scope_and_skill_constraints() {
        let workspace_root = PathBuf::from("C:/workspace/demo");
        let request = CreateSkillRequest {
            prompt: "生成一个用于审查 diff 的 skill".to_string(),
        };

        let prompt = build_create_skill_user_turn(&workspace_root, &request);

        assert!(prompt.contains("SKILL.md"));
        assert!(prompt.contains("default_scope: 工作区"));
        assert!(prompt.contains("skill_name"));
        assert!(prompt.contains("create_file 或 edit_file"));
        assert!(prompt.contains("YAML frontmatter"));
    }

    #[test]
    fn build_create_skill_user_turn_mentions_explicit_user_scope_override_rule() {
        let workspace_root = PathBuf::from("C:/workspace/demo");
        let request = CreateSkillRequest {
            prompt: "生成一个跨仓库稳定复用的 code review skill".to_string(),
        };

        let prompt = build_create_skill_user_turn(&workspace_root, &request);

        assert!(prompt.contains("只有在用户明确要求"));
        assert!(prompt.contains("Spirit 托管的用户目录"));
        assert!(prompt.contains("跨仓库稳定复用的个人工作流"));
        assert!(prompt.contains("create_file 或 edit_file"));
    }

    #[test]
    fn build_active_skill_payload_collects_resources_and_truncates_long_content() {
        let workspace_root = temp_test_dir("active-skill-payload");
        let skill_path = write_skill(
            &workspace_spirit_skills_dir(&workspace_root),
            "code-review",
            &sample_skill(
                "code-review",
                "Review diffs when the user asks for code review.",
                &"A".repeat(ACTIVE_SKILL_CONTENT_MAX_CHARS + 32),
            ),
        );
        let skill_root = skill_path.parent().expect("skill root");
        fs::create_dir_all(skill_root.join("scripts")).expect("create scripts dir");
        fs::create_dir_all(skill_root.join("references")).expect("create references dir");
        fs::write(skill_root.join("scripts/review.ps1"), "Write-Host review")
            .expect("write script");
        fs::write(skill_root.join("references/checklist.md"), "- inspect diff")
            .expect("write reference");

        let entry = SkillEntry {
            source: SkillSource {
                id: stable_skill_id(&skill_path),
                scope: SkillScope::Workspace,
                root_kind: SkillRootKind::WorkspaceSpirit,
                name: "code-review".to_string(),
                description: "Review diffs when the user asks for code review.".to_string(),
                short_label: ".spirit/skills/code-review/SKILL.md".to_string(),
                path: skill_path,
            },
            enabled: true,
            content: "A".repeat(ACTIVE_SKILL_CONTENT_MAX_CHARS + 32),
            preview: SkillPreview::default(),
        };

        let payload = build_active_skill_payload(&entry).expect("build active skill payload");
        assert!(payload.truncated);
        assert!(payload.content.contains("...<skill content truncated>"));
        assert_eq!(payload.resources.len(), 2);
        let mut resource_paths = payload
            .resources
            .iter()
            .map(|resource| resource.path.clone())
            .collect::<Vec<_>>();
        resource_paths.sort();
        assert_eq!(
            resource_paths,
            vec![
                "references/checklist.md".to_string(),
                "scripts/review.ps1".to_string(),
            ]
        );
    }

    #[test]
    fn build_activate_skill_user_turn_falls_back_when_note_is_empty() {
        assert!(build_activate_skill_user_turn("code-review", "  ").contains("code-review"));
        assert_eq!(
            build_activate_skill_user_turn("code-review", "聚焦风险与回归"),
            "聚焦风险与回归"
        );
    }
}