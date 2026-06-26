use anyhow::{Context, Result, anyhow};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    env, fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use crate::chat_timeline::{
    CHAT_SCHEMA_VERSION, PersistedTimelineTurn, build_persisted_timeline,
    derive_archive_projection, hydrate_desktop_messages_from_timeline,
    normalize_desktop_messages_for_persistence,
};
use crate::rewind::ConversationMessageSnapshot;

use crate::mcp::spirit_agent_data_dir;

const CHAT_DIR_NAME: &str = "chats";

fn default_chat_approval_level() -> String {
    "default".to_string()
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChatFile {
    chat_schema_version: i32,
    saved_at_unix_ms: u128,
    desktop_message_timeline: Vec<PersistedTimelineTurn>,
    llm_history: Vec<crate::ports::ArchivedLlmMessage>,
    #[serde(default)]
    loop_enabled: bool,
    #[serde(default = "default_chat_approval_level")]
    approval_level: String,
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
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredSubagentSession {
    summary: StoredSubagentSessionSummary,
    #[serde(default)]
    llm_history: Vec<crate::ports::ArchivedLlmMessage>,
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

#[derive(Debug)]
pub struct LoadedChat {
    pub messages: Vec<(String, String)>,
    pub assistant_aux: Vec<crate::ports::AssistantAuxArchiveEntry>,
    pub llm_history: Vec<crate::ports::ArchivedLlmMessage>,
    pub loop_enabled: bool,
    pub approval_level: String,
    pub subagent_sessions: Vec<crate::ports::SubagentSessionArchiveEntry>,
    pub desktop_messages: Option<Vec<ConversationMessageSnapshot>>,
    pub rewind: Option<Value>,
    pub session_display_name: Option<String>,
}

pub fn chat_dir_path() -> PathBuf {
    spirit_agent_data_dir().join(CHAT_DIR_NAME)
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
    llm_history: &[crate::ports::ArchivedLlmMessage],
    loop_enabled: bool,
    approval_level: &str,
    subagent_sessions: &[crate::ports::SubagentSessionArchiveEntry],
    rewind: Option<&Value>,
    desktop_messages: Option<&[ConversationMessageSnapshot]>,
    session_display_name_override: Option<&str>,
) -> Result<PathBuf> {
    let path = resolve_save_path(path_arg)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .with_context(|| format!("创建对话目录失败: {}", parent.display()))?;
    }

    let desktop_messages = desktop_messages
        .map(normalize_desktop_messages_for_persistence)
        .filter(|messages| !messages.is_empty())
        .unwrap_or_else(|| build_fallback_desktop_messages(messages, assistant_aux));
    let desktop_message_timeline = build_persisted_timeline(&desktop_messages);
    if desktop_message_timeline.is_empty() {
        return Err(anyhow!("chat schema v2 拒绝写入空会话 timeline"));
    }
    let workspace_root = current_workspace_root();

    let file = ChatFile {
        chat_schema_version: CHAT_SCHEMA_VERSION,
        saved_at_unix_ms: current_unix_millis(),
        desktop_message_timeline,
        llm_history: llm_history.to_vec(),
        loop_enabled,
        approval_level: crate::ports::normalize_approval_level(approval_level),
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
                llm_history: entry.llm_history.clone(),
            })
            .collect(),
        rewind: rewind.cloned(),
        session_display_name: session_display_name_override
            .map(str::to_string)
            .or_else(|| derive_session_display_name(&desktop_messages)),
        workspace_root: workspace_root
            .as_ref()
            .map(|path| path.to_string_lossy().to_string()),
        git_branch: workspace_root
            .as_ref()
            .and_then(|path| detect_git_branch(path)),
    };

    let content = serde_json::to_string_pretty(&file)?;
    fs::write(&path, content).with_context(|| format!("写入对话失败: {}", path.display()))?;
    Ok(path)
}

