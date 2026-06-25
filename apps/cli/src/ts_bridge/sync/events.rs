use crate::{
    host_runtime::{
        RuntimeEvent, build_tool_result_block, format_tool_ui_message, tool_approval_block,
        tool_failed_block,
    },
    ts_bridge::{
        tool_ui::{tool_request_from_host_value, tool_request_from_streaming_preview},
        types::bridge::BridgeRuntimeEvent,
        TsBridgeRuntime,
    },
    view::{ChatMessage, MessageRole},
};

impl TsBridgeRuntime {
    pub(crate) fn apply_bridge_events(&mut self, events: Vec<BridgeRuntimeEvent>) {
        for event in events {
            match event {
                BridgeRuntimeEvent::BeginAssistantResponse => {
                    self.pending_assistant_has_output = false;
                    self.events.push_back(RuntimeEvent::BeginAssistantResponse);
                }
                BridgeRuntimeEvent::UpdatePendingAssistantThinking { text } => {
                    self.events
                        .push_back(RuntimeEvent::UpdatePendingAssistantThinking(text));
                }
                BridgeRuntimeEvent::AssistantThinkingSegmentFinalized { text } => {
                    self.events
                        .push_back(RuntimeEvent::AssistantThinkingSegmentFinalized(text));
                }
                BridgeRuntimeEvent::UpdatePendingAssistantCompaction { text } => {
                    self.events
                        .push_back(RuntimeEvent::UpdatePendingAssistantCompaction(text));
                }
                BridgeRuntimeEvent::AssistantChunk { text } => {
                    self.pending_assistant_has_output = true;
                    self.events.push_back(RuntimeEvent::AssistantChunk(text));
                }
                BridgeRuntimeEvent::ReplacePendingAssistant { text } => {
                    self.pending_assistant_has_output = !text.trim().is_empty();
                    self.events
                        .push_back(RuntimeEvent::ReplacePendingAssistant(text));
                }
                BridgeRuntimeEvent::AssistantResponseCompleted => {
                    self.pending_assistant_has_output = false;
                    self.events
                        .push_back(RuntimeEvent::AssistantResponseCompleted);
                }
                BridgeRuntimeEvent::RemovePendingAssistant => {
                    self.pending_assistant_has_output = false;
                    self.events.push_back(RuntimeEvent::RemovePendingAssistant);
                }
                BridgeRuntimeEvent::ApprovalRequested { approval } => {
                    if let Some(session_id) = approval.subagent_session_id.as_deref() {
                        match tool_request_from_host_value(approval.request.clone()) {
                            Ok(_) => self.push_subagent_live_message(
                                session_id,
                                ChatMessage::with_tool_block(
                                    MessageRole::Agent,
                                    approval.prompt.clone(),
                                    tool_approval_block(
                                        &approval.tool_name,
                                        approval.tool_call_id.as_deref(),
                                        &approval.prompt,
                                        approval.trust_target.is_some(),
                                    ),
                                ),
                            ),
                            Err(err) => self.push_subagent_live_message(
                                session_id,
                                ChatMessage::new(
                                    MessageRole::Agent,
                                    format!(
                                        "待确认工具调用（解析失败）: {}\n{}",
                                        err, approval.prompt
                                    ),
                                ),
                            ),
                        }
                    } else {
                        self.events.push_back(RuntimeEvent::PushMessage(
                            ChatMessage::with_tool_block(
                                MessageRole::Agent,
                                approval.prompt.clone(),
                                tool_approval_block(
                                    &approval.tool_name,
                                    approval.tool_call_id.as_deref(),
                                    &approval.prompt,
                                    approval.trust_target.is_some(),
                                ),
                            ),
                        ));
                    }
                }
                BridgeRuntimeEvent::QuestionsRequested { questions } => {
                    self.events.push_back(RuntimeEvent::OpenAskQuestions {
                        tool_call_id: questions.tool_call_id,
                        tool_name: questions.tool_name,
                        questions: questions.questions,
                    });
                }
                BridgeRuntimeEvent::ToolCallStarted { .. } => {}
                BridgeRuntimeEvent::StreamingToolPreview {
                    tool_call_id,
                    tool_name,
                    arguments_json,
                } => {
                    let request =
                        tool_request_from_streaming_preview(&tool_name, &arguments_json);
                    self.events.push_back(RuntimeEvent::UpsertToolPreview {
                        tool_call_id,
                        tool_name,
                        arguments: request.arguments,
                    });
                }
                BridgeRuntimeEvent::ApprovalResolved { .. } => {}
                BridgeRuntimeEvent::HistoryCompacted {
                    dropped_messages,
                    summary_preview,
                } => {
                    let summary = summary_preview.unwrap_or_else(|| "<无摘要内容>".to_string());
                    self.events.push_back(RuntimeEvent::PushMessage(ChatMessage::new(
                        MessageRole::Agent,
                        format!(
                            "检测到上下文超限，已调用模型生成/更新压缩摘要并重试（本轮合并 {} 条历史消息）。\n\n压缩摘要预览:\n{}",
                            dropped_messages, summary
                        ),
                    )));
                }
                BridgeRuntimeEvent::BackgroundToolStatus { .. } => {}
                BridgeRuntimeEvent::ContextUsageUpdated { .. } => {}
                // TODO(cli): project tool-execution-output-chunk into TUI shell tool cards.
                BridgeRuntimeEvent::ToolExecutionOutputChunk { .. } => {}
                BridgeRuntimeEvent::ToolExecutionFinished { execution } => {
                    if execution.tool_name.starts_with("todo_") {
                        continue;
                    }
                    match tool_request_from_host_value(execution.request) {
                        Ok(request) => {
                            self.events.push_back(RuntimeEvent::PushMessage(
                                ChatMessage::with_tool_block(
                                    MessageRole::Agent,
                                    if execution.failed {
                                        format!("工具执行失败: {}", execution.output)
                                    } else {
                                        format_tool_ui_message(
                                            &request,
                                            &execution.tool_name,
                                            &execution.output,
                                        )
                                    },
                                    if execution.failed {
                                        tool_failed_block(
                                            &execution.tool_name,
                                            Some(execution.tool_call_id.as_str()),
                                            "工具执行失败",
                                            &execution.output,
                                        )
                                    } else {
                                        build_tool_result_block(
                                            &request,
                                            &execution.tool_name,
                                            Some(execution.tool_call_id.as_str()),
                                            &execution.output,
                                        )
                                    },
                                ),
                            ));
                        }
                        Err(err) => {
                            self.events.push_back(RuntimeEvent::PushMessage(
                                ChatMessage::with_tool_block(
                                    MessageRole::Agent,
                                    if execution.failed {
                                        format!(
                                            "工具执行失败（请求解析失败）: {}",
                                            execution.output
                                        )
                                    } else {
                                        format!(
                                            "工具执行完成（请求解析失败）: {}\n{}",
                                            err, execution.output
                                        )
                                    },
                                    if execution.failed {
                                        tool_failed_block(
                                            &execution.tool_name,
                                            Some(execution.tool_call_id.as_str()),
                                            "工具执行失败",
                                            &execution.output,
                                        )
                                    } else {
                                        tool_failed_block(
                                            &execution.tool_name,
                                            Some(execution.tool_call_id.as_str()),
                                            "工具执行完成但请求解析失败",
                                            &err.to_string(),
                                        )
                                    },
                                ),
                            ));
                        }
                    }
                }
            }
        }
    }
}
