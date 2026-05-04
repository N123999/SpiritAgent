pub mod adapters;
pub mod ask_questions;
pub mod chat_store;
pub mod cli;
#[cfg(feature = "tui")]
pub mod conversation_select;
pub mod host_runtime;
pub mod llm_types;
#[cfg(feature = "tui")]
pub mod locale;
pub mod logging;
pub mod mcp;
pub mod mcp_types;
pub mod model_registry;
pub mod model_provider_presets;
pub mod openai_models_list;
pub mod plan;
pub mod ports;
pub mod rewind;
pub mod rules;
pub mod runtime_handle;
pub mod session;
#[cfg(feature = "tui")]
pub mod shell;
pub mod skills;
#[cfg(test)]
pub(crate) mod test_support;
pub mod tool_runtime;
pub mod ts_bridge;
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
    ConfigCommand, ExtensionCommand, KeyCommand, MarketplaceCommand, McpCommand, ModelCommand,
    handle_config_cli, handle_extension_cli, handle_mcp_cli, handle_model_cli,
};
#[cfg(feature = "tui")]
pub use tui::TuiShell;
pub use view::{ChatMessage, MessageRole, ToolUiBlock, ToolUiPhase, TuiViewModel};
