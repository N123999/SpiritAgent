use super::*;
use rust_i18n::t;

pub(in crate::ui) struct BottomFormRenderResult {
    pub(in crate::ui) cursor: Option<(u16, u16)>,
    pub(in crate::ui) scroll_offset: Option<usize>,
}

struct RulesBottomFormLayout {
    content_lines: Vec<Line<'static>>,
    field_ranges: Vec<Option<(usize, usize)>>,
    footer_lines: Vec<Line<'static>>,
}

pub(in crate::ui) fn bottom_form_content_width(panel_width: u16) -> usize {
    panel_width.saturating_sub(2).saturating_sub(4).max(1) as usize
}

pub(in crate::ui) fn bottom_form_text_inner_width(panel_width: u16) -> usize {
    bottom_form_content_width(panel_width)
        .saturating_sub(2)
        .max(1)
}

pub(in crate::ui) fn bottom_form_text_visual_line_count(
    value: &str,
    placeholder: &str,
    text_inner_w: usize,
) -> usize {
    build_bottom_form_text_lines(value, placeholder, text_inner_w, false)
        .len()
        .max(1)
}

pub(in crate::ui) fn bottom_form_text_field_body_outer_height(
    value: &str,
    placeholder: &str,
    text_inner_w: usize,
) -> u16 {
    bottom_form_text_visual_line_count(value, placeholder, text_inner_w)
        .max(1)
        .saturating_add(2) as u16
}

pub(in crate::ui) fn bottom_form_text_field_outer_height(
    label: &str,
    help: &str,
    value: &str,
    placeholder: &str,
    field_width: usize,
    text_inner_w: usize,
) -> u16 {
    let label_height = if label.trim().is_empty() {
        0
    } else {
        build_bottom_form_footer_lines(label, field_width)
            .len()
            .max(1) as u16
    };
    let help_height = if help.trim().is_empty() {
        0
    } else {
        build_bottom_form_footer_lines(help, field_width)
            .len()
            .max(1) as u16
    };

    label_height
        .saturating_add(bottom_form_text_field_body_outer_height(
            value,
            placeholder,
            text_inner_w,
        ))
        .saturating_add(help_height)
}

pub(in crate::ui) fn bottom_form_field_outer_height(
    field: &BottomFormFieldView,
    field_width: usize,
    text_inner_w: usize,
) -> u16 {
    match &field.editor {
        BottomFormFieldEditorView::Section { text } => {
            build_bottom_form_footer_lines(text, field_width)
                .len()
                .max(1) as u16
        }
        BottomFormFieldEditorView::Text {
            value, placeholder, ..
        } => bottom_form_text_field_outer_height(
            &field.label,
            &field.help,
            value,
            placeholder,
            field_width,
            text_inner_w,
        ),
        BottomFormFieldEditorView::Choice { .. } => 3,
        BottomFormFieldEditorView::Checkbox { .. } => {
            let help_lines = if field.help.trim().is_empty() {
                0
            } else {
                build_bottom_form_footer_lines(&field.help, text_inner_w).len()
            };
            (1 + help_lines).max(1) as u16 + 2
        }
        BottomFormFieldEditorView::AskQuestion { .. } => 3,
    }
}

pub(in crate::ui) fn bottom_form_block_height(form: &BottomFormView, panel_width: u16) -> u16 {
    if matches!(
        form.kind,
        BottomFormKind::Rules | BottomFormKind::Skills | BottomFormKind::Extensions
    ) {
        return rules_bottom_form_block_height(form, panel_width);
    }
    if matches!(form.kind, BottomFormKind::AskQuestions { .. }) {
        return ask_questions_block_height(form, panel_width);
    }

    let text_inner_w = bottom_form_text_inner_width(panel_width);
    let content_w = bottom_form_content_width(panel_width);
    let fields_height = form
        .fields
        .iter()
        .map(|field| {
            u32::from(bottom_form_field_outer_height(
                field,
                content_w,
                text_inner_w,
            ))
        })
        .sum::<u32>();
    let field_gaps = form.fields.len().saturating_sub(1) as u32;
    let footer_gap = if form.fields.is_empty() { 0 } else { 1 };
    let footer_height = bottom_form_footer_height(&form.footer_hint, content_w) as u32;

    fields_height
        .saturating_add(field_gaps)
        .saturating_add(footer_gap)
        .saturating_add(footer_height)
        .saturating_add(4) as u16
}

pub(in crate::ui) fn bottom_form_display_height(
    form: &BottomFormView,
    panel_width: u16,
    panel_height: u16,
    input_height: u16,
) -> u16 {
    let full_height = bottom_form_block_height(form, panel_width);
    let available = panel_height.saturating_sub(input_height).max(3);
    let ratio_cap = panel_height.saturating_mul(3) / 5;
    let capped = available.min(ratio_cap.max(3));
    full_height.min(capped.max(3))
}

pub(in crate::ui) fn generic_bottom_form_selection_visible(
    form: &BottomFormView,
    scroll_offset: usize,
    field_width: usize,
    text_inner_w: usize,
    visible_height: usize,
) -> bool {
    let mut used_height = 0usize;
    for index in scroll_offset..form.fields.len() {
        let field_height =
            bottom_form_field_outer_height(&form.fields[index], field_width, text_inner_w) as usize;
        let needed_height = field_height + usize::from(index > scroll_offset);
        if used_height + needed_height > visible_height {
            return false;
        }
        used_height += needed_height;
        if index == form.selected_field {
            return true;
        }
    }
    false
}

