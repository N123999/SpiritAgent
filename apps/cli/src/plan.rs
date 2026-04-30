use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

use crate::mcp::spirit_agent_data_dir;

pub const USER_PLAN_FILE_NAME: &str = "plan.md";
pub const START_IMPLEMENTING_REMINDER: &str =
    "确定此方案后，请输入\"/start-implementing\" 或手动切换至 Agent 模式后要求开始实现。";

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanMetadata {
    pub path: PathBuf,
    pub exists: bool,
    #[serde(default)]
    pub plan_mode: bool,
    /// 注入系统消息的 Plan 宿主说明（中文）；仅在 `plan_mode` 时由宿主填充。
    #[serde(default)]
    pub plan_mode_host_instructions: String,
}

pub fn user_plan_path() -> PathBuf {
    spirit_agent_data_dir().join(USER_PLAN_FILE_NAME)
}

pub fn current_plan_metadata() -> PlanMetadata {
    plan_metadata_snapshot(false, Path::new("."))
}

/// 与当前磁盘上的 plan.md 及输入模式对齐；`workspace_root` 仅在 `plan_mode == true` 时用于生成宿主系统段。
pub fn plan_metadata_snapshot(plan_mode: bool, workspace_root: &Path) -> PlanMetadata {
    let path = user_plan_path();
    PlanMetadata {
        exists: path.exists(),
        path,
        plan_mode,
        plan_mode_host_instructions: if plan_mode {
            build_plan_mode_host_section(workspace_root)
        } else {
            String::new()
        },
    }
}

/// Plan 模式下写入 **系统消息** 的宿主说明（不含用户原话）。用户消息仅承载用户输入。
pub fn build_plan_mode_host_section(workspace_root: &Path) -> String {
    let target_path = user_plan_path();
    let target_exists = target_path.exists();
    let target_note = if target_exists {
        "目标文件已存在：若与本次需求完全不相干，应删除后新建（delete_file 再 create_file），勿在同一文件里堆 unrelated 内容；若仍相关则先读原文，再按最新需求压缩重写。"
    } else {
        "目标文件目前不存在；如果内容确定且路径可写，直接创建即可。"
    };

    format!(
        "你现在在处理一个 Plan 模式规划请求。\n\n目标:\n- target_path: {target_path}\n- workspace_root: {workspace_root}\n\n要求:\n- 仅当用户明确要做方案、设计或可落地的实现计划时，才撰写或重写 plan.md；除非用户主动要求交付「项目计划书/路线图」类文档，否则不要自行拟一份对整体项目的规划文档。\n- 最终 plan.md 是给后续实现阶段的 LLM 和宿主看的执行文档，不是给人类做项目管理汇报的。\n- 计划要详细到可执行：优先写目标拆解、关键文件、实现顺序、验证方式、风险点与回退策略。\n- 需要事实时先读取仓库内相关文件，不要臆造项目结构、技术栈或现有行为。\n- 避免空话、治理废话和泛泛 checklist；内容应直接影响后续实现行为。\n- 目标文件位于 Spirit 托管的用户目录：{target_path}。你可以在内容确认后使用 create_file 或 edit_file 写入；该路径虽在工作区外，但属于允许写入的托管范围，写入仍会经过正常审批；不要假设自己已经拿到权限，也不要在工具成功前声称“已写入计划”。\n- {target_note}\n- 如果你成功写入或更新 plan.md，后续在同一轮对话中还要再复述一遍最终方案，确保用户无需打开文件也能确认。\n- 在对话结尾必须原样输出这句话：{reminder}\n\n交付方式:\n- 如果你能直接在目标路径落盘，就在确认内容后使用文件工具写入。\n- 如果不能直接落盘，就把最终 plan.md 完整贴在回复里，并明确说明未写入。",
        target_path = target_path.display(),
        workspace_root = workspace_root.display(),
        target_note = target_note,
        reminder = START_IMPLEMENTING_REMINDER,
    )
}

pub fn build_start_implementing_user_turn() -> String {
    let target_path = user_plan_path();
    format!(
        "用户已确认方案并要求开始实现。开始实现前，先读取 Spirit 托管的计划文件 {target_path}，理解其中执行方案后再开始编码与验证。若该文件不存在、无法读取，或内容与当前需求明显不一致，先明确说明并请求用户重新生成或确认计划，不要假设计划内容。",
        target_path = target_path.display(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::shared_env_lock;

    use std::{
        env, fs,
        time::{SystemTime, UNIX_EPOCH},
    };

    fn temp_test_dir(label: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time")
            .as_nanos();
        let dir = env::temp_dir().join(format!("spirit-agent-plan-{label}-{unique}"));
        fs::create_dir_all(&dir).expect("create temp dir");
        dir
    }

    #[test]
    fn user_plan_path_lives_under_spirit_agent_data_dir() {
        let _guard = shared_env_lock()
            .lock()
            .unwrap_or_else(|err| err.into_inner());
        let appdata = temp_test_dir("user-plan-path");
        unsafe {
            env::set_var("APPDATA", &appdata);
            env::remove_var("USERPROFILE");
        }

        let path = user_plan_path();

        assert_eq!(path, appdata.join("SpiritAgent").join(USER_PLAN_FILE_NAME));
    }

    #[test]
    fn current_plan_metadata_reports_existing_file() {
        let _guard = shared_env_lock()
            .lock()
            .unwrap_or_else(|err| err.into_inner());
        let appdata = temp_test_dir("plan-metadata");
        unsafe {
            env::set_var("APPDATA", &appdata);
            env::remove_var("USERPROFILE");
        }
        let path = user_plan_path();
        fs::create_dir_all(path.parent().expect("plan parent")).expect("create plan parent");
        fs::write(&path, "# Plan\n").expect("write plan");

        let metadata = current_plan_metadata();

        assert_eq!(metadata.path, path);
        assert!(metadata.exists);
    }

    #[test]
    fn build_plan_mode_host_section_covers_plan_write_scope_and_reminder() {
        let workspace_root = PathBuf::from("C:/workspace/demo");
        let section = build_plan_mode_host_section(&workspace_root);

        assert!(section.contains("仅当用户明确要做方案"));
        assert!(section.contains("给后续实现阶段的 LLM 和宿主看的执行文档"));
        assert!(section.contains("Spirit 托管的用户目录"));
        assert!(section.contains("create_file 或 edit_file"));
        assert!(section.contains("plan.md"));
        assert!(section.contains(START_IMPLEMENTING_REMINDER));
        assert!(!section.contains("用户需求"));
    }

    #[test]
    fn build_start_implementing_user_turn_requires_reading_plan_first() {
        let prompt = build_start_implementing_user_turn();

        assert!(prompt.contains("先读取 Spirit 托管的计划文件"));
        assert!(prompt.contains("plan.md"));
        assert!(prompt.contains("不要假设计划内容"));
    }
}
