use anyhow::{Context, Result, anyhow};
use serde::{Deserialize, Serialize};
use std::{
    env, fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

const CHAT_DIR_NAME: &str = "chats";

#[derive(Serialize, Deserialize)]
struct ChatFile {
    saved_at_unix_ms: u128,
    messages: Vec<StoredChatMessage>,
    #[serde(default)]
    assistant_aux: Vec<StoredAssistantAux>,
    #[serde(default)]
    assistant_thinking: Vec<StoredAssistantThinking>,
    llm_history: Vec<StoredLlmMessage>,
}

#[derive(Serialize, Deserialize)]
struct StoredChatMessage {
    role: String,
    content: String,
}

#[derive(Serialize, Deserialize)]
struct StoredAssistantThinking {
    message_index: usize,
    content: String,
}

#[derive(Serialize, Deserialize)]
struct StoredAssistantAux {
    message_index: usize,
    #[serde(default)]
    thinking: Option<String>,
    #[serde(default)]
    compaction: Option<String>,
}

#[derive(Serialize, Deserialize)]
struct StoredLlmMessage {
    role: String,
    content: String,
    #[serde(default)]
    image_paths: Vec<String>,
}

pub struct LoadedChat {
    pub messages: Vec<(String, String)>,
    pub assistant_aux: Vec<crate::ports::AssistantAuxArchiveEntry>,
    pub llm_history: Vec<(String, String, Vec<String>)>,
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
) -> Result<PathBuf> {
    let path = resolve_save_path(path_arg)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .with_context(|| format!("创建对话目录失败: {}", parent.display()))?;
    }

    let file = ChatFile {
        saved_at_unix_ms: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0),
        messages: messages
            .iter()
            .map(|(role, content)| StoredChatMessage {
                role: role.clone(),
                content: content.clone(),
            })
            .collect(),
        assistant_aux: assistant_aux
            .iter()
            .map(|entry| StoredAssistantAux {
                message_index: entry.message_index,
                thinking: entry.thinking.clone(),
                compaction: entry.compaction.clone(),
            })
            .collect(),
        assistant_thinking: assistant_aux
            .iter()
            .filter_map(|entry| {
                entry
                    .thinking
                    .as_ref()
                    .map(|thinking| StoredAssistantThinking {
                        message_index: entry.message_index,
                        content: thinking.clone(),
                    })
            })
            .collect(),
        llm_history: llm_history
            .iter()
            .map(|(role, content, image_paths)| StoredLlmMessage {
                role: role.clone(),
                content: content.clone(),
                image_paths: image_paths.clone(),
            })
            .collect(),
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

    Ok(LoadedChat {
        messages: parsed
            .messages
            .into_iter()
            .map(|m| (m.role, m.content))
            .collect(),
        assistant_aux: if parsed.assistant_aux.is_empty() {
            parsed
                .assistant_thinking
                .into_iter()
                .filter(|entry| !entry.content.trim().is_empty())
                .map(|entry| crate::ports::AssistantAuxArchiveEntry {
                    message_index: entry.message_index,
                    thinking: Some(entry.content),
                    compaction: None,
                })
                .collect()
        } else {
            parsed
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
                .collect()
        },
        llm_history: parsed
            .llm_history
            .into_iter()
            .map(|m| (m.role, m.content, m.image_paths))
            .collect(),
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
