use comrak::{
    Arena, Options,
    nodes::{AstNode, ListType, NodeValue},
    parse_document,
};
use ratatui::{
    layout::{Constraint, Direction, Layout, Rect},
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{Block, Borders, Clear, Paragraph, Wrap},
};
use rust_i18n::t;
use std::{cell::RefCell, collections::HashMap, path::Path};
use unicode_width::{UnicodeWidthChar, UnicodeWidthStr};

use crate::{
    conversation_select::flatten_wrapped_history,
    logging,
    shell::{ask_questions as ask_questions_form, manual_shell},
    session::PendingMcpResource,
    tui::{ConversationPanelHit, TuiShell},
    view::{
        AskQuestionsOptionView, AskQuestionsQuestionView, AssistantAuxKind,
        BottomFormFieldEditorView, BottomFormFieldView, BottomFormKind, BottomFormView,
        ChatMessage, InputSuggestion, InputSuggestionKind, MainInputMode, MessageRole,
        PendingAssistantAux, ToolUiBlock, ToolUiPhase, TuiViewModel,
    },
};

const SLASH_SUGGESTION_VISIBLE_ITEMS: usize = 10;
const SLASH_SUGGESTION_BLOCK_HEIGHT: u16 = 12;
const SPIRIT_LOGO_LINES: [&str; 6] = [
    " ███████╗██████╗ ██╗██████╗ ██╗████████╗ █████╗  ██████╗ ███████╗███╗   ██╗████████╗",
    " ██╔════╝██╔══██╗██║██╔══██╗██║╚══██╔══╝██╔══██╗██╔════╝ ██╔════╝████╗  ██║╚══██╔══╝",
    " ███████╗██████╔╝██║██████╔╝██║   ██║   ███████║██║  ███╗█████╗  ██╔██╗ ██║   ██║   ",
    " ╚════██║██╔═══╝ ██║██╔══██╗██║   ██║   ██╔══██║██║   ██║██╔══╝  ██║╚██╗██║   ██║   ",
    " ███████║██║     ██║██║  ██║██║   ██║   ██║  ██║╚██████╔╝███████╗██║ ╚████║   ██║   ",
    " ╚══════╝╚═╝     ╚═╝╚═╝  ╚═╝╚═╝   ╚═╝   ╚═╝  ╚═╝ ╚═════╝ ╚══════╝╚═╝  ╚═══╝   ╚═╝   ",
];

thread_local! {
    static MARKDOWN_CACHE: RefCell<HashMap<String, Vec<Vec<Span<'static>>>>> =
        RefCell::new(HashMap::new());
    static INPUT_CURSOR_DEBUG_SIGNATURE: RefCell<Option<String>> = RefCell::new(None);
}

struct BottomFormRenderResult {
    cursor: Option<(u16, u16)>,
    scroll_offset: Option<usize>,
}

struct RulesBottomFormLayout {
    content_lines: Vec<Line<'static>>,
    field_ranges: Vec<Option<(usize, usize)>>,
    footer_lines: Vec<Line<'static>>,
}

fn conversation_logo_width(available_width: u16) -> u16 {
    let logo_text_width = SPIRIT_LOGO_LINES
        .iter()
        .map(|line| UnicodeWidthStr::width(*line))
        .max()
        .unwrap_or(0);
    let title_width = UnicodeWidthStr::width(format!(" {} ", t!("ui.brand.title")).as_str());
    let desired_width = logo_text_width.max(title_width).saturating_add(2) as u16;
    desired_width.min(available_width.max(1))
}

pub fn draw_ui(frame: &mut ratatui::Frame<'_>, shell: &mut TuiShell) {
    let app = shell.view_model();
    let show_model_picker = app.model_picker_active;
    let show_language_picker = app.language_picker_active;
    let show_chat_picker = app.chat_picker_active;
    let show_image_picker = app.image_picker_active;
    let show_bottom_form = app.bottom_form.is_some();
    let show_picker =
        show_model_picker || show_language_picker || show_chat_picker || show_image_picker;
    let show_suggestions = app.input_suggestion_kind.is_some() && !show_picker && !show_bottom_form;
    let root_chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints(if show_suggestions || show_bottom_form {
            vec![Constraint::Min(0)]
        } else {
            vec![Constraint::Min(0), Constraint::Length(1)]
        })
        .split(frame.area());
    let content_area = root_chunks[0];
    let input_inner_width = content_area.width.saturating_sub(2) as usize;
    let input_height = input_block_height(&app, input_inner_width);
    let bottom_form_height = app
        .bottom_form
        .as_ref()
        .map(|f| bottom_form_display_height(f, content_area.width, content_area.height, input_height))
        .unwrap_or(0);

    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints(if show_picker {
            vec![
                Constraint::Min(5),
                Constraint::Length(input_height),
                Constraint::Length(7),
                Constraint::Length(1),
            ]
        } else if show_bottom_form {
            vec![
                Constraint::Min(0),
                Constraint::Length(input_height),
                Constraint::Length(bottom_form_height),
            ]
        } else if show_suggestions {
            vec![
                Constraint::Min(5),
                Constraint::Length(input_height),
                Constraint::Length(SLASH_SUGGESTION_BLOCK_HEIGHT),
            ]
        } else {
            vec![
                Constraint::Min(4),
                Constraint::Length(input_height),
                Constraint::Length(1),
            ]
        })
        .split(content_area);

    let history_lines = build_history_lines(&app, chunks[0].width.saturating_sub(1) as usize);
    // 对话区无边框，内容与命中区域占满 chunks[0]。
    let inner_x = chunks[0].x;
    let inner_y = chunks[0].y;
    let inner_w = chunks[0].width.max(1);
    let inner_h = chunks[0].height.max(1);
    let history_view_height = inner_h as usize;
    let w = inner_w.max(1) as u16;
    // 以 WordWrapper 折行为准，避免 Paragraph::line_count 与自定义折行在少数宽度/CJK 下不一致导致滚动错位。
    let (flat_measure, _) = flatten_wrapped_history(history_lines.clone(), w, None);
    let total_visual_lines = flat_measure.len();
    let norm = shell.conversation_norm_for_paint(total_visual_lines);
    let (flat, plain) = flatten_wrapped_history(history_lines, w, norm);
    debug_assert_eq!(flat.len(), total_visual_lines);
    let max_scroll = flat.len().saturating_sub(history_view_height);
    let offset_bottom = shell.clamp_history_scroll(max_scroll);
    let history_scroll = max_scroll.saturating_sub(offset_bottom);
    let visible: Vec<Line<'static>> = flat
        .into_iter()
        .skip(history_scroll)
        .take(history_view_height)
        .collect();
    let history = Paragraph::new(visible);
    frame.render_widget(history, chunks[0]);
    shell.note_conversation_panel(
        ConversationPanelHit {
            x: inner_x,
            y: inner_y,
            w: inner_w,
            h: inner_h,
            scroll: history_scroll,
            total_lines: total_visual_lines,
        },
        plain,
    );

    let (input_cursor_row, input_cursor_col) =
        input_cursor_position(&app, chunks[1].width.saturating_sub(2) as usize);
    maybe_log_input_cursor_diagnostics(
        &app,
        chunks[1].width.saturating_sub(2) as usize,
        input_cursor_row,
        input_cursor_col,
    );
    let input_border_style =
        input_block_border_style(app.shell_mode_active, app.input_mode, show_bottom_form);
    let input_title = if app.shell_mode_active {
        t!("ui.input.title_shell").into_owned()
    } else {
        input_mode_title(app.input_mode)
    };
    let input = Paragraph::new(build_input_lines(
        &app,
        chunks[1].width.saturating_sub(2) as usize,
        show_bottom_form,
    ))
    .block(
        Block::default()
            .borders(Borders::ALL)
            .border_style(input_border_style)
            .title(Line::from(Span::styled(input_title, input_border_style))),
    );
    frame.render_widget(input, chunks[1]);

    if show_bottom_form {
        if let Some(form) = &app.bottom_form {
            let render = draw_bottom_form(frame, chunks[2], form);
            if let Some(scroll_offset) = render.scroll_offset {
                shell.sync_active_bottom_form_scroll(scroll_offset);
            }
            if let Some((cursor_x, cursor_y)) = render.cursor {
                frame.set_cursor_position((cursor_x, cursor_y));
            }
        }
    } else if !show_picker {
        // Use terminal display width so CJK/full-width characters keep cursor aligned.
        let max_cursor_offset = chunks[1].width.saturating_sub(3) as usize;
        let cursor_offset = input_cursor_col.min(max_cursor_offset as u16) as usize;
        let cursor_x = chunks[1].x + 1 + cursor_offset as u16;
        let cursor_y = chunks[1].y + 1 + input_cursor_row;
        frame.set_cursor_position((cursor_x, cursor_y));
    }

    if show_model_picker {
        let picker_lines = build_model_picker_lines(&app, 5);
        let picker_widget = Paragraph::new(picker_lines)
            .block(Block::default().borders(Borders::ALL).title(t!("ui.picker.model")))
            .wrap(Wrap { trim: true });
        frame.render_widget(picker_widget, chunks[2]);
    } else if show_language_picker {
        let picker_lines = build_language_picker_lines(&app, 5);
        let picker_widget = Paragraph::new(picker_lines)
            .block(Block::default().borders(Borders::ALL).title(t!("ui.picker.language")))
            .wrap(Wrap { trim: true });
        frame.render_widget(picker_widget, chunks[2]);
    } else if show_chat_picker {
        let picker_lines = build_chat_picker_lines(&app, 5);
        let picker_widget = Paragraph::new(picker_lines)
            .block(Block::default().borders(Borders::ALL).title(t!("ui.picker.sessions")))
            .wrap(Wrap { trim: true });
        frame.render_widget(picker_widget, chunks[2]);
    } else if show_image_picker {
        let picker_lines = build_image_picker_lines(&app, 5);
        let picker_widget = Paragraph::new(picker_lines)
            .block(Block::default().borders(Borders::ALL).title(t!("ui.picker.image")))
            .wrap(Wrap { trim: true });
        frame.render_widget(picker_widget, chunks[2]);
    } else if show_suggestions {
        let suggestions = build_suggestion_lines(
            &app,
            SLASH_SUGGESTION_VISIBLE_ITEMS,
            chunks[2].width.saturating_sub(2) as usize,
        );
        let suggestion_frame_style = conversation_body_text_style();
        let suggestion_title = input_suggestion_title(&app);
        let suggestions_widget = Paragraph::new(suggestions)
            .block(
                Block::default()
                    .borders(Borders::ALL)
                    .border_style(suggestion_frame_style)
                    .title(Line::from(Span::styled(
                        suggestion_title,
                        suggestion_frame_style,
                    ))),
            )
            .wrap(Wrap { trim: true });
        frame.render_widget(suggestions_widget, chunks[2]);
    }

    if !show_suggestions && !show_bottom_form {
        let help_idx = if show_picker { 3 } else { 2 };
        let footer = Paragraph::new(build_footer_line(&app, chunks[help_idx].width as usize));
        frame.render_widget(footer, chunks[help_idx]);
        frame.render_widget(Clear, root_chunks[1]);
    }
}

