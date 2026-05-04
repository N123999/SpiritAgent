use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};
use uuid::Uuid;

use crate::{
    ports::{AssistantAuxArchiveEntry, ChatArchive},
    view::{AssistantAuxData, ChatMessage, MessageRole, ToolUiBlock, ToolUiPhase},
};

const REWIND_DIR_NAME: &str = "rewind";

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredDesktopRewindMetadata {
    pub session_id: String,
    pub next_sequence: u64,
    #[serde(default)]
    pub checkpoints: Vec<DesktopRewindCheckpointMetadata>,
    #[serde(default)]
    pub file_changes: Vec<DesktopRewindFileChangeMetadata>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopRewindCheckpointMetadata {
    pub id: String,
    pub message_id: usize,
    pub message_index: usize,
    pub sequence: u64,
    pub created_at_unix_ms: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopRewindFileChangeMetadata {
    pub id: String,
    pub kind: HostFileChangeKind,
    pub path: String,
    pub resolved_path: String,
    pub tool_name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_call_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub message_id: Option<usize>,
    pub sequence: u64,
    pub created_at_unix_ms: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum HostFileChangeKind {
    CreateFile,
    EditFile,
    DeleteFile,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HostFileSnapshot {
    pub exists: bool,
    pub file: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sha256: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mtime_ms: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub size: Option<u64>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HostFileChangeRequestSummary {
    pub name: HostFileChangeKind,
    pub path: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub content_chars: Option<usize>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub old_chars: Option<usize>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub new_chars: Option<usize>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HostRecordedFileChange {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    pub kind: HostFileChangeKind,
    pub path: String,
    pub resolved_path: String,
    pub tool_name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_call_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub subagent_session_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub subagent_title: Option<String>,
    pub request: HostFileChangeRequestSummary,
    pub before: HostFileSnapshot,
    pub after: HostFileSnapshot,
    pub created_at_unix_ms: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopStoredFileChange {
    pub id: String,
    pub kind: HostFileChangeKind,
    pub path: String,
    pub resolved_path: String,
    pub tool_name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_call_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub subagent_session_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub subagent_title: Option<String>,
    pub request: HostFileChangeRequestSummary,
    pub before: HostFileSnapshot,
    pub after: HostFileSnapshot,
    pub created_at_unix_ms: u64,
    pub sequence: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub message_id: Option<usize>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopRewindCheckpointSnapshot {
    pub archive: ChatArchive,
    pub desktop_messages: Vec<ConversationMessageSnapshot>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub before_archive: Option<ChatArchive>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub before_desktop_messages: Option<Vec<ConversationMessageSnapshot>>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ConversationMessageRole {
    User,
    Assistant,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationMessageSnapshot {
    pub id: usize,
    pub role: ConversationMessageRole,
    pub content: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool: Option<ToolBlockSnapshot>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub aux: Option<MessageAuxSnapshot>,
    pub pending: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageAuxSnapshot {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub thinking: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub compaction: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolBlockSnapshot {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_call_id: Option<String>,
    pub tool_name: String,
    pub phase: ToolBlockSnapshotPhase,
    pub headline: String,
    pub detail_lines: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub args_excerpt: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub output_excerpt: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ToolBlockSnapshotPhase {
    PendingApproval,
    Running,
    Succeeded,
    Failed,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct HostFileRewindWarning {
    pub change_id: Option<String>,
    pub path: String,
    pub action: HostFileChangeKind,
    pub message: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct HostFileRewindResult {
    pub restored: usize,
    pub skipped: usize,
    pub warnings: Vec<HostFileRewindWarning>,
}

#[derive(Clone, Debug)]
pub struct RewindRestoreOutcome {
    pub before_archive: ChatArchive,
    pub before_messages: Vec<ConversationMessageSnapshot>,
    pub restored: usize,
    pub skipped: usize,
    pub warnings: Vec<HostFileRewindWarning>,
}

pub fn create_desktop_rewind_metadata() -> StoredDesktopRewindMetadata {
    StoredDesktopRewindMetadata {
        session_id: fresh_id(),
        next_sequence: 1,
        checkpoints: Vec::new(),
        file_changes: Vec::new(),
    }
}

pub fn normalize_desktop_rewind_metadata(value: Option<&Value>) -> StoredDesktopRewindMetadata {
    let mut metadata = value
        .and_then(|entry| serde_json::from_value::<StoredDesktopRewindMetadata>(entry.clone()).ok())
        .unwrap_or_else(create_desktop_rewind_metadata);
    if metadata.session_id.trim().is_empty() {
        metadata.session_id = fresh_id();
    }
    metadata.checkpoints.sort_by_key(|entry| entry.sequence);
    metadata.file_changes.sort_by_key(|entry| entry.sequence);
    let largest_sequence = metadata
        .checkpoints
        .iter()
        .map(|entry| entry.sequence)
        .chain(metadata.file_changes.iter().map(|entry| entry.sequence))
        .max()
        .unwrap_or(0);
    if metadata.next_sequence <= largest_sequence {
        metadata.next_sequence = largest_sequence + 1;
    }
    metadata
}

impl StoredDesktopRewindMetadata {
    pub fn next_sequence(&mut self) -> u64 {
        let next = self.next_sequence;
        self.next_sequence += 1;
        next
    }

    pub fn checkpoint_for_message_id(
        &self,
        message_id: usize,
    ) -> Option<&DesktopRewindCheckpointMetadata> {
        self.checkpoints
            .iter()
            .find(|checkpoint| checkpoint.message_id == message_id)
    }

    pub fn can_rewind_message(&self, message_id: usize) -> bool {
        self.checkpoint_for_message_id(message_id).is_some()
    }

    pub fn upsert_checkpoint(&mut self, checkpoint: DesktopRewindCheckpointMetadata) {
        if let Some(existing) = self
            .checkpoints
            .iter()
            .position(|candidate| candidate.message_id == checkpoint.message_id)
        {
            self.checkpoints[existing] = checkpoint;
        } else {
            self.checkpoints.push(checkpoint);
        }
        self.checkpoints.sort_by_key(|entry| entry.sequence);
    }

    pub fn prune_after_checkpoint(&mut self, checkpoint_sequence: u64) {
        self.checkpoints
            .retain(|checkpoint| checkpoint.sequence < checkpoint_sequence);
        self.file_changes
            .retain(|change| change.sequence <= checkpoint_sequence);
    }

    pub fn as_json(&self) -> Value {
        serde_json::to_value(self).unwrap_or(Value::Null)
    }
}

pub fn create_rewind_checkpoint_metadata(
    message_id: usize,
    message_index: usize,
    sequence: u64,
) -> DesktopRewindCheckpointMetadata {
    DesktopRewindCheckpointMetadata {
        id: fresh_id(),
        message_id,
        message_index,
        sequence,
        created_at_unix_ms: current_unix_ms(),
    }
}

pub fn to_desktop_file_change(
    change: HostRecordedFileChange,
    sequence: u64,
) -> DesktopStoredFileChange {
    DesktopStoredFileChange {
        id: fresh_id(),
        kind: change.kind,
        path: change.path,
        resolved_path: change.resolved_path,
        tool_name: change.tool_name,
        tool_call_id: change.tool_call_id,
        subagent_session_id: change.subagent_session_id,
        subagent_title: change.subagent_title,
        request: change.request,
        before: change.before,
        after: change.after,
        created_at_unix_ms: change.created_at_unix_ms,
        sequence,
        message_id: None,
    }
}

pub fn file_change_metadata(change: &DesktopStoredFileChange) -> DesktopRewindFileChangeMetadata {
    DesktopRewindFileChangeMetadata {
        id: change.id.clone(),
        kind: change.kind.clone(),
        path: change.path.clone(),
        resolved_path: change.resolved_path.clone(),
        tool_name: change.tool_name.clone(),
        tool_call_id: change.tool_call_id.clone(),
        message_id: change.message_id,
        sequence: change.sequence,
        created_at_unix_ms: change.created_at_unix_ms,
    }
}

pub fn save_rewind_checkpoint_snapshot(
    spirit_data_dir: &Path,
    session_id: &str,
    checkpoint_id: &str,
    snapshot: &DesktopRewindCheckpointSnapshot,
) -> Result<()> {
    write_sidecar_json(&checkpoint_path(spirit_data_dir, session_id, checkpoint_id), snapshot)
}

pub fn load_rewind_checkpoint_snapshot(
    spirit_data_dir: &Path,
    session_id: &str,
    checkpoint_id: &str,
) -> Result<Option<DesktopRewindCheckpointSnapshot>> {
    read_sidecar_json(&checkpoint_path(spirit_data_dir, session_id, checkpoint_id))
}

pub fn save_rewind_file_change(
    spirit_data_dir: &Path,
    session_id: &str,
    change: &DesktopStoredFileChange,
) -> Result<()> {
    write_sidecar_json(&file_change_path(spirit_data_dir, session_id, &change.id), change)
}

pub fn load_rewind_file_change(
    spirit_data_dir: &Path,
    session_id: &str,
    change_id: &str,
) -> Result<Option<DesktopStoredFileChange>> {
    read_sidecar_json(&file_change_path(spirit_data_dir, session_id, change_id))
}

pub fn archive_before_last_user(archive: &ChatArchive) -> ChatArchive {
    let mut cloned = archive.clone();
    let message_index = find_last_index(&cloned.messages, |(role, _)| role == "user");
    let history_index = find_last_index(&cloned.llm_history, |(role, _, _)| role == "user");
    if let Some(index) = message_index {
        cloned.messages.truncate(index);
        cloned.assistant_aux.retain(|entry| entry.message_index < index);
    }
    if let Some(index) = history_index {
        cloned.llm_history.truncate(index);
    }
    cloned
}

pub fn conversation_before_last_user(
    messages: &[ConversationMessageSnapshot],
) -> Vec<ConversationMessageSnapshot> {
    if let Some(index) = find_last_index(messages, |message| {
        message.role == ConversationMessageRole::User
    }) {
        return messages[..index].to_vec();
    }
    messages.to_vec()
}

pub fn resolve_before_checkpoint_state(
    snapshot: &DesktopRewindCheckpointSnapshot,
) -> RewindRestoreOutcome {
    let before_archive = snapshot
        .before_archive
        .clone()
        .unwrap_or_else(|| archive_before_last_user(&snapshot.archive));
    let before_messages = snapshot
        .before_desktop_messages
        .clone()
        .unwrap_or_else(|| conversation_before_last_user(&snapshot.desktop_messages));
    RewindRestoreOutcome {
        before_archive,
        before_messages,
        restored: 0,
        skipped: 0,
        warnings: Vec::new(),
    }
}

pub fn conversation_snapshots(
    messages: &[ChatMessage],
    assistant_aux_by_message: &HashMap<usize, AssistantAuxData>,
    pending_assistant_msg_index: Option<usize>,
) -> Vec<ConversationMessageSnapshot> {
    messages
        .iter()
        .enumerate()
        .map(|(index, message)| ConversationMessageSnapshot {
            id: index + 1,
            role: if message.role == MessageRole::User {
                ConversationMessageRole::User
            } else {
                ConversationMessageRole::Assistant
            },
            content: message.content.clone(),
            tool: message.tool_block.as_ref().map(tool_snapshot_from_block),
            aux: assistant_aux_by_message
                .get(&index)
                .and_then(message_aux_snapshot_from_data),
            pending: pending_assistant_msg_index == Some(index),
        })
        .collect()
}

pub fn restore_conversation(
    snapshots: &[ConversationMessageSnapshot],
) -> (Vec<ChatMessage>, HashMap<usize, AssistantAuxData>) {
    let mut messages = Vec::with_capacity(snapshots.len());
    let mut assistant_aux_by_message = HashMap::new();
    for (index, snapshot) in snapshots.iter().enumerate() {
        let tool_block = snapshot.tool.as_ref().map(tool_block_from_snapshot);
        messages.push(ChatMessage {
            role: if snapshot.role == ConversationMessageRole::User {
                MessageRole::User
            } else {
                MessageRole::Agent
            },
            content: snapshot.content.clone(),
            tool_block,
        });
        if let Some(aux) = snapshot.aux.as_ref().and_then(assistant_aux_data_from_snapshot) {
            assistant_aux_by_message.insert(index, aux);
        }
    }
    (messages, assistant_aux_by_message)
}

pub fn assistant_aux_entries(
    assistant_aux_by_message: &HashMap<usize, AssistantAuxData>,
    message_count: usize,
) -> Vec<AssistantAuxArchiveEntry> {
    let mut entries = assistant_aux_by_message
        .iter()
        .filter_map(|(idx, aux)| {
            if *idx >= message_count {
                return None;
            }
            let thinking = aux
                .thinking
                .clone()
                .filter(|value| !value.trim().is_empty());
            let compaction = aux
                .compaction
                .clone()
                .filter(|value| !value.trim().is_empty());
            if thinking.is_none() && compaction.is_none() {
                None
            } else {
                Some(AssistantAuxArchiveEntry {
                    message_index: *idx,
                    thinking,
                    compaction,
                })
            }
        })
        .collect::<Vec<_>>();
    entries.sort_by_key(|entry| entry.message_index);
    entries
}

pub fn read_host_file_snapshot(resolved_path: &Path) -> Result<HostFileSnapshot> {
    if !resolved_path.exists() {
        return Ok(HostFileSnapshot {
            exists: false,
            file: false,
            content: None,
            sha256: None,
            mtime_ms: None,
            size: None,
        });
    }

    let metadata = fs::metadata(resolved_path)
        .with_context(|| format!("读取文件 metadata 失败: {}", resolved_path.display()))?;
    let modified = metadata
        .modified()
        .ok()
        .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
        .map(|value| value.as_millis() as u64);
    if !metadata.is_file() {
        return Ok(HostFileSnapshot {
            exists: true,
            file: false,
            content: None,
            sha256: None,
            mtime_ms: modified,
            size: Some(metadata.len()),
        });
    }

    let content = fs::read_to_string(resolved_path)
        .with_context(|| format!("读取文件失败: {}", resolved_path.display()))?;
    Ok(HostFileSnapshot {
        exists: true,
        file: true,
        content: Some(content),
        sha256: None,
        mtime_ms: modified,
        size: Some(metadata.len()),
    })
}

pub fn restore_host_file_changes(changes: &[DesktopStoredFileChange]) -> Result<HostFileRewindResult> {
    let mut warnings = Vec::new();
    let mut restored = 0usize;
    let mut skipped = 0usize;

    for change in changes.iter().rev() {
        match restore_host_file_change(change)? {
            Ok(()) => {
                restored += 1;
            }
            Err(warning) => {
                skipped += 1;
                warnings.push(warning);
            }
        }
    }

    Ok(HostFileRewindResult {
        restored,
        skipped,
        warnings,
    })
}

fn restore_host_file_change(
    change: &DesktopStoredFileChange,
) -> Result<std::result::Result<(), HostFileRewindWarning>> {
    match change.kind {
        HostFileChangeKind::CreateFile => restore_create_file_change(change),
        HostFileChangeKind::EditFile => restore_edit_file_change(change),
        HostFileChangeKind::DeleteFile => restore_delete_file_change(change),
    }
}

fn restore_create_file_change(
    change: &DesktopStoredFileChange,
) -> Result<std::result::Result<(), HostFileRewindWarning>> {
    let target = PathBuf::from(&change.resolved_path);
    let current = read_host_file_snapshot(&target)?;
    if !current.exists {
        return Ok(Ok(()));
    }
    if !current.file {
        return Ok(Err(skipped_warning(
            change,
            "目标路径已存在但不是文件，已跳过删除。",
        )));
    }
    if current.content == change.after.content {
        fs::remove_file(&target)
            .with_context(|| format!("删除文件失败: {}", target.display()))?;
        return Ok(Ok(()));
    }
    Ok(Err(skipped_warning(
        change,
        "文件在创建后已被修改，已跳过删除以避免覆盖用户改动。",
    )))
}

fn restore_edit_file_change(
    change: &DesktopStoredFileChange,
) -> Result<std::result::Result<(), HostFileRewindWarning>> {
    let Some(before_content) = change.before.content.as_deref() else {
        return Ok(Err(skipped_warning(change, "缺少编辑前文件快照，无法回溯。")));
    };
    if !change.before.file {
        return Ok(Err(skipped_warning(change, "缺少编辑前文件快照，无法回溯。")));
    }
    let Some(after_content) = change.after.content.as_deref() else {
        return Ok(Err(skipped_warning(change, "缺少编辑后文件快照，无法回溯。")));
    };
    if !change.after.file {
        return Ok(Err(skipped_warning(change, "缺少编辑后文件快照，无法回溯。")));
    }

    let target = PathBuf::from(&change.resolved_path);
    let current = read_host_file_snapshot(&target)?;
    let Some(current_content) = current.content.as_deref() else {
        if !current.exists {
            return Ok(Err(skipped_warning(
                change,
                "目标文件已不存在，无法应用编辑回溯。",
            )));
        }
        return Ok(Err(skipped_warning(
            change,
            "目标路径已存在但不是文件，无法应用编辑回溯。",
        )));
    };

    if current_content == before_content {
        return Ok(Ok(()));
    }
    if current_content == after_content {
        fs::write(&target, before_content)
            .with_context(|| format!("写入文件失败: {}", target.display()))?;
        return Ok(Ok(()));
    }

    let Some(hunk) = build_single_text_hunk(before_content, after_content) else {
        return Ok(Err(skipped_warning(
            change,
            "无法定位唯一编辑片段，已跳过以避免覆盖用户改动。",
        )));
    };
    if hunk.after_text.is_empty() {
        return Ok(Err(skipped_warning(
            change,
            "无法定位唯一编辑片段，已跳过以避免覆盖用户改动。",
        )));
    }

    let hits = count_substring_occurrences(current_content, &hunk.after_text);
    if hits != 1 {
        return Ok(Err(skipped_warning(
            change,
            format!("编辑片段当前命中 {} 处，已跳过以避免覆盖用户改动。", hits),
        )));
    }

    fs::write(&target, current_content.replacen(&hunk.after_text, &hunk.before_text, 1))
        .with_context(|| format!("写入文件失败: {}", target.display()))?;
    Ok(Ok(()))
}

fn restore_delete_file_change(
    change: &DesktopStoredFileChange,
) -> Result<std::result::Result<(), HostFileRewindWarning>> {
    let Some(before_content) = change.before.content.as_deref() else {
        return Ok(Err(skipped_warning(change, "缺少删除前文件快照，无法重建文件。")));
    };
    if !change.before.file {
        return Ok(Err(skipped_warning(change, "缺少删除前文件快照，无法重建文件。")));
    }

    let target = PathBuf::from(&change.resolved_path);
    let current = read_host_file_snapshot(&target)?;
    if current.exists {
        return Ok(Err(skipped_warning(
            change,
            "目标路径已重新存在，已跳过重建以避免覆盖用户改动。",
        )));
    }

    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent)
            .with_context(|| format!("创建目录失败: {}", parent.display()))?;
    }
    fs::write(&target, before_content)
        .with_context(|| format!("写入文件失败: {}", target.display()))?;
    Ok(Ok(()))
}

fn skipped_warning(change: &DesktopStoredFileChange, message: impl Into<String>) -> HostFileRewindWarning {
    HostFileRewindWarning {
        change_id: Some(change.id.clone()),
        path: change.resolved_path.clone(),
        action: change.kind.clone(),
        message: message.into(),
    }
}

fn message_aux_snapshot_from_data(aux: &AssistantAuxData) -> Option<MessageAuxSnapshot> {
    let thinking = aux
        .thinking
        .clone()
        .filter(|value| !value.trim().is_empty());
    let compaction = aux
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
}

fn assistant_aux_data_from_snapshot(snapshot: &MessageAuxSnapshot) -> Option<AssistantAuxData> {
    let thinking = snapshot
        .thinking
        .clone()
        .filter(|value| !value.trim().is_empty());
    let compaction = snapshot
        .compaction
        .clone()
        .filter(|value| !value.trim().is_empty());
    if thinking.is_none() && compaction.is_none() {
        None
    } else {
        Some(AssistantAuxData {
            thinking,
            compaction,
        })
    }
}

fn tool_snapshot_from_block(block: &ToolUiBlock) -> ToolBlockSnapshot {
    ToolBlockSnapshot {
        tool_call_id: block.tool_call_id.clone(),
        tool_name: block.tool_name.clone(),
        phase: match block.phase {
            ToolUiPhase::PendingApproval => ToolBlockSnapshotPhase::PendingApproval,
            ToolUiPhase::Running => ToolBlockSnapshotPhase::Running,
            ToolUiPhase::Succeeded => ToolBlockSnapshotPhase::Succeeded,
            ToolUiPhase::Failed => ToolBlockSnapshotPhase::Failed,
        },
        headline: block.headline.clone(),
        detail_lines: block.detail_lines.clone(),
        args_excerpt: block.args_excerpt.clone(),
        output_excerpt: block.output_excerpt.clone(),
    }
}

fn tool_block_from_snapshot(snapshot: &ToolBlockSnapshot) -> ToolUiBlock {
    ToolUiBlock {
        tool_call_id: snapshot.tool_call_id.clone(),
        tool_name: snapshot.tool_name.clone(),
        phase: match snapshot.phase {
            ToolBlockSnapshotPhase::PendingApproval => ToolUiPhase::PendingApproval,
            ToolBlockSnapshotPhase::Running => ToolUiPhase::Running,
            ToolBlockSnapshotPhase::Succeeded => ToolUiPhase::Succeeded,
            ToolBlockSnapshotPhase::Failed => ToolUiPhase::Failed,
        },
        headline: snapshot.headline.clone(),
        detail_lines: snapshot.detail_lines.clone(),
        args_excerpt: snapshot.args_excerpt.clone(),
        output_excerpt: snapshot.output_excerpt.clone(),
    }
}

fn checkpoint_path(spirit_data_dir: &Path, session_id: &str, checkpoint_id: &str) -> PathBuf {
    session_rewind_dir(spirit_data_dir, session_id)
        .join("checkpoints")
        .join(format!("{}.json", safe_name(checkpoint_id)))
}

fn file_change_path(spirit_data_dir: &Path, session_id: &str, change_id: &str) -> PathBuf {
    session_rewind_dir(spirit_data_dir, session_id)
        .join("file-changes")
        .join(format!("{}.json", safe_name(change_id)))
}

fn session_rewind_dir(spirit_data_dir: &Path, session_id: &str) -> PathBuf {
    spirit_data_dir.join(REWIND_DIR_NAME).join(safe_name(session_id))
}

fn write_sidecar_json(path: &Path, value: &impl Serialize) -> Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .with_context(|| format!("创建回溯目录失败: {}", parent.display()))?;
    }
    let content = serde_json::to_string_pretty(value)?;
    fs::write(path, format!("{}\n", content))
        .with_context(|| format!("写入回溯 sidecar 失败: {}", path.display()))
}

fn read_sidecar_json<T>(path: &Path) -> Result<Option<T>>
where
    T: for<'de> Deserialize<'de>,
{
    if !path.exists() {
        return Ok(None);
    }
    let text = fs::read_to_string(path)
        .with_context(|| format!("读取回溯 sidecar 失败: {}", path.display()))?;
    let value = serde_json::from_str(&text)
        .with_context(|| format!("解析回溯 sidecar 失败: {}", path.display()))?;
    Ok(Some(value))
}

fn build_single_text_hunk(before: &str, after: &str) -> Option<TextHunk> {
    if before == after {
        return Some(TextHunk {
            before_text: String::new(),
            after_text: String::new(),
        });
    }

    let before_chars = before.chars().collect::<Vec<_>>();
    let after_chars = after.chars().collect::<Vec<_>>();
    let mut prefix = 0usize;
    while prefix < before_chars.len()
        && prefix < after_chars.len()
        && before_chars[prefix] == after_chars[prefix]
    {
        prefix += 1;
    }

    let mut before_end = before_chars.len();
    let mut after_end = after_chars.len();
    while before_end > prefix
        && after_end > prefix
        && before_chars[before_end - 1] == after_chars[after_end - 1]
    {
        before_end -= 1;
        after_end -= 1;
    }

    Some(TextHunk {
        before_text: before_chars[prefix..before_end].iter().collect(),
        after_text: after_chars[prefix..after_end].iter().collect(),
    })
}

fn count_substring_occurrences(source: &str, needle: &str) -> usize {
    if needle.is_empty() {
        return 0;
    }
    source.match_indices(needle).count()
}

fn fresh_id() -> String {
    Uuid::new_v4().to_string()
}

fn current_unix_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_millis() as u64)
        .unwrap_or(0)
}

fn safe_name(value: &str) -> String {
    value
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || matches!(ch, '.' | '_' | '-') {
                ch
            } else {
                '_'
            }
        })
        .collect()
}

fn find_last_index<T>(items: &[T], predicate: impl Fn(&T) -> bool) -> Option<usize> {
    (0..items.len()).rev().find(|index| predicate(&items[*index]))
}

#[derive(Clone, Debug)]
struct TextHunk {
    before_text: String,
    after_text: String,
}

#[cfg(test)]
mod tests {
    use super::{
        DesktopStoredFileChange, HostFileChangeKind, HostFileChangeRequestSummary,
        HostFileSnapshot, StoredDesktopRewindMetadata, create_desktop_rewind_metadata,
        normalize_desktop_rewind_metadata, restore_host_file_changes,
    };
    use serde_json::json;
    use std::{env, fs, path::PathBuf};
    use uuid::Uuid;

    #[test]
    fn normalize_desktop_rewind_metadata_advances_next_sequence() {
        let metadata = normalize_desktop_rewind_metadata(Some(&json!({
            "sessionId": "session-1",
            "nextSequence": 1,
            "checkpoints": [
                {
                    "id": "cp-1",
                    "messageId": 1,
                    "messageIndex": 0,
                    "sequence": 3,
                    "createdAtUnixMs": 1
                }
            ],
            "fileChanges": [
                {
                    "id": "fc-1",
                    "kind": "edit_file",
                    "path": "a.txt",
                    "resolvedPath": "C:/tmp/a.txt",
                    "toolName": "edit_file",
                    "sequence": 4,
                    "createdAtUnixMs": 2
                }
            ]
        })));

        assert_eq!(metadata.next_sequence, 5);
    }

    #[test]
    fn restore_host_file_changes_reverts_edit_when_current_matches_after() {
        let temp_dir = env::temp_dir().join(format!("spirit-rewind-test-{}", Uuid::new_v4()));
        fs::create_dir_all(&temp_dir).unwrap();
        let file_path = temp_dir.join("note.txt");
        fs::write(&file_path, "after").unwrap();

        let change = DesktopStoredFileChange {
            id: "change-1".to_string(),
            kind: HostFileChangeKind::EditFile,
            path: "note.txt".to_string(),
            resolved_path: file_path.to_string_lossy().to_string(),
            tool_name: "edit_file".to_string(),
            tool_call_id: None,
            subagent_session_id: None,
            subagent_title: None,
            request: HostFileChangeRequestSummary {
                name: HostFileChangeKind::EditFile,
                path: "note.txt".to_string(),
                content_chars: None,
                old_chars: Some(6),
                new_chars: Some(5),
            },
            before: HostFileSnapshot {
                exists: true,
                file: true,
                content: Some("before".to_string()),
                sha256: None,
                mtime_ms: None,
                size: Some(6),
            },
            after: HostFileSnapshot {
                exists: true,
                file: true,
                content: Some("after".to_string()),
                sha256: None,
                mtime_ms: None,
                size: Some(5),
            },
            created_at_unix_ms: 1,
            sequence: 1,
            message_id: None,
        };

        let result = restore_host_file_changes(&[change]).unwrap();
        let content = fs::read_to_string(&file_path).unwrap();

        assert_eq!(result.restored, 1);
        assert_eq!(result.skipped, 0);
        assert_eq!(content, "before");

        let _ = fs::remove_file(&file_path);
        let _ = fs::remove_dir_all(PathBuf::from(&temp_dir));
    }

    #[test]
    fn create_desktop_rewind_metadata_starts_empty() {
        let metadata: StoredDesktopRewindMetadata = create_desktop_rewind_metadata();

        assert!(metadata.checkpoints.is_empty());
        assert!(metadata.file_changes.is_empty());
        assert_eq!(metadata.next_sequence, 1);
        assert!(!metadata.session_id.trim().is_empty());
    }
}