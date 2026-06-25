#[cfg(test)]
mod integration;

use super::{ENV_API_KEY, ENV_RUNTIME_BACKEND_NODE_PATH, TsBridgeRuntime};
use crate::ts_bridge::{
    json_rpc::resolve_bridge_script,
    tool_ui::{is_retired_builtin_host_method, tool_request_from_host_value},
    types::bridge::{
        BridgeManualToolCommandStartResult, BridgeRuntimeEvent, BridgeRuntimeSnapshot,
        BridgeToolExecution,
    },
};
use crate::{
    host_runtime::RuntimeEvent,
    model_registry::{AppConfig, DEFAULT_API_BASE, ModelProfile, ModelProvider, NetworksConfig},
    ports::SecretStore,
};
use anyhow::{Result, anyhow};
use serde_json::{Value, json};
use std::{env, path::PathBuf, process::Command, sync::Arc};

struct StubSecretStore;

impl SecretStore for StubSecretStore {
    fn load_global_api_key(&self) -> Result<Option<String>> {
        Ok(Some("test-key".to_string()))
    }

    fn save_global_api_key(&self, _api_key: &str) -> Result<()> {
        Ok(())
    }

    fn remove_global_api_key(&self) -> Result<()> {
        Ok(())
    }

    fn load_model_api_key(&self, _model_name: &str) -> Result<Option<String>> {
        Ok(None)
    }

    fn save_model_api_key(&self, _model_name: &str, _api_key: &str) -> Result<()> {
        Ok(())
    }

    fn remove_model_api_key(&self, _model_name: &str) -> Result<()> {
        Ok(())
    }

    fn has_model_api_key(&self, _model_name: &str) -> Result<bool> {
        Ok(false)
    }
}

fn make_test_runtime() -> Option<TsBridgeRuntime> {
    let workspace_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("workspace root")
        .to_path_buf();

    if resolve_bridge_script(&workspace_root).is_err() {
        return None;
    }

    let node_path =
        env::var(ENV_RUNTIME_BACKEND_NODE_PATH).unwrap_or_else(|_| "node".to_string());
    if Command::new(&node_path).arg("--version").output().is_err() {
        return None;
    }

    let config = AppConfig {
        models: vec![
            ModelProfile {
                name: "gpt-4o-mini".to_string(),
                api_base: DEFAULT_API_BASE.to_string(),
                provider: None,
                reasoning_effort: None,
                context_length: None,
                extra: Default::default(),
            },
            ModelProfile {
                name: "gpt-4.1-mini".to_string(),
                api_base: DEFAULT_API_BASE.to_string(),
                provider: None,
                reasoning_effort: None,
                context_length: None,
                extra: Default::default(),
            },
        ],
        active_model: "gpt-4o-mini".to_string(),
        image_generation_model: None,
        video_generation_model: None,
        ui_locale: None,
        networks: NetworksConfig::default(),
        extra: Default::default(),
    };

    TsBridgeRuntime::new(config, Arc::new(StubSecretStore), workspace_root).ok()
}

fn busy_snapshot() -> BridgeRuntimeSnapshot {
    BridgeRuntimeSnapshot {
        pending_user_turn: Some("你好".to_string()),
        pending_image_paths: vec![],
        pending_mcp_resources: vec![],
        pending_aux_state: None,
        has_pending_approval: false,
        has_pending_manual_approval: false,
        has_pending_questions: false,
        current_pending_approval: None,
        current_pending_questions: None,
        child_sessions: vec![],
        is_busy: true,
        loop_enabled: false,
        approval_level: "default".to_string(),
        background_tool_status: None,
    }
}

