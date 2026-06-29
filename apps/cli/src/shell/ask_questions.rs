use rust_i18n::t;

use crate::{
    ask_questions::{AskQuestionsAnswer, AskQuestionsRequest, AskQuestionsResult},
    view::{
        AskQuestionsInputFieldView, AskQuestionsOptionView, AskQuestionsQuestionView,
        BottomFormFieldEditorView, BottomFormFieldView, BottomFormKind, BottomFormView,
    },
};

pub(crate) enum AskQuestionsActivateOutcome {
    None,
    Submit(AskQuestionsResult),
}

pub(crate) fn new_form(
    tool_call_id: impl Into<String>,
    tool_name: impl Into<String>,
    request: AskQuestionsRequest,
) -> BottomFormView {
    let title = request
        .title
        .clone()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| t!("form.ask_questions.title_default").into_owned());
    let fields = request
        .questions
        .iter()
        .map(|question| BottomFormFieldView {
            label: question.title.clone(),
            help: String::new(),
            editor: BottomFormFieldEditorView::AskQuestion {
                question: AskQuestionsQuestionView {
                    id: question.id.clone(),
                    allow_multiple: question.allow_multiple,
                    options: question
                        .options
                        .iter()
                        .map(|option| AskQuestionsOptionView {
                            id: option.id.clone(),
                            label: option.label.clone(),
                            summary: option.summary.clone(),
                            selected: false,
                        })
                        .collect(),
                    selected_row: 0,
                    custom_input: AskQuestionsInputFieldView {
                        label: t!("form.ask_questions.custom_input.label").into_owned(),
                        placeholder: t!("form.ask_questions.custom_input.placeholder")
                            .into_owned(),
                        value: String::new(),
                        cursor: 0,
                    },
                },
            },
        })
        .collect();

    BottomFormView {
        kind: BottomFormKind::AskQuestions {
            tool_call_id: tool_call_id.into(),
            tool_name: tool_name.into(),
            request,
            submit_selected: false,
            validation_message: None,
        },
        title,
        fields,
        selected_field: 0,
        scroll_offset: 0,
        footer_hint: String::new(),
    }
}

pub(crate) fn dismiss_result() -> AskQuestionsResult {
    AskQuestionsResult::skipped()
}

pub(crate) fn current_question(form: &BottomFormView) -> Option<&AskQuestionsQuestionView> {
    match form
        .fields
        .get(form.selected_field.min(form.fields.len().saturating_sub(1)))
        .map(|field| &field.editor)
    {
        Some(BottomFormFieldEditorView::AskQuestion { question }) => Some(question),
        _ => None,
    }
}

pub(crate) fn submit_selected(form: &BottomFormView) -> bool {
    match &form.kind {
        BottomFormKind::AskQuestions {
            submit_selected, ..
        } => *submit_selected,
        _ => false,
    }
}

pub(crate) fn validation_message(form: &BottomFormView) -> Option<&str> {
    match &form.kind {
        BottomFormKind::AskQuestions {
            validation_message, ..
        } => validation_message.as_deref(),
        _ => None,
    }
}

pub(crate) fn answered_question_count(form: &BottomFormView) -> usize {
    form.fields
        .iter()
        .filter(|field| match &field.editor {
            BottomFormFieldEditorView::AskQuestion { question } => question_answered(question),
            _ => false,
        })
        .count()
}

pub(crate) fn select_prev_row(form: &mut BottomFormView) {
    clear_validation(form);
    if submit_selected(form) {
        set_submit_selected(form, false);
        return;
    }

    let Some(question) = current_question_mut(form) else {
        return;
    };
    if question.selected_row > 0 {
        question.selected_row -= 1;
    }
}

pub(crate) fn select_next_row(form: &mut BottomFormView) {
    clear_validation(form);
    if submit_selected(form) {
        return;
    }

    let Some(question) = current_question_mut(form) else {
        return;
    };
    let row_count = question_row_count(question);
    if question.selected_row + 1 < row_count {
        question.selected_row += 1;
    }
}

