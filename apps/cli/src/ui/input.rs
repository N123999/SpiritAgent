use super::*;
use rust_i18n::t;
use std::{cell::RefCell, path::Path};

thread_local! {
    static INPUT_CURSOR_DEBUG_SIGNATURE: RefCell<Option<String>> = RefCell::new(None);
}

pub(in crate::ui) fn input_mode_title(input_mode: MainInputMode) -> String {
    match input_mode {
        MainInputMode::Agent => t!("ui.input.title_agent").into_owned(),
        MainInputMode::Plan => t!("ui.input.title_plan").into_owned(),
    }
}

/// 输入框边框与标题（legend）；Agent 模式单独变淡，Shell / Plan 保持原有高对比描边。
pub(in crate::ui) fn input_block_border_style(
    shell_mode_active: bool,
    input_mode: MainInputMode,
    bottom_form_open: bool,
) -> Style {
    if let Some(color) = cli_ui_border_color(CliUiHookSlot::InputFrame) {
        return Style::default().fg(color);
    }
    if bottom_form_open {
        return subtle_aux_text_style().add_modifier(Modifier::DIM);
    }
    if shell_mode_active {
        return Style::default().fg(Color::Rgb(184, 134, 11));
    }
    match input_mode {
        MainInputMode::Agent => conversation_body_text_style(),
        MainInputMode::Plan => Style::default().fg(Color::Yellow),
    }
}

pub(in crate::ui) fn input_text_style(
    shell_mode_active: bool,
    input_mode: MainInputMode,
    bottom_form_open: bool,
) -> Style {
    if bottom_form_open {
        return subtle_aux_text_style().add_modifier(Modifier::DIM);
    }
    if shell_mode_active {
        return Style::default().fg(Color::Rgb(184, 134, 11));
    }
    match input_mode {
        MainInputMode::Agent => Style::default().fg(Color::White),
        MainInputMode::Plan => Style::default().fg(Color::Yellow),
    }
}

pub(in crate::ui) fn deemphasize_pending_style(style: Style, bottom_form_open: bool) -> Style {
    if bottom_form_open {
        style.add_modifier(Modifier::DIM)
    } else {
        style
    }
}

pub(in crate::ui) fn build_footer_line(app: &TuiViewModel, width: usize) -> Line<'static> {
    let footer_style = subtle_aux_text_style();
    let mode_label = match app.input_mode {
        MainInputMode::Agent => t!("ui.footer.mode.agent"),
        MainInputMode::Plan => t!("ui.footer.mode.plan"),
    };
    let left_label = if app.rewind_picker.is_some() {
        format!(
            "{}  |  {}  |  {}",
            t!("ui.footer.preview"),
            mode_label,
            t!("ui.footer.rewind_hint")
        )
    } else if app.pending_response_active && app.pending_aux_state().is_some() {
        format!(
            "{}  |  {}  |  {}",
            t!("ui.footer.preview"),
            mode_label,
            t!("ui.footer.interrupt_reply_hint")
        )
    } else {
        format!("{}  |  {}", t!("ui.footer.preview"), mode_label)
    };
    let right_label = app.config.active_model.as_str();
    let side_padding = if width >= 12 {
        2
    } else if width >= 6 {
        1
    } else {
        0
    };

    if width == 0 {
        return Line::from(Vec::<Span<'static>>::new());
    }

    let content_width = width.saturating_sub(side_padding * 2);
    if content_width == 0 {
        return Line::from(Span::styled(" ".repeat(width), footer_style));
    }

    let right_width = UnicodeWidthStr::width(right_label);
    if right_width >= content_width {
        let text = truncate_to_width(right_label, content_width);
        let used_width = UnicodeWidthStr::width(text.as_str());
        return Line::from(vec![
            Span::styled(" ".repeat(side_padding), footer_style),
            Span::styled(text, footer_style),
            Span::styled(
                " ".repeat(width.saturating_sub(side_padding + used_width)),
                footer_style,
            ),
        ]);
    }

    let max_left_width = content_width.saturating_sub(right_width + 1);
    let left_text = truncate_to_width(&left_label, max_left_width.max(1));
    let left_width = UnicodeWidthStr::width(left_text.as_str());

    if left_width + 1 > content_width.saturating_sub(right_width) {
        let text = truncate_to_width(right_label, content_width);
        let used_width = UnicodeWidthStr::width(text.as_str());
        return Line::from(vec![
            Span::styled(" ".repeat(side_padding), footer_style),
            Span::styled(text, footer_style),
            Span::styled(
                " ".repeat(width.saturating_sub(side_padding + used_width)),
                footer_style,
            ),
        ]);
    }

    let gap = content_width.saturating_sub(left_width + right_width);
    Line::from(vec![
        Span::styled(" ".repeat(side_padding), footer_style),
        Span::styled(left_text, footer_style),
        Span::styled(" ".repeat(gap), footer_style),
        Span::styled(right_label.to_string(), footer_style),
        Span::styled(" ".repeat(side_padding), footer_style),
    ])
}