fn subtle_aux_text_style() -> Style {
    Style::default().fg(Color::Rgb(128, 128, 128))
}

fn conversation_body_text_style() -> Style {
    Style::default().fg(Color::Rgb(170, 170, 170))
}

fn input_mode_title(input_mode: MainInputMode) -> String {
    match input_mode {
        MainInputMode::Agent => t!("ui.input.title_agent").into_owned(),
        MainInputMode::Plan => t!("ui.input.title_plan").into_owned(),
    }
}

/// 输入框边框与标题（legend）；Agent 模式单独变淡，Shell / Plan 保持原有高对比描边。
fn input_block_border_style(
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
        MainInputMode::Agent => conversation_body_text_style(),
        MainInputMode::Plan => Style::default().fg(Color::Yellow),
    }
}

fn input_text_style(
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

fn deemphasize_pending_style(style: Style, bottom_form_open: bool) -> Style {
    if bottom_form_open {
        style.add_modifier(Modifier::DIM)
    } else {
        style
    }
}

fn build_footer_line(app: &TuiViewModel, width: usize) -> Line<'static> {
    let footer_style = subtle_aux_text_style();
    let mode_label = match app.input_mode {
        MainInputMode::Agent => t!("ui.footer.mode.agent"),
        MainInputMode::Plan => t!("ui.footer.mode.plan"),
    };
    let left_label = format!("{}  |  {}", t!("ui.footer.preview"), mode_label);
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

fn input_block_height(app: &TuiViewModel, max_width: usize) -> u16 {
    let content_lines = pending_input_header_line_count(app)
        .saturating_add(input_visual_line_count(&app.input, max_width))
        .max(1);
    content_lines.saturating_add(2) as u16
}

fn input_cursor_position(app: &TuiViewModel, max_width: usize) -> (u16, u16) {
    let prefix: String = app.input.chars().take(app.input_cursor).collect();
    let (row, col) = wrapped_text_cursor_position(&prefix, max_width);
    (
        pending_input_header_line_count(app).saturating_add(row) as u16,
        col as u16,
    )
}

fn build_input_lines(app: &TuiViewModel, max_width: usize, bottom_form_open: bool) -> Vec<Line<'static>> {
    let mut lines = Vec::new();

    if !app.pending_image_paths.is_empty() {
        let count = app.pending_image_paths.len();
        let summary = format!(
            "{}",
            t!("ui.pending.images.summary", count = count)
        );
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
        let summary = format!(
            "{}",
            t!("ui.pending.mcp_resources.summary", count = count)
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

fn pending_input_header_line_count(app: &TuiViewModel) -> usize {
    let mut lines = 0;
    if !app.pending_image_paths.is_empty() {
        lines += 2;
    }
    if !app.pending_mcp_resources.is_empty() {
        lines += 2;
    }
    lines
}

fn input_visual_line_count(text: &str, max_width: usize) -> usize {
    wrap_editor_text_lines(text, max_width).len().max(1)
}

fn wrapped_text_cursor_position(text: &str, max_width: usize) -> (usize, usize) {
    let visual_lines = wrap_editor_text_lines(text, max_width);
    let row = visual_lines.len().saturating_sub(1);
    let col = visual_lines
        .last()
        .map(|line| UnicodeWidthStr::width(line.as_str()))
        .unwrap_or(0);
    (row, col)
}

fn wrap_editor_text_lines(text: &str, max_width: usize) -> Vec<String> {
    let width = max_width.max(1);
    let mut lines = vec![String::new()];
    let mut col = 0usize;

    for ch in text.chars() {
        if ch == '\n' {
            lines.push(String::new());
            col = 0;
            continue;
        }

        let ch_width = UnicodeWidthChar::width(ch).unwrap_or(0);
        if ch_width > width {
            continue;
        }

        if ch_width > 0 && col > 0 && col + ch_width > width {
            lines.push(String::new());
            col = 0;
        }

        lines
            .last_mut()
            .expect("wrap_editor_text_lines")
            .push(ch);

        if ch_width > 0 {
            col += ch_width;
        }
    }

    if !text.is_empty() && col == width {
        lines.push(String::new());
    }

    lines
}

fn maybe_log_input_cursor_diagnostics(
    app: &TuiViewModel,
    max_width: usize,
    input_cursor_row: u16,
    input_cursor_col: u16,
) {
    let input_chars = app.input.chars().count();
    let should_log = app.input.contains('\n')
        || input_chars >= 48
        || app.input.chars().any(|ch| !ch.is_ascii());
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

fn sanitize_input_log_preview(text: &str, max_chars: usize) -> String {
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

fn summarize_pending_images(paths: &[String], max_width: usize) -> String {
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

fn summarize_pending_mcp_resources(resources: &[PendingMcpResource], max_width: usize) -> String {
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

fn file_name_for_display(path: &str) -> String {
    Path::new(path)
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| path.to_string())
}

fn truncate_to_width(text: &str, max_width: usize) -> String {
    if max_width == 0 {
        return String::new();
    }

    let text_width = UnicodeWidthStr::width(text);
    if text_width <= max_width {
        return text.to_string();
    }

    if max_width == 1 {
        return "…".to_string();
    }

    let mut out = String::new();
    let mut used = 0usize;
    for ch in text.chars() {
        let width = UnicodeWidthChar::width(ch).unwrap_or(0);
        if used + width + 1 > max_width {
            break;
        }
        out.push(ch);
        used += width;
    }
    out.push('…');
    out
}

fn clip_to_width(text: &str, max_width: usize) -> String {
    if max_width == 0 {
        return String::new();
    }

    let mut out = String::new();
    let mut used = 0usize;
    for ch in text.chars() {
        let ch_width = UnicodeWidthChar::width(ch).unwrap_or(0);
        if used + ch_width > max_width {
            break;
        }
        used += ch_width;
        out.push(ch);
    }
    out
}

fn pad_right_to_width(text: &str, width: usize) -> String {
    let used = UnicodeWidthStr::width(text);
    if used >= width {
        return text.to_string();
    }
    format!("{}{}", text, " ".repeat(width - used))
}

fn build_logo_top_border(inner_width: usize, title: &str) -> String {
    if inner_width == 0 {
        return String::new();
    }

    let title_width = UnicodeWidthStr::width(title);
    if title_width >= inner_width {
        return format!("┌{}┐", "─".repeat(inner_width));
    }

    format!("┌{}{}┐", title, "─".repeat(inner_width - title_width))
}

fn build_history_logo_lines(max_width: usize) -> Vec<Line<'static>> {
    if max_width < 4 {
        return Vec::new();
    }

    let banner_width = conversation_logo_width(max_width as u16) as usize;
    if banner_width < 4 {
        return Vec::new();
    }

    let inner_width = banner_width.saturating_sub(2);
    let logo_style = Style::default().fg(Color::Cyan);
    let mut lines = Vec::with_capacity(SPIRIT_LOGO_LINES.len() + 2);

    lines.push(Line::from(Span::styled(
        build_logo_top_border(inner_width, t!("ui.brand.title").as_ref()),
        logo_style,
    )));

    for logo_line in SPIRIT_LOGO_LINES {
        let clipped = clip_to_width(logo_line, inner_width);
        let padded = pad_right_to_width(&clipped, inner_width);
        lines.push(Line::from(Span::styled(
            format!("│{}│", padded),
            logo_style,
        )));
    }

    lines.push(Line::from(Span::styled(
        format!("└{}┘", "─".repeat(inner_width)),
        logo_style,
    )));
    lines
}

fn build_history_lines(app: &TuiViewModel, max_width: usize) -> Vec<Line<'static>> {
    let mut lines = build_history_logo_lines(max_width);
    let (visible_messages, skipped, start_index) = visible_messages(app);
    let has_pending_aux = app.pending_aux_state().is_some();
    let mut rendered_messages: Vec<Vec<Line<'static>>> = Vec::new();

    if !lines.is_empty() && (!visible_messages.is_empty() || has_pending_aux) {
        lines.push(Line::from(""));
    }

    if skipped > 0 {
        lines.push(Line::from(vec![
            Span::styled("... ", Style::default().fg(Color::DarkGray)),
            Span::styled(
                t!("ui.history.skipped_messages", count = skipped).into_owned(),
                Style::default()
                    .fg(Color::DarkGray)
                    .add_modifier(Modifier::ITALIC),
            ),
        ]));
    }

    for (idx, msg) in visible_messages.iter().enumerate() {
        if should_hide_pending_assistant_placeholder(app, msg, idx, visible_messages.len()) {
            continue;
        }
        let global_idx = start_index + idx;
        let rendered = render_message_lines(app, msg, global_idx);
        if !rendered.is_empty() {
            rendered_messages.push(rendered);
        }
    }

    let rendered_count = rendered_messages.len();
    for (idx, message_lines) in rendered_messages.into_iter().enumerate() {
        lines.extend(message_lines);
        if idx + 1 < rendered_count {
            lines.push(Line::from(""));
        }
    }

    lines
}

fn should_hide_pending_assistant_placeholder(
    app: &TuiViewModel,
    msg: &ChatMessage,
    idx: usize,
    total: usize,
) -> bool {
    app.pending_response_active
        && idx + 1 == total
        && msg.role == MessageRole::Agent
        && msg.tool_block.is_none()
        && msg.content.trim().is_empty()
        && app.pending_aux_state().is_none()
}

fn message_prefix_text() -> &'static str {
    ">\u{00a0}"
}

fn message_gutter_padding() -> &'static str {
    "  "
}

fn assistant_message_prefix_style() -> Style {
    Style::default()
        .fg(Color::Cyan)
        .add_modifier(Modifier::BOLD)
}

fn pending_aux_status_style(kind: AssistantAuxKind) -> Style {
    match kind {
        AssistantAuxKind::Thinking => Style::default()
            .fg(Color::Yellow)
            .add_modifier(Modifier::ITALIC),
        AssistantAuxKind::Compressing => {
            assistant_message_prefix_style().add_modifier(Modifier::ITALIC)
        }
    }
}

fn assistant_aux_title(kind: AssistantAuxKind) -> String {
    match kind {
        AssistantAuxKind::Thinking => t!("ui.aux.thinking").into_owned(),
        AssistantAuxKind::Compressing => t!("ui.aux.compacting").into_owned(),
    }
}

fn assistant_aux_title_style(kind: AssistantAuxKind) -> Style {
    match kind {
        AssistantAuxKind::Thinking => Style::default().fg(Color::DarkGray),
        AssistantAuxKind::Compressing => subtle_aux_text_style(),
    }
}

fn assistant_aux_body_style(kind: AssistantAuxKind) -> Style {
    match kind {
        AssistantAuxKind::Thinking => Style::default().fg(Color::DarkGray),
        AssistantAuxKind::Compressing => subtle_aux_text_style(),
    }
}

fn is_tool_progress_only_text(text: &str) -> bool {
    let mut saw_line = false;
    for segment in text.lines().map(str::trim).filter(|line| !line.is_empty()) {
        saw_line = true;
        if !segment.starts_with("准备调用工具:") {
            return false;
        }
    }
    saw_line
}

fn should_render_aux_after_message_body(text: Option<&str>, has_message_body: bool) -> bool {
    has_message_body && text.is_some_and(is_tool_progress_only_text)
}

fn render_aux_text_lines(
    push_message_line: &mut impl FnMut(Vec<Span<'static>>),
    kind: AssistantAuxKind,
    text: &str,
) {
    for segment in text.lines() {
        push_message_line(vec![Span::styled(
            segment.to_string(),
            assistant_aux_body_style(kind),
        )]);
    }
}

fn render_pending_aux_lines(
    push_message_line: &mut impl FnMut(Vec<Span<'static>>),
    pending_aux: &PendingAssistantAux,
    detail_text: Option<&str>,
) {
    push_message_line(vec![Span::styled(
        pending_aux.status_text.clone(),
        pending_aux_status_style(pending_aux.kind),
    )]);

    if let Some(detail_text) = detail_text {
        render_aux_text_lines(push_message_line, pending_aux.kind, detail_text);
    }
}

fn render_message_lines(
    app: &TuiViewModel,
    msg: &ChatMessage,
    message_index: usize,
) -> Vec<Line<'static>> {
    let prefix_style = match msg.role {
        MessageRole::User => conversation_body_text_style(),
        MessageRole::Agent => assistant_message_prefix_style(),
    };

    if let Some(ref tool) = msg.tool_block {
        return render_tool_card_lines(prefix_style, tool, app.show_aux_details);
    }

    let is_pending_assistant =
        msg.role == MessageRole::Agent && app.is_pending_assistant_message(message_index);

    let (message_body, embedded_thinking) = match msg.role {
        MessageRole::Agent => split_embedded_thinking_content(&msg.content),
        MessageRole::User => (msg.content.clone(), None),
    };

    let has_message_body = !message_body.trim().is_empty();
    let content_lines = if has_message_body {
        match msg.role {
            MessageRole::User => plain_text_lines(&message_body),
            MessageRole::Agent => markdown_lines(&message_body),
        }
    } else {
        Vec::new()
    };

    let mut out = Vec::new();
    let pending_aux = if is_pending_assistant {
        app.pending_aux_state()
    } else {
        None
    };
    let stored_aux = if msg.role == MessageRole::Agent && app.show_aux_details {
        app.assistant_aux_for_message(message_index)
    } else {
        None
    };
    let stored_compaction_text = stored_aux
        .and_then(|aux| aux.compaction.as_deref())
        .filter(|value| !value.trim().is_empty())
        .filter(|_| !matches!(pending_aux, Some(aux) if aux.kind == AssistantAuxKind::Compressing));
    let embedded_thinking_text = if msg.role == MessageRole::Agent && app.show_aux_details {
        embedded_thinking.as_deref().filter(|value| !value.trim().is_empty())
    } else {
        None
    };
    let stored_thinking_text = if pending_aux.is_none() {
        stored_aux
            .and_then(|aux| aux.thinking.as_deref())
            .filter(|value| !value.trim().is_empty())
            .or(embedded_thinking_text)
    } else {
        None
    };
    let pending_aux_detail_text = if app.show_aux_details {
        pending_aux.and_then(|aux| aux.detail_text.as_deref())
    } else {
        None
    };
    let render_stored_thinking_after_body =
        should_render_aux_after_message_body(stored_thinking_text, has_message_body);
    let render_pending_aux_after_body = pending_aux
        .is_some_and(|_| should_render_aux_after_message_body(pending_aux_detail_text, has_message_body));

    let mut has_rendered_visible_line = false;
    let mut push_message_line = |content_spans: Vec<Span<'static>>| {
        let mut spans = if has_rendered_visible_line {
            vec![Span::raw(message_gutter_padding())]
        } else {
            has_rendered_visible_line = true;
            vec![Span::styled(message_prefix_text(), prefix_style)]
        };
        spans.extend(content_spans);
        out.push(Line::from(spans));
    };

    if let Some(compaction_text) = stored_compaction_text {
        push_message_line(vec![Span::styled(
            assistant_aux_title(AssistantAuxKind::Compressing),
            assistant_aux_title_style(AssistantAuxKind::Compressing),
        )]);
        render_aux_text_lines(
            &mut push_message_line,
            AssistantAuxKind::Compressing,
            compaction_text,
        );
    }

    if let Some(thinking_text) = stored_thinking_text {
        if !render_stored_thinking_after_body {
            if stored_compaction_text.is_some() {
                push_message_line(vec![Span::styled(
                    assistant_aux_title(AssistantAuxKind::Thinking),
                    assistant_aux_title_style(AssistantAuxKind::Thinking),
                )]);
            }
            render_aux_text_lines(&mut push_message_line, AssistantAuxKind::Thinking, thinking_text);
        }
    }

    if let Some(pending_aux) = pending_aux {
        if !render_pending_aux_after_body {
            render_pending_aux_lines(&mut push_message_line, pending_aux, pending_aux_detail_text);
        }
    }

    let mut iter = content_lines.into_iter();
    if let Some(first) = iter.next() {
        push_message_line(first);
    } else if msg.role == MessageRole::User {
        push_message_line(Vec::new());
    }

    for line in iter {
        push_message_line(line);
    }

    if let Some(thinking_text) = stored_thinking_text {
        if render_stored_thinking_after_body {
            render_aux_text_lines(&mut push_message_line, AssistantAuxKind::Thinking, thinking_text);
        }
    }

    if let Some(pending_aux) = pending_aux {
        if render_pending_aux_after_body {
            render_pending_aux_lines(&mut push_message_line, pending_aux, pending_aux_detail_text);
        }
    }

    out
}

fn split_embedded_thinking_content(text: &str) -> (String, Option<String>) {
    let trimmed = text.trim_start();
    let Some(after_open) = trimmed.strip_prefix("<think>") else {
        return (text.to_string(), None);
    };

    let (thinking_raw, body_raw) = if let Some(close_idx) = after_open.find("</think>") {
        let body_start = close_idx + "</think>".len();
        (&after_open[..close_idx], &after_open[body_start..])
    } else {
        (after_open, "")
    };

    let thinking = thinking_raw.trim();
    let body = body_raw.trim_start_matches(['\r', '\n']);

    (
        body.to_string(),
        if thinking.is_empty() {
            None
        } else {
            Some(thinking.to_string())
        },
    )
}

fn tool_phase_label(phase: ToolUiPhase) -> (String, Color) {
    match phase {
        ToolUiPhase::PendingApproval => (t!("ui.tool.phase.pending_approval").into_owned(), Color::Yellow),
        ToolUiPhase::Running => (t!("ui.tool.phase.running").into_owned(), Color::Yellow),
        ToolUiPhase::Succeeded => (t!("ui.tool.phase.succeeded").into_owned(), Color::Green),
        ToolUiPhase::Failed => (t!("ui.tool.phase.failed").into_owned(), Color::Red),
    }
}

fn render_tool_card_lines(
    prefix_style: Style,
    tool: &ToolUiBlock,
    show_aux_details: bool,
) -> Vec<Line<'static>> {
    let (phase_label, phase_color) = tool_phase_label(tool.phase);
    let rail = Style::default().fg(Color::Rgb(96, 110, 130));
    let rail_sym = "▌ ";
    let indent = message_gutter_padding();
    let expand_details = show_aux_details
        || matches!(
            tool.phase,
            ToolUiPhase::PendingApproval | ToolUiPhase::Failed
        );

    let mut out = Vec::new();

    let mut title_spans = vec![
        Span::styled(message_prefix_text(), prefix_style),
        Span::styled(
            "[tool] ",
            Style::default()
                .fg(Color::Magenta)
                .add_modifier(Modifier::BOLD),
        ),
        Span::styled(
            tool.tool_name.clone(),
            Style::default()
                .fg(Color::Rgb(170, 170, 170))
                .add_modifier(Modifier::BOLD),
        ),
        Span::raw(" · "),
        Span::styled(
            phase_label.to_string(),
            Style::default()
                .fg(phase_color)
                .add_modifier(Modifier::BOLD),
        ),
    ];
    if let Some(ref id) = tool
        .tool_call_id
        .as_ref()
        .filter(|id| !manual_shell::is_local_tool_call_id(id))
    {
        let short = if id.chars().count() > 14 {
            let mut t = id.chars().take(14).collect::<String>();
            t.push('…');
            t
        } else {
            id.to_string()
        };
        title_spans.push(Span::raw(" "));
        title_spans.push(Span::styled(
            format!("({})", short),
            Style::default().fg(Color::DarkGray),
        ));
    }
    out.push(Line::from(title_spans));

    out.push(Line::from(vec![
        Span::raw(indent),
        Span::styled(rail_sym, rail),
        Span::styled(
            tool.headline.clone(),
            Style::default()
                .fg(Color::Rgb(170, 170, 170))
                .add_modifier(Modifier::BOLD),
        ),
    ]));

    for line in &tool.detail_lines {
        if line.is_empty() {
            continue;
        }
        out.push(Line::from(vec![
            Span::raw(indent),
            Span::styled(rail_sym, rail),
            Span::styled(line.clone(), Style::default().fg(Color::Rgb(190, 195, 205))),
        ]));
    }

    if expand_details {
        if let Some(ref args) = tool.args_excerpt {
            if !args.trim().is_empty() {
                out.push(Line::from(vec![
                    Span::raw(indent),
                    Span::styled(rail_sym, rail),
                    Span::styled(t!("ui.tool.args_json").into_owned(), Style::default().fg(Color::DarkGray)),
                ]));
                for seg in args.lines() {
                    out.push(Line::from(vec![
                        Span::raw(indent),
                        Span::raw("  "),
                        Span::styled(rail_sym, rail),
                        Span::styled(seg.to_string(), Style::default().fg(Color::Cyan)),
                    ]));
                }
            }
        }
    }

    if expand_details {
        if let Some(ref output) = tool.output_excerpt {
            if !output.trim().is_empty() {
                out.push(Line::from(vec![
                    Span::raw(indent),
                    Span::styled(rail_sym, rail),
                    Span::styled(t!("ui.tool.output").into_owned(), Style::default().fg(Color::DarkGray)),
                ]));
                let lines: Vec<&str> = output.lines().take(48).collect();
                for seg in lines.iter() {
                    out.push(Line::from(vec![
                        Span::raw(indent),
                        Span::raw("  "),
                        Span::styled(rail_sym, rail),
                        Span::styled((*seg).to_string(), conversation_body_text_style()),
                    ]));
                }
                let total_ln = output.lines().count();
                if total_ln > 48 {
                    out.push(Line::from(vec![
                        Span::raw(indent),
                        Span::raw("  "),
                        Span::styled(
                            t!("ui.tool.more_lines_hidden", count = total_ln.saturating_sub(48))
                                .into_owned(),
                            Style::default()
                                .fg(Color::DarkGray)
                                .add_modifier(Modifier::ITALIC),
                        ),
                    ]));
                }
            }
        }
    }

    out
}

fn plain_text_lines(text: &str) -> Vec<Vec<Span<'static>>> {
    let mut lines = Vec::new();
    for part in text.split('\n') {
        lines.push(vec![Span::styled(
            part.to_string(),
            conversation_body_text_style(),
        )]);
    }
    if lines.is_empty() {
        vec![vec![]]
    } else {
        lines
    }
}

