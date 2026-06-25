use anyhow::{Result, anyhow};
use serde_json::{Value, json};
use std::{env, path::Path};

use crate::{
    bedrock_mantle,
    model_provider_presets::{
        azure_api_base_from_resource_name, resolve_azure_resource_name, resolve_profile_api_base,
    },
    model_registry::{
        AppConfig, ModelProvider, load_provider_access_key_id_from_keyring,
        load_provider_secret_access_key_from_keyring, normalize_reasoning_effort_value,
    },
    ts_bridge::constants::{ENV_API_BASE, ENV_API_KEY},
};

use super::{
    TransportHost,
    keys::{resolve_key_from_store, resolve_optional_key_from_store},
    provider::{
        anthropic_effort_value, attach_google_vertex_transport_fields, model_capabilities_json,
        model_provider_vendor, open_responses_sdk_provider,
    },
};

pub(crate) fn build_mcp_only_transport_config(workspace_root: &Path) -> Value {
    json!({
        "apiKey": "mcp-only",
        "model": "mcp-only",
        "baseUrl": "https://example.invalid/v1",
        "workspaceRoot": workspace_root,
    })
}

pub(crate) fn transport_config_will_change(stored_config: &AppConfig, config: &AppConfig) -> bool {
    if stored_config.active_model != config.active_model {
        return true;
    }

    if stored_config
        .active_model_profile()
        .map(|profile| profile.api_base.as_str())
        != config
            .active_model_profile()
            .map(|profile| profile.api_base.as_str())
    {
        return true;
    }

    if stored_config
        .active_model_profile()
        .map(|profile| profile.transport_kind())
        != config
            .active_model_profile()
            .map(|profile| profile.transport_kind())
    {
        return true;
    }

    if stored_config
        .active_model_profile()
        .and_then(|profile| profile.reasoning_effort.as_deref())
        != config
            .active_model_profile()
            .and_then(|profile| profile.reasoning_effort.as_deref())
    {
        return true;
    }

    if stored_config.image_generation_model != config.image_generation_model {
        return true;
    }

    if stored_config.image_generation_model_profile().map(|profile| {
        (
            profile.api_base.as_str(),
            profile.provider,
            profile.transport_kind(),
            profile.supports_image_generation(),
        )
    }) != config.image_generation_model_profile().map(|profile| {
        (
            profile.api_base.as_str(),
            profile.provider,
            profile.transport_kind(),
            profile.supports_image_generation(),
        )
    }) {
        return true;
    }

    if stored_config.video_generation_model != config.video_generation_model {
        return true;
    }

    if stored_config.video_generation_model_profile().map(|profile| {
        (
            profile.api_base.as_str(),
            profile.provider,
            profile.transport_kind(),
            profile.supports_video_generation(),
        )
    }) != config.video_generation_model_profile().map(|profile| {
        (
            profile.api_base.as_str(),
            profile.provider,
            profile.transport_kind(),
            profile.supports_video_generation(),
        )
    }) {
        return true;
    }

    stored_config
        .active_model_profile()
        .map(|profile| profile.provider)
        != config
            .active_model_profile()
            .map(|profile| profile.provider)
}

pub(crate) fn attach_video_generation_config(
    host: &TransportHost<'_>,
    transport: &mut Value,
    config: &AppConfig,
) -> Result<()> {
    let Some(video_profile) = config.video_generation_model_profile() else {
        return Ok(());
    };
    if !video_profile.supports_video_generation() {
        return Ok(());
    }
    let Some(video_api_key) =
        resolve_optional_key_from_store(host, &video_profile.name, video_profile.provider)?
    else {
        return Ok(());
    };

    let mut video_generation = serde_json::json!({
        "apiKey": video_api_key,
        "model": video_profile.name,
        "baseUrl": resolve_profile_api_base(video_profile),
    });
    if let Some(provider) = video_profile.provider {
        if let Some(obj) = video_generation.as_object_mut() {
            obj.insert(
                "llmVendor".to_string(),
                json!(model_provider_vendor(provider)),
            );
        }
    }
    if let Some(model_capabilities) = model_capabilities_json(video_profile) {
        if let Some(obj) = video_generation.as_object_mut() {
            obj.insert("modelCapabilities".to_string(), model_capabilities);
        }
    }
    if let Some(obj) = transport.as_object_mut() {
        obj.insert("videoGeneration".to_string(), video_generation);
    }
    Ok(())
}

