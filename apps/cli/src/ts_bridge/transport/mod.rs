mod config;
pub(crate) mod keys;
mod provider;

pub(crate) use config::{
    attach_video_generation_config, build_mcp_only_transport_config,
    resolve_transport_config_json_for, transport_config_will_change,
};

use std::path::Path;

use crate::{model_registry::AppConfig, ports::SecretStore};

pub(crate) struct TransportHost<'a> {
    pub workspace_root: &'a Path,
    pub secret_store: &'a dyn SecretStore,
    pub stored_config: &'a AppConfig,
}

impl<'a> TransportHost<'a> {
    pub(crate) fn from_runtime(runtime: &'a super::TsBridgeRuntime) -> Self {
        Self {
            workspace_root: &runtime.workspace_root,
            secret_store: runtime.secret_store.as_ref(),
            stored_config: &runtime.config,
        }
    }
}