pub(in crate::ui) fn generic_bottom_form_effective_scroll(
    form: &BottomFormView,
    field_width: usize,
    text_inner_w: usize,
    visible_height: usize,
) -> usize {
    if form.fields.is_empty() || visible_height == 0 {
        return 0;
    }

    let mut effective_scroll = form.scroll_offset.min(form.fields.len().saturating_sub(1));
    if form.selected_field < effective_scroll {
        effective_scroll = form.selected_field;
    }

    while effective_scroll < form.selected_field
        && !generic_bottom_form_selection_visible(
            form,
            effective_scroll,
            field_width,
            text_inner_w,
            visible_height,
        )
    {
        effective_scroll += 1;
    }

    effective_scroll
}

/// 在 `fields_limit_y` 与页脚之间为每个可见字段分配 `Rect`；空间不足时**仍绘制**该字段的可见部分
///（`height = min(自然高度, 剩余高度)`），避免像整表留空一样不渲染。
pub(in crate::ui) fn generic_bottom_form_visible_field_areas(
    form: &BottomFormView,
    content_area: Rect,
    fields_limit_y: u16,
    text_inner_w: usize,
    effective_scroll: usize,
) -> Vec<(usize, Rect)> {
    let mut areas = Vec::new();
    let mut field_y = content_area.y;

    for (index, field) in form.fields.iter().enumerate().skip(effective_scroll) {
        if field_y > content_area.y {
            let available_before_gap = fields_limit_y.saturating_sub(field_y);
            if available_before_gap <= 1 {
                break;
            }
            field_y = field_y.saturating_add(1);
        }

        let remaining_height = fields_limit_y.saturating_sub(field_y);
        if remaining_height == 0 {
            break;
        }

        let field_height =
            bottom_form_field_outer_height(field, content_area.width as usize, text_inner_w);
        let render_height = field_height.min(remaining_height);
        areas.push((
            index,
            Rect {
                x: content_area.x,
                y: field_y,
                width: content_area.width,
                height: render_height,
            },
        ));

        field_y = field_y.saturating_add(render_height);
        if render_height < field_height {
            break;
        }
    }

    areas
}

pub(in crate::ui) fn rules_bottom_form_block_height(
    form: &BottomFormView,
    panel_width: u16,
) -> u16 {
    let layout = build_rules_bottom_form_layout(form, bottom_form_content_width(panel_width));
    let content_height = layout.content_lines.len().max(1) as u16;
    let footer_height = layout.footer_lines.len().max(1) as u16;
    let footer_gap = if layout.content_lines.is_empty() {
        0
    } else {
        1
    };

    content_height
        .saturating_add(footer_height)
        .saturating_add(footer_gap)
        .saturating_add(4)
}

pub(in crate::ui) fn ask_questions_block_height(form: &BottomFormView, panel_width: u16) -> u16 {
    let Some(question) = ask_questions_form::current_question(form) else {
        return 8;
    };

    let content_w = bottom_form_content_width(panel_width);
    let title_text = ask_questions_title_text(form);
    let meta_height = 1u16;
    let title_height = build_bottom_form_footer_lines(&title_text, content_w)
        .len()
        .max(1) as u16;
    let row_heights = (0..ask_questions_form::question_row_count(question))
        .map(|row| ask_questions_row_block_height(question, row, content_w))
        .sum::<u16>();
    let row_gaps = ask_questions_form::question_row_count(question).saturating_sub(1) as u16;
    let rows_gap = if ask_questions_form::question_row_count(question) > 0 {
        1
    } else {
        0
    };
    let validation_gap = if ask_questions_form::validation_message(form).is_some() {
        1
    } else {
        0
    };
    let validation_height = if ask_questions_form::validation_message(form).is_some() {
        1
    } else {
        0
    };
    let tabs_gap = 1u16;
    let tabs_height = 1u16;

    meta_height
        .saturating_add(title_height)
        .saturating_add(rows_gap)
        .saturating_add(row_heights)
        .saturating_add(row_gaps)
        .saturating_add(validation_gap)
        .saturating_add(validation_height)
        .saturating_add(tabs_gap)
        .saturating_add(tabs_height)
        .saturating_add(4)
}

pub(in crate::ui) fn ask_questions_title_text(form: &BottomFormView) -> String {
    let Some(question) = ask_questions_form::current_question(form) else {
        return String::new();
    };
    let label = form
        .fields
        .get(form.selected_field.min(form.fields.len().saturating_sub(1)))
        .map(|field| field.label.clone())
        .unwrap_or_default();
    if question.required {
        format!(
            "{} {}",
            label,
            t!("form.ask_questions.required_badge").into_owned()
        )
    } else {
        label
    }
}

pub(in crate::ui) fn ask_questions_row_block_height(
    question: &AskQuestionsQuestionView,
    row_index: usize,
    field_width: usize,
) -> u16 {
    let inner_width = field_width.saturating_sub(2).max(1);
    if matches!(
        question.kind,
        crate::ask_questions::AskQuestionsQuestionKind::Text
    ) {
        let Some(input) = question.text_input.as_ref() else {
            return 0;
        };
        return bottom_form_text_field_outer_height(
            &input.label,
            "",
            &input.value,
            &input.placeholder,
            field_width,
            inner_width,
        );
    }

    if let Some(option) = question.options.get(row_index) {
        let summary_lines = option
            .summary
            .as_ref()
            .map(|summary| build_bottom_form_footer_lines(summary, inner_width).len())
            .unwrap_or(0);
        return (1 + summary_lines).max(1) as u16 + 2;
    }

    let Some(input) = question.custom_input.as_ref() else {
        return 0;
    };
    bottom_form_text_field_outer_height(
        &input.label,
        "",
        &input.value,
        &input.placeholder,
        field_width,
        inner_width,
    )
}

