use crate::rewind::{
    ConversationMessageRole, ConversationMessageSnapshot, MessageAuxSnapshot, ToolBlockSnapshot,
};

pub const CHAT_SCHEMA_VERSION: i32 = 2;

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PersistedTimelineRow {
    pub row_id: String,
    pub message_id: usize,
    pub turn_id: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub segment_id: Option<u64>,
    pub kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub section: Option<String>,
    pub created_order: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,
    pub pending: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool: Option<ToolBlockSnapshot>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub aux: Option<MessageAuxSnapshot>,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PersistedTimelineSegment {
    pub segment_id: u64,
    pub turn_id: u64,
    pub kind: String,
    pub status: String,
    pub created_order: u64,
    pub rows: Vec<PersistedTimelineRow>,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PersistedTimelineTurn {
    pub turn_id: u64,
    pub created_order: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub user_row: Option<PersistedTimelineRow>,
    pub segments: Vec<PersistedTimelineSegment>,
}

pub fn normalize_desktop_messages_for_persistence(
    messages: &[ConversationMessageSnapshot],
) -> Vec<ConversationMessageSnapshot> {
    messages
        .iter()
        .filter(|message| {
            let aux = sanitize_aux(message.aux.as_ref());
            !(message.role == ConversationMessageRole::Assistant
                && message.content.trim().is_empty()
                && message.tool.is_none()
                && aux.is_none())
        })
        .map(|message| ConversationMessageSnapshot {
            id: message.id,
            role: message.role,
            content: message.content.clone(),
            tool: message.tool.clone(),
            aux: sanitize_aux(message.aux.as_ref()),
            pending: false,
        })
        .collect()
}

pub fn build_persisted_timeline(
    messages: &[ConversationMessageSnapshot],
) -> Vec<PersistedTimelineTurn> {
    let normalized = normalize_desktop_messages_for_persistence(messages);
    let mut turns = Vec::new();
    let mut current_turn: Option<PersistedTimelineTurn> = None;
    let mut current_segment: Option<PersistedTimelineSegment> = None;
    let mut next_turn_id = 1u64;
    let mut next_segment_id = 1u64;
    let mut next_row_id = 1u64;
    let mut next_created_order = 0u64;

    let push_segment = |turn: &mut PersistedTimelineTurn, segment: PersistedTimelineSegment| {
        if !segment.rows.is_empty() {
            turn.segments.push(segment);
        }
    };

    for message in normalized {
        if message.role == ConversationMessageRole::User {
            if let Some(mut turn) = current_turn.take() {
                if let Some(segment) = current_segment.take() {
                    push_segment(&mut turn, segment);
                }
                turns.push(turn);
            }
            current_turn = Some(PersistedTimelineTurn {
                turn_id: next_turn_id,
                created_order: next_created_order,
                user_row: Some(PersistedTimelineRow {
                    row_id: format!("row-{next_row_id}"),
                    message_id: message.id,
                    turn_id: next_turn_id,
                    segment_id: None,
                    kind: "user".to_string(),
                    section: None,
                    created_order: next_created_order,
                    content: Some(message.content.clone()),
                    pending: false,
                    tool: None,
                    aux: None,
                }),
                segments: Vec::new(),
            });
            next_turn_id += 1;
            next_row_id += 1;
            next_created_order += 1;
            continue;
        }

        if current_segment.is_none() {
            let turn_id = if let Some(turn) = current_turn.as_ref() {
                turn.turn_id
            } else {
                let turn = PersistedTimelineTurn {
                    turn_id: next_turn_id,
                    created_order: next_created_order,
                    user_row: None,
                    segments: Vec::new(),
                };
                next_turn_id += 1;
                next_created_order += 1;
                current_turn = Some(turn);
                current_turn.as_ref().expect("turn inserted").turn_id
            };
            current_segment = Some(PersistedTimelineSegment {
                segment_id: next_segment_id,
                turn_id,
                kind: "initial".to_string(),
                status: "completed".to_string(),
                created_order: next_created_order,
                rows: Vec::new(),
            });
            next_segment_id += 1;
            next_created_order += 1;
        }

        let turn = current_turn.as_mut().expect("assistant turn");
        let segment = current_segment.as_mut().expect("assistant segment");
        if let Some(row) =
            row_from_assistant_message(message, turn.turn_id, segment.segment_id, next_created_order, next_row_id)
        {
            segment.rows.push(row);
            next_row_id += 1;
            next_created_order += 1;
        }
    }

    if let Some(mut turn) = current_turn.take() {
        if let Some(segment) = current_segment.take() {
            push_segment(&mut turn, segment);
        }
        if turn.user_row.is_some() || !turn.segments.is_empty() {
            turns.push(turn);
        }
    }

    turns
}

fn row_from_assistant_message(
    message: ConversationMessageSnapshot,
    turn_id: u64,
    segment_id: u64,
    created_order: u64,
    row_id_num: u64,
) -> Option<PersistedTimelineRow> {
    let base = |kind: &str, section: Option<&str>| PersistedTimelineRow {
        row_id: format!("row-{row_id_num}"),
        message_id: message.id,
        turn_id,
        segment_id: Some(segment_id),
        kind: kind.to_string(),
        section: section.map(str::to_string),
        created_order,
        content: None,
        pending: false,
        tool: None,
        aux: None,
    };

    if let Some(tool) = message.tool.clone() {
        let mut row = base("tool", Some("tools"));
        row.tool = Some(tool);
        return Some(row);
    }

    let aux = sanitize_aux(message.aux.as_ref());
    if message.content.trim().is_empty() {
        if let Some(thinking) = aux.as_ref().and_then(|value| value.thinking.clone()) {
            return Some(PersistedTimelineRow {
                aux: Some(MessageAuxSnapshot {
                    thinking: Some(thinking),
                    compaction: None,
                }),
                section: Some("before-tools".to_string()),
                ..base("assistant-thinking", Some("before-tools"))
            });
        }
        if let Some(compaction) = aux.as_ref().and_then(|value| value.compaction.clone()) {
            return Some(PersistedTimelineRow {
                aux: Some(MessageAuxSnapshot {
                    thinking: None,
                    compaction: Some(compaction),
                }),
                ..base("assistant-compaction", None)
            });
        }
        return None;
    }

    Some(PersistedTimelineRow {
        content: Some(message.content),
        aux,
        section: Some("after-tools".to_string()),
        ..base("assistant-text", Some("after-tools"))
    })
}

pub fn hydrate_desktop_messages_from_timeline(
    timeline: &[PersistedTimelineTurn],
) -> Vec<ConversationMessageSnapshot> {
    let mut messages = Vec::new();
    for turn in timeline {
        if let Some(user_row) = turn.user_row.as_ref() {
            if let Some(message) = row_to_message(user_row) {
                messages.push(message);
            }
        }
        for segment in &turn.segments {
            for row in &segment.rows {
                if let Some(message) = row_to_message(row) {
                    messages.push(message);
                }
            }
        }
    }
    messages
}

fn row_to_message(row: &PersistedTimelineRow) -> Option<ConversationMessageSnapshot> {
    if row.pending {
        return None;
    }
    match row.kind.as_str() {
        "user" => {
            let content = row.content.as_deref()?.trim();
            if content.is_empty() {
                return None;
            }
            Some(ConversationMessageSnapshot {
                id: row.message_id,
                role: ConversationMessageRole::User,
                content: content.to_string(),
                tool: None,
                aux: None,
                pending: false,
            })
        }
        "assistant-text" => {
            let content = row.content.as_deref()?.trim();
            if content.is_empty() {
                return None;
            }
            Some(ConversationMessageSnapshot {
                id: row.message_id,
                role: ConversationMessageRole::Assistant,
                content: content.to_string(),
                tool: None,
                aux: sanitize_aux(row.aux.as_ref()),
                pending: false,
            })
        }
        "assistant-thinking" => Some(ConversationMessageSnapshot {
            id: row.message_id,
            role: ConversationMessageRole::Assistant,
            content: String::new(),
            tool: None,
            aux: sanitize_aux(row.aux.as_ref()),
            pending: false,
        }),
        "assistant-compaction" => Some(ConversationMessageSnapshot {
            id: row.message_id,
            role: ConversationMessageRole::Assistant,
            content: String::new(),
            tool: None,
            aux: sanitize_aux(row.aux.as_ref()),
            pending: false,
        }),
        "tool" => Some(ConversationMessageSnapshot {
            id: row.message_id,
            role: ConversationMessageRole::Assistant,
            content: String::new(),
            tool: row.tool.clone(),
            aux: None,
            pending: false,
        }),
        _ => None,
    }
}

pub fn derive_archive_projection(
    messages: &[ConversationMessageSnapshot],
) -> (Vec<(String, String)>, Vec<crate::ports::AssistantAuxArchiveEntry>) {
    let mut archive_messages = Vec::new();
    let mut assistant_aux = Vec::new();
    for message in messages {
        if message.role == ConversationMessageRole::User {
            archive_messages.push(("user".to_string(), message.content.clone()));
            continue;
        }
        if message.tool.is_some() {
            continue;
        }
        let aux = sanitize_aux(message.aux.as_ref());
        if message.content.trim().is_empty() && aux.is_none() {
            continue;
        }
        let index = archive_messages.len();
        archive_messages.push(("assistant".to_string(), message.content.clone()));
        if let Some(aux) = aux {
            assistant_aux.push(crate::ports::AssistantAuxArchiveEntry {
                message_index: index,
                thinking: aux.thinking,
                compaction: aux.compaction,
                finish_task_notice: None,
            });
        }
    }
    (archive_messages, assistant_aux)
}

fn sanitize_aux(aux: Option<&MessageAuxSnapshot>) -> Option<MessageAuxSnapshot> {
    let aux = aux?;
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::rewind::{ToolBlockSnapshotPhase};

    #[test]
    fn build_persisted_timeline_omits_empty_assistant_content_for_tool_and_thinking() {
        let messages = vec![
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
                content: String::new(),
                tool: Some(crate::rewind::ToolBlockSnapshot {
                    tool_call_id: Some("call-1".to_string()),
                    tool_name: "read_file".to_string(),
                    phase: ToolBlockSnapshotPhase::Succeeded,
                    headline: "Read".to_string(),
                    detail_lines: Vec::new(),
                    image_paths: Vec::new(),
                    video_paths: Vec::new(),
                    args_excerpt: None,
                    output_excerpt: None,
                }),
                aux: None,
                pending: false,
            },
            ConversationMessageSnapshot {
                id: 4,
                role: ConversationMessageRole::Assistant,
                content: "answer".to_string(),
                tool: None,
                aux: None,
                pending: false,
            },
        ];

        let timeline = build_persisted_timeline(&messages);
        let rows = &timeline[0].segments[0].rows;
        assert_eq!(rows.len(), 3);
        assert_eq!(rows[0].kind, "assistant-thinking");
        assert!(rows[0].content.is_none());
        assert_eq!(rows[1].kind, "tool");
        assert!(rows[1].content.is_none());
        assert_eq!(rows[2].content.as_deref(), Some("answer"));
    }
}
