use anyhow::{Result, anyhow};
use serde_json::{Map, Value, json};

use crate::model_registry::ModelProvider;

pub(crate) fn open_responses_sdk_provider(provider: Option<ModelProvider>) -> Option<&'static str> {
    match provider {
        Some(ModelProvider::Openai) => Some("openai"),
        Some(ModelProvider::Xai) => Some("xai"),
        Some(ModelProvider::Azure) => Some("azure"),
        Some(ModelProvider::VercelAiGateway) | Some(ModelProvider::Openrouter) => None,
        _ => Some("open-responses-compatible"),
    }
}

pub(crate) fn attach_google_vertex_transport_fields(
    transport: &mut Value,
    profile: &crate::model_registry::ModelProfile,
) -> Result<()> {
    if profile.provider != Some(ModelProvider::GoogleVertexAi) {
        return Ok(());
    }

    let obj = transport
        .as_object_mut()
        .ok_or_else(|| anyhow!("transport config 不是 JSON 对象"))?;

    if let Some(project) = profile.vertex_project() {
        obj.insert("vertexProject".to_string(), json!(project));
    }
    if let Some(location) = profile.vertex_location() {
        obj.insert("vertexLocation".to_string(), json!(location));
    }

    if let Ok(client_email) = crate::model_registry::load_provider_vertex_client_email_from_keyring(
        ModelProvider::GoogleVertexAi.as_str(),
    ) {
        let trimmed = client_email.trim();
        if !trimmed.is_empty() {
            obj.insert("vertexClientEmail".to_string(), json!(trimmed));
        }
    }
    if let Ok(private_key) = crate::model_registry::load_provider_vertex_private_key_from_keyring(
        ModelProvider::GoogleVertexAi.as_str(),
    ) {
        let trimmed = private_key.trim();
        if !trimmed.is_empty() {
            obj.insert("vertexPrivateKey".to_string(), json!(trimmed));
        }
    }

    Ok(())
}

pub(crate) fn model_provider_vendor(provider: ModelProvider) -> &'static str {
    match provider {
        ModelProvider::Deepseek => "deepseek",
        ModelProvider::Xai => "xai",
        ModelProvider::Moonshot => "moonshot-ai",
        ModelProvider::ZAi => "z-ai",
        ModelProvider::ZhipuAi => "zhipu-ai",
        ModelProvider::Minimax => "minimax",
        ModelProvider::Xiaomi => "xiaomi",
        ModelProvider::Siliconflow => "siliconflow",
        ModelProvider::Alibaba => "alibaba",
        ModelProvider::Anthropic => {
            unreachable!("Anthropic 不应映射到 openai-compatible llmVendor")
        }
        ModelProvider::VercelAiGateway => "vercel-ai-gateway",
        ModelProvider::Openrouter => "openrouter",
        ModelProvider::Openai => "openai",
        ModelProvider::Google => "google",
        ModelProvider::GoogleVertexAi => "google-vertex-ai",
        ModelProvider::Volcengine => "volcengine",
        ModelProvider::Azure => "azure",
        ModelProvider::AmazonBedrock => {
            unreachable!("Amazon Bedrock 不应映射到 openai-compatible llmVendor")
        }
        ModelProvider::Custom => "custom",
    }
}

pub(crate) fn anthropic_effort_value(value: Option<&str>) -> Option<&'static str> {
    match value.map(str::trim) {
        Some("low") => Some("low"),
        Some("medium") => Some("medium"),
        Some("high") => Some("high"),
        Some("xhigh") => Some("xhigh"),
        Some("max") => Some("max"),
        _ => None,
    }
}

pub(crate) fn model_capabilities_json(profile: &crate::model_registry::ModelProfile) -> Option<Value> {
    let capabilities = profile.explicit_capabilities()?;
    let mut object = Map::new();
    for capability in capabilities {
        match capability.as_str() {
            "chat" => {
                object.insert("chat".to_string(), Value::Bool(true));
            }
            "image" | "imageInput" => {
                object.insert("imageInput".to_string(), Value::Bool(true));
            }
            "audioInput" => {
                object.insert("audioInput".to_string(), Value::Bool(true));
            }
            "video" | "videoInput" => {
                object.insert("videoInput".to_string(), Value::Bool(true));
            }
            "imageGeneration" => {
                object.insert("imageGeneration".to_string(), Value::Bool(true));
            }
            "videoGeneration" => {
                object.insert("videoGeneration".to_string(), Value::Bool(true));
            }
            _ => {}
        }
    }
    if object.is_empty() {
        None
    } else {
        Some(Value::Object(object))
    }
}
