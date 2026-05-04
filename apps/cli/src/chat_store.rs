use anyhow::{Context, Result, anyhow};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    env, fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

const CHAT_DIR_NAME: &str = "chats";

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChatFile {
    saved_at_unix_ms: u128,
    messages: Vec<StoredChatMessage>,
    #[serde(default)]
    assistant_aux: Vec<StoredAssistantAux>,
    llm_history: Vec<StoredLlmMessage>,
    #[serde(default)]
    subagent_sessions: Vec<StoredSubagentSession>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    rewind: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    session_display_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    workspace_root: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    git_branch: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    desktop_messages: Option<Vec<StoredDesktopMessage>>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredChatMessage {
    role: String,
    content: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredAssistantAux {
    message_index: usize,
    #[serde(default)]
    thinking: Option<String>,
    #[serde(default)]
    compaction: Option<String>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredLlmMessage {
    role: String,
    content: String,
    #[serde(default)]
    image_paths: Vec<String>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredDesktopMessage {
    id: usize,
    role: String,
    content: String,
    pending: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    aux: Option<StoredDesktopMessageAux>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredDesktopMessageAux {
    #[serde(default)]
    thinking: Option<String>,
    #[serde(default)]
    compaction: Option<String>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredSubagentSession {
    summary: StoredSubagentSessionSummary,
    #[serde(default)]
    llm_history: Vec<StoredLlmMessage>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredSubagentSessionSummary {
    session_id: String,
    parent_tool_call_id: String,
    title: String,
    status: crate::ports::SubagentSessionStatus,
    started_at_unix_ms: u64,
    updated_at_unix_ms: u64,
    completed_at_unix_ms: Option<u64>,
    latest_message: Option<String>,
    final_output: Option<String>,
    error: Option<String>,
}

struct SanitizedChatData {
    messages: Vec<StoredChatMessage>,
    assistant_aux: Vec<StoredAssistantAux>,
    desktop_messages: Vec<StoredDesktopMessage>,
}

pub struct LoadedChat {
    pub messages: Vec<(String, String)>,
    pub assistant_aux: Vec<crate::ports::AssistantAuxArchiveEntry>,
    pub llm_history: Vec<(String, String, Vec<String>)>,
    pub subagent_sessions: Vec<crate::ports::SubagentSessionArchiveEntry>,
    pub rewind: Option<Value>,
}

pub fn chat_dir_path() -> PathBuf {
    if let Ok(appdata) = env::var("APPDATA") {
        return PathBuf::from(appdata)
            .join("SpiritAgent")
            .join(CHAT_DIR_NAME);
    }

    if let Ok(home) = env::var("USERPROFILE") {
        return PathBuf::from(home)
            .join(".spirit-agent")
            .join(CHAT_DIR_NAME);
    }

    PathBuf::from(format!(".spirit-agent.{}", CHAT_DIR_NAME))
}

pub fn list_chat_files() -> Result<Vec<PathBuf>> {
    let dir = chat_dir_path();
    if !dir.exists() {
        return Ok(Vec::new());
    }

    let mut files = fs::read_dir(&dir)
        .with_context(|| format!("读取对话目录失败: {}", dir.display()))?
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.is_file())
        .filter(|p| p.extension().and_then(|s| s.to_str()) == Some("json"))
        .collect::<Vec<_>>();

    files.sort_by(|a, b| b.cmp(a));
    Ok(files)
}

pub fn save_chat(
    path_arg: Option<&str>,
    messages: &[(String, String)],
    assistant_aux: &[crate::ports::AssistantAuxArchiveEntry],
    llm_history: &[(String, String, Vec<String>)],
    subagent_sessions: &[crate::ports::SubagentSessionArchiveEntry],
    rewind: Option<&Value>,
) -> Result<PathBuf> {
    let path = resolve_save_path(path_arg)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .with_context(|| format!("创建对话目录失败: {}", parent.display()))?;
    }

    let sanitized = sanitize_chat_data(messages, assistant_aux);
    let workspace_root = current_workspace_root();

    let file = ChatFile {
        saved_at_unix_ms: current_unix_millis(),
        messages: sanitized.messages,
        assistant_aux: sanitized.assistant_aux,
        llm_history: llm_history
            .iter()
            .map(|(role, content, image_paths)| StoredLlmMessage {
                role: role.clone(),
                content: content.clone(),
                image_paths: image_paths.clone(),
            })
            .collect(),
        subagent_sessions: subagent_sessions
            .iter()
            .map(|entry| StoredSubagentSession {
                summary: StoredSubagentSessionSummary {
                    session_id: entry.summary.session_id.clone(),
                    parent_tool_call_id: entry.summary.parent_tool_call_id.clone(),
                    title: entry.summary.title.clone(),
                    status: entry.summary.status,
                    started_at_unix_ms: entry.summary.started_at_unix_ms,
                    updated_at_unix_ms: entry.summary.updated_at_unix_ms,
                    completed_at_unix_ms: entry.summary.completed_at_unix_ms,
                    latest_message: entry.summary.latest_message.clone(),
                    final_output: entry.summary.final_output.clone(),
                    error: entry.summary.error.clone(),
                },
                llm_history: entry
                    .llm_history
                    .iter()
                    .map(|message| StoredLlmMessage {
                        role: message.role.clone(),
                        content: message.content.clone(),
                        image_paths: message.image_paths.clone(),
                    })
                    .collect(),
            })
            .collect(),
        rewind: rewind.cloned(),
        session_display_name: derive_session_display_name(&sanitized.desktop_messages),
        workspace_root: workspace_root.as_ref().map(|path| path.to_string_lossy().to_string()),
        git_branch: workspace_root
            .as_ref()
            .and_then(|path| detect_git_branch(path)),
        desktop_messages: (!sanitized.desktop_messages.is_empty())
            .then_some(sanitized.desktop_messages),
    };

    let content = serde_json::to_string_pretty(&file)?;
    fs::write(&path, content).with_context(|| format!("写入对话失败: {}", path.display()))?;
    Ok(path)
}

pub fn load_chat(path_arg: &str) -> Result<LoadedChat> {
    let path = resolve_load_path(path_arg)?;
    let text = fs::read_to_string(&path)
        .with_context(|| format!("读取对话文件失败: {}", path.display()))?;
    let parsed: ChatFile = serde_json::from_str(&text)
        .with_context(|| format!("解析对话文件失败: {}", path.display()))?;

    let messages = parsed
        .messages
        .into_iter()
        .map(|m| (m.role, m.content))
        .collect::<Vec<_>>();
    let assistant_aux = parsed
        .assistant_aux
        .into_iter()
        .filter(|entry| {
            entry
                .thinking
                .as_ref()
                .is_some_and(|value| !value.trim().is_empty())
                || entry
                    .compaction
                    .as_ref()
                    .is_some_and(|value| !value.trim().is_empty())
        })
        .map(|entry| crate::ports::AssistantAuxArchiveEntry {
            message_index: entry.message_index,
            thinking: entry.thinking.filter(|value| !value.trim().is_empty()),
            compaction: entry.compaction.filter(|value| !value.trim().is_empty()),
        })
        .collect::<Vec<_>>();
    let sanitized = sanitize_chat_data(&messages, &assistant_aux);

    Ok(LoadedChat {
        messages: sanitized
            .messages
            .into_iter()
            .map(|m| (m.role, m.content))
            .collect(),
        assistant_aux: sanitized
            .assistant_aux
            .into_iter()
            .map(|entry| crate::ports::AssistantAuxArchiveEntry {
                message_index: entry.message_index,
                thinking: entry.thinking,
                compaction: entry.compaction,
            })
            .collect(),
        llm_history: parsed
            .llm_history
            .into_iter()
            .map(|m| (m.role, m.content, m.image_paths))
            .collect(),
        subagent_sessions: parsed
            .subagent_sessions
            .into_iter()
            .map(|entry| crate::ports::SubagentSessionArchiveEntry {
                summary: crate::ports::SubagentSessionSummary {
                    session_id: entry.summary.session_id,
                    parent_tool_call_id: entry.summary.parent_tool_call_id,
                    title: entry.summary.title,
                    status: entry.summary.status,
                    started_at_unix_ms: entry.summary.started_at_unix_ms,
                    updated_at_unix_ms: entry.summary.updated_at_unix_ms,
                    completed_at_unix_ms: entry.summary.completed_at_unix_ms,
                    latest_message: entry.summary.latest_message,
                    final_output: entry.summary.final_output,
                    error: entry.summary.error,
                },
                llm_history: entry
                    .llm_history
                    .into_iter()
                    .map(|message| crate::ports::ArchivedLlmMessage {
                        role: message.role,
                        content: message.content,
                        image_paths: message.image_paths,
                    })
                    .collect(),
            })
            .collect(),
        rewind: parsed.rewind,
    })
}

fn current_unix_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

fn sanitize_chat_data(
    messages: &[(String, String)],
    assistant_aux: &[crate::ports::AssistantAuxArchiveEntry],
) -> SanitizedChatData {
    let normalized_aux = assistant_aux
        .iter()
        .filter_map(|entry| {
            let thinking = entry
                .thinking
                .clone()
                .filter(|value| !value.trim().is_empty());
            let compaction = entry
                .compaction
                .clone()
                .filter(|value| !value.trim().is_empty());
            if thinking.is_none() && compaction.is_none() {
                None
            } else {
                Some((
                    entry.message_index,
                    StoredAssistantAux {
                        message_index: 0,
                        thinking,
                        compaction,
                    },
                ))
            }
        })
        .collect::<Vec<_>>();

    let mut persisted_messages = Vec::new();
    let mut persisted_aux = Vec::new();
    let mut desktop_messages = Vec::new();

    for (original_index, (role, content)) in messages.iter().enumerate() {
        let aux = normalized_aux
            .iter()
            .find(|(index, _)| *index == original_index)
            .map(|(_, entry)| entry.clone());
        if role == "assistant" && content.trim().is_empty() && aux.is_none() {
            continue;
        }

        let message_index = persisted_messages.len();
        persisted_messages.push(StoredChatMessage {
            role: role.clone(),
            content: content.clone(),
        });

        let desktop_aux = aux.clone().map(|mut entry| {
            entry.message_index = message_index;
            persisted_aux.push(entry.clone());
            StoredDesktopMessageAux {
                thinking: entry.thinking,
                compaction: entry.compaction,
            }
        });

        desktop_messages.push(StoredDesktopMessage {
            id: message_index + 1,
            role: role.clone(),
            content: content.clone(),
            pending: false,
            aux: desktop_aux,
        });
    }

    SanitizedChatData {
        messages: persisted_messages,
        assistant_aux: persisted_aux,
        desktop_messages,
    }
}

fn derive_session_display_name(messages: &[StoredDesktopMessage]) -> Option<String> {
    let seed = messages
        .iter()
        .find(|message| message.role == "user" && !message.content.trim().is_empty())?
        .content
        .trim();
    let truncated = seed.chars().take(28).collect::<String>();
    Some(if seed.chars().count() > 28 {
        format!("{}...", truncated)
    } else {
        seed.to_string()
    })
}

fn current_workspace_root() -> Option<PathBuf> {
    env::current_dir().ok()
}

fn detect_git_branch(workspace_root: &Path) -> Option<String> {
    let git_dir = resolve_git_dir(workspace_root)?;
    let head = fs::read_to_string(git_dir.join("HEAD")).ok()?;
    let reference = head.trim().strip_prefix("ref:")?.trim();
    let branch = reference.rsplit('/').next()?.trim();
    (!branch.is_empty()).then(|| branch.to_string())
}

fn resolve_git_dir(workspace_root: &Path) -> Option<PathBuf> {
    let dot_git = workspace_root.join(".git");
    if dot_git.is_dir() {
        return Some(dot_git);
    }
    if !dot_git.is_file() {
        return None;
    }

    let raw = fs::read_to_string(dot_git).ok()?;
    let relative = raw.trim().strip_prefix("gitdir:")?.trim();
    let path = PathBuf::from(relative);
    Some(if path.is_absolute() {
        path
    } else {
        workspace_root.join(path)
    })
}

fn resolve_save_path(path_arg: Option<&str>) -> Result<PathBuf> {
    match path_arg {
        Some(raw) if !raw.trim().is_empty() => {
            let p = PathBuf::from(raw.trim());
            Ok(with_json_extension(p))
        }
        _ => {
            let dir = chat_dir_path();
            let ts = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|d| d.as_secs())
                .unwrap_or(0);
            Ok(dir.join(format!("chat-{}.json", ts)))
        }
    }
}

fn resolve_load_path(path_arg: &str) -> Result<PathBuf> {
    let trimmed = path_arg.trim();
    if trimmed.is_empty() {
        return Err(anyhow!("/sessions load 需要文件名或路径"));
    }

    let raw = PathBuf::from(trimmed);
    let candidate = if raw.is_absolute() {
        with_json_extension(raw)
    } else {
        let in_chat_dir = with_json_extension(chat_dir_path().join(&raw));
        if in_chat_dir.exists() {
            in_chat_dir
        } else {
            with_json_extension(raw)
        }
    };

    if !candidate.exists() {
        return Err(anyhow!("对话文件不存在: {}", candidate.display()));
    }

    Ok(candidate)
}

fn with_json_extension(path: PathBuf) -> PathBuf {
    if path.extension().and_then(|s| s.to_str()) == Some("json") {
        return path;
    }

    let mut p = path;
    if p.file_name().is_some() {
        p.set_extension("json");
    }
    p
}

pub fn display_name(path: &Path) -> String {
    if let Some(name) = path.file_name().and_then(|s| s.to_str()) {
        return name.to_string();
    }
    path.to_string_lossy().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn save_chat_writes_desktop_compatible_schema_and_reloads() {
        let file_path = test_file_path("desktop-compatible-save");
        let messages = vec![
            ("user".to_string(), "hello".to_string()),
            ("assistant".to_string(), "".to_string()),
            ("assistant".to_string(), "".to_string()),
            ("assistant".to_string(), "answer".to_string()),
        ];
        let assistant_aux = vec![crate::ports::AssistantAuxArchiveEntry {
            message_index: 2,
            thinking: Some("reasoning".to_string()),
            compaction: None,
        }];
        let llm_history = vec![("user".to_string(), "hello".to_string(), Vec::new())];

        let saved = save_chat(
            Some(file_path.to_string_lossy().as_ref()),
            &messages,
            &assistant_aux,
            &llm_history,
            &[],
            None,
        )
        .expect("save chat");

        let raw = fs::read_to_string(&saved).expect("read saved chat");
        let parsed: Value = serde_json::from_str(&raw).expect("parse saved chat json");
        assert!(parsed.get("savedAtUnixMs").is_some());
        assert!(parsed.get("saved_at_unix_ms").is_none());
        assert!(parsed.get("assistantAux").is_some());
        assert!(parsed.get("assistant_aux").is_none());
        assert!(parsed.get("llmHistory").is_some());

        let stored_messages = parsed["messages"].as_array().expect("messages array");
        assert_eq!(stored_messages.len(), 3);
        let desktop_messages = parsed["desktopMessages"]
            .as_array()
            .expect("desktop messages array");
        assert_eq!(desktop_messages.len(), 3);
        assert_eq!(parsed["assistantAux"][0]["messageIndex"], json!(1));
        assert_eq!(desktop_messages[1]["aux"]["thinking"], json!("reasoning"));

        let loaded = load_chat(saved.to_string_lossy().as_ref()).expect("reload chat");
        assert_eq!(loaded.messages.len(), 3);
        assert_eq!(loaded.assistant_aux.len(), 1);
        assert_eq!(loaded.assistant_aux[0].message_index, 1);
        assert_eq!(loaded.assistant_aux[0].thinking.as_deref(), Some("reasoning"));

        let _ = fs::remove_file(saved);
    }

    fn test_file_path(label: &str) -> PathBuf {
        let file_name = format!("spirit-agent-chat-store-{}-{}.json", label, current_unix_millis());
        env::temp_dir().join(file_name)
    }
}