fn idle_snapshot() -> BridgeRuntimeSnapshot {
    BridgeRuntimeSnapshot {
        pending_user_turn: None,
        pending_image_paths: vec![],
        pending_mcp_resources: vec![],
        pending_aux_state: None,
        has_pending_approval: false,
        has_pending_manual_approval: false,
        has_pending_questions: false,
        current_pending_approval: None,
        current_pending_questions: None,
        child_sessions: vec![],
        is_busy: false,
        loop_enabled: false,
        approval_level: "default".to_string(),
        background_tool_status: None,
    }
}

#[test]
fn validate_config_change_allows_transport_switch_while_busy() {
    let Some(mut runtime) = make_test_runtime() else {
        return;
    };

    runtime.apply_snapshot(busy_snapshot());

    let mut next = runtime.config().clone();
    next.active_model = "gpt-4.1-mini".to_string();

    assert!(
        runtime.validate_config_change(&next).is_ok(),
        "忙时仍应通过校验，bridge 替换推迟到空闲"
    );
}

#[test]
fn replace_config_defers_bridge_transport_while_busy_and_flushes_when_idle() {
    let Some(mut runtime) = make_test_runtime() else {
        return;
    };

    runtime.apply_snapshot(busy_snapshot());
    assert!(!runtime.deferred_transport_replace_for_test());

    let mut next = runtime.config().clone();
    next.active_model = "gpt-4.1-mini".to_string();
    runtime.replace_config(next);

    assert!(runtime.deferred_transport_replace_for_test());
    assert_eq!(runtime.config().active_model, "gpt-4.1-mini");

    runtime.apply_snapshot(idle_snapshot());
    assert!(
        !runtime.deferred_transport_replace_for_test(),
        "空闲后应完成对 TS 的 replaceConfig"
    );
}

#[test]
fn validate_config_change_allows_non_transport_updates_while_busy() {
    let Some(mut runtime) = make_test_runtime() else {
        return;
    };

    runtime.apply_snapshot(busy_snapshot());

    let mut next = runtime.config().clone();
    next.ui_locale = Some("zh-CN".to_string());
    next.models.push(ModelProfile {
        name: "gpt-4.1".to_string(),
        api_base: DEFAULT_API_BASE.to_string(),
        provider: None,
        reasoning_effort: None,
        context_length: None,
        extra: Default::default(),
    });

    assert!(runtime.validate_config_change(&next).is_ok());
}

#[test]
fn resolve_transport_config_json_includes_model_knobs() {
    let Some(runtime) = make_test_runtime() else {
        return;
    };

    let mut next = runtime.config().clone();
    let active = next
        .active_model_profile_mut()
        .expect("active model should exist");
    active.provider = Some(ModelProvider::Custom);
    active.reasoning_effort = Some("minimal".to_string());

    let transport = runtime
        .resolve_transport_config_json_for(&next)
        .expect("resolve transport config");

    assert_eq!(
        transport.get("llmVendor").and_then(Value::as_str),
        Some("custom")
    );
    assert!(transport.get("transportImplementation").is_none());
    assert_eq!(
        transport.get("reasoningEffort").and_then(Value::as_str),
        Some("default")
    );
}

#[test]
fn resolve_transport_config_json_includes_video_generation_model_for_open_responses() {
    let Some(runtime) = make_test_runtime() else {
        return;
    };

    let mut next = runtime.config().clone();
    let active = next
        .active_model_profile_mut()
        .expect("active model should exist");
    active.provider = Some(ModelProvider::Volcengine);
    active
        .extra
        .insert("transportKind".to_string(), json!("open-responses"));
    next.models.push(ModelProfile {
        name: "seedance-video".to_string(),
        api_base: "https://ark.cn-beijing.volces.com/api/v3".to_string(),
        provider: Some(ModelProvider::Volcengine),
        reasoning_effort: None,
        context_length: None,
        extra: serde_json::Map::from_iter([(
            "capabilities".to_string(),
            json!(["videoGeneration"]),
        )]),
    });
    next.video_generation_model = Some("seedance-video".to_string());

    let transport = runtime
        .resolve_transport_config_json_for(&next)
        .expect("resolve transport config");

    assert_eq!(
        transport.get("transportKind").and_then(Value::as_str),
        Some("open-responses")
    );
    let video_generation = transport
        .get("videoGeneration")
        .expect("video generation config");
    assert_eq!(
        video_generation.get("model").and_then(Value::as_str),
        Some("seedance-video")
    );
    assert_eq!(
        video_generation.get("llmVendor").and_then(Value::as_str),
        Some("volcengine")
    );
}