pub(in crate::ui) fn ask_questions_selection_visible(
    question: &AskQuestionsQuestionView,
    scroll_offset: usize,
    field_width: usize,
    visible_height: usize,
) -> bool {
    let mut used_height = 0usize;
    for row_index in scroll_offset..ask_questions_form::question_row_count(question) {
        let row_height = ask_questions_row_block_height(question, row_index, field_width) as usize;
        let needed = row_height + usize::from(row_index > scroll_offset);
        if used_height + needed > visible_height {
            return false;
        }
        used_height += needed;
        if row_index == question.selected_row {
            return true;
        }
    }
    false
}

pub(in crate::ui) fn ask_questions_effective_scroll(
    form: &BottomFormView,
    question: &AskQuestionsQuestionView,
    field_width: usize,
    visible_height: usize,
) -> usize {
    if visible_height == 0 {
        return 0;
    }

    let row_count = ask_questions_form::question_row_count(question);
    if row_count == 0 {
        return 0;
    }

    let mut effective_scroll = form.scroll_offset.min(row_count.saturating_sub(1));
    if ask_questions_form::submit_selected(form) {
        return effective_scroll;
    }

    if question.selected_row < effective_scroll {
        effective_scroll = question.selected_row;
    }
    while effective_scroll < question.selected_row
        && !ask_questions_selection_visible(question, effective_scroll, field_width, visible_height)
    {
        effective_scroll += 1;
    }
    effective_scroll
}

pub(in crate::ui) fn ask_questions_visible_row_areas(
    question: &AskQuestionsQuestionView,
    content_area: Rect,
    limit_y: u16,
    effective_scroll: usize,
) -> Vec<(usize, Rect)> {
    let mut areas = Vec::new();
    let mut row_y = content_area.y;

    for row_index in effective_scroll..ask_questions_form::question_row_count(question) {
        if row_y > content_area.y {
            let available_before_gap = limit_y.saturating_sub(row_y);
            if available_before_gap <= 1 {
                break;
            }
            row_y = row_y.saturating_add(1);
        }

        let remaining_height = limit_y.saturating_sub(row_y);
        if remaining_height == 0 {
            break;
        }

        let natural_height =
            ask_questions_row_block_height(question, row_index, content_area.width as usize);
        let render_height = natural_height.min(remaining_height);
        areas.push((
            row_index,
            Rect {
                x: content_area.x,
                y: row_y,
                width: content_area.width,
                height: render_height,
            },
        ));
        row_y = row_y.saturating_add(render_height);
        if render_height < natural_height {
            break;
        }
    }

    areas
}

pub(in crate::ui) fn draw_ask_questions_form(
    frame: &mut ratatui::Frame<'_>,
    area: Rect,
    form: &BottomFormView,
) -> BottomFormRenderResult {
    let outer_border_style = patch_style_border(
        subtle_aux_text_style(),
        cli_ui_border_color(CliUiHookSlot::QuestionsPanel)
            .or(cli_ui_accent_color(CliUiHookSlot::QuestionsPanel)),
    );
    let outer_title_style = patch_style_foreground(
        subtle_aux_text_style(),
        cli_ui_foreground_color(CliUiHookSlot::QuestionsPanel),
    );
    let title = truncate_to_width(&form.title, area.width.saturating_sub(4) as usize);
    let outer_block = Block::default()
        .borders(Borders::ALL)
        .border_style(outer_border_style)
        .title(Line::from(Span::styled(title, outer_title_style)));
    let inner_area = outer_block.inner(area);
    frame.render_widget(outer_block, area);

    let content_area = inset_rect(inner_area, 2, 1);
    if content_area.width < 3 || content_area.height == 0 {
        return BottomFormRenderResult {
            cursor: None,
            scroll_offset: Some(0),
        };
    }

    let Some(question) = ask_questions_form::current_question(form) else {
        return BottomFormRenderResult {
            cursor: None,
            scroll_offset: Some(0),
        };
    };

    let selected_question_index = form.selected_field.min(form.fields.len().saturating_sub(1));
    let answered_count = ask_questions_form::answered_question_count(form);
    let meta_text = t!(
        "form.ask_questions.meta",
        current = selected_question_index + 1,
        total = form.fields.len(),
        answered = answered_count
    )
    .into_owned();
    frame.render_widget(
        Paragraph::new(Line::from(Span::styled(meta_text, subtle_aux_text_style()))),
        Rect {
            x: content_area.x,
            y: content_area.y,
            width: content_area.width,
            height: 1,
        },
    );

    let title_lines = build_bottom_form_footer_lines(
        ask_questions_title_text(form).as_str(),
        content_area.width as usize,
    )
    .into_iter()
    .map(|line| {
        let text = line
            .spans
            .into_iter()
            .map(|span| span.content.into_owned())
            .collect::<String>();
        Line::from(Span::styled(
            text,
            patch_style_foreground(
                Style::default()
                    .fg(Color::White)
                    .add_modifier(Modifier::BOLD),
                cli_ui_foreground_color(CliUiHookSlot::QuestionsPanel),
            ),
        ))
    })
    .collect::<Vec<_>>();
    let title_height = title_lines.len().max(1) as u16;
    frame.render_widget(
        Paragraph::new(title_lines),
        Rect {
            x: content_area.x,
            y: content_area.y.saturating_add(1),
            width: content_area.width,
            height: title_height,
        },
    );

    let validation_height = if ask_questions_form::validation_message(form).is_some() {
        1
    } else {
        0
    };
    let tabs_y = content_area
        .y
        .saturating_add(content_area.height.saturating_sub(1));
    let validation_y = tabs_y.saturating_sub(validation_height);
    let rows_start_y = content_area
        .y
        .saturating_add(1)
        .saturating_add(title_height);
    let rows_start_y = if ask_questions_form::question_row_count(question) > 0 {
        rows_start_y.saturating_add(1)
    } else {
        rows_start_y
    };
    let rows_limit_y = validation_y;
    let visible_height = rows_limit_y.saturating_sub(rows_start_y) as usize;
    let effective_scroll =
        ask_questions_effective_scroll(form, question, content_area.width as usize, visible_height);

    let mut cursor = None;
    if visible_height > 0 {
        let rows_area = Rect {
            x: content_area.x,
            y: rows_start_y,
            width: content_area.width,
            height: rows_limit_y.saturating_sub(rows_start_y),
        };
        for (row_index, row_area) in
            ask_questions_visible_row_areas(question, rows_area, rows_limit_y, effective_scroll)
        {
            let row_selected =
                !ask_questions_form::submit_selected(form) && row_index == question.selected_row;
            let row_cursor = if let Some(option) = question.options.get(row_index) {
                draw_ask_questions_option_row(frame, row_area, question, option, row_selected)
            } else if matches!(
                question.kind,
                crate::ask_questions::AskQuestionsQuestionKind::Text
            ) {
                question.text_input.as_ref().and_then(|input| {
                    draw_bottom_form_text_field(
                        frame,
                        row_area,
                        &input.label,
                        "",
                        &input.value,
                        &input.placeholder,
                        input.cursor,
                        row_selected,
                        false,
                    )
                })
            } else {
                question.custom_input.as_ref().and_then(|input| {
                    draw_bottom_form_text_field(
                        frame,
                        row_area,
                        &input.label,
                        "",
                        &input.value,
                        &input.placeholder,
                        input.cursor,
                        row_selected,
                        false,
                    )
                })
            };
            if row_selected {
                cursor = row_cursor;
            }
        }
    }

    if let Some(message) = ask_questions_form::validation_message(form) {
        frame.render_widget(
            Paragraph::new(Line::from(Span::styled(
                truncate_to_width(message, content_area.width as usize),
                Style::default().fg(Color::Red),
            ))),
            Rect {
                x: content_area.x,
                y: validation_y,
                width: content_area.width,
                height: 1,
            },
        );
    }

    frame.render_widget(
        Paragraph::new(build_ask_questions_tab_line(
            form,
            content_area.width as usize,
        )),
        Rect {
            x: content_area.x,
            y: tabs_y,
            width: content_area.width,
            height: 1,
        },
    );

    BottomFormRenderResult {
        cursor,
        scroll_offset: Some(effective_scroll),
    }
}

