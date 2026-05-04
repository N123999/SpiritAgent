use super::subagent::subagent_status_badge;
use super::*;
use rust_i18n::t;

pub(in crate::ui) fn inline_picker_bounds(
    total: usize,
    selected: usize,
    max_items: usize,
) -> (usize, usize) {
    let window = max_items.max(1);
    let pivot = window / 2;
    let max_start = total.saturating_sub(window);
    let start = selected.saturating_sub(pivot).min(max_start);
    let end = (start + window).min(total);
    (start, end)
}

pub(in crate::ui) fn inline_picker_text_style(is_selected: bool) -> Style {
    if is_selected {
        Style::default().fg(Color::White)
    } else {
        subtle_aux_text_style()
    }
}

pub(in crate::ui) fn inline_picker_meta_style(is_selected: bool) -> Style {
    if is_selected {
        inline_picker_text_style(true)
    } else {
        subtle_aux_text_style().add_modifier(Modifier::DIM)
    }
}

pub(in crate::ui) fn picker_selection_prefix(is_selected: bool) -> &'static str {
    if is_selected { "> " } else { "  " }
}

pub(in crate::ui) fn inline_picker_area(area: Rect) -> Rect {
    let offset = if area.width >= 12 {
        1
    } else if area.width >= 6 {
        0
    } else {
        0
    }
    .min(area.width.saturating_sub(1));

    Rect {
        x: area.x.saturating_add(offset),
        y: area.y,
        width: area.width.saturating_sub(offset),
        height: area.height,
    }
}

pub(in crate::ui) fn draw_inline_picker(
    frame: &mut ratatui::Frame<'_>,
    area: Rect,
    lines: Vec<Line<'static>>,
) {
    let picker_widget = Paragraph::new(lines).wrap(Wrap { trim: false });
    frame.render_widget(Clear, area);
    frame.render_widget(picker_widget, inline_picker_area(area));
}

pub(in crate::ui) fn suggestions_use_inline_picker(app: &TuiViewModel) -> bool {
    matches!(app.input_suggestion_kind, Some(InputSuggestionKind::Slash))
}

fn inline_suggestion_detail_line(detail: String) -> String {
    detail.trim_start().to_string()
}

pub(in crate::ui) fn build_suggestion_lines(
    app: &TuiViewModel,
    max_items: usize,
    max_width: usize,
) -> Vec<Line<'static>> {
    let default_style = subtle_aux_text_style();
    let selected_style = Style::default().fg(Color::White);

    match app.input_suggestion_kind {
        Some(InputSuggestionKind::Slash) => {}
        Some(InputSuggestionKind::FileReference) if app.input_suggestion_loading => {
            return vec![Line::from(Span::styled(
                t!("tui.file_reference.indexing").into_owned(),
                default_style,
            ))];
        }
        Some(InputSuggestionKind::FileReference) => {}
        None => {
            return vec![Line::from(Span::styled(
                t!("ui.suggestion.hint.trigger").into_owned(),
                default_style,
            ))];
        }
    }

    if app.slash_suggestions.is_empty() {
        let message = match app.input_suggestion_kind {
            Some(InputSuggestionKind::Slash) => t!("ui.suggestion.empty.slash").into_owned(),
            Some(InputSuggestionKind::FileReference) => {
                t!("ui.suggestion.empty.file_reference").into_owned()
            }
            None => t!("ui.suggestion.empty.generic").into_owned(),
        };
        return vec![Line::from(Span::styled(message, default_style))];
    }

    if matches!(
        app.input_suggestion_kind,
        Some(InputSuggestionKind::FileReference)
    ) {
        return build_file_reference_suggestion_lines(
            app,
            max_items,
            default_style,
            selected_style,
        );
    }

    let selected = app.selected_suggestion;
    let total = app.slash_suggestions.len();
    let (start, end) = inline_picker_bounds(total, selected, max_items);
    let visible_commands = &app.slash_suggestions[start..end];
    let command_column_width = visible_commands
        .iter()
        .map(|suggestion| {
            UnicodeWidthStr::width(
                format!("{}{}", picker_selection_prefix(true), suggestion.label).as_str(),
            )
        })
        .max()
        .unwrap_or(0);
    let description_gap = if max_width >= 40 {
        4
    } else if max_width >= 24 {
        3
    } else {
        2
    };

    let mut lines = Vec::new();
    for idx in start..end {
        let suggestion = &app.slash_suggestions[idx];
        let is_selected = idx == selected;
        let command_style = inline_picker_text_style(is_selected);
        let summary_style = inline_picker_meta_style(is_selected);
        let command_text = format!("{}{}", picker_selection_prefix(is_selected), suggestion.label);
        let summary = suggestion_summary(suggestion);

        if summary.is_empty() || max_width == 0 {
            lines.push(Line::from(Span::styled(command_text, command_style)));
            continue;
        }

        let command_width = UnicodeWidthStr::width(command_text.as_str());
        let summary_width = max_width.saturating_sub(command_column_width + description_gap);
        if summary_width == 0 {
            lines.push(Line::from(Span::styled(command_text, command_style)));
            continue;
        }

        let spacing = command_column_width
            .saturating_sub(command_width)
            .saturating_add(description_gap);
        let summary_text = truncate_to_width(&summary, summary_width);

        lines.push(Line::from(vec![
            Span::styled(command_text, command_style),
            Span::styled(" ".repeat(spacing), summary_style),
            Span::styled(summary_text, summary_style),
        ]));
    }

    if total == 1 {
        let details = suggestion_usage_lines(&app.slash_suggestions[selected]);
        if !details.is_empty() {
            lines.push(Line::from(Span::styled("", default_style)));
            for detail in details {
                lines.push(Line::from(Span::styled(
                    inline_suggestion_detail_line(detail),
                    default_style,
                )));
            }
        }
    }

    lines
}