#[test]
fn resolve_transport_config_json_includes_image_generation_model() {
    let Some(runtime) = make_test_runtime() else {
        return;
    };

    let mut next = runtime.config().clone();
    next.active_model_profile_mut()
        .expect("active model should exist")
        .extra
        .insert("capabilities".to_string(), json!(["chat"]));
    next.models.push(ModelProfile {
        name: "image-model".to_string(),
        api_base: "https://images.example.invalid/v1".to_string(),
        provider: Some(ModelProvider::Custom),
        reasoning_effort: None,
        context_length: None,
        extra: serde_json::Map::from_iter([(
            "capabilities".to_string(),
            json!(["imageGeneration"]),
        )]),
    });
    next.image_generation_model = Some("image-model".to_string());

    let transport = runtime
        .resolve_transport_config_json_for(&next)
        .expect("resolve transport config");

    assert_eq!(
        transport
            .get("modelCapabilities")
            .and_then(|capabilities| capabilities.get("chat"))
            .and_then(Value::as_bool),
        Some(true)
    );
    let image_generation = transport
        .get("imageGeneration")
        .expect("image generation config");
    assert_eq!(
        image_generation.get("model").and_then(Value::as_str),
        Some("image-model")
    );
    assert_eq!(
        image_generation.get("baseUrl").and_then(Value::as_str),
        Some("https://images.example.invalid/v1")
    );
    assert_eq!(
        image_generation.get("llmVendor").and_then(Value::as_str),
        Some("custom")
    );
    assert_eq!(
        image_generation
            .get("modelCapabilities")
            .and_then(|capabilities| capabilities.get("imageGeneration"))
            .and_then(Value::as_bool),
        Some(true)
    );
}

#[test]
fn resolve_transport_config_json_uses_xai_official_responses_provider() {
    let Some(runtime) = make_test_runtime() else {
        return;
    };

    let mut next = runtime.config().clone();
    let active = next
        .active_model_profile_mut()
        .expect("active model should exist");
    active.provider = Some(ModelProvider::Xai);
    active
        .extra
        .insert("transportKind".to_string(), json!("open-responses"));

    let transport = runtime
        .resolve_transport_config_json_for(&next)
        .expect("resolve transport config");

    assert_eq!(
        transport.get("transportKind").and_then(Value::as_str),
        Some("open-responses")
    );
    assert_eq!(
        transport.get("responsesProvider").and_then(Value::as_str),
        Some("xai")
    );
    assert_eq!(
        transport.get("llmVendor").and_then(Value::as_str),
        Some("xai")
    );
}