pub(in crate::ui) fn draw_ask_questions_option_row(
    frame: &mut ratatui::Frame<'_>,
    area: Rect,
    question: &AskQuestionsQuestionView,
    option: &AskQuestionsOptionView,
    is_selected_row: bool,
) -> Option<(u16, u16)> {
    // 与 Agent 主输入区一致：描边用 `input_block_border_style`（即正文灰），已填/已选文字用白字。
    // 仅键盘焦点、未勾选时整行（含字）用正文灰，略淡于已选白字。
    let border_style = if option.selected || is_selected_row {
        input_block_border_style(false, MainInputMode::Agent, false)
    } else {
        subtle_aux_text_style()
    };
    let label_style = if option.selected {
        input_text_style(false, MainInputMode::Agent, false)
    } else if is_selected_row {
        conversation_body_text_style()
    } else {
        subtle_aux_text_style()
    };
    let block = Block::default()
        .borders(Borders::ALL)
        .border_style(border_style);
    let inner = block.inner(area);
    frame.render_widget(block, area);

    let marker = match question.kind {
        crate::ask_questions::AskQuestionsQuestionKind::SingleSelect => {
            if option.selected {
                "(x)"
            } else {
                "( )"
            }
        }
        crate::ask_questions::AskQuestionsQuestionKind::MultiSelect => {
            if option.selected {
                "[x]"
            } else {
                "[ ]"
            }
        }
        crate::ask_questions::AskQuestionsQuestionKind::Text => "   ",
    };
    let mut lines = vec![Line::from(Span::styled(
        format!("{} {}", marker, option.label),
        label_style,
    ))];
    if let Some(summary) = option
        .summary
        .as_ref()
        .filter(|value| !value.trim().is_empty())
    {
        lines.extend(build_bottom_form_footer_lines(
            summary,
            inner.width as usize,
        ));
    }
    let max_lines = usize::from(inner.height);
    if lines.len() > max_lines {
        lines.truncate(max_lines);
    }
    frame.render_widget(Paragraph::new(lines), inner);

    if is_selected_row {
        Some((inner.x + 1, inner.y))
    } else {
        None
    }
}