pub(in crate::ui) fn build_file_reference_suggestion_lines(
    app: &TuiViewModel,
    max_items: usize,
    default_style: Style,
    selected_style: Style,
) -> Vec<Line<'static>> {
    let selected = app.selected_suggestion;
    let total = app.slash_suggestions.len();
    let window = max_items.max(1);
    let start = if selected + 1 > window {
        selected + 1 - window
    } else {
        0
    };
    let end = (start + window).min(total);

    let mut lines = Vec::new();
    for idx in start..end {
        let path = &app.slash_suggestions[idx];
        let is_selected = idx == selected;
        let style = if is_selected {
            selected_style
        } else {
            default_style
        };
        let prefix = picker_selection_prefix(is_selected);
        lines.push(Line::from(Span::styled(
            format!("{}{}", prefix, path.label),
            style,
        )));
    }

    lines
}

pub(in crate::ui) fn input_suggestion_title(app: &TuiViewModel) -> String {
    match app.input_suggestion_kind {
        Some(InputSuggestionKind::Slash) => t!("ui.suggestion.title.slash").into_owned(),
        Some(InputSuggestionKind::FileReference) => {
            t!("ui.suggestion.title.file_reference").into_owned()
        }
        None => t!("ui.suggestion.title.generic").into_owned(),
    }
}

pub(in crate::ui) fn suggestion_summary(suggestion: &InputSuggestion) -> String {
    if !suggestion.summary.is_empty() {
        return suggestion.summary.clone();
    }

    match suggestion.label.as_str() {
        "/help" => t!("ui.suggestion.summary.help").into_owned(),
        "/clear" => t!("ui.suggestion.summary.clear").into_owned(),
        "/quit" | "/exit" => t!("ui.suggestion.summary.quit").into_owned(),
        "/continue" => t!("ui.suggestion.summary.continue").into_owned(),
        "/model" => t!("ui.suggestion.summary.model").into_owned(),
        "/compact" => t!("ui.suggestion.summary.compact").into_owned(),
        "/sessions" => t!("ui.suggestion.summary.sessions").into_owned(),
        "/image" => t!("ui.suggestion.summary.image").into_owned(),
        "/mcp" => t!("ui.suggestion.summary.mcp").into_owned(),
        "/create-rule" => t!("ui.suggestion.summary.create_rule").into_owned(),
        "/rules" => t!("ui.suggestion.summary.rules").into_owned(),
        "/create-skill" => t!("ui.suggestion.summary.create_skill").into_owned(),
        "/skills" => t!("ui.suggestion.summary.skills").into_owned(),
        "/extensions" => t!("ui.suggestion.summary.extensions").into_owned(),
        "/log" => t!("ui.suggestion.summary.log").into_owned(),
        "/language" => t!("ui.suggestion.summary.language").into_owned(),
        _ => String::new(),
    }
}