fn markdown_lines(text: &str) -> Vec<Vec<Span<'static>>> {
    MARKDOWN_CACHE.with(|cache| {
        let mut cache = cache.borrow_mut();
        if let Some(hit) = cache.get(text) {
            return hit.clone();
        }

        let arena = Arena::new();
        let root = parse_document(&arena, text, &markdown_options());

        let mut builder = MdBuilder::new();
        render_markdown_node(root, &mut builder, conversation_body_text_style(), 0);
        let parsed = builder.into_lines();

        // Keep cache bounded so long sessions won't grow unbounded memory.
        if cache.len() > 512 {
            cache.clear();
        }
        cache.insert(text.to_string(), parsed.clone());
        parsed
    })
}

fn markdown_options() -> Options<'static> {
    let mut opts = Options::default();
    opts.extension.strikethrough = true;
    opts.extension.table = true;
    opts.extension.tasklist = true;
    opts.extension.autolink = true;
    opts.extension.superscript = true;
    opts.render.hardbreaks = true;
    opts
}

fn render_markdown_node<'a>(
    node: &'a AstNode<'a>,
    builder: &mut MdBuilder,
    style: Style,
    list_depth: usize,
) {
    match &node.data.borrow().value {
        NodeValue::Document => {
            for child in node.children() {
                render_markdown_node(child, builder, style, list_depth);
            }
        }
        NodeValue::Paragraph => {
            for child in node.children() {
                render_markdown_node(child, builder, style, list_depth);
            }
            builder.new_line();
        }
        NodeValue::Heading(heading) => {
            let h_style = style
                .fg(Color::Yellow)
                .add_modifier(Modifier::BOLD)
                .add_modifier(if heading.level <= 2 {
                    Modifier::UNDERLINED
                } else {
                    Modifier::empty()
                });
            for child in node.children() {
                render_markdown_node(child, builder, h_style, list_depth);
            }
            builder.new_line();
        }
        NodeValue::Text(text) => {
            builder.push_span(Span::styled(text.to_string(), style));
        }
        NodeValue::Code(code) => {
            builder.push_span(Span::styled(
                format!("`{}`", code.literal),
                style.fg(Color::Magenta),
            ));
        }
        NodeValue::CodeBlock(code) => {
            builder.new_line();
            let code_style = Style::default().fg(Color::Cyan);
            for line in code.literal.lines() {
                builder.push_span(Span::styled(format!("  {}", line), code_style));
                builder.new_line();
            }
            builder.new_line();
        }
        NodeValue::Strong => {
            let strong_style = style.add_modifier(Modifier::BOLD);
            for child in node.children() {
                render_markdown_node(child, builder, strong_style, list_depth);
            }
        }
        NodeValue::Emph => {
            let emph_style = style.add_modifier(Modifier::ITALIC);
            for child in node.children() {
                render_markdown_node(child, builder, emph_style, list_depth);
            }
        }
        NodeValue::Strikethrough => {
            let strike_style = style.add_modifier(Modifier::CROSSED_OUT);
            for child in node.children() {
                render_markdown_node(child, builder, strike_style, list_depth);
            }
        }
        NodeValue::SoftBreak | NodeValue::LineBreak => {
            builder.new_line();
        }
        NodeValue::ThematicBreak => {
            builder.push_span(Span::styled(
                "--------------------------------".to_string(),
                style.fg(Color::DarkGray),
            ));
            builder.new_line();
        }
        NodeValue::List(list) => {
            let mut idx = 0usize;
            for item in node.children() {
                idx += 1;
                let indent = "  ".repeat(list_depth);
                let marker = match list.list_type {
                    ListType::Bullet => "- ".to_string(),
                    ListType::Ordered => format!("{}. ", idx),
                };
                builder.push_span(Span::raw(indent));
                builder.push_span(Span::styled(
                    marker,
                    Style::default()
                        .fg(Color::Yellow)
                        .add_modifier(Modifier::BOLD),
                ));
                render_markdown_node(item, builder, style, list_depth + 1);
                builder.new_line();
            }
        }
        NodeValue::Item(_) => {
            for child in node.children() {
                render_markdown_node(child, builder, style, list_depth);
            }
        }
        NodeValue::Link(_) => {
            let link_style = style
                .fg(Color::Blue)
                .add_modifier(Modifier::UNDERLINED | Modifier::BOLD);
            for child in node.children() {
                render_markdown_node(child, builder, link_style, list_depth);
            }
        }
        _ => {
            for child in node.children() {
                render_markdown_node(child, builder, style, list_depth);
            }
        }
    }
}