pub(in crate::ui) fn build_ask_questions_tab_line(
    form: &BottomFormView,
    max_width: usize,
) -> Line<'static> {
    let selected_question = form.selected_field.min(form.fields.len().saturating_sub(1));
    let submit_text = format!(" {} ", t!("form.ask_questions.submit_tab"));
    let submit_width = UnicodeWidthStr::width(submit_text.as_str());
    let mut spans = Vec::new();
    let mut used_width = 0usize;

    for (index, field) in form.fields.iter().enumerate() {
        let answered = match &field.editor {
            BottomFormFieldEditorView::AskQuestion { question } => {
                ask_questions_form::question_answered(question)
            }
            _ => false,
        };
        let short_label = truncate_to_width(&field.label, 14);
        let tab_text = format!(" {}:{} ", index + 1, short_label);
        let tab_width = UnicodeWidthStr::width(tab_text.as_str());
        if used_width + tab_width + 1 + submit_width > max_width && !spans.is_empty() {
            break;
        }

        let style = if !ask_questions_form::submit_selected(form) && index == selected_question {
            if answered {
                input_text_style(false, MainInputMode::Agent, false)
            } else {
                conversation_body_text_style()
            }
        } else if answered {
            input_text_style(false, MainInputMode::Agent, false)
        } else {
            subtle_aux_text_style()
        };
        spans.push(Span::styled(tab_text, style));
        used_width += tab_width;
    }

    if !spans.is_empty() && used_width + 1 < max_width {
        spans.push(Span::styled(" ", subtle_aux_text_style()));
        used_width += 1;
    }

    if submit_width <= max_width.saturating_sub(used_width) || spans.is_empty() {
        let style = if ask_questions_form::submit_selected(form) {
            conversation_body_text_style()
        } else if ask_questions_form::answered_question_count(form) == form.fields.len() {
            input_text_style(false, MainInputMode::Agent, false)
        } else {
            subtle_aux_text_style()
        };
        spans.push(Span::styled(submit_text.clone(), style));
    }

    if spans.is_empty() {
        spans.push(Span::styled(submit_text, subtle_aux_text_style()));
    }

    Line::from(spans)
}

/// Character-wrapped visual rows for one logical line (no `\n`), aligned with `wrapped_single_line_cursor_position`.
pub(in crate::ui) fn bottom_form_wrap_logical_line(line: &str, max_width: usize) -> Vec<String> {
    let width = max_width.max(1);
    if line.is_empty() {
        return vec![String::new()];
    }
    let mut out: Vec<String> = vec![String::new()];
    let mut col = 0usize;

    for ch in line.chars() {
        let ch_width = UnicodeWidthChar::width(ch).unwrap_or(0);
        if ch_width == 0 {
            continue;
        }
        if col > 0 && col + ch_width > width {
            out.push(String::new());
            col = 0;
        }
        out.last_mut()
            .expect("bottom_form_wrap_logical_line")
            .push(ch);
        col += ch_width;
        if col >= width {
            let extra = col / width;
            for _ in 0..extra {
                out.push(String::new());
            }
            col %= width;
        }
    }
    out
}

pub(in crate::ui) fn build_bottom_form_text_lines(
    value: &str,
    placeholder: &str,
    max_width: usize,
    is_selected: bool,
) -> Vec<Line<'static>> {
    let (text, is_placeholder) = if value.is_empty() {
        (placeholder, true)
    } else {
        (value, false)
    };
    let style = if is_placeholder {
        subtle_aux_text_style()
    } else if is_selected {
        Style::default().fg(Color::White)
    } else {
        subtle_aux_text_style()
    };

    let mut lines: Vec<Line<'static>> = Vec::new();
    for logical in text.split('\n') {
        for v in bottom_form_wrap_logical_line(logical, max_width) {
            lines.push(Line::from(Span::styled(v, style)));
        }
    }
    if lines.is_empty() {
        lines.push(Line::from(Span::styled(String::new(), style)));
    }
    lines
}

pub(in crate::ui) fn build_bottom_form_footer_lines(
    text: &str,
    max_width: usize,
) -> Vec<Line<'static>> {
    let style = subtle_aux_text_style();
    let mut lines: Vec<Line<'static>> = Vec::new();

    for logical in text.split('\n') {
        for visual in bottom_form_wrap_logical_line(logical, max_width) {
            lines.push(Line::from(Span::styled(visual, style)));
        }
    }

    if lines.is_empty() {
        lines.push(Line::from(Span::styled(String::new(), style)));
    }

    lines
}

pub(in crate::ui) fn bottom_form_footer_height(text: &str, max_width: usize) -> u16 {
    build_bottom_form_footer_lines(text, max_width).len().max(1) as u16
}

pub(in crate::ui) fn draw_bottom_form(
    frame: &mut ratatui::Frame<'_>,
    area: Rect,
    form: &BottomFormView,
) -> BottomFormRenderResult {
    if matches!(
        form.kind,
        BottomFormKind::Rules | BottomFormKind::Skills | BottomFormKind::Extensions
    ) {
        return draw_rules_bottom_form(frame, area, form);
    }
    if matches!(form.kind, BottomFormKind::AskQuestions { .. }) {
        return draw_ask_questions_form(frame, area, form);
    }

    let outer_border_style = subtle_aux_text_style();
    let outer_title_style = subtle_aux_text_style();
    let title = truncate_to_width(&form.title, area.width.saturating_sub(4) as usize);
    let outer_block = Block::default()
        .borders(Borders::ALL)
        .border_style(outer_border_style)
        .title(Line::from(Span::styled(title, outer_title_style)));
    let inner_area = outer_block.inner(area);
    frame.render_widget(outer_block, area);

    let content_area = inset_rect(inner_area, 2, 1);
    if content_area.width < 3 || content_area.height == 0 {
        return BottomFormRenderResult {
            cursor: None,
            scroll_offset: None,
        };
    }

    let text_inner_w = bottom_form_text_inner_width(area.width);
    let footer_lines =
        build_bottom_form_footer_lines(&form.footer_hint, content_area.width as usize);
    let footer_height = footer_lines.len().max(1) as u16;
    let footer_gap = if form.fields.is_empty() { 0 } else { 1 };
    let footer_y = content_area
        .y
        .saturating_add(content_area.height.saturating_sub(footer_height));
    let fields_limit_y = footer_y.saturating_sub(footer_gap);
    let visible_height = fields_limit_y.saturating_sub(content_area.y) as usize;
    let effective_scroll = generic_bottom_form_effective_scroll(
        form,
        content_area.width as usize,
        text_inner_w,
        visible_height,
    );
    let mut cursor = None;
    for (index, field_area) in generic_bottom_form_visible_field_areas(
        form,
        content_area,
        fields_limit_y,
        text_inner_w,
        effective_scroll,
    ) {
        let field = &form.fields[index];
        let field_cursor = match &field.editor {
            BottomFormFieldEditorView::Section { text } => {
                draw_bottom_form_section_field(frame, field_area, text);
                None
            }
            BottomFormFieldEditorView::Text {
                value,
                placeholder,
                cursor,
                disabled,
                ..
            } => draw_bottom_form_text_field(
                frame,
                field_area,
                &field.label,
                &field.help,
                value,
                placeholder,
                *cursor,
                index == form.selected_field,
                *disabled,
            ),
            BottomFormFieldEditorView::Choice { options, selected } => {
                draw_bottom_form_choice_field(
                    frame,
                    field_area,
                    &field.label,
                    options,
                    *selected,
                    index == form.selected_field,
                )
            }
            BottomFormFieldEditorView::Checkbox {
                checked, disabled, ..
            } => draw_bottom_form_checkbox_field(
                frame,
                field_area,
                &field.label,
                field.help.as_str(),
                *checked,
                *disabled,
                index == form.selected_field,
            ),
            BottomFormFieldEditorView::AskQuestion { .. } => None,
        };

        if index == form.selected_field {
            cursor = field_cursor;
        }
    }

    let footer_area = Rect {
        x: content_area.x,
        y: footer_y,
        width: content_area.width,
        height: footer_height,
    };
    frame.render_widget(Paragraph::new(footer_lines), footer_area);

    BottomFormRenderResult {
        cursor,
        scroll_offset: Some(effective_scroll),
    }
}

