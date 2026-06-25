use anyhow::{Result, anyhow};
use std::env;

use crate::model_registry::ModelProvider;
use crate::ts_bridge::constants::ENV_API_KEY;

use super::TransportHost;

pub(crate) fn resolve_key_from_store(
    host: &TransportHost<'_>,
    model_name: &str,
    provider: Option<ModelProvider>,
) -> Result<String> {
    if provider == Some(ModelProvider::AmazonBedrock) {
        if let Ok(value) =
            crate::model_registry::load_provider_api_key_from_keyring(ModelProvider::AmazonBedrock.as_str())
        {
            let trimmed = value.trim();
            if !trimmed.is_empty() {
                return Ok(trimmed.to_string());
            }
        }
        if crate::model_registry::has_bedrock_runtime_credentials_in_keyring()? {
            return Ok(String::new());
        }
    } else if provider == Some(ModelProvider::GoogleVertexAi) {
        if let Ok(value) = crate::model_registry::load_provider_api_key_from_keyring(
            ModelProvider::GoogleVertexAi.as_str(),
        ) {
            let trimmed = value.trim();
            if !trimmed.is_empty() {
                return Ok(trimmed.to_string());
            }
        }
        if let Some(profile) = host.stored_config.active_model_profile() {
            if crate::model_registry::has_google_vertex_runtime_credentials(
                "",
                profile.vertex_project().as_deref(),
                profile.vertex_location().as_deref(),
            ) {
                return Ok(String::new());
            }
        }
    } else if let Some(provider) = provider {
        if let Ok(value) =
            crate::model_registry::load_provider_api_key_from_keyring(provider.as_str())
        {
            let trimmed = value.trim();
            if !trimmed.is_empty() {
                return Ok(trimmed.to_string());
            }
        }
    }
    if let Some(value) = host.secret_store.load_model_api_key(model_name)? {
        return Ok(value);
    }
    if let Some(value) = host.secret_store.load_global_api_key()? {
        return Ok(value);
    }

    if provider == Some(ModelProvider::AmazonBedrock) {
        return Err(anyhow!(
            "未检测到 Amazon Bedrock 凭证。请在 Desktop 连接向导配置 Bearer API Key 或 IAM 凭证，或设置环境变量 {}",
            ENV_API_KEY
        ));
    }

    if provider == Some(ModelProvider::GoogleVertexAi) {
        return Err(anyhow!(
            "未检测到 Google Vertex AI 凭证。请配置 Express API Key、服务账号（client email + private key）、或 ADC（填写 project/location 并设置 GOOGLE_APPLICATION_CREDENTIALS / gcloud 默认凭证），或设置环境变量 {}",
            ENV_API_KEY
        ));
    }

    Err(anyhow!(
        "未检测到模型 {} 的 API Key。可执行 `spirit model add {} --api-base <url> --key <api_key>` 或设置环境变量 {}",
        model_name,
        model_name,
        ENV_API_KEY
    ))
}

pub(crate) fn resolve_optional_key_from_store(
    host: &TransportHost<'_>,
    model_name: &str,
    provider: Option<ModelProvider>,
) -> Result<Option<String>> {
    if let Ok(value) = env::var(ENV_API_KEY) {
        let trimmed = value.trim();
        if !trimmed.is_empty() {
            return Ok(Some(trimmed.to_string()));
        }
    }
    if let Some(provider) = provider {
        if let Ok(value) =
            crate::model_registry::load_provider_api_key_from_keyring(provider.as_str())
        {
            let trimmed = value.trim();
            if !trimmed.is_empty() {
                return Ok(Some(trimmed.to_string()));
            }
        }
    }
    if let Some(value) = host.secret_store.load_model_api_key(model_name)? {
        return Ok(Some(value));
    }
    host.secret_store.load_global_api_key()
}
