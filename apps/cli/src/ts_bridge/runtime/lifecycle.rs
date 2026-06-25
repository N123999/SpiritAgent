use anyhow::{Result, anyhow};
use serde_json::{Value, json};
use std::{
    collections::{HashMap, VecDeque},
    path::PathBuf,
    sync::Arc,
};

use crate::{
    host_runtime::RuntimeEvent,
    logging,
    model_registry::AppConfig,
    ports::SecretStore,
    rewind,
    session::SessionModel,
    ts_bridge::{
        archive::llm_history_to_json,
        json_rpc::{is_json_rpc_response, JsonRpcProcess, resolve_bridge_script},
        transport,
        bootstrap_plan_metadata, TsBridgeRuntime,
    },
};

impl TsBridgeRuntime {
    pub fn new(
        config: AppConfig,
        secret_store: Arc<dyn SecretStore>,
        workspace_root: PathBuf,
    ) -> Result<Self> {
        let process = JsonRpcProcess::spawn(resolve_bridge_script(&workspace_root)?)?;
        let mut runtime = Self {
            process,
            config,
            secret_store,
            workspace_root,
            session: SessionModel::new(),
            rewind: rewind::create_desktop_rewind_metadata(),
            enabled_rules: Vec::new(),
            enabled_skill_catalog: Vec::new(),
            plan_metadata: bootstrap_plan_metadata(),
            active_plan_path: None,
            pending_aux_state: None,
            pending_approval_kind: None,
            current_pending_approval: None,
            pending_questions_active: false,
            pending_assistant_has_output: false,
            is_busy_cache: false,
            child_sessions_cache: Vec::new(),
            subagent_message_cache: HashMap::new(),
            events: VecDeque::new(),
            bridge_failed: false,
            deferred_transport_replace: false,
        };
        logging::log_event(&format!(
            "[ts-bridge-host] runtime init workspace_root={}",
            runtime.workspace_root.display()
        ));
        runtime.initialize_bridge()?;
        runtime.apply_llm_http_version_from_config()?;
        runtime.apply_llm_client_version_from_build()?;
        Ok(runtime)
    }

    pub fn new_mcp_only(
        secret_store: Arc<dyn SecretStore>,
        workspace_root: PathBuf,
    ) -> Result<Self> {
        let process = JsonRpcProcess::spawn(resolve_bridge_script(&workspace_root)?)?;
        let mut runtime = Self {
            process,
            config: AppConfig::default(),
            secret_store,
            workspace_root,
            session: SessionModel::new(),
            rewind: rewind::create_desktop_rewind_metadata(),
            enabled_rules: Vec::new(),
            enabled_skill_catalog: Vec::new(),
            plan_metadata: bootstrap_plan_metadata(),
            active_plan_path: None,
            pending_aux_state: None,
            pending_approval_kind: None,
            current_pending_approval: None,
            pending_questions_active: false,
            pending_assistant_has_output: false,
            is_busy_cache: false,
            child_sessions_cache: Vec::new(),
            subagent_message_cache: HashMap::new(),
            events: VecDeque::new(),
            bridge_failed: false,
            deferred_transport_replace: false,
        };
        runtime.initialize_bridge_with_transport_config(transport::build_mcp_only_transport_config(
            &runtime.workspace_root,
        ))?;
        Ok(runtime)
    }

    pub fn abort(&mut self) {
        if self.bridge_failed {
            return;
        }
        if let Err(err) = self.call_bridge("runtime.abort", None) {
            self.handle_bridge_error(err);
            return;
        }
        if let Err(err) = self.sync_after_command() {
            self.handle_bridge_error(err);
        }
    }

    pub fn continue_assistant_completion(&mut self) -> Result<()> {
        if self.bridge_failed {
            return Err(anyhow!("TS bridge 已失效，无法继续补全回复"));
        }
        self.call_bridge("runtime.continueAssistantCompletionStreaming", None)?;
        self.sync_after_command()?;
        Ok(())
    }

