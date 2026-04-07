pub mod adapters;
pub mod chat_store;
pub mod cli;
pub mod llm_client;
pub mod logging;
pub mod model_registry;
pub mod ports;
pub mod runtime;
pub mod session;
pub mod tool_runtime;
pub mod tui;
pub mod view;
#[cfg(feature = "tui")]
pub mod ui;

pub use cli::{ConfigCommand, KeyCommand, ModelCommand, handle_config_cli, handle_model_cli};
pub use tui::TuiShell;
pub use view::{ChatMessage, MessageRole, TuiViewModel};