pub(crate) fn move_left(form: &mut BottomFormView) {
    clear_validation(form);
    if submit_selected(form) {
        set_submit_selected(form, false);
        return;
    }
    if form.selected_field > 0 {
        form.selected_field -= 1;
        form.scroll_offset = 0;
    }
}

pub(crate) fn move_right(form: &mut BottomFormView) {
    clear_validation(form);
    if submit_selected(form) {
        return;
    }
    if form.selected_field + 1 < form.fields.len() {
        form.selected_field += 1;
        form.scroll_offset = 0;
    } else {
        set_submit_selected(form, true);
    }
}

pub(crate) fn move_home(form: &mut BottomFormView) {
    clear_validation(form);
    if submit_selected(form) {
        set_submit_selected(form, false);
        form.selected_field = 0;
        form.scroll_offset = 0;
        return;
    }
    if is_custom_input_row(form) {
        question_mut(form).custom_input.cursor = 0;
    } else if let Some(question) = current_question_mut(form) {
        question.selected_row = 0;
    }
}

pub(crate) fn move_end(form: &mut BottomFormView) {
    clear_validation(form);
    if submit_selected(form) {
        return;
    }
    if is_custom_input_row(form) {
        let question = question_mut(form);
        question.custom_input.cursor = question.custom_input.value.chars().count();
    } else if let Some(question) = current_question_mut(form) {
        question.selected_row = question_row_count(question).saturating_sub(1);
    }
}

pub(crate) fn insert_char(form: &mut BottomFormView, ch: char) {
    if ch == '\n' || ch == '\r' {
        return;
    }
    clear_validation(form);
    if !is_custom_input_row(form) {
        return;
    }
    let question = question_mut(form);
    if !question.allow_multiple {
        clear_option_selections(question);
    }
    let input = &mut question.custom_input;
    let index = char_cursor_to_byte_index(&input.value, input.cursor);
    input.value.insert(index, ch);
    input.cursor += 1;
}

pub(crate) fn insert_text(form: &mut BottomFormView, text: &str) {
    let normalized = text.replace("\r\n", " ").replace(['\r', '\n'], " ");
    if normalized.is_empty() {
        return;
    }
    clear_validation(form);
    if !is_custom_input_row(form) {
        return;
    }
    let question = question_mut(form);
    if !question.allow_multiple {
        clear_option_selections(question);
    }
    let input = &mut question.custom_input;
    let index = char_cursor_to_byte_index(&input.value, input.cursor);
    input.value.insert_str(index, normalized.as_str());
    input.cursor += normalized.chars().count();
}

pub(crate) fn backspace(form: &mut BottomFormView) {
    clear_validation(form);
    if !is_custom_input_row(form) {
        return;
    }
    let input = &mut question_mut(form).custom_input;
    if input.cursor == 0 {
        return;
    }
    let end = char_cursor_to_byte_index(&input.value, input.cursor);
    let start = char_cursor_to_byte_index(&input.value, input.cursor.saturating_sub(1));
    input.value.replace_range(start..end, "");
    input.cursor -= 1;
}

pub(crate) fn delete(form: &mut BottomFormView) {
    clear_validation(form);
    if !is_custom_input_row(form) {
        return;
    }
    let input = &mut question_mut(form).custom_input;
    if input.cursor >= input.value.chars().count() {
        return;
    }
    let start = char_cursor_to_byte_index(&input.value, input.cursor);
    let end = char_cursor_to_byte_index(&input.value, input.cursor.saturating_add(1));
    input.value.replace_range(start..end, "");
}

