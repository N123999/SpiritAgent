use super::*;

pub(super) fn apply_runtime_events(shell: &mut TuiShell) {
    for event in shell.runtime.drain_events() {
        match event {
            RuntimeEvent::PushMessage(msg) => shell.messages.push(msg),
            RuntimeEvent::OpenAskQuestions {
                tool_call_id,
                tool_name,
                questions,
            } => {
                shell.open_ask_questions_form(tool_call_id, tool_name, questions);
            }
            RuntimeEvent::BeginAssistantResponse => {
                let should_reanchor_persisted_subagent_status =
                    should_reanchor_persisted_subagent_status_on_begin_assistant_response(
                        shell.messages.last(),
                        shell.persisted_standalone_pending_aux.as_ref(),
                    );
                shell
                    .messages
                    .push(ChatMessage::new(MessageRole::Agent, String::new()));
                let idx = shell.messages.len() - 1;
                shell.assistant_aux_by_message.remove(&idx);
                shell.pending_assistant_msg_index = Some(idx);
                shell.last_completed_assistant_msg_index = None;
                if should_reanchor_persisted_subagent_status {
                    let previous_anchor = shell.persisted_standalone_pending_aux_anchor;
                    shell.persisted_standalone_pending_aux_anchor = Some(idx);
                    if previous_anchor != Some(idx) {
                        logging::log_event(&format!(
                            "[tui-subagent-anchor] begin-response-reanchor prev_anchor={:?} next_anchor={:?} status={}",
                            previous_anchor,
                            Some(idx),
                            shell.persisted_standalone_pending_aux
                                .as_ref()
                                .map(|aux| aux.status_text.as_str())
                                .unwrap_or("<none>"),
                        ));
                    }
                }
            }
            RuntimeEvent::UpdatePendingAssistantThinking(thinking) => {
                if let Some(idx) = shell.pending_assistant_msg_index {
                    let entry = shell.assistant_aux_by_message.entry(idx).or_default();
                    entry.thinking = if thinking.trim().is_empty() {
                        None
                    } else {
                        Some(thinking)
                    };
                    if entry.thinking.is_none() && entry.compaction.is_none() {
                        shell.assistant_aux_by_message.remove(&idx);
                    }
                }
            }
            RuntimeEvent::AssistantThinkingSegmentFinalized(thinking) => {
                if let Some(idx) = shell
                    .pending_assistant_msg_index
                    .or(shell.last_completed_assistant_msg_index)
                {
                    let entry = shell.assistant_aux_by_message.entry(idx).or_default();
                    entry.thinking = if thinking.trim().is_empty() {
                        None
                    } else {
                        Some(thinking)
                    };
                    if entry.thinking.is_none() && entry.compaction.is_none() {
                        shell.assistant_aux_by_message.remove(&idx);
                    }
                }
            }
            RuntimeEvent::UpdatePendingAssistantCompaction(compaction) => {
                if let Some(idx) = shell.pending_assistant_msg_index {
                    let entry = shell.assistant_aux_by_message.entry(idx).or_default();
                    entry.compaction = if compaction.trim().is_empty() {
                        None
                    } else {
                        Some(compaction)
                    };
                    if entry.thinking.is_none() && entry.compaction.is_none() {
                        shell.assistant_aux_by_message.remove(&idx);
                    }
                }
            }
            RuntimeEvent::AssistantChunk(chunk) => {
                if let Some(idx) = shell.pending_assistant_msg_index {
                    if let Some(msg) = shell.messages.get_mut(idx) {
                        msg.content.push_str(&chunk);
                    }
                }
            }
            RuntimeEvent::ReplacePendingAssistant(content) => {
                if let Some(idx) = shell.pending_assistant_msg_index {
                    if let Some(msg) = shell.messages.get_mut(idx) {
                        msg.content = content;
                        msg.tool_block = None;
                    }
                } else {
                    shell
                        .messages
                        .push(ChatMessage::new(MessageRole::Agent, content));
                }
            }
            RuntimeEvent::AssistantResponseCompleted => {
                shell.last_completed_assistant_msg_index = shell.pending_assistant_msg_index;
                shell.pending_assistant_msg_index = None;
            }
            RuntimeEvent::RemovePendingAssistant => {
                if let Some(idx) = shell.pending_assistant_msg_index.take() {
                    let has_persisted_aux =
                        shell.assistant_aux_by_message.get(&idx).is_some_and(|aux| {
                            aux.thinking
                                .as_ref()
                                .is_some_and(|value| !value.trim().is_empty())
                                || aux
                                    .compaction
                                    .as_ref()
                                    .is_some_and(|value| !value.trim().is_empty())
                        });
                    if !has_persisted_aux && idx < shell.messages.len() {
                        shell.adjust_persisted_standalone_pending_aux_anchor_for_removed_message(
                            idx,
                        );
                        shell.assistant_aux_by_message.remove(&idx);
                        shell.messages.remove(idx);
                    }
                }
            }
        }
    }

    shell.sync_persisted_standalone_pending_aux();
    shell.sync_subagent_approval_input_state();
}
