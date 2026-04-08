use anyhow::{Context, Result, anyhow};
use std::env;

use crate::{
    adapters::{DefaultAppPaths, JsonConfigStore, KeyringSecretStore},
    mcp::{McpConfigScope, example_github_mcp_config, load_merged_mcp_config, save_mcp_config},
    mcp_manager::McpManager,
    model_registry::{AppConfig, DEFAULT_API_BASE, ModelProfile},
    ports::{AppPaths, ConfigStore, SecretStore},
};

const ENV_API_KEY: &str = "SPIRIT_API_KEY";

pub enum ModelCommand {
    List,
    Add {
        name: String,
        api_base: Option<String>,
        key: Option<String>,
    },
    Remove {
        name: String,
    },
    Use {
        name: String,
    },
    Current,
}

pub enum ConfigCommand {
    Show,
    SetBase {
        url: String,
    },
    Key {
        action: KeyCommand,
    },
}

pub enum KeyCommand {
    Set {
        value: Option<String>,
    },
    Remove,
    Status,
}

pub enum McpCommand {
    List,
    Show,
    Init {
        scope: McpConfigScope,
        force: bool,
    },
}

pub fn handle_model_cli(action: ModelCommand) -> Result<()> {
    let config_store = JsonConfigStore;
    let secret_store = KeyringSecretStore;
    let mut cfg = config_store.load()?;

    match action {
        ModelCommand::List => {
            println!("当前模型: {}", cfg.active_model);
            println!("模型列表:");
            for model in &cfg.models {
                let key_saved = secret_store.has_model_api_key(&model.name).unwrap_or(false);
                println!(
                    "  - {}\n    api_base: {}\n    key: {}",
                    model.name,
                    model.api_base,
                    if key_saved { "已保存" } else { "未保存" }
                );
            }
        }
        ModelCommand::Add {
            name,
            api_base,
            key,
        } => {
            if cfg.has_model(&name) {
                println!("模型已存在: {}", name);
            } else {
                let api_base = api_base.unwrap_or_else(|| DEFAULT_API_BASE.to_string());
                let key_value = match key {
                    Some(v) => v,
                    None => rpassword::prompt_password("请输入该模型 API Key: ")
                        .context("读取 API Key 输入失败")?,
                };
                if key_value.trim().is_empty() {
                    return Err(anyhow!("API Key 不能为空"));
                }

                cfg.add_model(ModelProfile {
                    name: name.clone(),
                    api_base: api_base.clone(),
                });
                secret_store.save_model_api_key(&name, &key_value)?;
                config_store.save(&cfg)?;
                println!("已添加模型: {}", name);
                println!("api_base: {}", api_base);
            }
        }
        ModelCommand::Remove { name } => {
            if name == cfg.active_model {
                return Err(anyhow!("不能删除当前模型，请先切换到其他模型"));
            }
            let before = cfg.models.len();
            cfg.models.retain(|m| m.name != name);
            if cfg.models.len() == before {
                println!("模型不存在: {}", name);
            } else {
                config_store.save(&cfg)?;
                let _ = secret_store.remove_model_api_key(&name);
                println!("已删除模型: {}", name);
            }
        }
        ModelCommand::Use { name } => {
            if !cfg.has_model(&name) {
                return Err(anyhow!("模型不存在，请先添加: {}", name));
            }
            cfg.active_model = name.clone();
            config_store.save(&cfg)?;
            println!("已切换当前模型为: {}", name);
        }
        ModelCommand::Current => {
            println!("当前模型: {}", cfg.active_model);
        }
    }

    Ok(())
}

pub fn handle_config_cli(action: ConfigCommand) -> Result<()> {
    let config_store = JsonConfigStore;
    let secret_store = KeyringSecretStore;
    let app_paths = DefaultAppPaths::new();
    let mut cfg = config_store.load()?;

    match action {
        ConfigCommand::Show => {
            println!("配置文件: {}", app_paths.config_file().display());
            println!("active_model: {}", cfg.active_model);
            println!("models:");
            for model in &cfg.models {
                let key_saved = secret_store.has_model_api_key(&model.name).unwrap_or(false);
                println!(
                    "  - {} (api_base: {}, key: {})",
                    model.name,
                    model.api_base,
                    if key_saved { "已保存" } else { "未保存" }
                );
            }
            println!(
                "环境变量 {}: {}",
                ENV_API_KEY,
                if env::var(ENV_API_KEY).is_ok() {
                    "已设置"
                } else {
                    "未设置"
                }
            );
            let keyring_saved = secret_store
                .load_global_api_key()
                .map(|v| v.is_some())
                .unwrap_or(false);
            println!(
                "系统安全凭据(keyring): {}",
                if keyring_saved { "已保存" } else { "未保存" }
            );
            println!("API Key 读取优先级: {} > 模型专属 keyring > 全局 keyring", ENV_API_KEY);
        }
        ConfigCommand::SetBase { url } => {
            if let Some(active) = cfg.active_model_profile_mut() {
                active.api_base = url.clone();
            }
            config_store.save(&cfg)?;
            println!("已更新当前模型 API Base: {}", url);
        }
        ConfigCommand::Key { action } => handle_key_cli(action, &secret_store)?,
    }

    Ok(())
}