pub fn load_chat(path_arg: &str) -> Result<LoadedChat> {
    let path = resolve_load_path(path_arg)?;
    let text = fs::read_to_string(&path)
        .with_context(|| format!("读取对话文件失败: {}", path.display()))?;
    let parsed: Value = serde_json::from_str(&text)
        .with_context(|| format!("解析对话文件失败: {}", path.display()))?;

    ensure_chat_schema_v2(&parsed)?;
    reject_legacy_conversation_fields(&parsed)?;

    let parsed: ChatFile = serde_json::from_value(parsed)
        .with_context(|| format!("解析 chat schema v2 失败: {}", path.display()))?;
    if parsed.desktop_message_timeline.is_empty() {
        return Err(anyhow!("chat schema v2 要求非空 desktopMessageTimeline"));
    }

    let desktop_messages = hydrate_desktop_messages_from_timeline(&parsed.desktop_message_timeline);
    if desktop_messages.is_empty() {
        return Err(anyhow!("chat schema v2 timeline 未还原出任何消息"));
    }
    let (messages, assistant_aux) = derive_archive_projection(&desktop_messages);

    Ok(LoadedChat {
        messages,
        assistant_aux,
        llm_history: parsed.llm_history,
        loop_enabled: parsed.loop_enabled,
        approval_level: crate::ports::normalize_approval_level(&parsed.approval_level),
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
                llm_history: entry.llm_history,
            })
            .collect(),
        desktop_messages: Some(desktop_messages),
        rewind: parsed.rewind,
        session_display_name: parsed.session_display_name,
    })
}

fn ensure_chat_schema_v2(parsed: &Value) -> Result<()> {
    match parsed.get("chatSchemaVersion").and_then(Value::as_i64) {
        Some(version) if version == CHAT_SCHEMA_VERSION as i64 => Ok(()),
        Some(version) => Err(anyhow!(
            "chat schema v2 required (chatSchemaVersion={CHAT_SCHEMA_VERSION}), got {version}"
        )),
        None => Err(anyhow!(
            "chat schema v2 required (chatSchemaVersion={CHAT_SCHEMA_VERSION}), got none"
        )),
    }
}

fn reject_legacy_conversation_fields(parsed: &Value) -> Result<()> {
    if parsed.get("messages").is_some() {
        return Err(anyhow!("chat schema v2 must not include messages"));
    }
    if parsed.get("assistantAux").is_some() {
        return Err(anyhow!("chat schema v2 must not include assistantAux"));
    }
    if parsed.get("desktopMessages").is_some() {
        return Err(anyhow!("chat schema v2 must not include desktopMessages"));
    }
    Ok(())
}

fn current_unix_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

fn build_fallback_desktop_messages(
    messages: &[(String, String)],
    assistant_aux: &[crate::ports::AssistantAuxArchiveEntry],
) -> Vec<ConversationMessageSnapshot> {
    use crate::rewind::{ConversationMessageRole, MessageAuxSnapshot};

    messages
        .iter()
        .enumerate()
        .map(|(index, (role, content))| ConversationMessageSnapshot {
            id: index + 1,
            role: if role == "user" {
                ConversationMessageRole::User
            } else {
                ConversationMessageRole::Assistant
            },
            content: content.clone(),
            tool: None,
            aux: assistant_aux
                .iter()
                .find(|entry| entry.message_index == index)
                .and_then(|entry| {
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
                        Some(MessageAuxSnapshot {
                            thinking,
                            compaction,
                        })
                    }
                }),
            pending: false,
        })
        .collect()
}

fn derive_session_display_name(messages: &[ConversationMessageSnapshot]) -> Option<String> {
    use crate::rewind::ConversationMessageRole;

    let seed = messages
        .iter()
        .find(|message| {
            message.role == ConversationMessageRole::User && !message.content.trim().is_empty()
        })?
        .content
        .trim();
    let truncated = seed.chars().take(28).collect::<String>();
    Some(if seed.chars().count() > 28 {
        format!("{}...", truncated)
    } else {
        seed.to_string()
    })
}