pub(in crate::ui) fn input_block_height(app: &TuiViewModel, max_width: usize) -> u16 {
    let content_lines = pending_input_header_line_count(app)
        .saturating_add(input_visual_line_count(&app.input, max_width))
        .max(1);
    content_lines.saturating_add(2) as u16
}

pub(in crate::ui) fn input_cursor_position(app: &TuiViewModel, max_width: usize) -> (u16, u16) {
    let prefix: String = app.input.chars().take(app.input_cursor).collect();
    let (row, col) = wrapped_text_cursor_position(&prefix, max_width);
    (
        pending_input_header_line_count(app).saturating_add(row) as u16,
        col as u16,
    )
}

pub(in crate::ui) fn build_input_lines(
    app: &TuiViewModel,
    max_width: usize,
    bottom_form_open: bool,
) -> Vec<Line<'static>> {
    let mut lines = Vec::new();

    if let Some(approval) = &app.pending_subagent_approval {
        let summary = format!(
            "SubAgent 待确认: {} / {}",
            approval.session_title, approval.tool_name
        );
        lines.push(Line::from(Span::styled(
            truncate_to_width(&summary, max_width),
            deemphasize_pending_style(
                Style::default()
                    .fg(Color::Yellow)
                    .add_modifier(Modifier::BOLD),
                bottom_form_open,
            ),
        )));
        lines.push(Line::from(Span::styled(
            truncate_to_width(&approval.prompt, max_width),
            deemphasize_pending_style(Style::default().fg(Color::LightYellow), bottom_form_open),
        )));
    }

    if !app.pending_image_paths.is_empty() {
        let count = app.pending_image_paths.len();
        let summary = format!("{}", t!("ui.pending.images.summary", count = count));
        lines.push(Line::from(Span::styled(
            truncate_to_width(&summary, max_width),
            deemphasize_pending_style(
                Style::default()
                    .fg(Color::Green)
                    .add_modifier(Modifier::BOLD),
                bottom_form_open,
            ),
        )));
        lines.push(Line::from(Span::styled(
            summarize_pending_images(&app.pending_image_paths, max_width),
            deemphasize_pending_style(Style::default().fg(Color::Cyan), bottom_form_open),
        )));
    }

    if !app.pending_mcp_resources.is_empty() {
        let count = app.pending_mcp_resources.len();
        let summary = format!("{}", t!("ui.pending.mcp_resources.summary", count = count));
        lines.push(Line::from(Span::styled(
            truncate_to_width(&summary, max_width),
            deemphasize_pending_style(
                Style::default()
                    .fg(Color::Yellow)
                    .add_modifier(Modifier::BOLD),
                bottom_form_open,
            ),
        )));
        lines.push(Line::from(Span::styled(
            summarize_pending_mcp_resources(&app.pending_mcp_resources, max_width),
            deemphasize_pending_style(Style::default().fg(Color::LightYellow), bottom_form_open),
        )));
    }

    for line in wrap_editor_text_lines(&app.input, max_width) {
        lines.push(Line::from(Span::styled(
            line,
            input_text_style(app.shell_mode_active, app.input_mode, bottom_form_open),
        )));
    }

    lines
}

pub(in crate::ui) fn pending_input_header_line_count(app: &TuiViewModel) -> usize {
    let mut lines = 0;
    if app.pending_subagent_approval.is_some() {
        lines += 2;
    }
    if !app.pending_image_paths.is_empty() {
        lines += 2;
    }
    if !app.pending_mcp_resources.is_empty() {
        lines += 2;
    }
    lines
}