struct MdBuilder {
    lines: Vec<Vec<Span<'static>>>,
}

impl MdBuilder {
    fn new() -> Self {
        Self {
            lines: vec![Vec::new()],
        }
    }

    fn push_span(&mut self, span: Span<'static>) {
        if let Some(last) = self.lines.last_mut() {
            last.push(span);
        }
    }

    fn new_line(&mut self) {
        if self.lines.last().map(|l| l.is_empty()).unwrap_or(false) {
            return;
        }
        self.lines.push(Vec::new());
    }

    fn into_lines(mut self) -> Vec<Vec<Span<'static>>> {
        while self.lines.len() > 1 && self.lines.last().is_some_and(|l| l.is_empty()) {
            self.lines.pop();
        }
        if self.lines.is_empty() {
            vec![vec![]]
        } else {
            self.lines
        }
    }
}

fn visible_messages(app: &TuiViewModel) -> (&[ChatMessage], usize, usize) {
    (&app.messages, app.history_truncated_before, app.history_truncated_before)
}

fn build_suggestion_lines(
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
        return vec![Line::from(Span::styled(
            message,
            default_style,
        ))];
    }

    if matches!(app.input_suggestion_kind, Some(InputSuggestionKind::FileReference)) {
        return build_file_reference_suggestion_lines(app, max_items, default_style, selected_style);
    }

    let selected = app.selected_suggestion;
    let total = app.slash_suggestions.len();
    let window = max_items.max(1);
    let start = if selected + 1 > window {
        selected + 1 - window
    } else {
        0
    };
    let end = (start + window).min(total);
    let visible_commands = &app.slash_suggestions[start..end];
    let command_column_width = visible_commands
        .iter()
        .map(|suggestion| UnicodeWidthStr::width(format!("  {}", suggestion.label).as_str()))
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
        let command_style = if is_selected {
            selected_style
        } else {
            default_style
        };
        let command_text = format!("  {}", suggestion.label);
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
            Span::styled(" ".repeat(spacing), default_style),
            Span::styled(summary_text, default_style),
        ]));
    }

    if total == 1 {
        let details = suggestion_usage_lines(&app.slash_suggestions[selected]);
        if !details.is_empty() {
            lines.push(Line::from(Span::styled("", default_style)));
            for detail in details {
                lines.push(Line::from(Span::styled(detail, default_style)));
            }
        }
    }

    lines
}