pub(in crate::ui) fn suggestion_usage_lines(suggestion: &InputSuggestion) -> Vec<String> {
    if !suggestion.details.is_empty() {
        let mut lines = vec![t!("ui.suggestion.usage.heading").into_owned()];
        lines.extend(
            suggestion
                .details
                .iter()
                .map(|detail| format!("    {}", detail)),
        );
        return lines;
    }

    match suggestion.label.as_str() {
        "/continue" => vec![
            t!("ui.suggestion.usage.heading").into_owned(),
            "    /continue".to_string(),
            t!("ui.suggestion.usage.continue_note").into_owned(),
        ],
        "/model" => vec![
            t!("ui.suggestion.usage.heading").into_owned(),
            "    /model list".to_string(),
            "    /model use <name>".to_string(),
            t!("ui.suggestion.usage.model.add_form").into_owned(),
            t!("ui.suggestion.usage.model.add_cli").into_owned(),
            "    /model remove <name>".to_string(),
        ],
        "/sessions" => vec![
            t!("ui.suggestion.usage.heading").into_owned(),
            "    /sessions".to_string(),
            "    /sessions save [path]".to_string(),
            "    /sessions load <file>".to_string(),
            "    /sessions rewind".to_string(),
            "    /sessions rewind <index> [new_message]".to_string(),
            t!("ui.suggestion.usage.sessions.rewind_note").into_owned(),
        ],
        "/image" => vec![
            t!("ui.suggestion.usage.heading").into_owned(),
            "    /image <path> [prompt]".to_string(),
            "    /image pick".to_string(),
            "    /image clear".to_string(),
        ],
        "/mcp" => vec![
            t!("ui.suggestion.usage.heading").into_owned(),
            "    /mcp".to_string(),
            "    /mcp list".to_string(),
            "    /mcp add".to_string(),
            "    /mcp inspect [server]".to_string(),
            "    /mcp tools [server]".to_string(),
            "    /mcp resources [server]".to_string(),
            "    /mcp prompts [server]".to_string(),
            "    /<server>_<prompt> [args_json | user_message]".to_string(),
            t!("ui.suggestion.usage.note").into_owned(),
            t!("ui.suggestion.usage.mcp_note").into_owned(),
        ],
        "/create-rule" => vec![
            t!("ui.suggestion.usage.heading").into_owned(),
            format!("    {}", t!("ui.suggestion.usage.create_rule.repo")),
            format!("    {}", t!("ui.suggestion.usage.create_rule.user")),
        ],
        "/rules" => vec![
            t!("ui.suggestion.usage.heading").into_owned(),
            "    /rules".to_string(),
        ],
        "/create-skill" => vec![
            t!("ui.suggestion.usage.heading").into_owned(),
            format!("    {}", t!("ui.suggestion.usage.create_skill.default")),
            format!("    {}", t!("ui.suggestion.usage.create_skill.user")),
        ],
        "/skills" => vec![
            t!("ui.suggestion.usage.heading").into_owned(),
            "    /skills".to_string(),
        ],
        "/extensions" => vec![
            t!("ui.suggestion.usage.heading").into_owned(),
            "    /extensions".to_string(),
            "    /extensions marketplace [query]".to_string(),
            "    /extensions list".to_string(),
            "    /extensions import <zip>".to_string(),
            "    /extensions remove <id>".to_string(),
        ],
        "/log" => vec![
            t!("ui.suggestion.usage.heading").into_owned(),
            "    /log".to_string(),
            "    /log export".to_string(),
            "    /log session export".to_string(),
        ],
        "/language" => vec![
            t!("ui.suggestion.usage.heading").into_owned(),
            "    /language".to_string(),
            "    /language en".to_string(),
            "    /language zh-CN".to_string(),
        ],
        _ => Vec::new(),
    }
}

pub(in crate::ui) fn build_model_picker_lines(
    app: &TuiViewModel,
    max_items: usize,
) -> Vec<Line<'static>> {
    if app.config.models.is_empty() {
        return vec![Line::from(t!("ui.picker.models.empty").into_owned())];
    }

    let selected = app
        .model_picker_index
        .min(app.config.models.len().saturating_sub(1));
    let total = app.config.models.len();
    let (start, end) = inline_picker_bounds(total, selected, max_items);

    let mut lines = Vec::new();
    for idx in start..end {
        let model = &app.config.models[idx];
        let is_selected = idx == selected;
        let is_active = model.name == app.config.active_model;

        let active_suffix = if is_active {
            t!("ui.picker.models.current_suffix").into_owned()
        } else {
            String::new()
        };
        let row_style = inline_picker_text_style(is_selected);
        let meta_style = inline_picker_meta_style(is_selected);

        lines.push(Line::from(vec![
            Span::styled(picker_selection_prefix(is_selected), row_style),
            Span::styled(model.name.to_string(), row_style),
            Span::styled(format!(" ({})", model.api_base), meta_style),
            Span::styled(active_suffix, meta_style),
        ]));
    }

    lines
}

