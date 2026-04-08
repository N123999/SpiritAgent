pub mod adapters;
pub mod chat_store;
pub mod cli;
#[cfg(feature = "tui")]
pub mod conversation_select;
pub mod llm_client;
pub mod logging;
pub mod mcp;
pub mod mcp_manager;
pub mod model_registry;
pub mod ports;
pub mod runtime;
pub mod session;
pub mod tool_runtime;
#[cfg(feature = "tui")]
pub mod tui;
#[cfg(feature = "tui")]
pub mod ui;
pub mod view;
#[cfg(feature = "tui")]
mod word_wrap;

pub use cli::{
	ConfigCommand, KeyCommand, McpCommand, ModelCommand, handle_config_cli, handle_mcp_cli,
	handle_model_cli,
};
#[cfg(feature = "tui")]
pub use tui::TuiShell;
pub use view::{ChatMessage, MessageRole, ToolUiBlock, ToolUiPhase, TuiViewModel};