fn build_file_reference_suggestion_lines(
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
        let style = if is_selected { selected_style } else { default_style };
        let prefix = if is_selected { "> " } else { "  " };
        lines.push(Line::from(Span::styled(
            format!("{}{}", prefix, path.label),
            style,
        )));
    }

    lines
}

fn input_suggestion_title(app: &TuiViewModel) -> String {
    match app.input_suggestion_kind {
        Some(InputSuggestionKind::Slash) => t!("ui.suggestion.title.slash").into_owned(),
        Some(InputSuggestionKind::FileReference) => {
            t!("ui.suggestion.title.file_reference").into_owned()
        }
        None => t!("ui.suggestion.title.generic").into_owned(),
    }
}

fn suggestion_summary(suggestion: &InputSuggestion) -> String {
    if !suggestion.summary.is_empty() {
        return suggestion.summary.clone();
    }

    match suggestion.label.as_str() {
        "/help" => t!("ui.suggestion.summary.help").into_owned(),
        "/clear" => t!("ui.suggestion.summary.clear").into_owned(),
        "/quit" | "/exit" => t!("ui.suggestion.summary.quit").into_owned(),
        "/model" => t!("ui.suggestion.summary.model").into_owned(),
        "/compact" => t!("ui.suggestion.summary.compact").into_owned(),
        "/sessions" => t!("ui.suggestion.summary.sessions").into_owned(),
        "/image" => t!("ui.suggestion.summary.image").into_owned(),
        "/mcp" => t!("ui.suggestion.summary.mcp").into_owned(),
        "/create-rule" => t!("ui.suggestion.summary.create_rule").into_owned(),
        "/rules" => t!("ui.suggestion.summary.rules").into_owned(),
        "/create-skill" => t!("ui.suggestion.summary.create_skill").into_owned(),
        "/skills" => t!("ui.suggestion.summary.skills").into_owned(),
        "/log" => t!("ui.suggestion.summary.log").into_owned(),
        "/language" => t!("ui.suggestion.summary.language").into_owned(),
        _ => String::new(),
    }
}

fn suggestion_usage_lines(suggestion: &InputSuggestion) -> Vec<String> {
    if !suggestion.details.is_empty() {
        let mut lines = vec![t!("ui.suggestion.usage.heading").into_owned()];
        lines.extend(suggestion.details.iter().map(|detail| format!("    {}", detail)));
        return lines;
    }

    match suggestion.label.as_str() {
        "/model" => vec![
            t!("ui.suggestion.usage.heading").into_owned(),
            "    /model list".to_string(),
            "    /model use <name>".to_string(),
            "    /model add <name> <api_base> <api_key>".to_string(),
            "    /model remove <name>".to_string(),
        ],
        "/sessions" => vec![
            t!("ui.suggestion.usage.heading").into_owned(),
            "    /sessions".to_string(),
            "    /sessions save [path]".to_string(),
            "    /sessions load <file>".to_string(),
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
            format!("    {}", t!("ui.suggestion.usage.create_skill.repo")),
            format!("    {}", t!("ui.suggestion.usage.create_skill.user")),
        ],
        "/skills" => vec![
            t!("ui.suggestion.usage.heading").into_owned(),
            "    /skills".to_string(),
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

fn build_model_picker_lines(app: &TuiViewModel, max_items: usize) -> Vec<Line<'static>> {
    if app.config.models.is_empty() {
        return vec![Line::from(t!("ui.picker.models.empty").into_owned())];
    }

    let selected = app
        .model_picker_index
        .min(app.config.models.len().saturating_sub(1));
    let total = app.config.models.len();
    let window = max_items.max(1);
    let start = if selected + 1 > window {
        selected + 1 - window
    } else {
        0
    };
    let end = (start + window).min(total);

    let mut lines = Vec::new();
    for idx in start..end {
        let model = &app.config.models[idx];
        let is_selected = idx == selected;
        let is_active = model.name == app.config.active_model;

        let marker = if is_selected { "> " } else { "  " };
        let active_suffix = if is_active {
            t!("ui.picker.models.current_suffix").into_owned()
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
                marker, model.name, model.api_base, active_suffix
            ),
            style,
        )));
    }

    lines
}