#[test]
fn resolve_transport_config_json_uses_azure_official_responses_provider() {
    let Some(runtime) = make_test_runtime() else {
        return;
    };

    let previous_api_key = env::var(ENV_API_KEY).ok();
    // SAFETY: 单测串行写入进程级环境变量，结束后恢复。
    unsafe {
        env::set_var(ENV_API_KEY, "test-azure-key");
    }

    let mut next = runtime.config().clone();
    next.models.push(ModelProfile {
        name: "my-gpt4o-deploy".to_string(),
        api_base: "https://my-openai-resource.openai.azure.com/openai/v1".to_string(),
        provider: Some(ModelProvider::Azure),
        reasoning_effort: None,
        context_length: None,
        extra: serde_json::Map::from_iter([
            ("transportKind".to_string(), json!("open-responses")),
            ("azureResourceName".to_string(), json!("my-openai-resource")),
        ]),
    });
    next.active_model = "my-gpt4o-deploy".to_string();

    let transport = runtime
        .resolve_transport_config_json_for(&next)
        .expect("resolve transport config");

    assert_eq!(
        transport.get("transportKind").and_then(Value::as_str),
        Some("open-responses")
    );
    assert_eq!(
        transport.get("baseUrl").and_then(Value::as_str),
        Some("https://my-openai-resource.openai.azure.com/openai/v1")
    );
    assert_eq!(
        transport.get("responsesProvider").and_then(Value::as_str),
        Some("azure")
    );
    assert_eq!(
        transport.get("llmVendor").and_then(Value::as_str),
        Some("azure")
    );
    assert_eq!(
        transport
            .get("azureResourceName")
            .and_then(Value::as_str),
        Some("my-openai-resource")
    );
    assert_eq!(
        transport.get("model").and_then(Value::as_str),
        Some("my-gpt4o-deploy")
    );

    unsafe {
        match previous_api_key {
            Some(value) => env::set_var(ENV_API_KEY, value),
            None => env::remove_var(ENV_API_KEY),
        }
    }
}

#[test]
fn resolve_transport_config_json_recomputes_azure_base_url_from_resource_name() {
    let Some(runtime) = make_test_runtime() else {
        return;
    };

    let previous_api_key = env::var(ENV_API_KEY).ok();
    // SAFETY: 单测串行写入进程级环境变量，结束后恢复。
    unsafe {
        env::set_var(ENV_API_KEY, "test-azure-key");
    }

    let mut next = runtime.config().clone();
    next.models.push(ModelProfile {
        name: "my-gpt4o-deploy".to_string(),
        api_base: "https://stale-host.example/openai/v1".to_string(),
        provider: Some(ModelProvider::Azure),
        reasoning_effort: None,
        context_length: None,
        extra: serde_json::Map::from_iter([
            ("transportKind".to_string(), json!("open-responses")),
            ("azureResourceName".to_string(), json!("my-openai-resource")),
        ]),
    });
    next.active_model = "my-gpt4o-deploy".to_string();

    let transport = runtime
        .resolve_transport_config_json_for(&next)
        .expect("resolve transport config");

    assert_eq!(
        transport.get("baseUrl").and_then(Value::as_str),
        Some("https://my-openai-resource.openai.azure.com/openai/v1")
    );

    unsafe {
        match previous_api_key {
            Some(value) => env::set_var(ENV_API_KEY, value),
            None => env::remove_var(ENV_API_KEY),
        }
    }
}

#[test]
fn resolve_transport_config_json_routes_bedrock_mantle_openai_to_open_responses() {
    let Some(runtime) = make_test_runtime() else {
        return;
    };

    let previous_api_key = env::var(ENV_API_KEY).ok();
    // SAFETY: 单测串行写入进程级环境变量，结束后恢复。
    unsafe {
        env::set_var(ENV_API_KEY, "test-mantle-bearer");
    }

    let mut next = runtime.config().clone();
    next.models.push(ModelProfile {
        name: "openai.gpt-5.5".to_string(),
        api_base: "https://bedrock-runtime.us-east-2.amazonaws.com".to_string(),
        provider: Some(ModelProvider::AmazonBedrock),
        reasoning_effort: None,
        context_length: None,
        extra: serde_json::Map::from_iter([("awsRegion".to_string(), json!("us-east-2"))]),
    });
    next.active_model = "openai.gpt-5.5".to_string();

    let transport = runtime
        .resolve_transport_config_json_for(&next)
        .expect("resolve transport config");

    assert_eq!(
        transport.get("transportKind").and_then(Value::as_str),
        Some("open-responses")
    );
    assert_eq!(
        transport.get("baseUrl").and_then(Value::as_str),
        Some("https://bedrock-mantle.us-east-2.api.aws/openai/v1")
    );
    assert_eq!(
        transport.get("llmVendor").and_then(Value::as_str),
        Some("openai")
    );
    assert_eq!(
        transport.get("responsesProvider").and_then(Value::as_str),
        Some("openai")
    );

    unsafe {
        match previous_api_key {
            Some(value) => env::set_var(ENV_API_KEY, value),
            None => env::remove_var(ENV_API_KEY),
        }
    }
}

