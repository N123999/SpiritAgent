use anyhow::{Context, Result, anyhow};
use std::env;

use crate::{
    adapters::{DefaultAppPaths, JsonConfigStore, KeyringSecretStore},
    mcp::{
        example_github_mcp_config, load_mcp_config, save_mcp_config, set_server_enabled,
        workspace_mcp_config_path,
    },
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
        force: bool,
    },
    Enable {
        name: String,
    },
    Disable {
        name: String,
    },
    Inspect {
        name: String,
    },
    Tools {
        name: String,
    },
    CallTool {
        name: String,
        tool: String,
        args_json: Option<String>,
    },
    Resources {
        name: String,
    },
    Prompts {
        name: String,
    },
    ReadResource {
        name: String,
        uri: String,
    },
    GetPrompt {
        name: String,
        prompt: String,
        args_json: Option<String>,
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
            println!("MCP 配置: {}", manager.config_path().display());

            if servers.len() == 0 {
                println!("未配置任何 MCP server。可先执行 `spirit-agent mcp init` 生成模板。\n");
                println!("提示: 首个模板会生成 GitHub MCP 的 stdio 配置，并使用环境变量 GITHUB_PERSONAL_ACCESS_TOKEN。" );
                return Ok(());
            }

            println!("MCP servers:");
            for server in servers.by_ref() {
                println!(
                    "  - {}\n    display: {}\n    state: {}\n    capabilities: {}\n    transport: {}",
                    server.name,
                    server.display_name,
                    server.state.label(),
                    server.capability_summary(),
                    server.transport_summary(),
                );
            }
        }
        McpCommand::Show => {
            let loaded = load_mcp_config(&workspace_root)?;

            println!("工作区: {}", workspace_root.display());
            println!("MCP 配置: {}", loaded.path.display());
            println!();
            println!("server 数量: {}", loaded.config.servers.len());
            println!();
            println!("MCP 配置:");
            println!("{}", serde_json::to_string_pretty(&loaded.config)?);
        }
        McpCommand::Init { force } => {
            let path = workspace_mcp_config_path(&workspace_root);

            save_mcp_config(&path, &example_github_mcp_config(), force)?;
            println!("已生成 MCP 配置模板: {}", path.display());
            println!("模板默认包含 GitHub MCP 的 stdio 配置。\n请通过环境变量 GITHUB_PERSONAL_ACCESS_TOKEN 注入 PAT，不要把明文凭据提交到仓库。\n随后可执行 `spirit-agent mcp list` 检查配置。"
            );
        }
        McpCommand::Enable { name } => {
            let path = set_server_enabled(&workspace_root, &name, true)?;
            println!(
                "已启用 MCP server: {}\n配置文件: {}",
                name,
                path.display(),
            );
        }
        McpCommand::Disable { name } => {
            let path = set_server_enabled(&workspace_root, &name, false)?;
            println!(
                "已禁用 MCP server: {}\n配置文件: {}",
                name,
                path.display(),
            );
        }
        McpCommand::Inspect { name } => {
            let manager = McpManager::load(workspace_root)?;
            let inspection = manager.inspect_server(&name)?;
            println!("server: {}", inspection.name);
            println!("display: {}", inspection.display_name);
            println!("protocol_version: {}", inspection.protocol_version);
            println!("peer.name: {}", inspection.server_name);
            println!("peer.version: {}", inspection.server_version);
            if let Some(title) = inspection.server_title {
                println!("peer.title: {}", title);
            }
            if let Some(description) = inspection.server_description {
                println!("peer.description: {}", description);
            }
            if let Some(instructions) = inspection.instructions {
                println!("instructions:\n{}", instructions);
            }
            println!("capabilities:");
            println!("  tools: {}", yes_no(inspection.supports_tools));
            println!("  resources: {}", yes_no(inspection.supports_resources));
            println!("  prompts: {}", yes_no(inspection.supports_prompts));
            println!("  logging: {}", yes_no(inspection.supports_logging));
            println!("  completions: {}", yes_no(inspection.supports_completions));
            println!("  tools.listChanged: {}", yes_no(inspection.tools_list_changed));
            println!(
                "  resources.listChanged: {}",
                yes_no(inspection.resources_list_changed)
            );
            println!("  prompts.listChanged: {}", yes_no(inspection.prompts_list_changed));
            println!("counts:");
            println!("  tools: {}", inspection.tools_count);
            println!("  resources: {}", inspection.resources_count);
            println!("  resource_templates: {}", inspection.resource_templates_count);
            println!("  prompts: {}", inspection.prompts_count);
        }
        McpCommand::Tools { name } => {
            let manager = McpManager::load(workspace_root)?;
            let tools = manager.list_tools(&name)?;
            if tools.is_empty() {
                println!("MCP server {} 当前没有可见 tools。", name);
            } else {
                println!("tools ({}):", tools.len());
                for tool in tools {
                    println!("  - {}", tool.name);
                    if let Some(title) = tool.title {
                        println!("    title: {}", title);
                    }
                    if let Some(description) = tool.description {
                        println!("    description: {}", description);
                    }
                }
            }
        }
        McpCommand::CallTool {
            name,
            tool,
            args_json,
        } => {
            let manager = McpManager::load(workspace_root)?;
            let arguments = parse_optional_json_object(args_json.as_deref())?;
            let value = manager.call_tool(&name, &tool, arguments)?;
            println!("{}", serde_json::to_string_pretty(&value)?);
        }
        McpCommand::Resources { name } => {
            let manager = McpManager::load(workspace_root)?;
            let resources = manager.list_resources(&name)?;
            if resources.is_empty() {
                println!("MCP server {} 当前没有可见 resources。", name);
            } else {
                println!("resources ({}):", resources.len());
                for resource in resources {
                    println!("  - {}", resource.uri);
                    println!("    name: {}", resource.name);
                    if let Some(title) = resource.title {
                        println!("    title: {}", title);
                    }
                    if let Some(description) = resource.description {
                        println!("    description: {}", description);
                    }
                    if let Some(mime) = resource.mime_type {
                        println!("    mime: {}", mime);
                    }
                    if let Some(size) = resource.size {
                        println!("    size: {}", size);
                    }
                }
            }
        }
        McpCommand::Prompts { name } => {
            let manager = McpManager::load(workspace_root)?;
            let prompts = manager.list_prompts(&name)?;
            if prompts.is_empty() {
                println!("MCP server {} 当前没有可见 prompts。", name);
            } else {
                println!("prompts ({}):", prompts.len());
                for prompt in prompts {
                    println!("  - {}", prompt.name);
                    if let Some(title) = prompt.title {
                        println!("    title: {}", title);
                    }
                    if let Some(description) = prompt.description {
                        println!("    description: {}", description);
                    }
                    if !prompt.arguments.is_empty() {
                        println!("    arguments:");
                        for arg in prompt.arguments {
                            println!(
                                "      - {}{}",
                                arg.name,
                                if arg.required { " (required)" } else { "" }
                            );
                            if let Some(title) = arg.title {
                                println!("        title: {}", title);
                            }
                            if let Some(description) = arg.description {
                                println!("        description: {}", description);
                            }
                        }
                    }
                }
            }
        }
        McpCommand::ReadResource { name, uri } => {
            let manager = McpManager::load(workspace_root)?;
            let value = manager.read_resource(&name, &uri)?;
            println!("{}", serde_json::to_string_pretty(&value)?);
        }
        McpCommand::GetPrompt {
            name,
            prompt,
            args_json,
        } => {
            let manager = McpManager::load(workspace_root)?;
            let arguments = parse_optional_json_object(args_json.as_deref())?;
            let value = manager.get_prompt(&name, &prompt, arguments)?;
            println!("{}", serde_json::to_string_pretty(&value)?);
        }
    }

    Ok(())
}

fn parse_optional_json_object(input: Option<&str>) -> Result<Option<serde_json::Map<String, serde_json::Value>>> {
    let Some(raw) = input else {
        return Ok(None);
    };

    let value: serde_json::Value =
        serde_json::from_str(raw).with_context(|| format!("JSON 解析失败: {}", raw))?;
    match value {
        serde_json::Value::Object(map) => Ok(Some(map)),
        _ => Err(anyhow!("args-json 必须是 JSON object，例如 `{{\"owner\":\"microsoft\"}}`")),
    }
}

fn yes_no(flag: bool) -> &'static str {
    if flag {
        "yes"
    } else {
        "no"
    }
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
