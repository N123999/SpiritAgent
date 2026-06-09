use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

use crate::{
    llm_types::LlmMessage,
    mcp::spirit_agent_data_dir,
    ports::ArchivedLlmMessage,
};

pub const PLANS_DIR_NAME: &str = "plans";

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanMetadata {
    pub path: PathBuf,
    pub exists: bool,
    #[serde(default = "default_agent_mode")]
    pub agent_mode: String,
    #[serde(default)]
    pub plan_mode: bool,
}

fn default_agent_mode() -> String {
    "agent".to_string()
}

pub fn user_plans_dir() -> PathBuf {
    spirit_agent_data_dir().join(PLANS_DIR_NAME)
}

impl PlanMetadata {
    pub fn spirit_agent_mode(&self) -> &str {
        match self.agent_mode.as_str() {
            "agent" | "plan" | "ask" | "debug" => self.agent_mode.as_str(),
            _ if self.plan_mode => "plan",
            _ => "agent",
        }
    }
}

pub fn plan_metadata_snapshot(agent_mode: &str, active_plan_path: Option<&Path>) -> PlanMetadata {
    let path = active_plan_path
        .filter(|candidate| !candidate.as_os_str().is_empty())
        .map(PathBuf::from)
        .unwrap_or_default();
    let plan_mode = agent_mode == "plan";
    PlanMetadata {
        exists: !path.as_os_str().is_empty() && path.exists(),
        path,
        agent_mode: agent_mode.to_string(),
        plan_mode,
    }
}

pub fn extract_active_plan_path_from_llm_history(history: &[LlmMessage]) -> Option<PathBuf> {
    for message in history.iter().rev() {
        if message.role != "tool" && message.role != "assistant" {
            continue;
        }
        if let Some(path) = parse_create_plan_path_from_tool_output(&message.content) {
            return Some(PathBuf::from(path));
        }
    }
    None
}

pub fn parse_create_plan_path_from_tool_output(output: &str) -> Option<String> {
    output
        .lines()
        .find_map(|line| line.strip_prefix("path: "))
        .map(str::trim)
        .filter(|path| !path.is_empty())
        .filter(|_| output.contains("[plan]"))
        .map(str::to_string)
}

pub fn extract_active_plan_path_from_archived_llm_history(
    history: &[ArchivedLlmMessage],
) -> Option<PathBuf> {
    for message in history.iter().rev() {
        if message.role != "tool" && message.role != "assistant" {
            continue;
        }
        if let Some(path) = parse_create_plan_path_from_tool_output(&message.text_content()) {
            return Some(PathBuf::from(path));
        }
    }
    None
}

pub fn build_start_implementing_user_turn(active_plan_path: Option<&Path>) -> String {
    match active_plan_path.filter(|path| !path.as_os_str().is_empty()) {
        Some(path) => format!(
            "用户已确认方案并要求开始实现。开始实现前，先读取 Spirit 托管的计划文件 {}，理解其中执行方案后再开始编码与验证。若该文件不存在、无法读取，或内容与当前需求明显不一致，先明确说明并请求用户重新生成或确认计划，不要假设计划内容。",
            path.display()
        ),
        None => "用户已确认方案并要求开始实现。本会话尚未记录可用的实施计划路径；请先使用 create_plan 创建计划后再开始实现。".to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::shared_env_lock;

    use std::{
        env, fs,
        time::{SystemTime, UNIX_EPOCH},
    };

    fn unique_spirit_data_dir(label: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or(0);
        env::temp_dir().join(format!(
            "spirit-agent-plan-test-{label}-{nanos}-{}",
            std::process::id()
        ))
    }

    #[test]
    fn plan_metadata_snapshot_uses_active_plan_path() {
        let _lock = shared_env_lock();
        let spirit_data_dir = unique_spirit_data_dir("snapshot");
        unsafe {
            env::set_var("SPIRIT_AGENT_DATA_DIR", &spirit_data_dir);
        }
        let plan_path = user_plans_dir().join("demo-plan.md");
        fs::create_dir_all(plan_path.parent().expect("plans parent")).expect("create plans dir");
        fs::write(&plan_path, "# Demo").expect("write plan");

        let metadata = plan_metadata_snapshot("agent", Some(&plan_path));
        assert_eq!(metadata.path, plan_path);
        assert!(metadata.exists);
    }

    fn llm_tool_message(content: &str) -> LlmMessage {
        LlmMessage {
            role: "tool",
            content: content.to_string(),
            image_paths: Vec::new(),
            tool_call_id: Some("call-1".to_string()),
            tool_calls: None,
            provider_state: None,
        }
    }

    #[test]
    fn extract_active_plan_path_from_llm_history_reads_last_create_plan() {
        let history = vec![
            llm_tool_message("[plan]\npath: /tmp/first.md\naction: create_plan"),
            llm_tool_message("[plan]\npath: /tmp/second.md\naction: create_plan"),
        ];
        assert_eq!(
            extract_active_plan_path_from_llm_history(&history),
            Some(PathBuf::from("/tmp/second.md"))
        );
    }

    #[test]
    fn build_start_implementing_user_turn_requires_active_plan_path() {
        assert!(build_start_implementing_user_turn(None).contains("create_plan"));
        let prompt = build_start_implementing_user_turn(Some(Path::new("/tmp/plan.md")));
        assert!(prompt.contains("/tmp/plan.md"));
    }
}