#[test]
fn resolve_transport_config_json_uses_anthropic_union_shape() {
    let Some(runtime) = make_test_runtime() else {
        return;
    };

    let mut next = runtime.config().clone();
    let active = next
        .active_model_profile_mut()
        .expect("active model should exist");
    active.provider = Some(ModelProvider::Anthropic);
    active.reasoning_effort = Some("max".to_string());
    active
        .extra
        .insert("transportKind".to_string(), json!("anthropic"));

    let transport = runtime
        .resolve_transport_config_json_for(&next)
        .expect("resolve transport config");

    assert_eq!(
        transport.get("transportKind").and_then(Value::as_str),
        Some("anthropic")
    );
    assert_eq!(transport.get("llmVendor"), None);
    assert_eq!(transport.get("effort").and_then(Value::as_str), Some("max"));
    assert_eq!(transport.get("imageGeneration"), None);
}

#[test]
fn transport_config_change_detects_model_knobs() {
    let Some(runtime) = make_test_runtime() else {
        return;
    };

    let mut next = runtime.config().clone();
    next.active_model_profile_mut()
        .expect("active model should exist")
        .provider = Some(ModelProvider::Custom);
    assert!(runtime.transport_config_will_change(&next));

    let mut next = runtime.config().clone();
    next.active_model_profile_mut()
        .expect("active model should exist")
        .extra
        .insert("transportKind".to_string(), json!("anthropic"));
    assert!(runtime.transport_config_will_change(&next));

    let mut next = runtime.config().clone();
    next.active_model_profile_mut()
        .expect("active model should exist")
        .reasoning_effort = Some("low".to_string());
    assert!(runtime.transport_config_will_change(&next));

    let mut next = runtime.config().clone();
    next.models.push(ModelProfile {
        name: "image-model".to_string(),
        api_base: DEFAULT_API_BASE.to_string(),
        provider: None,
        reasoning_effort: None,
        context_length: None,
        extra: serde_json::Map::from_iter([(
            "capabilities".to_string(),
            json!(["imageGeneration"]),
        )]),
    });
    next.image_generation_model = Some("image-model".to_string());
    assert!(runtime.transport_config_will_change(&next));
}

#[test]
fn runtime_error_clears_pending_turn_and_finishes_round() {
    let Some(mut runtime) = make_test_runtime() else {
        return;
    };

    runtime.apply_snapshot(busy_snapshot());
    runtime.handle_bridge_error(anyhow!("runtime-error: 401 status code (no body)"));

    assert!(!runtime.is_busy());
    assert!(runtime.session().pending_user_turn().is_none());

    let events = runtime.drain_events();
    assert!(
        events
            .iter()
            .any(|event| matches!(event, RuntimeEvent::RemovePendingAssistant))
    );
    assert!(events.iter().any(|event| matches!(
        event,
        RuntimeEvent::PushMessage(message)
            if message.content == "TS runtime 执行失败: 401 status code (no body)"
    )));
}

#[test]
fn bridge_runtime_event_accepts_camel_case_background_status_fields() {
    let value = json!({
        "kind": "background-tool-status",
        "phase": "finished",
        "toolName": "mcp_tool",
        "request": { "server": "github", "tool_name": "get_me" },
        "statusText": "MCP 工具执行中: github / get_me",
        "failed": false,
    });

    let event: BridgeRuntimeEvent =
        serde_json::from_value(value).expect("event should deserialize");
    match event {
        BridgeRuntimeEvent::BackgroundToolStatus {
            phase,
            tool_name,
            request,
            status_text,
            failed,
        } => {
            assert_eq!(phase, "finished");
            assert_eq!(tool_name.as_deref(), Some("mcp_tool"));
            assert!(request.is_some());
            assert_eq!(
                status_text.as_deref(),
                Some("MCP 工具执行中: github / get_me")
            );
            assert_eq!(failed, Some(false));
        }
        other => panic!("unexpected event variant: {other:?}"),
    }
}