    pub fn drain_events(&mut self) -> Vec<RuntimeEvent> {
        self.events.drain(..).collect()
    }

    pub fn tick_thinking_spinner(&mut self) {
        if self.bridge_failed || !self.should_poll_bridge() {
            return;
        }
        if let Err(err) = self.call_bridge("runtime.tickThinkingSpinner", None) {
            self.handle_bridge_error(err);
            return;
        }
        if let Err(err) = self.sync_snapshot_only() {
            self.handle_bridge_error(err);
        }
    }

    pub fn poll(&mut self) {
        if self.bridge_failed || !self.should_poll_bridge() {
            return;
        }
        if let Err(err) = self.call_bridge("runtime.poll", None) {
            self.handle_bridge_error(err);
            return;
        }
        if let Err(err) = self.sync_after_command() {
            self.handle_bridge_error(err);
            return;
        }
        if let Err(err) = self.consume_completed_manual_tool_command_result() {
            self.handle_bridge_error(err);
        }
    }

    pub fn handle_stream_stall_timeout(&mut self) {
        if self.bridge_failed || !self.should_poll_bridge() {
            return;
        }
        if let Err(err) = self.call_bridge("runtime.handleStreamStallTimeout", None) {
            self.handle_bridge_error(err);
            return;
        }
        if let Err(err) = self.sync_after_command() {
            self.handle_bridge_error(err);
        }
    }

    fn initialize_bridge(&mut self) -> Result<()> {
        self.initialize_bridge_with_transport_config(self.resolve_transport_config_json()?)
    }

    fn initialize_bridge_with_transport_config(&mut self, transport_config: Value) -> Result<()> {
        let snapshot = self.call_bridge(
            "runtime.init",
            Some(json!({
                "transportConfig": transport_config,
                "history": llm_history_to_json(self.session.llm_history()),
                "enabledRules": self.enabled_rules,
                "enabledSkillCatalog": self.enabled_skill_catalog,
                "planMetadata": self.plan_metadata,
                "loopEnabled": self.session.loop_enabled(),
                "approvalLevel": self.session.approval_level(),
                "todoSessionKey": self.rewind.session_id,
            })),
        )?;
        self.apply_snapshot(serde_json::from_value(snapshot)?);
        self.apply_llm_http_version_from_config()?;
        self.apply_llm_client_version_from_build()?;
        Ok(())
    }

    pub(crate) fn resolve_transport_config_json(&self) -> Result<Value> {
        self.resolve_transport_config_json_for(&self.config)
    }

    pub(crate) fn resolve_transport_config_json_for(&self, config: &AppConfig) -> Result<Value> {
        transport::resolve_transport_config_json_for(
            &transport::TransportHost::from_runtime(self),
            config,
        )
    }

    pub(crate) fn transport_config_will_change(&self, config: &AppConfig) -> bool {
        transport::transport_config_will_change(&self.config, config)
    }

    pub(crate) fn call_bridge(&mut self, method: &str, params: Option<Value>) -> Result<Value> {
        if self.bridge_failed {
            return Err(anyhow!("TS bridge 已处于失败状态。"));
        }

        let request_id = self.process.next_request_id();
        self.process.write_request(request_id, method, params)?;

        loop {
            let message = self.process.recv_message()?;
            if is_json_rpc_response(&message) {
                let message_id = message
                    .get("id")
                    .and_then(Value::as_u64)
                    .ok_or_else(|| anyhow!("JSON-RPC 响应缺少 id"))?;
                if message_id != request_id {
                    return Err(anyhow!(
                        "收到不匹配的 JSON-RPC 响应 id: {} != {}",
                        message_id,
                        request_id
                    ));
                }

                if let Some(error) = message.get("error") {
                    let summary = error
                        .get("message")
                        .and_then(Value::as_str)
                        .unwrap_or("TS bridge 返回未知错误");
                    return Err(anyhow!("runtime-error: {}", summary));
                }

                return Ok(message.get("result").cloned().unwrap_or(Value::Null));
            }

            self.handle_host_request(message)?;
        }
    }
}