pub(crate) fn activate(form: &mut BottomFormView) -> Result<AskQuestionsActivateOutcome, String> {
    clear_validation(form);
    if submit_selected(form) {
        return match build_answered_result(form) {
            Ok(result) => Ok(AskQuestionsActivateOutcome::Submit(result)),
            Err(message) => {
                set_validation(form, message);
                Ok(AskQuestionsActivateOutcome::None)
            }
        };
    }

    let Some(selected_question_index) = selected_question_index(form) else {
        return Ok(AskQuestionsActivateOutcome::None);
    };

    let mut should_advance = false;

    {
        let Some(question) = question_by_index_mut(form, selected_question_index) else {
            return Ok(AskQuestionsActivateOutcome::None);
        };

        let row = question.selected_row;
        if row < question.options.len() {
            if question.allow_multiple {
                if let Some(option) = question.options.get_mut(row) {
                    option.selected = !option.selected;
                }
            } else {
                clear_option_selections(question);
                if let Some(option) = question.options.get_mut(row) {
                    option.selected = true;
                }
                question.custom_input.value.clear();
                question.custom_input.cursor = 0;
                should_advance = true;
            }
        } else {
            should_advance = true;
        }
    }

    if should_advance {
        advance_to_next_question(form);
    }

    Ok(AskQuestionsActivateOutcome::None)
}

pub(crate) fn question_answered(question: &AskQuestionsQuestionView) -> bool {
    question.options.iter().any(|option| option.selected)
        || !question.custom_input.value.trim().is_empty()
}

pub(crate) fn question_row_count(question: &AskQuestionsQuestionView) -> usize {
    question.options.len() + 1
}

fn build_answered_result(form: &mut BottomFormView) -> Result<AskQuestionsResult, String> {
    let answers = form
        .fields
        .iter()
        .filter_map(|field| match &field.editor {
            BottomFormFieldEditorView::AskQuestion { question } => Some(AskQuestionsAnswer {
                question_id: question.id.clone(),
                selected_option_ids: question
                    .options
                    .iter()
                    .filter(|option| option.selected)
                    .map(|option| option.id.clone())
                    .collect(),
                custom_text: {
                    let value = question.custom_input.value.trim().to_string();
                    if value.is_empty() {
                        None
                    } else {
                        Some(value)
                    }
                },
            }),
            _ => None,
        })
        .collect();

    Ok(AskQuestionsResult {
        status: crate::ask_questions::AskQuestionsStatus::Answered,
        answers,
    })
}

fn advance_to_next_question(form: &mut BottomFormView) {
    if form.selected_field + 1 < form.fields.len() {
        form.selected_field += 1;
        form.scroll_offset = 0;
        set_submit_selected(form, false);
    } else {
        set_submit_selected(form, true);
    }
}

fn clear_option_selections(question: &mut AskQuestionsQuestionView) {
    for option in &mut question.options {
        option.selected = false;
    }
}

fn is_custom_input_row(form: &BottomFormView) -> bool {
    current_question(form)
        .is_some_and(|question| question.selected_row >= question.options.len())
}

fn question_mut(form: &mut BottomFormView) -> &mut AskQuestionsQuestionView {
    current_question_mut(form).expect("ask question field must exist")
}

fn current_question_mut(form: &mut BottomFormView) -> Option<&mut AskQuestionsQuestionView> {
    let selected = selected_question_index(form)?;
    match form.fields.get_mut(selected).map(|field| &mut field.editor) {
        Some(BottomFormFieldEditorView::AskQuestion { question }) => Some(question),
        _ => None,
    }
}

fn question_by_index_mut(
    form: &mut BottomFormView,
    index: usize,
) -> Option<&mut AskQuestionsQuestionView> {
    match form.fields.get_mut(index).map(|field| &mut field.editor) {
        Some(BottomFormFieldEditorView::AskQuestion { question }) => Some(question),
        _ => None,
    }
}

fn selected_question_index(form: &BottomFormView) -> Option<usize> {
    if form.fields.is_empty() {
        None
    } else {
        Some(form.selected_field.min(form.fields.len().saturating_sub(1)))
    }
}

fn set_submit_selected(form: &mut BottomFormView, selected: bool) {
    if let BottomFormKind::AskQuestions {
        submit_selected, ..
    } = &mut form.kind
    {
        *submit_selected = selected;
    }
}