#[test]
fn bridge_runtime_event_accepts_camel_case_history_compacted_fields() {
    let value = json!({
        "kind": "history-compacted",
        "droppedMessages": 5,
        "summaryPreview": "summary",
    });

    let event: BridgeRuntimeEvent =
        serde_json::from_value(value).expect("event should deserialize");
    match event {
        BridgeRuntimeEvent::HistoryCompacted {
            dropped_messages,
            summary_preview,
        } => {
            assert_eq!(dropped_messages, 5);
            assert_eq!(summary_preview.as_deref(), Some("summary"));
        }
        other => panic!("unexpected event variant: {other:?}"),
    }
}

#[test]
fn bridge_runtime_event_accepts_assistant_thinking_segment_finalized() {
    let value = json!({
        "kind": "assistant-thinking-segment-finalized",
        "text": "先分析一下用户意图",
    });

    let event: BridgeRuntimeEvent =
        serde_json::from_value(value).expect("event should deserialize");
    match event {
        BridgeRuntimeEvent::AssistantThinkingSegmentFinalized { text } => {
            assert_eq!(text, "先分析一下用户意图");
        }
        other => panic!("unexpected event variant: {other:?}"),
    }
}

#[test]
fn assistant_thinking_segment_finalized_is_forwarded_to_runtime_events() {
    let Some(mut runtime) = make_test_runtime() else {
        return;
    };

    runtime.apply_bridge_events(vec![
        BridgeRuntimeEvent::AssistantThinkingSegmentFinalized {
            text: "整理完成态 thinking".to_string(),
        },
    ]);

    let events = runtime.drain_events();
    assert!(events.iter().any(|event| matches!(
        event,
        RuntimeEvent::AssistantThinkingSegmentFinalized(text)
            if text == "整理完成态 thinking"
    )));
}

#[test]
fn tool_execution_finished_event_appends_separate_tool_message() {
    let Some(mut runtime) = make_test_runtime() else {
        return;
    };

    runtime.apply_bridge_events(vec![BridgeRuntimeEvent::ToolExecutionFinished {
        execution: BridgeToolExecution {
            tool_call_id: "call_123".to_string(),
            tool_name: "web_fetch".to_string(),
            request: json!({
                "name": "web_fetch",
                "url": "https://example.com"
            }),
            output: "example output".to_string(),
            failed: false,
        },
    }]);

    let events = runtime.drain_events();
    assert!(events.iter().any(|event| matches!(
        event,
        RuntimeEvent::PushMessage(message)
            if message
                .tool_block
                .as_ref()
                .is_some_and(|block| block.tool_name == "web_fetch" && block.tool_call_id.as_deref() == Some("call_123"))
    )));
}

#[test]
fn completed_manual_tool_result_appends_tool_message() {
    let Some(mut runtime) = make_test_runtime() else {
        return;
    };

    runtime.handle_manual_tool_command_result(BridgeManualToolCommandStartResult::Completed {
        request: json!({
            "name": "shell",
            "command": "echo hello"
        }),
        tool_name: "shell".to_string(),
        output: "hello".to_string(),
        failed: false,
        background_execution: false,
    });

    let events = runtime.drain_events();
    assert!(events.iter().any(|event| matches!(
        event,
        RuntimeEvent::PushMessage(message)
            if message
                .tool_block
                .as_ref()
                .is_some_and(|block| block.tool_name == "shell" && block.phase == crate::view::ToolUiPhase::Succeeded)
    )));
}