fn build_chat_picker_lines(app: &TuiViewModel, max_items: usize) -> Vec<Line<'static>> {
    if app.chat_picker_files.is_empty() {
        return vec![Line::from(t!("ui.picker.sessions.empty").into_owned())];
    }

    let selected = app
        .chat_picker_index
        .min(app.chat_picker_files.len().saturating_sub(1));
    let total = app.chat_picker_files.len();
    let window = max_items.max(1);
    let start = if selected + 1 > window {
        selected + 1 - window
    } else {
        0
    };
    let end = (start + window).min(total);

    let mut lines = Vec::new();
    for idx in start..end {
        let name = &app.chat_picker_files[idx];
        let is_selected = idx == selected;
        let marker = if is_selected { "> " } else { "  " };
        let style = if is_selected {
            Style::default()
                .fg(Color::Cyan)
                .add_modifier(Modifier::BOLD | Modifier::REVERSED)
        } else {
            Style::default().fg(Color::White)
        };
        lines.push(Line::from(Span::styled(
            format!("{}{}", marker, name),
            style,
        )));
    }

    lines
}

fn build_language_picker_lines(app: &TuiViewModel, max_items: usize) -> Vec<Line<'static>> {
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
        let marker = if is_selected { "> " } else { "  " };
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
                marker,
                crate::locale::language_display_name(locale_code),
                locale_code,
                active_suffix
            ),
            style,
        )));
    }

    lines
}

fn build_image_picker_lines(app: &TuiViewModel, max_items: usize) -> Vec<Line<'static>> {
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
        let marker = if is_selected { "> " } else { "  " };
        let style = if is_selected {
            Style::default()
                .fg(Color::Cyan)
                .add_modifier(Modifier::BOLD | Modifier::REVERSED)
        } else {
            Style::default().fg(Color::White)
        };
        lines.push(Line::from(Span::styled(
            format!("{}{}", marker, name),
            style,
        )));
    }

    lines
}

/// Matches `draw_bottom_form` → `draw_bottom_form_text_field`: outer panel width to text inner width.
fn bottom_form_content_width(panel_width: u16) -> usize {
    panel_width.saturating_sub(2).saturating_sub(4).max(1) as usize
}

fn bottom_form_text_inner_width(panel_width: u16) -> usize {
    bottom_form_content_width(panel_width)
        .saturating_sub(2)
        .max(1)
}

fn bottom_form_text_visual_line_count(
    value: &str,
    placeholder: &str,
    text_inner_w: usize,
) -> usize {
    build_bottom_form_text_lines(value, placeholder, text_inner_w, false)
        .len()
        .max(1)
}

fn bottom_form_text_field_body_outer_height(
    value: &str,
    placeholder: &str,
    text_inner_w: usize,
) -> u16 {
    bottom_form_text_visual_line_count(value, placeholder, text_inner_w)
        .max(1)
        .saturating_add(2) as u16
}

fn bottom_form_text_field_outer_height(
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
        build_bottom_form_footer_lines(label, field_width).len().max(1) as u16
    };
    let help_height = if help.trim().is_empty() {
        0
    } else {
        build_bottom_form_footer_lines(help, field_width).len().max(1) as u16
    };

    label_height
        .saturating_add(bottom_form_text_field_body_outer_height(
            value,
            placeholder,
            text_inner_w,
        ))
        .saturating_add(help_height)
}