pub fn fallback_session_display_name(messages: &[ConversationMessageSnapshot]) -> String {
    derive_session_display_name(messages).unwrap_or_else(|| "Chat".to_string())
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
    use crate::rewind::{ConversationMessageRole, MessageAuxSnapshot};
    use serde_json::json;

    #[test]
    fn save_chat_writes_v2_schema_and_reloads() {
        let file_path = test_file_path("v2-save");
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
            finish_task_notice: None,
        }];
        let llm_history = vec![crate::ports::ArchivedLlmMessage::from_text_and_images(
            "user".to_string(),
            "hello".to_string(),
            Vec::new(),
        )];
        let desktop_messages = vec![
            ConversationMessageSnapshot {
                id: 1,
                role: ConversationMessageRole::User,
                content: "hello".to_string(),
                tool: None,
                aux: None,
                pending: false,
            },
            ConversationMessageSnapshot {
                id: 2,
                role: ConversationMessageRole::Assistant,
                content: String::new(),
                tool: None,
                aux: Some(MessageAuxSnapshot {
                    thinking: Some("reasoning".to_string()),
                    compaction: None,
                }),
                pending: false,
            },
            ConversationMessageSnapshot {
                id: 3,
                role: ConversationMessageRole::Assistant,
                content: "answer".to_string(),
                tool: None,
                aux: None,
                pending: false,
            },
        ];

        let saved = save_chat(
            Some(file_path.to_string_lossy().as_ref()),
            &messages,
            &assistant_aux,
            &llm_history,
            true,
            "default",
            &[],
            None,
            Some(&desktop_messages),
            None,
        )
        .expect("save chat");

        let raw = fs::read_to_string(&saved).expect("read saved chat");
        let parsed: Value = serde_json::from_str(&raw).expect("parse saved chat json");
        assert_eq!(parsed["chatSchemaVersion"], json!(2));
        assert!(parsed.get("messages").is_none());
        assert!(parsed.get("assistantAux").is_none());
        assert!(parsed.get("desktopMessages").is_none());
        assert!(parsed["desktopMessageTimeline"].is_array());
        assert_eq!(parsed["loopEnabled"], json!(true));

        let loaded = load_chat(saved.to_string_lossy().as_ref()).expect("reload chat");
        assert_eq!(loaded.messages.len(), 3);
        assert!(loaded.loop_enabled);
        assert_eq!(loaded.assistant_aux.len(), 1);
        assert_eq!(
            loaded
                .desktop_messages
                .as_ref()
                .expect("desktop messages loaded")
                .len(),
            3
        );

        let _ = fs::remove_file(saved);
    }

    #[test]
    fn load_chat_rejects_legacy_schema() {
        let file_path = test_file_path("legacy-schema");
        let raw = json!({
            "savedAtUnixMs": current_unix_millis(),
            "messages": [{ "role": "user", "content": "hello" }],
            "assistantAux": [],
            "llmHistory": [],
            "subagentSessions": [],
        });
        fs::write(
            &file_path,
            serde_json::to_string_pretty(&raw).expect("serialize legacy json"),
        )
        .expect("write legacy chat");

        let error = load_chat(file_path.to_string_lossy().as_ref()).expect_err("legacy load");
        assert!(error.to_string().contains("chat schema v2"));

        let _ = fs::remove_file(file_path);
    }

    #[test]
    fn load_chat_preserves_v2_tool_timeline_rows() {
        let file_path = test_file_path("v2-tool-snapshot");
        let raw = json!({
            "chatSchemaVersion": 2,
            "savedAtUnixMs": current_unix_millis(),
            "desktopMessageTimeline": [{
                "turnId": 1,
                "createdOrder": 0,
                "userRow": {
                    "rowId": "row-user",
                    "messageId": 1,
                    "turnId": 1,
                    "kind": "user",
                    "createdOrder": 0,
                    "content": "画一张图",
                    "pending": false
                },
                "segments": [{
                    "segmentId": 1,
                    "turnId": 1,
                    "kind": "initial",
                    "status": "completed",
                    "createdOrder": 1,
                    "rows": [{
                        "rowId": "row-tool",
                        "messageId": 2,
                        "turnId": 1,
                        "segmentId": 1,
                        "kind": "tool",
                        "section": "tools",
                        "createdOrder": 2,
                        "pending": false,
                        "tool": {
                            "toolName": "generate_image",
                            "phase": "succeeded",
                            "headline": "图片生成完成",
                            "detailLines": [
                                "path: C:\\\\Users\\\\pc\\\\AppData\\\\Roaming\\\\SpiritAgent\\\\generated-images\\\\demo.png"
                            ],
                            "outputExcerpt": "[generated image]",
                            "imagePaths": [
                                "C:\\\\Users\\\\pc\\\\AppData\\\\Roaming\\\\SpiritAgent\\\\generated-images\\\\demo.png"
                            ]
                        }
                    }]
                }]
            }],
            "llmHistory": [],
            "subagentSessions": []
        });
        fs::write(
            &file_path,
            serde_json::to_string_pretty(&raw).expect("serialize v2 json"),
        )
        .expect("write v2 chat");

        let loaded = load_chat(file_path.to_string_lossy().as_ref()).expect("load v2 chat");
        let desktop_messages = loaded
            .desktop_messages
            .as_ref()
            .expect("desktop tool snapshots");
        assert_eq!(desktop_messages.len(), 2);
        assert_eq!(
            desktop_messages[1]
                .tool
                .as_ref()
                .expect("tool snapshot")
                .tool_name,
            "generate_image"
        );

        let _ = fs::remove_file(file_path);
    }

    fn test_file_path(label: &str) -> PathBuf {
        let file_name = format!(
            "spirit-agent-chat-store-{}-{}.json",
            label,
            current_unix_millis()
        );
        env::temp_dir().join(file_name)
    }
}