pub(in crate::ui) fn draw_rules_bottom_form(
    frame: &mut ratatui::Frame<'_>,
    area: Rect,
    form: &BottomFormView,
) -> BottomFormRenderResult {
    let outer_border_style = patch_style_border(
        subtle_aux_text_style(),
        cli_ui_border_color(CliUiHookSlot::BottomForm)
            .or(cli_ui_accent_color(CliUiHookSlot::BottomForm)),
    );
    let outer_title_style = patch_style_foreground(
        subtle_aux_text_style(),
        cli_ui_foreground_color(CliUiHookSlot::BottomForm),
    );
    let title = truncate_to_width(&form.title, area.width.saturating_sub(4) as usize);
    let outer_block = Block::default()
        .borders(Borders::ALL)
        .border_style(outer_border_style)
        .title(Line::from(Span::styled(title, outer_title_style)));
    let inner_area = outer_block.inner(area);
    frame.render_widget(outer_block, area);

    let content_area = inset_rect(inner_area, 2, 1);
    if content_area.width < 3 || content_area.height == 0 {
        return BottomFormRenderResult {
            cursor: None,
            scroll_offset: Some(0),
        };
    }

    let layout = build_rules_bottom_form_layout(form, content_area.width as usize);
    let footer_height = layout.footer_lines.len().max(1) as u16;
    let footer_gap = if layout.content_lines.is_empty() {
        0
    } else {
        1
    };
    let footer_y = content_area
        .y
        .saturating_add(content_area.height.saturating_sub(footer_height));
    let fields_limit_y = footer_y.saturating_sub(footer_gap);
    let visible_height = fields_limit_y.saturating_sub(content_area.y) as usize;

    if visible_height > 0 {
        let max_scroll = layout.content_lines.len().saturating_sub(visible_height);
        let mut effective_scroll = form.scroll_offset.min(max_scroll);

        if let Some(Some((selected_start, selected_end))) =
            layout.field_ranges.get(form.selected_field)
        {
            if *selected_start < effective_scroll {
                effective_scroll = *selected_start;
            } else if *selected_end >= effective_scroll.saturating_add(visible_height) {
                effective_scroll = selected_end
                    .saturating_add(1)
                    .saturating_sub(visible_height);
            }
        }

        let fields_area = Rect {
            x: content_area.x,
            y: content_area.y,
            width: content_area.width,
            height: fields_limit_y.saturating_sub(content_area.y),
        };
        let visible_lines = layout
            .content_lines
            .iter()
            .skip(effective_scroll)
            .take(visible_height)
            .cloned()
            .collect::<Vec<_>>();
        frame.render_widget(Paragraph::new(visible_lines), fields_area);

        let footer_area = Rect {
            x: content_area.x,
            y: footer_y,
            width: content_area.width,
            height: footer_height,
        };
        frame.render_widget(Paragraph::new(layout.footer_lines), footer_area);

        return BottomFormRenderResult {
            cursor: None,
            scroll_offset: Some(effective_scroll),
        };
    }

    let footer_area = Rect {
        x: content_area.x,
        y: footer_y,
        width: content_area.width,
        height: footer_height,
    };
    frame.render_widget(Paragraph::new(layout.footer_lines), footer_area);

    BottomFormRenderResult {
        cursor: None,
        scroll_offset: Some(0),
    }
}