pub fn handle_mcp_cli(action: McpCommand) -> Result<()> {
    let app_paths = DefaultAppPaths::new();
    let workspace_root = app_paths.workspace_root();

    match action {
        McpCommand::List => {
            let manager = McpManager::load(workspace_root.clone())?;
            let mut servers = manager.servers();

            println!("工作区: {}", manager.workspace_root().display());
            println!("用户级 MCP 配置: {}", manager.user_config_path().display());
            println!("工作区 MCP 配置: {}", manager.workspace_config_path().display());

            if servers.len() == 0 {
                println!("未配置任何 MCP server。可先执行 `spirit-agent mcp init --scope workspace` 生成模板。\n");
                println!("提示: 首个模板会生成 GitHub MCP 的 stdio 配置，并使用环境变量 GITHUB_PERSONAL_ACCESS_TOKEN。" );
                return Ok(());
            }

            println!("MCP servers:");
            for server in servers.by_ref() {
                println!(
                    "  - {}\n    display: {}\n    source: {}\n    state: {}\n    trusted: {}\n    capabilities: {}\n    transport: {}",
                    server.name,
                    server.display_name,
                    server.source,
                    server.state.label(),
                    if server.trusted { "yes" } else { "no" },
                    server.capability_summary(),
                    server.transport_summary(),
                );
            }
        }
        McpCommand::Show => {
            let loaded = load_merged_mcp_config(&workspace_root)?;

            println!("工作区: {}", workspace_root.display());
            println!("用户级 MCP 配置: {}", loaded.user_path.display());
            println!("工作区 MCP 配置: {}", loaded.workspace_path.display());
            println!();
            println!("用户级 server 数量: {}", loaded.user_config.servers.len());
            println!("工作区 server 数量: {}", loaded.workspace_config.servers.len());
            println!("合并后 server 数量: {}", loaded.merged.servers.len());
            println!();
            println!("合并后 MCP 配置:");
            println!("{}", serde_json::to_string_pretty(&loaded.merged)?);
        }
        McpCommand::Init { scope, force } => {
            let path = match scope {
                McpConfigScope::User => crate::mcp::user_mcp_config_path(),
                McpConfigScope::Workspace => crate::mcp::workspace_mcp_config_path(&workspace_root),
            };

            save_mcp_config(&path, &example_github_mcp_config(), force)?;
            println!("已生成 MCP 配置模板: {}", path.display());
            println!("模板默认包含 GitHub MCP 的 stdio 配置。\n请通过环境变量 GITHUB_PERSONAL_ACCESS_TOKEN 注入 PAT，不要把明文凭据提交到仓库。\n随后可执行 `spirit-agent mcp list` 检查配置。"
            );
        }
    }

    Ok(())
}

fn handle_key_cli(action: KeyCommand, secret_store: &KeyringSecretStore) -> Result<()> {
    match action {
        KeyCommand::Set { value } => {
            let key = match value {
                Some(v) => v,
                None => rpassword::prompt_password("请输入 API Key: ")
                    .context("读取 API Key 输入失败")?,
            };

            if key.trim().is_empty() {
                return Err(anyhow!("API Key 不能为空"));
            }

            secret_store.save_global_api_key(key.trim())?;
            println!(
                "已写入 API Key 到系统安全凭据。\n优先级仍为环境变量 {} > keyring。",
                ENV_API_KEY
            );
        }
        KeyCommand::Remove => {
            secret_store.remove_global_api_key()?;
            println!("已删除 keyring 中保存的 API Key。");
        }
        KeyCommand::Status => {
            let env_set = env::var(ENV_API_KEY)
                .ok()
                .map(|s| !s.trim().is_empty())
                .unwrap_or(false);

            let keyring_set = secret_store
                .load_global_api_key()
                .map(|v| v.is_some())
                .unwrap_or(false);

            println!("{}: {}", ENV_API_KEY, if env_set { "已设置" } else { "未设置" });
            println!(
                "系统安全凭据(keyring): {}",
                if keyring_set { "已保存" } else { "未保存" }
            );
            println!("当前读取优先级: {} > 模型专属 keyring > 全局 keyring", ENV_API_KEY);
        }
    }

    Ok(())
}

pub fn load_or_default_config() -> AppConfig {
    JsonConfigStore
        .load()
        .unwrap_or_else(|_| AppConfig::default())
}
