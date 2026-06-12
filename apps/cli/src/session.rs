use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::{
    llm_types::{LlmMessage, LlmToolCall},
    ports::{ArchivedLlmMessage, ArchivedLlmToolCall, AssistantAuxArchiveEntry, ChatArchive},
};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingMcpResource {
    pub server: String,
    pub display_name: String,
    pub uri: String,
    pub mime_type: Option<String>,
    pub read_at_unix_ms: u128,
    pub content: String,
}

impl PendingMcpResource {
    pub fn new(
        server: String,
        display_name: String,
        uri: String,
        mime_type: Option<String>,
        content: String,
    ) -> Self {
        Self {
            server,
            display_name,
            uri,
            mime_type,
            read_at_unix_ms: SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|d| d.as_millis())
                .unwrap_or(0),
            content,
        }
    }

    pub fn short_label(&self) -> String {
        format!("{} -> {}", self.server, self.uri)
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingWorkspaceFile {
    pub path: String,
    pub attached_at_unix_ms: u128,
    pub total_chars: usize,
    pub truncated: bool,
    pub content: String,
}

impl PendingWorkspaceFile {
    pub fn new(path: String, total_chars: usize, truncated: bool, content: String) -> Self {
        Self {
            path,
            attached_at_unix_ms: SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|d| d.as_millis())
                .unwrap_or(0),
            total_chars,
            truncated,
            content,
        }
    }

    pub fn short_label(&self) -> String {
        self.path.clone()
    }
}

pub struct SessionModel {
    llm_history: Vec<LlmMessage>,
    llm_api_trace: Vec<Value>,
    pending_user_turn: Option<String>,
    pending_image_paths: Vec<String>,
    pending_mcp_resources: Vec<PendingMcpResource>,
    loop_enabled: bool,
    approval_level: String,
}

impl Default for SessionModel {
    fn default() -> Self {
        Self {
            llm_history: Vec::new(),
            llm_api_trace: Vec::new(),
            pending_user_turn: None,
            pending_image_paths: Vec::new(),
            pending_mcp_resources: Vec::new(),
            loop_enabled: false,
            approval_level: "default".to_string(),
        }
    }
}

impl SessionModel {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn clear(&mut self) {
        self.llm_history.clear();
        self.llm_api_trace.clear();
        self.pending_user_turn = None;
        self.pending_image_paths.clear();
        self.pending_mcp_resources.clear();
        self.loop_enabled = false;
        self.approval_level = "default".to_string();
    }

    pub fn llm_history(&self) -> &[LlmMessage] {
        &self.llm_history
    }

    pub fn llm_history_mut(&mut self) -> &mut Vec<LlmMessage> {
        &mut self.llm_history
    }

    pub fn llm_api_trace(&self) -> &[Value] {
        &self.llm_api_trace
    }

    pub fn append_api_trace(&mut self, trace: &mut Vec<Value>) {
        self.llm_api_trace.append(trace);
    }

    pub fn clear_api_trace(&mut self) {
        self.llm_api_trace.clear();
    }

    pub fn pending_user_turn(&self) -> Option<&str> {
        self.pending_user_turn.as_deref()
    }

    pub fn set_pending_user_turn(&mut self, text: String) {
        self.pending_user_turn = Some(text);
    }

    pub fn clear_pending_user_turn(&mut self) {
        self.pending_user_turn = None;
    }

    pub fn pending_image_paths(&self) -> &[String] {
        &self.pending_image_paths
    }

    pub fn pending_mcp_resources(&self) -> &[PendingMcpResource] {
        &self.pending_mcp_resources
    }

    pub fn loop_enabled(&self) -> bool {
        self.loop_enabled
    }

    pub fn set_loop_enabled(&mut self, enabled: bool) {
        self.loop_enabled = enabled;
    }

    pub fn approval_level(&self) -> &str {
        &self.approval_level
    }

    pub fn set_approval_level(&mut self, approval_level: &str) {
        self.approval_level = crate::ports::normalize_approval_level(approval_level);
    }

    pub fn add_pending_image(&mut self, path: String) {
        self.pending_image_paths.push(path);
    }

