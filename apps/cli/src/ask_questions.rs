use anyhow::{Result, anyhow};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AskQuestionsQuestionKind {
    SingleSelect,
    MultiSelect,
    Text,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AskQuestionsOptionSpec {
    pub label: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AskQuestionsQuestionSpec {
    pub id: String,
    pub title: String,
    pub kind: AskQuestionsQuestionKind,
    #[serde(default)]
    pub required: bool,
    #[serde(default)]
    pub options: Vec<AskQuestionsOptionSpec>,
    #[serde(default)]
    pub allow_custom_input: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub custom_input_placeholder: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub custom_input_label: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AskQuestionsRequest {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    pub questions: Vec<AskQuestionsQuestionSpec>,
}

impl AskQuestionsRequest {
    pub fn validate(&self) -> Result<()> {
        if self.questions.is_empty() {
            return Err(anyhow!("ask_questions 至少需要一个问题"));
        }

        let mut seen_ids = HashSet::new();
        for question in &self.questions {
            let id = question.id.trim();
            if id.is_empty() {
                return Err(anyhow!("ask_questions 问题 id 不能为空"));
            }
            if !seen_ids.insert(id.to_string()) {
                return Err(anyhow!("ask_questions 问题 id 不能重复: {}", id));
            }
            if question.title.trim().is_empty() {
                return Err(anyhow!("ask_questions 问题标题不能为空: {}", id));
            }

            match question.kind {
                AskQuestionsQuestionKind::SingleSelect | AskQuestionsQuestionKind::MultiSelect => {
                    if question.options.is_empty() && !question.allow_custom_input {
                        return Err(anyhow!(
                            "ask_questions 选择题至少需要一个预设选项或开启自定义输入: {}",
                            id
                        ));
                    }
                    for option in &question.options {
                        if option.label.trim().is_empty() {
                            return Err(anyhow!("ask_questions 选项文本不能为空: {}", id));
                        }
                    }
                }
                AskQuestionsQuestionKind::Text => {
                    if !question.options.is_empty() {
                        return Err(anyhow!("ask_questions 文本题不能包含 options: {}", id));
                    }
                }
            }
        }

        Ok(())
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AskQuestionsStatus {
    Answered,
    Skipped,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AskQuestionsAnswer {
    pub question_id: String,
    pub title: String,
    pub kind: AskQuestionsQuestionKind,
    pub answered: bool,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub selected_option_indexes: Vec<usize>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub selected_option_labels: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub custom_input: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AskQuestionsResult {
    pub status: AskQuestionsStatus,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub answers: Vec<AskQuestionsAnswer>,
}

impl AskQuestionsResult {
    pub fn skipped() -> Self {
        Self {
            status: AskQuestionsStatus::Skipped,
            answers: Vec::new(),
        }
    }
}