pub(in crate::ui) fn maybe_log_input_cursor_diagnostics(
    app: &TuiViewModel,
    max_width: usize,
    input_cursor_row: u16,
    input_cursor_col: u16,
) {
    let input_chars = app.input.chars().count();
    let should_log =
        app.input.contains('\n') || input_chars >= 48 || app.input.chars().any(|ch| !ch.is_ascii());
    if !should_log {
        return;
    }

    let preview = sanitize_input_log_preview(&app.input, 96);
    let signature = format!(
        "width={max_width}|chars={input_chars}|cursor={}|row={input_cursor_row}|col={input_cursor_col}|preview={preview}",
        app.input_cursor,
    );

    INPUT_CURSOR_DEBUG_SIGNATURE.with(|last| {
        let mut last = last.borrow_mut();
        if last.as_deref() == Some(signature.as_str()) {
            return;
        }
        *last = Some(signature);
        logging::log_event(&format!(
            "[input] render chars={} cursor={} width={} row={} col={} visual_lines={} preview={}",
            input_chars,
            app.input_cursor,
            max_width,
            input_cursor_row,
            input_cursor_col,
            wrap_editor_text_lines(&app.input, max_width).len(),
            preview,
        ));
    });
}

pub(in crate::ui) fn sanitize_input_log_preview(text: &str, max_chars: usize) -> String {
    let mut preview = String::new();
    let mut emitted = 0usize;
    for ch in text.chars() {
        if emitted >= max_chars {
            preview.push('…');
            break;
        }
        match ch {
            '\n' => preview.push_str("\\n"),
            '\r' => preview.push_str("\\r"),
            _ => preview.push(ch),
        }
        emitted += 1;
    }
    preview
}

pub(in crate::ui) fn summarize_pending_images(paths: &[String], max_width: usize) -> String {
    if max_width == 0 {
        return String::new();
    }

    let mut parts = Vec::new();
    for path in paths {
        let name = file_name_for_display(path);
        parts.push(format!("[img] {}", truncate_to_width(&name, 18)));
    }

    let mut line = String::new();
    let mut remaining = parts.len();
    for part in parts {
        let candidate = if line.is_empty() {
            part.clone()
        } else {
            format!("{}  {}", line, part)
        };
        if UnicodeWidthStr::width(candidate.as_str()) > max_width {
            break;
        }
        line = candidate;
        remaining = remaining.saturating_sub(1);
    }

    if line.is_empty() {
        return truncate_to_width("[img] ...", max_width);
    }

    if remaining > 0 {
        let suffix = format!("  +{}", remaining);
        let combined = format!("{}{}", line, suffix);
        if UnicodeWidthStr::width(combined.as_str()) <= max_width {
            combined
        } else {
            truncate_to_width(&line, max_width)
        }
    } else {
        line
    }
}

pub(in crate::ui) fn summarize_pending_mcp_resources(
    resources: &[PendingMcpResource],
    max_width: usize,
) -> String {
    if max_width == 0 {
        return String::new();
    }

    let mut parts = Vec::new();
    for resource in resources {
        parts.push(format!(
            "[mcp] {}",
            truncate_to_width(&resource.short_label(), 26)
        ));
    }

    let mut line = String::new();
    let mut remaining = parts.len();
    for part in parts {
        let candidate = if line.is_empty() {
            part.clone()
        } else {
            format!("{}  {}", line, part)
        };
        if UnicodeWidthStr::width(candidate.as_str()) > max_width {
            break;
        }
        line = candidate;
        remaining = remaining.saturating_sub(1);
    }

    if line.is_empty() {
        return truncate_to_width("[mcp] ...", max_width);
    }

    if remaining > 0 {
        let suffix = format!("  +{}", remaining);
        let combined = format!("{}{}", line, suffix);
        if UnicodeWidthStr::width(combined.as_str()) <= max_width {
            combined
        } else {
            truncate_to_width(&line, max_width)
        }
    } else {
        line
    }
}

pub(in crate::ui) fn file_name_for_display(path: &str) -> String {
    Path::new(path)
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| path.to_string())
}