pub(in crate::ui) fn build_chat_picker_lines(
    app: &TuiViewModel,
    max_items: usize,
) -> Vec<Line<'static>> {
    if app.chat_picker_files.is_empty() {
        return vec![Line::from(t!("ui.picker.sessions.empty").into_owned())];
    }

    let selected = app
        .chat_picker_index
        .min(app.chat_picker_files.len().saturating_sub(1));
    let total = app.chat_picker_files.len();
    let (start, end) = inline_picker_bounds(total, selected, max_items);

    let mut lines = Vec::new();
    for idx in start..end {
        let name = &app.chat_picker_files[idx];
        let is_selected = idx == selected;
        let style = inline_picker_text_style(is_selected);
        lines.push(Line::from(Span::styled(
            format!("{}{}", picker_selection_prefix(is_selected), name),
            style,
        )));
    }

    lines
}

pub(in crate::ui) fn build_subagent_picker_lines(
    app: &TuiViewModel,
    max_items: usize,
    max_width: usize,
) -> Vec<Line<'static>> {
    if app.subagent_sessions.is_empty() {
        return vec![Line::from("当前没有子会话。")];
    }

    let selected = app
        .subagent_picker_index
        .min(app.subagent_sessions.len().saturating_sub(1));
    let total = app.subagent_sessions.len();
    let window = max_items.max(1);
    let start = if selected + 1 > window {
        selected + 1 - window
    } else {
        0
    };
    let end = (start + window).min(total);

    let mut lines = Vec::new();
    for idx in start..end {
        let item = &app.subagent_sessions[idx];
        let is_selected = idx == selected;
        let (status_label, status_style) = subagent_status_badge(item.status, is_selected);
        let title_style = if is_selected {
            Style::default()
                .fg(Color::White)
                .add_modifier(Modifier::BOLD | Modifier::REVERSED)
        } else {
            Style::default().fg(Color::White)
        };

        let title = truncate_to_width(&item.title, max_width.saturating_sub(12).max(8));
        lines.push(Line::from(vec![
            Span::styled(picker_selection_prefix(is_selected), title_style),
            Span::styled(format!("[{}] ", status_label), status_style),
            Span::styled(title, title_style),
        ]));

        if let Some(latest) = item.latest_message.as_deref() {
            lines.push(Line::from(Span::styled(
                format!(
                    "    {}",
                    truncate_to_width(latest, max_width.saturating_sub(4))
                ),
                subtle_aux_text_style(),
            )));
        }
    }

    lines
}

pub(in crate::ui) fn build_language_picker_lines(
    app: &TuiViewModel,
    max_items: usize,
) -> Vec<Line<'static>> {
    let locales = crate::locale::supported_ui_locales();
    let selected = app
        .language_picker_index
        .min(locales.len().saturating_sub(1));
    let total = locales.len();
    let window = max_items.max(1);
    let start = if selected + 1 > window {
        selected + 1 - window
    } else {
        0
    };
    let end = (start + window).min(total);

    let current_locale = rust_i18n::locale().to_string();
    let mut lines = Vec::new();
    for (idx, locale_code) in locales.iter().enumerate().take(end).skip(start) {
        let is_selected = idx == selected;
        let is_active = *locale_code == current_locale.as_str();
        let active_suffix = if is_active {
            t!("ui.picker.languages.current_suffix").into_owned()
        } else {
            String::new()
        };
        let style = if is_selected {
            Style::default()
                .fg(Color::Cyan)
                .add_modifier(Modifier::BOLD | Modifier::REVERSED)
        } else if is_active {
            Style::default()
                .fg(Color::Green)
                .add_modifier(Modifier::BOLD)
        } else {
            Style::default().fg(Color::White)
        };
        lines.push(Line::from(Span::styled(
            format!(
                "{}{} ({}){}",
                picker_selection_prefix(is_selected),
                crate::locale::language_display_name(locale_code),
                locale_code,
                active_suffix
            ),
            style,
        )));
    }

    lines
}

pub(in crate::ui) fn build_image_picker_lines(
    app: &TuiViewModel,
    max_items: usize,
) -> Vec<Line<'static>> {
    if app.image_picker_files.is_empty() {
        return vec![Line::from(t!("ui.picker.images.empty").into_owned())];
    }

    let selected = app
        .image_picker_index
        .min(app.image_picker_files.len().saturating_sub(1));
    let total = app.image_picker_files.len();
    let window = max_items.max(1);
    let start = if selected + 1 > window {
        selected + 1 - window
    } else {
        0
    };
    let end = (start + window).min(total);

    let mut lines = Vec::new();
    for idx in start..end {
        let name = &app.image_picker_files[idx];
        let is_selected = idx == selected;
        let style = if is_selected {
            Style::default()
                .fg(Color::Cyan)
                .add_modifier(Modifier::BOLD | Modifier::REVERSED)
        } else {
            Style::default().fg(Color::White)
        };
        lines.push(Line::from(Span::styled(
            format!("{}{}", picker_selection_prefix(is_selected), name),
            style,
        )));
    }

    lines
}
