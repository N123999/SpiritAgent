use anyhow::Result;
use serde_json::Value;

use crate::{
    host_runtime::{
        RuntimeEvent, ToolUiRequest, build_tool_result_block, format_tool_ui_message,
        tool_failed_block,
    },
    logging,
    ts_bridge::{
        tool_ui::tool_request_from_host_value,
        types::bridge::{
            BridgeManualToolCommandStartResult, LocalMcpToolFailedEvent, LocalMcpToolResultEvent,
        },
        TsBridgeRuntime,
    },
    view::{ChatMessage, MessageRole},
};

impl TsBridgeRuntime {
    pub(crate) fn push_local_mcp_tool_result(&mut self, event: LocalMcpToolResultEvent) {
        let request = crate::ts_bridge::tool_ui::tool_request_from_local_mcp(&event.request);
        if let Some(session_id) = event.subagent_session_id.as_deref() {
            self.push_subagent_tool_result(
                session_id,
                &request,
                &event.tool_name,
                event.tool_call_id.as_deref(),
                &event.output,
            );
            return;
        }

        self.events
            .push_back(RuntimeEvent::PushMessage(ChatMessage::with_tool_block(
                MessageRole::Agent,
                format_tool_ui_message(&request, &event.tool_name, &event.output),
                build_tool_result_block(
                    &request,
                    &event.tool_name,
                    event.tool_call_id.as_deref(),
                    &event.output,
                ),
            )));
    }

    pub(crate) fn push_local_mcp_tool_failure(&mut self, event: LocalMcpToolFailedEvent) {
        if let Some(session_id) = event.subagent_session_id.as_deref() {
            self.push_subagent_tool_failure(
                session_id,
                &event.tool_name,
                event.tool_call_id.as_deref(),
                &event.error,
            );
            return;
        }

        self.events
            .push_back(RuntimeEvent::PushMessage(ChatMessage::with_tool_block(
                MessageRole::Agent,
                format!("工具执行失败: {}", event.error),
                tool_failed_block(
                    &event.tool_name,
                    event.tool_call_id.as_deref(),
                    "工具执行失败",
                    &event.error,
                ),
            )));
    }

    pub(crate) fn push_subagent_live_message(&mut self, session_id: &str, message: ChatMessage) {
        self.subagent_message_cache
            .entry(session_id.to_string())
            .or_default()
            .push(message);
    }

    fn push_subagent_tool_result(
        &mut self,
        session_id: &str,
        request: &ToolUiRequest,
        tool_name: &str,
        tool_call_id: Option<&str>,
        output: &str,
    ) {
        self.push_subagent_live_message(
            session_id,
            ChatMessage::with_tool_block(
                MessageRole::Agent,
                format_tool_ui_message(request, tool_name, output),
                build_tool_result_block(request, tool_name, tool_call_id, output),
            ),
        );
    }

    fn push_subagent_tool_failure(
        &mut self,
        session_id: &str,
        tool_name: &str,
        tool_call_id: Option<&str>,
        error: &str,
    ) {
        self.push_subagent_live_message(
            session_id,
            ChatMessage::with_tool_block(
                MessageRole::Agent,
                format!("工具执行失败: {}", error),
                tool_failed_block(tool_name, tool_call_id, "工具执行失败", error),
            ),
        );
    }

    pub(crate) fn handle_manual_tool_command_bridge_response(&mut self, value: &Value) -> Result<()> {
        let Some(result_value) = value.get("result").cloned() else {
            return Ok(());
        };

        let result: BridgeManualToolCommandStartResult = serde_json::from_value(result_value)?;
        self.handle_manual_tool_command_result(result);
        Ok(())
    }