fn bottom_form_field_outer_height(
    field: &BottomFormFieldView,
    field_width: usize,
    text_inner_w: usize,
) -> u16 {
    match &field.editor {
        BottomFormFieldEditorView::Section { text } => {
            build_bottom_form_footer_lines(text, field_width).len().max(1) as u16
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

fn bottom_form_block_height(form: &BottomFormView, panel_width: u16) -> u16 {
    if matches!(form.kind, BottomFormKind::Rules | BottomFormKind::Skills) {
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
        .map(|field| u32::from(bottom_form_field_outer_height(field, content_w, text_inner_w)))
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

fn bottom_form_display_height(
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

fn generic_bottom_form_selection_visible(
    form: &BottomFormView,
    scroll_offset: usize,
    field_width: usize,
    text_inner_w: usize,
    visible_height: usize,
) -> bool {
    let mut used_height = 0usize;
    for index in scroll_offset..form.fields.len() {
        let field_height = bottom_form_field_outer_height(&form.fields[index], field_width, text_inner_w)
            as usize;
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

fn generic_bottom_form_effective_scroll(
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
fn generic_bottom_form_visible_field_areas(
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

fn rules_bottom_form_block_height(form: &BottomFormView, panel_width: u16) -> u16 {
    let layout = build_rules_bottom_form_layout(form, bottom_form_content_width(panel_width));
    let content_height = layout.content_lines.len().max(1) as u16;
    let footer_height = layout.footer_lines.len().max(1) as u16;
    let footer_gap = if layout.content_lines.is_empty() { 0 } else { 1 };

    content_height
        .saturating_add(footer_height)
        .saturating_add(footer_gap)
        .saturating_add(4)
}

fn ask_questions_block_height(form: &BottomFormView, panel_width: u16) -> u16 {
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
    let row_gaps = ask_questions_form::question_row_count(question)
        .saturating_sub(1) as u16;
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

fn ask_questions_title_text(form: &BottomFormView) -> String {
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

fn ask_questions_row_block_height(
    question: &AskQuestionsQuestionView,
    row_index: usize,
    field_width: usize,
) -> u16 {
    let inner_width = field_width.saturating_sub(2).max(1);
    if matches!(question.kind, crate::ask_questions::AskQuestionsQuestionKind::Text) {
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

fn ask_questions_selection_visible(
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

fn ask_questions_effective_scroll(
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

fn ask_questions_visible_row_areas(
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

fn draw_ask_questions_form(
    frame: &mut ratatui::Frame<'_>,
    area: Rect,
    form: &BottomFormView,
) -> BottomFormRenderResult {
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
            Style::default().fg(Color::White).add_modifier(Modifier::BOLD),
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
    let rows_start_y = content_area.y.saturating_add(1).saturating_add(title_height);
    let rows_start_y = if ask_questions_form::question_row_count(question) > 0 {
        rows_start_y.saturating_add(1)
    } else {
        rows_start_y
    };
    let rows_limit_y = validation_y;
    let visible_height = rows_limit_y.saturating_sub(rows_start_y) as usize;
    let effective_scroll = ask_questions_effective_scroll(
        form,
        question,
        content_area.width as usize,
        visible_height,
    );

    let mut cursor = None;
    if visible_height > 0 {
        let rows_area = Rect {
            x: content_area.x,
            y: rows_start_y,
            width: content_area.width,
            height: rows_limit_y.saturating_sub(rows_start_y),
        };
        for (row_index, row_area) in ask_questions_visible_row_areas(
            question,
            rows_area,
            rows_limit_y,
            effective_scroll,
        ) {
            let row_selected = !ask_questions_form::submit_selected(form)
                && row_index == question.selected_row;
            let row_cursor = if let Some(option) = question.options.get(row_index) {
                draw_ask_questions_option_row(
                    frame,
                    row_area,
                    question,
                    option,
                    row_selected,
                )
            } else if matches!(question.kind, crate::ask_questions::AskQuestionsQuestionKind::Text) {
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
        Paragraph::new(build_ask_questions_tab_line(form, content_area.width as usize)),
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

fn draw_ask_questions_option_row(
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
    if let Some(summary) = option.summary.as_ref().filter(|value| !value.trim().is_empty()) {
        lines.extend(build_bottom_form_footer_lines(summary, inner.width as usize));
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

fn build_ask_questions_tab_line(form: &BottomFormView, max_width: usize) -> Line<'static> {
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
fn bottom_form_wrap_logical_line(line: &str, max_width: usize) -> Vec<String> {
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

fn build_bottom_form_text_lines(
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

fn build_bottom_form_footer_lines(text: &str, max_width: usize) -> Vec<Line<'static>> {
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

fn bottom_form_footer_height(text: &str, max_width: usize) -> u16 {
    build_bottom_form_footer_lines(text, max_width).len().max(1) as u16
}

fn draw_bottom_form(
    frame: &mut ratatui::Frame<'_>,
    area: Rect,
    form: &BottomFormView,
) -> BottomFormRenderResult {
    if matches!(form.kind, BottomFormKind::Rules | BottomFormKind::Skills) {
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
                checked,
                disabled,
                ..
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

fn draw_rules_bottom_form(
    frame: &mut ratatui::Frame<'_>,
    area: Rect,
    form: &BottomFormView,
) -> BottomFormRenderResult {
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
            scroll_offset: Some(0),
        };
    }

    let layout = build_rules_bottom_form_layout(form, content_area.width as usize);
    let footer_height = layout.footer_lines.len().max(1) as u16;
    let footer_gap = if layout.content_lines.is_empty() { 0 } else { 1 };
    let footer_y = content_area
        .y
        .saturating_add(content_area.height.saturating_sub(footer_height));
    let fields_limit_y = footer_y.saturating_sub(footer_gap);
    let visible_height = fields_limit_y.saturating_sub(content_area.y) as usize;

    if visible_height > 0 {
        let max_scroll = layout.content_lines.len().saturating_sub(visible_height);
        let mut effective_scroll = form.scroll_offset.min(max_scroll);

        if let Some(Some((selected_start, selected_end))) = layout.field_ranges.get(form.selected_field)
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

fn build_rules_bottom_form_layout(form: &BottomFormView, max_width: usize) -> RulesBottomFormLayout {
    let mut content_lines = Vec::new();
    let mut field_ranges = vec![None; form.fields.len()];
    let checkbox_column_width = form
        .fields
        .iter()
        .filter_map(|field| match &field.editor {
            BottomFormFieldEditorView::Checkbox { checked, .. } => {
                Some(UnicodeWidthStr::width(rules_checkbox_label_text(&field.label, *checked).as_str()))
            }
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
            content_lines.push(Line::from(Span::styled(String::new(), subtle_aux_text_style())));
        }
    }

    RulesBottomFormLayout {
        content_lines,
        field_ranges,
        footer_lines: build_bottom_form_footer_lines(&form.footer_hint, max_width),
    }
}

fn build_rules_checkbox_header_line(
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

fn rules_checkbox_label_text(label: &str, checked: bool) -> String {
    let checkbox_text = if checked { "[x]" } else { "[ ]" };
    format!("{} {}", checkbox_text, label)
}

fn truncate_from_left_to_width(text: &str, max_width: usize) -> String {
    if max_width == 0 {
        return String::new();
    }
    if UnicodeWidthStr::width(text) <= max_width {
        return text.to_string();
    }
    if max_width == 1 {
        return "…".to_string();
    }

    let mut collected = Vec::new();
    let mut used_width = 1;
    for ch in text.chars().rev() {
        let ch_width = UnicodeWidthChar::width(ch).unwrap_or(0);
        if ch_width == 0 {
            continue;
        }
        if used_width + ch_width > max_width {
            break;
        }
        collected.push(ch);
        used_width += ch_width;
    }
    collected.reverse();

    format!("…{}", collected.into_iter().collect::<String>())
}

fn draw_bottom_form_section_field(
    frame: &mut ratatui::Frame<'_>,
    area: Rect,
    text: &str,
) {
    let lines = build_bottom_form_footer_lines(text, area.width as usize);
    let max_lines = usize::from(area.height);
    let lines: Vec<Line<'static>> = lines.into_iter().take(max_lines).collect();
    frame.render_widget(Paragraph::new(lines), area);
}

fn draw_bottom_form_text_field(
    frame: &mut ratatui::Frame<'_>,
    area: Rect,
    label: &str,
    help: &str,
    value: &str,
    placeholder: &str,
    cursor_chars: usize,
    is_selected: bool,
) -> Option<(u16, u16)> {
    // 自 `next_y` 到 `area` 下边的剩余行，须与底部 footer（快捷键提示）错开，不可画出区域外。
    let bottom_exclusive = area.y.saturating_add(area.height);
    let mut next_y = area.y;

    if !label.trim().is_empty() {
        let budget = bottom_exclusive.saturating_sub(next_y);
        if budget > 0 {
            let label_style = if is_selected {
                Style::default().fg(Color::White).add_modifier(Modifier::BOLD)
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
        let block = Block::default()
            .borders(Borders::ALL)
            .border_style(bottom_form_field_style(is_selected));
        let inner = block.inner(body_area);
        frame.render_widget(block, body_area);

        let mut lines = build_bottom_form_text_lines(value, placeholder, inner.width as usize, is_selected);
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

    if !is_selected {
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

fn draw_bottom_form_choice_field(
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

fn draw_bottom_form_checkbox_field(
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

fn bottom_form_field_style(is_selected: bool) -> Style {
    if is_selected {
        Style::default().fg(Color::White)
    } else {
        subtle_aux_text_style()
    }
}

fn inset_rect(area: Rect, horizontal: u16, vertical: u16) -> Rect {
    let double_h = horizontal.saturating_mul(2);
    let double_v = vertical.saturating_mul(2);
    Rect {
        x: area.x.saturating_add(horizontal.min(area.width)),
        y: area.y.saturating_add(vertical.min(area.height)),
        width: area.width.saturating_sub(double_h),
        height: area.height.saturating_sub(double_v),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        model_registry::AppConfig,
        view::{
            AssistantAuxData, BottomFormFieldEditorView, BottomFormFieldView, BottomFormView,
            MainInputMode,
        },
    };

    fn render_text_lines(lines: Vec<Line<'static>>) -> Vec<String> {
        lines
            .into_iter()
            .map(|line| {
                line.spans
                    .into_iter()
                    .map(|span| span.content.into_owned().replace('\u{00a0}', " "))
                    .collect::<String>()
            })
            .collect()
    }

    fn build_view_model(message: ChatMessage) -> TuiViewModel {
        TuiViewModel {
            input: String::new(),
            input_cursor: 0,
            input_mode: MainInputMode::Agent,
            shell_mode_active: false,
            pending_image_paths: vec![],
            pending_mcp_resources: vec![],
            history_truncated_before: 0,
            messages: vec![message],
            assistant_aux_by_message: HashMap::new(),
            config: AppConfig::default(),
            show_aux_details: true,
            input_suggestion_kind: None,
            input_suggestion_loading: false,
            slash_suggestions: vec![],
            selected_suggestion: 0,
            model_picker_active: false,
            model_picker_index: 0,
            model_add_pick_active: false,
            model_add_pick_index: 0,
            model_add_pick_models: vec![],
            model_add_pick_api_base: String::new(),
            language_picker_active: false,
            language_picker_index: 0,
            chat_picker_active: false,
            chat_picker_index: 0,
            chat_picker_files: vec![],
            image_picker_active: false,
            image_picker_index: 0,
            image_picker_files: vec![],
            bottom_form: None,
            history_offset_from_bottom: 0,
            pending_response_active: false,
            pending_assistant_msg_index: None,
            pending_aux: None,
            conversation_sel_anchor: None,
            conversation_sel_head: None,
        }
    }

    fn build_bottom_form_view(value: &str, footer_hint: &str) -> BottomFormView {
        BottomFormView {
            kind: crate::view::BottomFormKind::McpAdd,
            title: "Add MCP Server".to_string(),
            fields: vec![
                BottomFormFieldView {
                    label: "名称".to_string(),
                    help: String::new(),
                    editor: BottomFormFieldEditorView::Text {
                        value: "github".to_string(),
                        placeholder: "名称，例如 github".to_string(),
                        cursor: 0,
                        mask: false,
                    },
                },
                BottomFormFieldView {
                    label: "类型".to_string(),
                    help: String::new(),
                    editor: BottomFormFieldEditorView::Choice {
                        options: vec!["STDIO".to_string(), "HTTP".to_string()],
                        selected: 0,
                    },
                },
                BottomFormFieldView {
                    label: "命令".to_string(),
                    help: String::new(),
                    editor: BottomFormFieldEditorView::Text {
                        value: value.to_string(),
                        placeholder: "命令，例如 npx -y @modelcontextprotocol/server-github"
                            .to_string(),
                        cursor: 0,
                        mask: false,
                    },
                },
                BottomFormFieldView {
                    label: "环境变量".to_string(),
                    help: String::new(),
                    editor: BottomFormFieldEditorView::Text {
                        value: "GITHUB_TOKEN=demo".to_string(),
                        placeholder: "环境变量，可选，例如 GITHUB_TOKEN=demo".to_string(),
                        cursor: 0,
                        mask: false,
                    },
                },
            ],
            selected_field: 2,
            scroll_offset: 0,
            footer_hint: footer_hint.to_string(),
        }
    }

    #[test]
    fn bottom_form_block_height_grows_for_multiline_text() {
        let single = build_bottom_form_view(
            "npx -y @modelcontextprotocol/server-github",
            "Enter 保存 Esc 取消",
        );
        let multi = build_bottom_form_view(
            "npx -y @modelcontextprotocol/server-github\n--stdio\n--verbose",
            "Enter 保存 Esc 取消",
        );

        assert!(bottom_form_block_height(&multi, 80) > bottom_form_block_height(&single, 80));
    }

    #[test]
    fn bottom_form_block_height_grows_for_wrapped_footer_hint() {
        let form = build_bottom_form_view(
            "npx -y @modelcontextprotocol/server-github",
            "↑/↓ 切换字段  ←/→ 移动光标或切换类型  Enter 保存  Shift+Enter 换行  Esc 取消",
        );

        assert!(bottom_form_block_height(&form, 28) > bottom_form_block_height(&form, 96));
    }

    #[test]
    fn input_cursor_matches_wrapped_render_for_exact_width_line_before_newline() {
        let mut app = build_view_model(ChatMessage::new(MessageRole::Agent, "welcome"));
        app.input = "你好你好\nA".to_string();
        app.input_cursor = app.input.chars().count();

        let lines = render_text_lines(build_input_lines(&app, 8, false));
        let (row, col) = input_cursor_position(&app, 8);

        assert_eq!(lines, vec!["你好你好", "A"]);
        assert_eq!((row, col), (1, 1));
    }

    #[test]
    fn input_cursor_moves_to_trailing_empty_row_when_last_line_fills_width() {
        let mut app = build_view_model(ChatMessage::new(MessageRole::Agent, "welcome"));
        app.input = "你好你好".to_string();
        app.input_cursor = app.input.chars().count();

        let lines = render_text_lines(build_input_lines(&app, 8, false));
        let (row, col) = input_cursor_position(&app, 8);

        assert_eq!(lines, vec!["你好你好", ""]);
        assert_eq!((row, col), (1, 0));
    }

    #[test]
    fn plan_mode_input_uses_yellow_border_and_text_and_plan_title() {
        let title = input_mode_title(MainInputMode::Plan);
        let border = input_block_border_style(false, MainInputMode::Plan, false);
        let text = input_text_style(false, MainInputMode::Plan, false);

        assert_eq!(title, "Plan");
        assert_eq!(border.fg, Some(Color::Yellow));
        assert_eq!(text.fg, Some(Color::Yellow));
    }

    #[test]
    fn agent_mode_input_softens_only_border_text_stays_white() {
        let border = input_block_border_style(false, MainInputMode::Agent, false);
        let text = input_text_style(false, MainInputMode::Agent, false);

        assert_eq!(border.fg, conversation_body_text_style().fg);
        assert_eq!(text.fg, Some(Color::White));
    }

    #[test]
    fn footer_shows_mode_without_tab_toggle_hint() {
        let agent_footer = render_text_lines(vec![build_footer_line(
            &build_view_model(ChatMessage::new(MessageRole::Agent, "welcome")),
            80,
        )]);

        let mut plan_app = build_view_model(ChatMessage::new(MessageRole::Agent, "welcome"));
        plan_app.input_mode = MainInputMode::Plan;
        let plan_footer = render_text_lines(vec![build_footer_line(&plan_app, 80)]);

        assert!(!agent_footer[0].contains("Tab"));
        assert!(!plan_footer[0].contains("Tab"));
        assert!(agent_footer[0].contains(" |  Agent"));
        assert!(plan_footer[0].contains(" |  Plan"));
    }

    #[test]
    fn stored_tool_progress_renders_after_agent_message_body() {
        let mut app = build_view_model(ChatMessage::new(
            MessageRole::Agent,
            "我来帮您执行这个命令。",
        ));
        app.assistant_aux_by_message.insert(
            0,
            AssistantAuxData {
                thinking: Some("准备调用工具: run_shell_command".to_string()),
                compaction: None,
            },
        );

        let lines = render_text_lines(render_message_lines(&app, &app.messages[0], 0));
        let body_idx = lines
            .iter()
            .position(|line| line.contains("我来帮您执行这个命令。"))
            .expect("body line exists");
        let tool_idx = lines
            .iter()
            .position(|line| line.contains("准备调用工具: run_shell_command"))
            .expect("tool progress line exists");

        assert!(body_idx < tool_idx);
    }

    #[test]
    fn real_thinking_stays_before_agent_message_body() {
        let mut app = build_view_model(ChatMessage::new(
            MessageRole::Agent,
            "我来帮您执行这个命令。",
        ));
        app.assistant_aux_by_message.insert(
            0,
            AssistantAuxData {
                thinking: Some("先检查命令参数是否安全。".to_string()),
                compaction: None,
            },
        );

        let lines = render_text_lines(render_message_lines(&app, &app.messages[0], 0));
        let thinking_idx = lines
            .iter()
            .position(|line| line.contains("先检查命令参数是否安全。"))
            .expect("thinking line exists");
        let body_idx = lines
            .iter()
            .position(|line| line.contains("我来帮您执行这个命令。"))
            .expect("body line exists");

        assert!(thinking_idx < body_idx);
    }

    #[test]
    fn embedded_thinking_renders_in_aux_details_without_raw_tags() {
        let app = build_view_model(ChatMessage::new(
            MessageRole::Agent,
            "<think>先看一下项目结构。</think>\n\n我已经梳理完主要模块。",
        ));

        let lines = render_text_lines(render_message_lines(&app, &app.messages[0], 0));
        let thinking_idx = lines
            .iter()
            .position(|line| line.contains("先看一下项目结构。"))
            .expect("embedded thinking line exists");
        let body_idx = lines
            .iter()
            .position(|line| line.contains("我已经梳理完主要模块。"))
            .expect("body line exists");

        assert!(thinking_idx < body_idx);
        assert!(lines.iter().all(|line| !line.contains("<think>")));
        assert!(lines.iter().all(|line| !line.contains("</think>")));
    }

    #[test]
    fn embedded_thinking_is_hidden_when_aux_details_collapsed() {
        let mut app = build_view_model(ChatMessage::new(
            MessageRole::Agent,
            "<think>先看一下项目结构。</think>\n\n我已经梳理完主要模块。",
        ));
        app.show_aux_details = false;

        let lines = render_text_lines(render_message_lines(&app, &app.messages[0], 0));

        assert!(lines.iter().any(|line| line.contains("我已经梳理完主要模块。")));
        assert!(lines.iter().all(|line| !line.contains("先看一下项目结构。")));
        assert!(lines.iter().all(|line| !line.contains("<think>")));
    }

    #[test]
    fn thinking_only_message_stays_invisible_when_aux_details_collapsed() {
        let mut app = build_view_model(ChatMessage::new(
            MessageRole::Agent,
            "<think>先看一下项目结构。</think>",
        ));
        app.show_aux_details = false;

        let lines = render_text_lines(render_message_lines(&app, &app.messages[0], 0));

        assert!(lines.is_empty());
    }

    #[test]
    fn pending_thinking_detail_is_hidden_when_aux_details_collapsed() {
        let mut app = build_view_model(ChatMessage::new(MessageRole::Agent, "我来处理这个问题。"));
        app.show_aux_details = false;
        app.pending_response_active = true;
        app.pending_assistant_msg_index = Some(0);
        app.pending_aux = Some(PendingAssistantAux {
            kind: AssistantAuxKind::Thinking,
            status_text: "Thinking...".to_string(),
            detail_text: Some("先检查当前渲染分支。".to_string()),
        });

        let lines = render_text_lines(render_message_lines(&app, &app.messages[0], 0));

        assert!(lines.iter().any(|line| line.contains("Thinking...")));
        assert!(lines.iter().any(|line| line.contains("我来处理这个问题。")));
        assert!(lines.iter().all(|line| !line.contains("先检查当前渲染分支。")));
    }

    #[test]
    fn pending_thinking_detail_is_visible_when_aux_details_expanded() {
        let mut app = build_view_model(ChatMessage::new(MessageRole::Agent, "我来处理这个问题。"));
        app.pending_response_active = true;
        app.pending_assistant_msg_index = Some(0);
        app.pending_aux = Some(PendingAssistantAux {
            kind: AssistantAuxKind::Thinking,
            status_text: "Thinking...".to_string(),
            detail_text: Some("先检查当前渲染分支。".to_string()),
        });

        let lines = render_text_lines(render_message_lines(&app, &app.messages[0], 0));

        assert!(lines.iter().any(|line| line.contains("Thinking...")));
        assert!(lines.iter().any(|line| line.contains("先检查当前渲染分支。")));
    }

    #[test]
    fn assistant_prefix_stays_with_first_wrapped_cjk_line() {
        let app = build_view_model(ChatMessage::new(
            MessageRole::Agent,
            "我注意到您使用了中文表达情绪。请问有什么我可以帮助您解决的问题吗？",
        ));

        let (flat, _) = crate::conversation_select::flatten_wrapped_history(
            render_message_lines(&app, &app.messages[0], 0),
            18,
            None,
        );
        let lines = render_text_lines(flat);

        assert!(lines.first().is_some_and(|line| line.contains("我")));
        assert!(lines.first().is_some_and(|line| !line.trim().eq(">")));
    }

    #[test]
    fn assistant_soft_wrap_continuation_aligns_with_text_column() {
        let app = build_view_model(ChatMessage::new(
            MessageRole::Agent,
            "我理解您可能感到沮丧或生气，但使用粗口并不能帮助我们解决问题。如果您遇到了什么困难或需要帮助，请告诉我具体的情况，我会尽力为您提供有用的支持和建议。",
        ));

        let (flat, _) = crate::conversation_select::flatten_wrapped_history(
            render_message_lines(&app, &app.messages[0], 0),
            28,
            None,
        );
        let lines = render_text_lines(flat);

        assert!(lines.first().is_some_and(|line| line.starts_with("> ")));
        assert!(lines.get(1).is_some_and(|line| line.starts_with("  ")));
        assert!(lines.get(1).is_some_and(|line| !line.starts_with("> ")));
    }
}