    pub fn clear_pending_images(&mut self) -> usize {
        let cleared = self.pending_image_paths.len();
        self.pending_image_paths.clear();
        cleared
    }

    pub fn take_pending_images(&mut self) -> Vec<String> {
        std::mem::take(&mut self.pending_image_paths)
    }

    pub fn add_pending_mcp_resource(&mut self, resource: PendingMcpResource) {
        self.pending_mcp_resources.push(resource);
    }

    pub fn clear_pending_mcp_resources(&mut self) -> usize {
        let cleared = self.pending_mcp_resources.len();
        self.pending_mcp_resources.clear();
        cleared
    }

    pub fn take_pending_mcp_resources(&mut self) -> Vec<PendingMcpResource> {
        std::mem::take(&mut self.pending_mcp_resources)
    }

    pub fn record_context_message(&mut self, role: &'static str, content: String) {
        self.llm_history.push(LlmMessage {
            role,
            content,
            image_paths: vec![],
            tool_call_id: None,
            tool_calls: None,
            provider_state: None,
        });
    }

    pub fn record_user_turn(&mut self, text: String, images: Vec<String>) {
        self.llm_history.push(LlmMessage {
            role: "user",
            content: text,
            image_paths: images,
            tool_call_id: None,
            tool_calls: None,
            provider_state: None,
        });
    }

    pub fn record_assistant_turn(&mut self, text: String) {
        self.llm_history.push(LlmMessage {
            role: "assistant",
            content: text,
            image_paths: vec![],
            tool_call_id: None,
            tool_calls: None,
            provider_state: None,
        });
    }

    pub fn replace_from_archive(&mut self, archive: &ChatArchive) {
        self.llm_history = archive
            .llm_history
            .iter()
            .map(|message| LlmMessage {
                role: if message.role == "assistant" {
                    "assistant"
                } else if message.role == "system" {
                    "system"
                } else if message.role == "tool" {
                    "tool"
                } else {
                    "user"
                },
                content: message.text_content(),
                image_paths: message.image_paths(),
                tool_call_id: message.tool_call_id.clone(),
                tool_calls: message.tool_calls.as_ref().map(|tool_calls| {
                    tool_calls
                        .iter()
                        .map(|tool_call| LlmToolCall {
                            id: tool_call.id.clone(),
                            name: tool_call.name.clone(),
                            arguments_json: tool_call.arguments_json.clone(),
                        })
                        .collect()
                }),
                provider_state: message.provider_state.clone(),
            })
            .collect();
        self.llm_api_trace.clear();
        self.pending_user_turn = None;
        self.pending_image_paths.clear();
        self.pending_mcp_resources.clear();
        self.loop_enabled = archive.loop_enabled;
        self.approval_level = crate::ports::normalize_approval_level(&archive.approval_level);
    }

    pub fn to_archive(
        &self,
        messages: &[(String, String)],
        assistant_aux: &[AssistantAuxArchiveEntry],
    ) -> ChatArchive {
        ChatArchive {
            messages: messages.to_vec(),
            assistant_aux: assistant_aux.to_vec(),
            llm_history: self
                .llm_history
                .iter()
                .map(|message| {
                    ArchivedLlmMessage::from_text_and_images(
                        message.role.to_string(),
                        message.content.clone(),
                        message.image_paths.clone(),
                    )
                    .with_tool_call_id(message.tool_call_id.clone())
                    .with_tool_calls(message.tool_calls.as_ref().map(|tool_calls| {
                        tool_calls
                            .iter()
                            .map(|tool_call| ArchivedLlmToolCall {
                                id: tool_call.id.clone(),
                                name: tool_call.name.clone(),
                                arguments_json: tool_call.arguments_json.clone(),
                            })
                            .collect()
                    }))
                    .with_provider_state(message.provider_state.clone())
                })
                .collect(),
            loop_enabled: self.loop_enabled,
            approval_level: self.approval_level.clone(),
            subagent_sessions: Vec::new(),
            desktop_messages: None,
            rewind: None,
            session_display_name: None,
        }
    }
}