    pub(crate) fn handle_manual_tool_command_result(&mut self, result: BridgeManualToolCommandStartResult) {
        match result {
            BridgeManualToolCommandStartResult::Completed {
                request,
                tool_name,
                output,
                failed,
                background_execution: _,
            } => self.push_manual_tool_command_message(request, &tool_name, &output, failed),
            BridgeManualToolCommandStartResult::StartedBackground {
                request: _,
                tool_name: _,
                status_text: _,
            }
            | BridgeManualToolCommandStartResult::StartedUserTurn { user_message: _ }
            | BridgeManualToolCommandStartResult::RequiresApproval { approval: _ } => {}
            BridgeManualToolCommandStartResult::Denied {
                request: _,
                tool_name: _,
                message,
            } => {
                self.events
                    .push_back(RuntimeEvent::PushMessage(ChatMessage::new(
                        MessageRole::Agent,
                        message,
                    )));
            }
            BridgeManualToolCommandStartResult::Failed { error, request } => {
                self.push_manual_tool_command_failure(request, &error);
            }
        }
    }

    fn push_manual_tool_command_message(
        &mut self,
        request: Value,
        tool_name: &str,
        output: &str,
        failed: bool,
    ) {
        match tool_request_from_host_value(request) {
            Ok(request) => {
                self.events
                    .push_back(RuntimeEvent::PushMessage(ChatMessage::with_tool_block(
                        MessageRole::Agent,
                        if failed {
                            format!("工具执行失败: {}", output)
                        } else {
                            format_tool_ui_message(&request, tool_name, output)
                        },
                        if failed {
                            tool_failed_block(tool_name, None, "工具执行失败", output)
                        } else {
                            build_tool_result_block(&request, tool_name, None, output)
                        },
                    )));
            }
            Err(err) => {
                self.events
                    .push_back(RuntimeEvent::PushMessage(ChatMessage::new(
                        MessageRole::Agent,
                        if failed {
                            format!("工具执行失败（请求解析失败）: {}", output)
                        } else {
                            format!("工具执行完成（请求解析失败）: {}\n{}", err, output)
                        },
                    )));
            }
        }
    }

    fn push_manual_tool_command_failure(&mut self, request: Option<Value>, error: &str) {
        if let Some(request) = request
            && let Ok(request) = tool_request_from_host_value(request)
        {
            self.events
                .push_back(RuntimeEvent::PushMessage(ChatMessage::with_tool_block(
                    MessageRole::Agent,
                    format!("工具执行失败: {}", error),
                    tool_failed_block(&request.name, None, "工具执行失败", error),
                )));
            return;
        }

        self.events
            .push_back(RuntimeEvent::PushMessage(ChatMessage::new(
                MessageRole::Agent,
                format!("工具执行失败: {}", error),
            )));
    }

    pub(crate) fn handle_bridge_error(&mut self, err: anyhow::Error) {
        let mut summary = err.to_string();
        let fatal = !summary.starts_with("runtime-error: ");
        if let Some(stripped) = summary.strip_prefix("runtime-error: ") {
            summary = stripped.to_string();
        }

        if fatal && self.bridge_failed {
            logging::log_event(&format!(
                "[ts-bridge-host] suppress repeated fatal error: {}",
                summary
            ));
            return;
        }

        if fatal {
            self.bridge_failed = true;
        }
        logging::log_event(&format!(
            "[ts-bridge-host] {}: {}",
            if fatal {
                "fatal error"
            } else {
                "runtime error"
            },
            summary
        ));
        let had_inflight_response = self.is_busy_cache || self.pending_aux_state.is_some();
        let had_pending_output = self.pending_assistant_has_output;
        self.is_busy_cache = false;
        self.pending_aux_state = None;
        self.pending_approval_kind = None;
        self.pending_assistant_has_output = false;
        self.session.clear_pending_user_turn();
        if had_inflight_response {
            self.events.push_back(if had_pending_output {
                RuntimeEvent::AssistantResponseCompleted
            } else {
                RuntimeEvent::RemovePendingAssistant
            });
        }
        self.events
            .push_back(RuntimeEvent::PushMessage(ChatMessage::new(
                MessageRole::Agent,
                if fatal {
                    format!("TS runtime bridge 失败: {}", summary)
                } else {
                    format!("TS runtime 执行失败: {}", summary)
                },
            )));
        self.flush_deferred_transport_replace();
    }
}
