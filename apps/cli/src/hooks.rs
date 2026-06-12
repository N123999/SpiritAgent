use std::path::PathBuf;

use anyhow::Result;

use crate::{
    adapters::{DefaultAppPaths, KeyringSecretStore},
    hooks_types::{HookListItem, HooksValidationReport},
    ports::AppPaths,
    ts_bridge::TsBridgeRuntime,
};

pub enum HookCommand {
    List {
        workspace: Option<PathBuf>,
    },
    Validate {
        workspace: Option<PathBuf>,
    },
}

pub fn handle_hooks_cli(action: HookCommand) -> Result<()> {
    let app_paths = DefaultAppPaths::new();
    match action {
        HookCommand::List { workspace } => {
            let workspace_root = workspace.unwrap_or_else(|| app_paths.workspace_root());
            let mut runtime = TsBridgeRuntime::new_mcp_only(
                std::sync::Arc::new(KeyringSecretStore),
                workspace_root.clone(),
            )?;
            let items = runtime.list_hook_entries(Some(workspace_root.to_string_lossy().as_ref()))?;
            print_hooks_list(&items);
        }
        HookCommand::Validate { workspace } => {
            let workspace_root = workspace.unwrap_or_else(|| app_paths.workspace_root());
            let mut runtime = TsBridgeRuntime::new_mcp_only(
                std::sync::Arc::new(KeyringSecretStore),
                workspace_root.clone(),
            )?;
            let report = runtime.validate_hooks(Some(workspace_root.to_string_lossy().as_ref()))?;
            print_hooks_validation_report(&report);
        }
    }
    Ok(())
}

fn hook_scope_label(scope: &str) -> &str {
    if scope == "workspace" {
        "工作区"
    } else {
        "用户"
    }
}

fn print_hooks_list(items: &[HookListItem]) {
    if items.is_empty() {
        println!("未配置任何 Hook 条目。可在 TUI 中使用 /hooks add 添加。");
        return;
    }

    println!("已配置 Hook 条目 ({}):", items.len());
    for item in items {
        println!(
            "  - {} [{}] #{}  {}",
            item.event,
            hook_scope_label(&item.scope),
            item.index,
            item.command,
        );
    }
}

fn print_hooks_validation_report(report: &HooksValidationReport) {
    println!("用户 Hooks 配置: {}", report.user_config_path);
    if let Some(workspace_path) = &report.workspace_config_path {
        println!("工作区 Hooks 配置: {workspace_path}");
    } else {
        println!("工作区 Hooks 配置: (未绑定工作区)");
    }
    println!();
    println!("事件条目统计:");
    for (event, count) in &report.summary {
        println!("  - {event}: {count}");
    }
    println!();
    if report.entries.is_empty() {
        println!("未配置任何 Hook 条目。");
        return;
    }

    println!("Hook 条目:");
    for entry in &report.entries {
        let status = if entry.exists { "ok" } else { "missing" };
        println!(
            "  - [{status}] {}:{}#{} ({}) -> {}",
            entry.scope, entry.event, entry.index, entry.command, entry.resolved_path,
        );
    }
}