pub(crate) fn resolve_transport_config_json_for(host: &TransportHost<'_>, config: &AppConfig) -> Result<Value> {
    let Some(active) = config
        .active_model_profile()
        .filter(|profile| !profile.name.trim().is_empty())
    else {
        return Ok(build_mcp_only_transport_config(&host.workspace_root));
    };

    let api_key = if let Ok(value) = env::var(ENV_API_KEY) {
        let trimmed = value.trim();
        if trimmed.is_empty() {
            super::keys::resolve_key_from_store(host, &active.name, active.provider)?
        } else {
            trimmed.to_string()
        }
    } else {
        super::keys::resolve_key_from_store(host, &active.name, active.provider)?
    };

    let api_base = env::var(ENV_API_BASE).unwrap_or_else(|_| resolve_profile_api_base(active));

    let normalized_reasoning_effort = normalize_reasoning_effort_value(
        active.reasoning_effort.clone(),
        active.provider,
        active.transport_kind(),
        &active.name,
    );

    let mut transport =
        if active.transport_kind() == crate::model_registry::ModelTransportKind::Anthropic {
            serde_json::json!({
                "transportKind": "anthropic",
                "apiKey": api_key,
                "model": active.name,
                "baseUrl": api_base,
                "workspaceRoot": host.workspace_root,
            })
        } else if active.transport_kind() == crate::model_registry::ModelTransportKind::OpenResponses {
            let mut transport = serde_json::json!({
                "transportKind": "open-responses",
                "apiKey": api_key,
                "model": active.name,
                "baseUrl": api_base,
                "workspaceRoot": host.workspace_root,
                "store": false,
            });
            if let Some(responses_provider) = open_responses_sdk_provider(active.provider) {
                if let Some(obj) = transport.as_object_mut() {
                    obj.insert(
                        "responsesProvider".to_string(),
                        json!(responses_provider),
                    );
                }
            }
            if active.provider == Some(ModelProvider::Azure) {
                let resource_name = resolve_azure_resource_name(
                    active.azure_resource_name(),
                    &api_base,
                )
                .ok_or_else(|| {
                    anyhow!("Azure 模型缺少 azureResourceName 配置，请使用 Desktop 连接向导导入或 spirit model add --azure-resource-name")
                })?;
                let azure_base = azure_api_base_from_resource_name(&resource_name);
                if let Some(obj) = transport.as_object_mut() {
                    obj.insert("baseUrl".to_string(), json!(azure_base));
                    obj.insert("azureResourceName".to_string(), json!(resource_name));
                    obj.insert("llmVendor".to_string(), json!("azure"));
                }
            }
            transport
        } else if active.transport_kind() == crate::model_registry::ModelTransportKind::Bedrock {
            if active.provider == Some(ModelProvider::AmazonBedrock)
                && crate::bedrock_mantle::is_bedrock_mantle_openai_model(&active.name)
            {
                let region = active.aws_region().ok_or_else(|| {
                    anyhow!("Amazon Bedrock 模型缺少 awsRegion 配置，请使用 Desktop 连接向导导入或手动写入 config.json")
                })?;
                let mantle_base =
                    crate::bedrock_mantle::bedrock_mantle_api_base_from_region(&region);
                let mut transport = serde_json::json!({
                    "transportKind": "open-responses",
                    "model": active.name,
                    "baseUrl": mantle_base,
                    "workspaceRoot": host.workspace_root,
                    "store": false,
                    "responsesProvider": "openai",
                    "llmVendor": "openai",
                });
                if !api_key.trim().is_empty() {
                    if let Some(obj) = transport.as_object_mut() {
                        obj.insert("apiKey".to_string(), json!(api_key));
                    }
                } else if let Ok(access_key_id) =
                    load_provider_access_key_id_from_keyring(ModelProvider::AmazonBedrock.as_str())
                {
                    if let Ok(secret_access_key) = load_provider_secret_access_key_from_keyring(
                        ModelProvider::AmazonBedrock.as_str(),
                    ) {
                        let access_key_id = access_key_id.trim();
                        let secret_access_key = secret_access_key.trim();
                        if !access_key_id.is_empty() && !secret_access_key.is_empty() {
                            if let Some(obj) = transport.as_object_mut() {
                                obj.insert(
                                    "bedrockMantleIam".to_string(),
                                    json!({
                                        "region": region,
                                        "accessKeyId": access_key_id,
                                        "secretAccessKey": secret_access_key,
                                    }),
                                );
                            }
                        }
                    }
                }
                transport
            } else {
            let region = active.aws_region().ok_or_else(|| {
                anyhow!("Amazon Bedrock 模型缺少 awsRegion 配置，请使用 Desktop 连接向导导入或手动写入 config.json")
            })?;
            let mut transport = serde_json::json!({
                "transportKind": "bedrock",
                "model": active.name,
                "region": region,
                "baseUrl": api_base,
                "workspaceRoot": host.workspace_root,
            });
            if !api_key.trim().is_empty() {
                if let Some(obj) = transport.as_object_mut() {
                    obj.insert("apiKey".to_string(), json!(api_key));
                }
            }
            if let Ok(access_key_id) =
                load_provider_access_key_id_from_keyring(ModelProvider::AmazonBedrock.as_str())
            {
                if let Ok(secret_access_key) = load_provider_secret_access_key_from_keyring(
                    ModelProvider::AmazonBedrock.as_str(),
                ) {
                    let access_key_id = access_key_id.trim();
                    let secret_access_key = secret_access_key.trim();
                    if !access_key_id.is_empty() && !secret_access_key.is_empty() {
                        if let Some(obj) = transport.as_object_mut() {
                            obj.insert("accessKeyId".to_string(), json!(access_key_id));
                            obj.insert(
                                "secretAccessKey".to_string(),
                                json!(secret_access_key),
                            );
                        }
                    }
                }
            }
            transport
            }
        } else {
            serde_json::json!({
                "apiKey": api_key,
                "model": active.name,
                "baseUrl": api_base,
                "workspaceRoot": host.workspace_root,
            })
        };

    if let Some(model_capabilities) = model_capabilities_json(active) {
        if let Some(obj) = transport.as_object_mut() {
            obj.insert("modelCapabilities".to_string(), model_capabilities);
        }
    }

    if active.transport_kind() == crate::model_registry::ModelTransportKind::Anthropic {
        if let Some(effort) = anthropic_effort_value(normalized_reasoning_effort.as_deref()) {
            if let Some(obj) = transport.as_object_mut() {
                obj.insert("effort".to_string(), json!(effort));
            }
        }
    } else if active.transport_kind() == crate::model_registry::ModelTransportKind::OpenResponses
        || (active.provider == Some(ModelProvider::AmazonBedrock)
            && crate::bedrock_mantle::is_bedrock_mantle_openai_model(&active.name))
    {
        let is_mantle_openai = active.provider == Some(ModelProvider::AmazonBedrock)
            && crate::bedrock_mantle::is_bedrock_mantle_openai_model(&active.name);
        if !is_mantle_openai {
            if let Some(provider) = active.provider {
                if let Some(obj) = transport.as_object_mut() {
                    obj.insert(
                        "llmVendor".to_string(),
                        json!(model_provider_vendor(provider)),
                    );
                }
            }
        }
        if let Some(reasoning_effort) = normalized_reasoning_effort.as_deref() {
            if let Some(obj) = transport.as_object_mut() {
                obj.insert("reasoningEffort".to_string(), json!(reasoning_effort));
            }
        }
    } else if active.transport_kind() == crate::model_registry::ModelTransportKind::Bedrock
        && !(active.provider == Some(ModelProvider::AmazonBedrock)
            && crate::bedrock_mantle::is_bedrock_mantle_openai_model(&active.name))
    {
        if let Some(reasoning_effort) = normalized_reasoning_effort.as_deref() {
            if let Some(obj) = transport.as_object_mut() {
                obj.insert("reasoningEffort".to_string(), json!(reasoning_effort));
            }
        }
    } else {
        if let Some(provider) = active.provider {
            if let Some(obj) = transport.as_object_mut() {
                obj.insert(
                    "llmVendor".to_string(),
                    json!(model_provider_vendor(provider)),
                );
            }
        }
        if let Some(reasoning_effort) = normalized_reasoning_effort.as_deref() {
            if let Some(obj) = transport.as_object_mut() {
                obj.insert("reasoningEffort".to_string(), json!(reasoning_effort));
            }
        }
        if let Some(image_profile) = config.image_generation_model_profile() {
            if image_profile.supports_image_generation() {
                    if let Some(image_api_key) =
                        resolve_optional_key_from_store(host, &image_profile.name, image_profile.provider)?
                {
                    let mut image_generation = serde_json::json!({
                        "apiKey": image_api_key,
                        "model": image_profile.name,
                        "baseUrl": resolve_profile_api_base(image_profile),
                    });
                    if let Some(provider) = image_profile.provider {
                        if let Some(obj) = image_generation.as_object_mut() {
                            obj.insert(
                                "llmVendor".to_string(),
                                json!(model_provider_vendor(provider)),
                            );
                        }
                    }
                    if let Some(model_capabilities) = model_capabilities_json(image_profile) {
                        if let Some(obj) = image_generation.as_object_mut() {
                            obj.insert("modelCapabilities".to_string(), model_capabilities);
                        }
                    }
                    if let Some(obj) = transport.as_object_mut() {
                        obj.insert("imageGeneration".to_string(), image_generation);
                    }
                }
            }
        }
    }
    attach_google_vertex_transport_fields(&mut transport, active)?;
    attach_video_generation_config(host, &mut transport, config)?;
    Ok(transport)
}