#[test]
fn failed_manual_tool_result_with_request_appends_failure_message() {
    let Some(mut runtime) = make_test_runtime() else {
        return;
    };

    runtime.handle_manual_tool_command_result(BridgeManualToolCommandStartResult::Failed {
        error: "boom".to_string(),
        request: Some(json!({
            "name": "shell",
            "command": "echo hello"
        })),
    });

    let events = runtime.drain_events();
    assert!(events.iter().any(|event| matches!(
        event,
        RuntimeEvent::PushMessage(message)
            if message
                .tool_block
                .as_ref()
                .is_some_and(|block| block.tool_name == "shell" && block.phase == crate::view::ToolUiPhase::Failed)
    )));
}

#[test]
fn tool_execution_finished_event_deserializes_host_request_shape() {
    let value = json!({
        "kind": "tool-execution-finished",
        "execution": {
            "toolCallId": "call_123",
            "toolName": "shell",
            "request": {
                "name": "shell",
                "command": "echo hello"
            },
            "output": "hello",
            "failed": false
        }
    });

    let event: BridgeRuntimeEvent =
        serde_json::from_value(value).expect("event should deserialize");
    match event {
        BridgeRuntimeEvent::ToolExecutionFinished { execution } => {
            assert_eq!(execution.tool_name, "shell");
            assert_eq!(execution.tool_call_id, "call_123");
            assert_eq!(
                execution.request.get("name").and_then(Value::as_str),
                Some("shell")
            );
        }
        other => panic!("unexpected event variant: {other:?}"),
    }
}

#[test]
fn tool_execution_output_chunk_event_deserializes() {
    let value = json!({
        "kind": "tool-execution-output-chunk",
        "toolCallId": "call_shell",
        "toolName": "shell",
        "request": {
            "name": "shell",
            "command": "npm install"
        },
        "chunk": "added 1 package\n"
    });

    let event: BridgeRuntimeEvent =
        serde_json::from_value(value).expect("event should deserialize");
    match event {
        BridgeRuntimeEvent::ToolExecutionOutputChunk {
            tool_call_id,
            tool_name,
            chunk,
            ..
        } => {
            assert_eq!(tool_call_id, "call_shell");
            assert_eq!(tool_name, "shell");
            assert_eq!(chunk, "added 1 package\n");
        }
        other => panic!("unexpected event variant: {other:?}"),
    }
}

#[test]
fn tool_request_from_host_value_rejects_legacy_rust_enum_shape() {
    let err = tool_request_from_host_value(json!({
        "WebFetch": {
            "url": "https://example.com"
        }
    }))
    .expect_err("legacy rust enum shape should be rejected");

    assert!(err.to_string().contains("工具请求缺少 name"));
}

#[test]
fn tool_request_from_host_value_keeps_name_and_args_without_rust_semantics() {
    let request = tool_request_from_host_value(json!({
        "name": "host_internal_preview",
        "preview": "dry-run",
        "nested": {
            "count": 2
        }
    }))
    .expect("ui request should parse");

    assert_eq!(request.name, "host_internal_preview");
    assert_eq!(
        request.arguments,
        json!({
            "preview": "dry-run",
            "nested": {
                "count": 2
            }
        })
    );
}

#[test]
fn retired_builtin_host_methods_stay_on_host_internal_side() {
    for method in [
        "host.builtinToolDefinitionEnvironment",
        "host.parseCommand",
        "host.requestFromFunctionCall",
        "host.authorize",
        "host.trust",
        "host.execute",
    ] {
        assert!(
            is_retired_builtin_host_method(method),
            "{method} should not fall back to Rust CLI tool runtime"
        );
    }

    assert!(!is_retired_builtin_host_method("host.addMcpServer"));
    assert!(!is_retired_builtin_host_method(
        "host.localToolExecuted"
    ));
}