fn clear_validation(form: &mut BottomFormView) {
    if let BottomFormKind::AskQuestions {
        validation_message, ..
    } = &mut form.kind
    {
        *validation_message = None;
    }
}

fn set_validation(form: &mut BottomFormView, message: String) {
    if let BottomFormKind::AskQuestions {
        validation_message, ..
    } = &mut form.kind
    {
        *validation_message = Some(message);
    }
}

fn char_cursor_to_byte_index(text: &str, cursor_chars: usize) -> usize {
    if cursor_chars == 0 {
        return 0;
    }
    text.char_indices()
        .nth(cursor_chars)
        .map(|(index, _)| index)
        .unwrap_or(text.len())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ask_questions::{AskQuestionsOptionSpec, AskQuestionsQuestionSpec, AskQuestionsStatus};

    fn build_form(questions: Vec<AskQuestionsQuestionSpec>) -> BottomFormView {
        new_form(
            "call-1",
            "ask_questions",
            AskQuestionsRequest {
                title: Some("Need details".to_string()),
                questions,
            },
        )
    }

    fn single_select_question(id: &str, title: &str) -> AskQuestionsQuestionSpec {
        AskQuestionsQuestionSpec {
            id: id.to_string(),
            title: title.to_string(),
            allow_multiple: false,
            options: vec![
                AskQuestionsOptionSpec {
                    id: "a".to_string(),
                    label: "A".to_string(),
                    summary: Some("Option A".to_string()),
                },
                AskQuestionsOptionSpec {
                    id: "b".to_string(),
                    label: "B".to_string(),
                    summary: Some("Option B".to_string()),
                },
            ],
        }
    }

    #[test]
    fn single_select_enter_selects_and_advances() {
        let mut form = build_form(vec![
            single_select_question("q1", "First"),
            single_select_question("q2", "Second"),
        ]);

        let outcome = activate(&mut form).expect("activate should succeed");
        assert!(matches!(outcome, AskQuestionsActivateOutcome::None));
        assert_eq!(form.selected_field, 1);
        assert!(!submit_selected(&form));

        let BottomFormFieldEditorView::AskQuestion { question } = &form.fields[0].editor else {
            panic!("expected ask question field");
        };
        assert!(question.options[0].selected);
        assert!(!question.options[1].selected);
    }

    #[test]
    fn submit_without_selection_is_allowed() {
        let mut form = build_form(vec![single_select_question("q1", "First")]);

        move_right(&mut form);
        assert!(submit_selected(&form));

        let outcome = activate(&mut form).expect("submit should succeed without answers");
        let AskQuestionsActivateOutcome::Submit(result) = outcome else {
            panic!("expected submit outcome");
        };
        assert_eq!(result.status, AskQuestionsStatus::Answered);
        assert_eq!(result.answers.len(), 1);
        assert!(result.answers[0].selected_option_ids.is_empty());
        assert!(result.answers[0].custom_text.is_none());
    }

    #[test]
    fn submit_returns_structured_answers() {
        let mut form = build_form(vec![single_select_question("q1", "First")]);

        let first = activate(&mut form).expect("selection should succeed");
        assert!(matches!(first, AskQuestionsActivateOutcome::None));
        assert!(submit_selected(&form));

        let submit = activate(&mut form).expect("submit should succeed");
        let AskQuestionsActivateOutcome::Submit(result) = submit else {
            panic!("expected submit outcome");
        };
        assert_eq!(result.status, AskQuestionsStatus::Answered);
        assert_eq!(result.answers.len(), 1);
        assert_eq!(result.answers[0].question_id, "q1");
        assert_eq!(result.answers[0].selected_option_ids, vec!["a".to_string()]);
    }

    #[test]
    fn dismiss_returns_skipped_result() {
        let result = dismiss_result();
        assert_eq!(result.status, AskQuestionsStatus::Skipped);
        assert!(result.answers.is_empty());
    }
}
