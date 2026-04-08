use serde_json::Value;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::{
    llm_client::LlmMessage,
    ports::{AssistantAuxArchiveEntry, ChatArchive},
    tool_runtime::ToolRequest,
};

const TOOL_MEMORY_PREFIX: &str = "[TOOL_MEMORY]";
const TOOL_MEMORY_MAX_ENTRIES: usize = 24;
const TOOL_MEMORY_SNIPPET_CHARS: usize = 1200;

#[derive(Clone, Debug)]
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

#[derive(Default)]
pub struct SessionModel {
    llm_history: Vec<LlmMessage>,
    llm_api_trace: Vec<Value>,
    pending_user_turn: Option<String>,
    pending_image_paths: Vec<String>,
    pending_mcp_resources: Vec<PendingMcpResource>,
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
        });
    }

    pub fn record_user_turn(&mut self, text: String, images: Vec<String>) {
        self.llm_history.push(LlmMessage {
            role: "user",
            content: text,
            image_paths: images,
        });
    }

    pub fn record_assistant_turn(&mut self, text: String) {
        self.llm_history.push(LlmMessage {
            role: "assistant",
            content: text,
            image_paths: vec![],
        });
    }

    pub fn persist_tool_memory(&mut self, request: &ToolRequest, output: &str) {
        let request_desc = match request {
            ToolRequest::McpTool {
                server,
                tool_name,
                arguments,
                ..
            } => format!(
                "mcp_tool server={} tool={} args={}",
                server,
                tool_name,
                truncate_for_preview(&arguments.to_string(), 600)
            ),
            ToolRequest::WebFetch { url } => format!("web_fetch url={}", url),
            ToolRequest::ListDirectory { path } => {
                format!("list_directory_files path={}", path)
            }
            ToolRequest::ReadFile {
                path,
                start_line,
                end_line,
            } => format!(
                "read_file path={} start={} end={}",
                path,
                start_line
                    .map(|v| v.to_string())
                    .unwrap_or_else(|| "1".to_string()),
                end_line
                    .map(|v| v.to_string())
                    .unwrap_or_else(|| "default".to_string())
            ),
            ToolRequest::Search { query } => format!("search_files query={}", query),
            ToolRequest::Shell { command } => format!("run_shell_command command={}", command),
            ToolRequest::CreateFile { path, content } => {
                format!("create_file path={} chars={}", path, content.chars().count())
            }
            ToolRequest::UpdateFile {
                path,
                old_text,
                new_text,
            } => format!(
                "update_file path={} old_chars={} new_chars={}",
                path,
                old_text.chars().count(),
                new_text.chars().count()
            ),
            ToolRequest::DeleteFile { path } => format!("delete_file path={}", path),
        };

        let entry = format!(
            "{}\nrequest: {}\nresult_snippet:\n{}",
            TOOL_MEMORY_PREFIX,
            request_desc,
            truncate_for_preview(output, TOOL_MEMORY_SNIPPET_CHARS)
        );

        self.llm_history.push(LlmMessage {
            role: "system",
            content: entry,
            image_paths: vec![],
        });
        self.prune_tool_memories();
    }

    pub fn replace_from_archive(&mut self, archive: &ChatArchive) {
        self.llm_history = archive
            .llm_history
            .iter()
            .map(|(role, content, image_paths)| LlmMessage {
                role: if role == "assistant" {
                    "assistant"
                } else if role == "system" {
                    "system"
                } else {
                    "user"
                },
                content: content.clone(),
                image_paths: image_paths.clone(),
            })
            .collect();
        self.llm_api_trace.clear();
        self.pending_user_turn = None;
        self.pending_image_paths.clear();
        self.pending_mcp_resources.clear();
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
                .map(|m| (m.role.to_string(), m.content.clone(), m.image_paths.clone()))
                .collect(),
        }
    }

    fn prune_tool_memories(&mut self) {
        let mut seen = 0usize;
        let total_tool_memories = self
            .llm_history
            .iter()
            .filter(|m| m.role == "system" && m.content.starts_with(TOOL_MEMORY_PREFIX))
            .count();

        if total_tool_memories <= TOOL_MEMORY_MAX_ENTRIES {
            return;
        }

        let remove_count = total_tool_memories - TOOL_MEMORY_MAX_ENTRIES;
        self.llm_history.retain(|m| {
            if m.role == "system" && m.content.starts_with(TOOL_MEMORY_PREFIX) {
                seen += 1;
                return seen > remove_count;
            }
            true
        });
    }
}

fn truncate_for_preview(text: &str, max_chars: usize) -> String {
    text.chars().take(max_chars).collect()
}