fn build_rules_bottom_form_layout(
    form: &BottomFormView,
    max_width: usize,
) -> RulesBottomFormLayout {
    let mut content_lines = Vec::new();
    let mut field_ranges = vec![None; form.fields.len()];
    let checkbox_column_width = form
        .fields
        .iter()
        .filter_map(|field| match &field.editor {
            BottomFormFieldEditorView::Checkbox { checked, .. } => Some(UnicodeWidthStr::width(
                rules_checkbox_label_text(&field.label, *checked).as_str(),
            )),
            _ => None,
        })
        .max()
        .unwrap_or(0);

    for (index, field) in form.fields.iter().enumerate() {
        let start = content_lines.len();
        match &field.editor {
            BottomFormFieldEditorView::Section { text } => {
                let section_style = subtle_aux_text_style().add_modifier(Modifier::BOLD);
                for line in build_bottom_form_footer_lines(text, max_width) {
                    let text = line
                        .spans
                        .into_iter()
                        .map(|span| span.content.into_owned())
                        .collect::<String>();
                    content_lines.push(Line::from(Span::styled(text, section_style)));
                }
            }
            BottomFormFieldEditorView::Checkbox {
                checked,
                disabled,
                path,
                ..
            } => {
                content_lines.push(build_rules_checkbox_header_line(
                    &field.label,
                    path.as_deref(),
                    *checked,
                    *disabled,
                    index == form.selected_field,
                    checkbox_column_width,
                    max_width,
                ));
                if !field.help.trim().is_empty() {
                    content_lines.extend(build_bottom_form_footer_lines(&field.help, max_width));
                }
            }
            BottomFormFieldEditorView::Text { .. }
            | BottomFormFieldEditorView::Choice { .. }
            | BottomFormFieldEditorView::AskQuestion { .. } => {}
        }

        if content_lines.len() > start {
            field_ranges[index] = Some((start, content_lines.len().saturating_sub(1)));
        }

        if index + 1 < form.fields.len() {
            content_lines.push(Line::from(Span::styled(
                String::new(),
                subtle_aux_text_style(),
            )));
        }
    }

    RulesBottomFormLayout {
        content_lines,
        field_ranges,
        footer_lines: build_bottom_form_footer_lines(&form.footer_hint, max_width),
    }
}

pub(in crate::ui) fn build_rules_checkbox_header_line(
    label: &str,
    path: Option<&str>,
    checked: bool,
    disabled: bool,
    is_selected: bool,
    checkbox_column_width: usize,
    max_width: usize,
) -> Line<'static> {
    let label_style = if disabled {
        subtle_aux_text_style().add_modifier(Modifier::DIM)
    } else if is_selected {
        Style::default().fg(Color::White)
    } else {
        subtle_aux_text_style()
    };
    let path_style = if disabled {
        subtle_aux_text_style().add_modifier(Modifier::DIM)
    } else {
        subtle_aux_text_style()
    };
    let left_text = rules_checkbox_label_text(label, checked);

    let Some(path_text) = path.filter(|value| !value.is_empty()) else {
        return Line::from(Span::styled(left_text, label_style));
    };

    let left_width = UnicodeWidthStr::width(left_text.as_str());
    if max_width == 0 || left_width >= max_width {
        return Line::from(Span::styled(
            truncate_to_width(&left_text, max_width.max(1)),
            label_style,
        ));
    }

    let description_gap = if max_width >= 40 {
        4
    } else if max_width >= 24 {
        3
    } else {
        2
    };
    let base_column = checkbox_column_width.max(left_width);
    let available_for_path = max_width.saturating_sub(base_column + description_gap);
    if available_for_path == 0 {
        return Line::from(Span::styled(left_text, label_style));
    }

    let rendered_path = truncate_from_left_to_width(path_text, available_for_path);
    let gap = base_column
        .saturating_sub(left_width)
        .saturating_add(description_gap);

    Line::from(vec![
        Span::styled(left_text, label_style),
        Span::styled(" ".repeat(gap), subtle_aux_text_style()),
        Span::styled(rendered_path, path_style),
    ])
}

pub(in crate::ui) fn rules_checkbox_label_text(label: &str, checked: bool) -> String {
    let checkbox_text = if checked { "[x]" } else { "[ ]" };
    format!("{} {}", checkbox_text, label)
}

pub(in crate::ui) fn draw_bottom_form_section_field(
    frame: &mut ratatui::Frame<'_>,
    area: Rect,
    text: &str,
) {
    let lines = build_bottom_form_footer_lines(text, area.width as usize)
        .into_iter()
        .map(|line| {
            patch_line_foreground(
                line,
                cli_ui_foreground_color(CliUiHookSlot::BottomFormSection),
            )
        })
        .collect::<Vec<_>>();
    let max_lines = usize::from(area.height);
    let lines: Vec<Line<'static>> = lines.into_iter().take(max_lines).collect();
    frame.render_widget(Paragraph::new(lines), area);
}

