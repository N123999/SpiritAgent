pub mod adapters;
pub mod chat_store;
pub mod cli;
#[cfg(feature = "tui")]
pub mod conversation_select;
pub mod host_runtime;
#[cfg(feature = "tui")]
pub mod locale;
pub mod llm_types;
pub mod logging;
pub mod mcp;
pub mod mcp_types;
pub mod model_registry;
pub mod plan;
pub mod ports;
pub mod rules;
pub mod runtime_handle;
pub mod session;
pub mod skills;
pub mod ts_bridge;
#[cfg(feature = "tui")]
pub mod shell;
#[cfg(test)]
pub(crate) mod test_support;
pub mod tool_runtime;
#[cfg(feature = "tui")]
pub mod tui;
#[cfg(feature = "tui")]
pub mod ui;
pub mod view;
#[cfg(feature = "tui")]
mod word_wrap;

#[cfg(feature = "tui")]
rust_i18n::i18n!("locales", fallback = "en");

pub use cli::{
    ConfigCommand, KeyCommand, McpCommand, ModelCommand, handle_config_cli, handle_mcp_cli,
    handle_model_cli,
};
#[cfg(feature = "tui")]
pub use tui::TuiShell;
pub use view::{ChatMessage, MessageRole, ToolUiBlock, ToolUiPhase, TuiViewModel};