pub(in crate::ui) fn draw_bottom_form_text_field(
    frame: &mut ratatui::Frame<'_>,
    area: Rect,
    label: &str,
    help: &str,
    value: &str,
    placeholder: &str,
    cursor_chars: usize,
    is_selected: bool,
    disabled: bool,
) -> Option<(u16, u16)> {
    // 自 `next_y` 到 `area` 下边的剩余行，须与底部 footer（快捷键提示）错开，不可画出区域外。
    let bottom_exclusive = area.y.saturating_add(area.height);
    let mut next_y = area.y;

    if !label.trim().is_empty() {
        let budget = bottom_exclusive.saturating_sub(next_y);
        if budget > 0 {
            let label_style = if is_selected {
                Style::default()
                    .fg(Color::White)
                    .add_modifier(Modifier::BOLD)
            } else {
                subtle_aux_text_style().add_modifier(Modifier::BOLD)
            };
            let label_lines = build_bottom_form_footer_lines(label, area.width as usize)
                .into_iter()
                .map(|line| {
                    let text = line
                        .spans
                        .into_iter()
                        .map(|span| span.content.into_owned())
                        .collect::<String>();
                    Line::from(Span::styled(text, label_style))
                })
                .collect::<Vec<_>>();
            let label_natural = label_lines.len().max(1) as u16;
            let label_height = label_natural.min(budget);
            let take_n = label_height as usize;
            let truncated: Vec<Line<'static>> = label_lines.into_iter().take(take_n).collect();
            frame.render_widget(
                Paragraph::new(truncated),
                Rect {
                    x: area.x,
                    y: next_y,
                    width: area.width,
                    height: label_height,
                },
            );
            next_y = next_y.saturating_add(label_height);
        }
    }

    let text_inner_w = area.width.saturating_sub(2).max(1) as usize;
    let body_natural = bottom_form_text_field_body_outer_height(value, placeholder, text_inner_w);
    let body_height = body_natural.min(bottom_exclusive.saturating_sub(next_y));
    let inner_for_cursor = if body_height > 0 {
        let body_area = Rect {
            x: area.x,
            y: next_y,
            width: area.width,
            height: body_height,
        };
        let border_style = if disabled {
            Style::default().fg(Color::DarkGray)
        } else {
            bottom_form_field_style(is_selected)
        };
        let block = Block::default()
            .borders(Borders::ALL)
            .border_style(border_style);
        let inner = block.inner(body_area);
        frame.render_widget(block, body_area);

        let mut lines =
            build_bottom_form_text_lines(value, placeholder, inner.width as usize, is_selected);
        let max_inner_lines = usize::from(inner.height);
        if lines.len() > max_inner_lines {
            lines.truncate(max_inner_lines);
        }
        frame.render_widget(Paragraph::new(lines), inner);
        next_y = next_y.saturating_add(body_height);
        Some(inner)
    } else {
        None
    };

    if !help.trim().is_empty() {
        let budget = bottom_exclusive.saturating_sub(next_y);
        if budget > 0 {
            let help_lines = build_bottom_form_footer_lines(help, area.width as usize);
            let help_natural = help_lines.len().max(1) as u16;
            let help_height = help_natural.min(budget);
            let truncated: Vec<Line<'static>> =
                help_lines.into_iter().take(help_height as usize).collect();
            frame.render_widget(
                Paragraph::new(truncated),
                Rect {
                    x: area.x,
                    y: next_y,
                    width: area.width,
                    height: help_height,
                },
            );
        }
    }

    if !is_selected || disabled {
        return None;
    }

    let inner = inner_for_cursor?;
    if inner.height == 0 {
        return None;
    }

    let prefix: String = value.chars().take(cursor_chars).collect();
    let (row, col) = wrapped_text_cursor_position(&prefix, inner.width as usize);
    let row_u = u16::try_from(row).unwrap_or(u16::MAX);
    if row_u >= inner.height {
        return None;
    }

    Some((
        inner.x + col.min(inner.width.saturating_sub(1) as usize) as u16,
        inner.y + row_u,
    ))
}

pub(in crate::ui) fn draw_bottom_form_choice_field(
    frame: &mut ratatui::Frame<'_>,
    area: Rect,
    label: &str,
    options: &[String],
    selected: usize,
    is_selected: bool,
) -> Option<(u16, u16)> {
    let block = Block::default()
        .borders(Borders::ALL)
        .border_style(bottom_form_field_style(is_selected));
    let inner = block.inner(area);
    frame.render_widget(block, area);

    let mut spans = vec![Span::styled(
        format!("{}  ", label),
        subtle_aux_text_style(),
    )];
    let safe_selected = selected.min(options.len().saturating_sub(1));
    let mut cursor_offset = UnicodeWidthStr::width(label).saturating_add(2) as u16;

    for (index, option) in options.iter().enumerate() {
        if index > 0 {
            spans.push(Span::styled("   ", subtle_aux_text_style()));
            cursor_offset = cursor_offset.saturating_add(3);
        }

        let option_style = if is_selected && index == safe_selected {
            Style::default().fg(Color::White)
        } else {
            subtle_aux_text_style()
        };

        if index < safe_selected {
            cursor_offset =
                cursor_offset.saturating_add(UnicodeWidthStr::width(option.as_str()) as u16);
        }

        spans.push(Span::styled(option.clone(), option_style));
    }

    frame.render_widget(Paragraph::new(Line::from(spans)), inner);

    if is_selected {
        Some((
            inner.x + cursor_offset.min(inner.width.saturating_sub(1)),
            inner.y,
        ))
    } else {
        None
    }
}

pub(in crate::ui) fn draw_bottom_form_checkbox_field(
    frame: &mut ratatui::Frame<'_>,
    area: Rect,
    label: &str,
    help: &str,
    checked: bool,
    disabled: bool,
    is_selected: bool,
) -> Option<(u16, u16)> {
    let block = Block::default()
        .borders(Borders::ALL)
        .border_style(bottom_form_field_style(is_selected));
    let inner = block.inner(area);
    frame.render_widget(block, area);

    let checkbox_text = if checked { "[x]" } else { "[ ]" };
    let checkbox_style = if disabled {
        subtle_aux_text_style().add_modifier(Modifier::DIM)
    } else if is_selected {
        Style::default().fg(Color::White)
    } else {
        subtle_aux_text_style()
    };
    let mut lines = vec![Line::from(Span::styled(
        format!("{} {}", checkbox_text, label),
        checkbox_style,
    ))];
    if !help.trim().is_empty() {
        lines.extend(build_bottom_form_footer_lines(help, inner.width as usize));
    }
    let max_lines = usize::from(inner.height);
    if lines.len() > max_lines {
        lines.truncate(max_lines);
    }
    frame.render_widget(Paragraph::new(lines), inner);

    if is_selected && !disabled {
        Some((inner.x + 1, inner.y))
    } else {
        None
    }
}

pub(in crate::ui) fn bottom_form_field_style(is_selected: bool) -> Style {
    if is_selected {
        Style::default().fg(Color::White)
    } else {
        subtle_aux_text_style()
    }
}
