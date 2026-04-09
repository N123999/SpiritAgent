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
use std::{cell::RefCell, collections::HashMap, path::Path};
use unicode_width::{UnicodeWidthChar, UnicodeWidthStr};

use crate::{
    conversation_select::flatten_wrapped_history,
    shell::manual_shell,
    session::PendingMcpResource,
    tui::{ConversationPanelHit, TuiShell},
    view::{
        AssistantAuxKind, BottomFormFieldEditorView, BottomFormView, ChatMessage, MessageRole,
        PendingAssistantAux, ToolUiBlock, ToolUiPhase, TuiViewModel,
    },
};

const MAX_RENDERED_MESSAGES: usize = 180;
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
}

fn conversation_logo_width(available_width: u16) -> u16 {
    let logo_text_width = SPIRIT_LOGO_LINES
        .iter()
        .map(|line| UnicodeWidthStr::width(*line))
        .max()
        .unwrap_or(0);
    let title_width = UnicodeWidthStr::width(" SpiritAgent ");
    let desired_width = logo_text_width.max(title_width).saturating_add(2) as u16;
    desired_width.min(available_width.max(1))
}

pub fn draw_ui(frame: &mut ratatui::Frame<'_>, shell: &mut TuiShell) {
    let app = shell.view_model();
    let show_model_picker = app.model_picker_active;
    let show_chat_picker = app.chat_picker_active;
    let show_image_picker = app.image_picker_active;
    let show_bottom_form = app.bottom_form.is_some();
    let show_picker = show_model_picker || show_chat_picker || show_image_picker;
    let show_suggestions = app.input.starts_with('/') && !show_picker && !show_bottom_form;
    let root_chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints(if show_suggestions || show_bottom_form {
            vec![Constraint::Min(0)]
        } else {
            vec![Constraint::Min(0), Constraint::Length(1)]
        })
        .split(frame.area());
    let content_area = root_chunks[0];
    let bottom_form_height = app
        .bottom_form
        .as_ref()
        .map(|f| bottom_form_block_height(f, content_area.width))
        .unwrap_or(0);
    let input_inner_width = content_area.width.saturating_sub(2) as usize;
    let input_height = input_block_height(&app, input_inner_width);

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
    let input_style = input_block_style(app.shell_mode_active);
    let input_title = if app.shell_mode_active { "Shell" } else { "Input" };
    let input = Paragraph::new(build_input_lines(
        &app,
        chunks[1].width.saturating_sub(2) as usize,
    ))
    .block(
        Block::default()
            .borders(Borders::ALL)
            .border_style(input_style)
            .title(Line::from(Span::styled(input_title, input_style))),
    )
    .wrap(Wrap { trim: false });
    frame.render_widget(input, chunks[1]);

    if show_bottom_form {
        if let Some(form) = &app.bottom_form {
            if let Some((cursor_x, cursor_y)) = draw_bottom_form(frame, chunks[2], form) {
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
            .block(Block::default().borders(Borders::ALL).title("Model Picker"))
            .wrap(Wrap { trim: true });
        frame.render_widget(picker_widget, chunks[2]);
    } else if show_chat_picker {
        let picker_lines = build_chat_picker_lines(&app, 5);
        let picker_widget = Paragraph::new(picker_lines)
            .block(Block::default().borders(Borders::ALL).title("Sessions"))
            .wrap(Wrap { trim: true });
        frame.render_widget(picker_widget, chunks[2]);
    } else if show_image_picker {
        let picker_lines = build_image_picker_lines(&app, 5);
        let picker_widget = Paragraph::new(picker_lines)
            .block(Block::default().borders(Borders::ALL).title("Image Picker"))
            .wrap(Wrap { trim: true });
        frame.render_widget(picker_widget, chunks[2]);
    } else if show_suggestions {
        let suggestions = build_suggestion_lines(
            &app,
            SLASH_SUGGESTION_VISIBLE_ITEMS,
            chunks[2].width.saturating_sub(2) as usize,
        );
        let suggestions_widget = Paragraph::new(suggestions)
            .block(
                Block::default()
                    .borders(Borders::ALL)
                    .title("Slash Commands"),
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

fn shell_mode_input_style() -> Style {
    Style::default().fg(Color::Rgb(184, 134, 11))
}

fn input_block_style(shell_mode_active: bool) -> Style {
    if shell_mode_active {
        shell_mode_input_style()
    } else {
        Style::default().fg(Color::White)
    }
}

fn input_text_style(shell_mode_active: bool) -> Style {
    if shell_mode_active {
        shell_mode_input_style()
    } else {
        Style::default().fg(Color::White)
    }
}

fn build_footer_line(app: &TuiViewModel, width: usize) -> Line<'static> {
    let footer_style = subtle_aux_text_style();
    let left_label = "SpiritAgent Preview";
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
    let left_text = truncate_to_width(left_label, max_left_width.max(1));
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

fn build_input_lines(app: &TuiViewModel, max_width: usize) -> Vec<Line<'static>> {
    let mut lines = Vec::new();

    if !app.pending_image_paths.is_empty() {
        let count = app.pending_image_paths.len();
        let summary = format!(
            "Picked {} image{}  |  /image clear",
            count,
            if count == 1 { "" } else { "s" }
        );
        lines.push(Line::from(Span::styled(
            truncate_to_width(&summary, max_width),
            Style::default()
                .fg(Color::Green)
                .add_modifier(Modifier::BOLD),
        )));
        lines.push(Line::from(Span::styled(
            summarize_pending_images(&app.pending_image_paths, max_width),
            Style::default().fg(Color::Cyan),
        )));
    }

    if !app.pending_mcp_resources.is_empty() {
        let count = app.pending_mcp_resources.len();
        let summary = format!(
            "Attached {} MCP resource{}  |  /mcp resource clear",
            count,
            if count == 1 { "" } else { "s" }
        );
        lines.push(Line::from(Span::styled(
            truncate_to_width(&summary, max_width),
            Style::default()
                .fg(Color::Yellow)
                .add_modifier(Modifier::BOLD),
        )));
        lines.push(Line::from(Span::styled(
            summarize_pending_mcp_resources(&app.pending_mcp_resources, max_width),
            Style::default().fg(Color::LightYellow),
        )));
    }

    let logical_lines: Vec<&str> = if app.input.is_empty() {
        vec![""]
    } else {
        app.input.split('\n').collect()
    };
    for line in logical_lines {
        lines.push(Line::from(Span::styled(
            line.to_string(),
            input_text_style(app.shell_mode_active),
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
    wrapped_text_cursor_position(text, max_width)
        .0
        .saturating_add(1)
}

fn wrapped_text_cursor_position(text: &str, max_width: usize) -> (usize, usize) {
    let mut total_rows = 0usize;
    let mut lines = text.split('\n').peekable();
    while let Some(line) = lines.next() {
        let (row, col) = wrapped_single_line_cursor_position(line, max_width);
        if lines.peek().is_none() {
            return (total_rows.saturating_add(row), col);
        }
        total_rows = total_rows.saturating_add(row.saturating_add(1));
    }
    (total_rows, 0)
}

fn wrapped_single_line_cursor_position(line: &str, max_width: usize) -> (usize, usize) {
    let width = max_width.max(1);
    let mut row = 0usize;
    let mut col = 0usize;

    for ch in line.chars() {
        let ch_width = UnicodeWidthChar::width(ch).unwrap_or(0);
        if ch_width == 0 {
            continue;
        }
        if col > 0 && col + ch_width > width {
            row += 1;
            col = 0;
        }
        col += ch_width;
        if col >= width {
            row += col / width;
            col %= width;
        }
    }

    (row, col)
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
        build_logo_top_border(inner_width, "SpiritAgent"),
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
                format!("已折叠更早的 {} 条消息", skipped),
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
    "> "
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

fn assistant_aux_title(kind: AssistantAuxKind) -> &'static str {
    match kind {
        AssistantAuxKind::Thinking => "思考内容",
        AssistantAuxKind::Compressing => "压缩摘要",
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
) {
    push_message_line(vec![Span::styled(
        pending_aux.status_text.clone(),
        pending_aux_status_style(pending_aux.kind),
    )]);

    if let Some(detail_text) = pending_aux.detail_text.as_deref() {
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

    let has_message_body = !msg.content.trim().is_empty();
    let content_lines = if has_message_body {
        match msg.role {
            MessageRole::User => plain_text_lines(&msg.content),
            MessageRole::Agent => markdown_lines(&msg.content),
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
    let stored_thinking_text = if pending_aux.is_none() {
        stored_aux
            .and_then(|aux| aux.thinking.as_deref())
            .filter(|value| !value.trim().is_empty())
    } else {
        None
    };
    let render_stored_thinking_after_body =
        should_render_aux_after_message_body(stored_thinking_text, has_message_body);
    let render_pending_aux_after_body = pending_aux.is_some_and(|aux| {
        should_render_aux_after_message_body(aux.detail_text.as_deref(), has_message_body)
    });

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
            render_pending_aux_lines(&mut push_message_line, pending_aux);
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
            render_pending_aux_lines(&mut push_message_line, pending_aux);
        }
    }

    out
}

fn tool_phase_label(phase: ToolUiPhase) -> (&'static str, Color) {
    match phase {
        ToolUiPhase::PendingApproval => ("待确认", Color::Yellow),
        ToolUiPhase::Running => ("执行中", Color::Yellow),
        ToolUiPhase::Succeeded => ("成功", Color::Green),
        ToolUiPhase::Failed => ("失败", Color::Red),
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
                    Span::styled("参数 JSON", Style::default().fg(Color::DarkGray)),
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
                    Span::styled("输出", Style::default().fg(Color::DarkGray)),
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
                            format!("… 另有 {} 行未显示", total_ln.saturating_sub(48)),
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
    if app.messages.len() <= MAX_RENDERED_MESSAGES {
        return (&app.messages, 0, 0);
    }

    let start = app.messages.len() - MAX_RENDERED_MESSAGES;
    (&app.messages[start..], start, start)
}

fn build_suggestion_lines(
    app: &TuiViewModel,
    max_items: usize,
    max_width: usize,
) -> Vec<Line<'static>> {
    let default_style = subtle_aux_text_style();
    let selected_style = Style::default().fg(Color::White);

    if !app.input.starts_with('/') {
        return vec![Line::from(Span::styled(
            "输入 / 触发命令补全",
            default_style,
        ))];
    }

    if app.slash_suggestions.is_empty() {
        return vec![Line::from(Span::styled("没有匹配的命令", default_style))];
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
        .map(|cmd| UnicodeWidthStr::width(format!("  {}", cmd).as_str()))
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
        let cmd = &app.slash_suggestions[idx];
        let is_selected = idx == selected;
        let command_style = if is_selected {
            selected_style
        } else {
            default_style
        };
        let command_text = format!("  {}", cmd);
        let summary = suggestion_summary(cmd);

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
        let summary_text = truncate_to_width(summary, summary_width);

        lines.push(Line::from(vec![
            Span::styled(command_text, command_style),
            Span::styled(" ".repeat(spacing), default_style),
            Span::styled(summary_text, default_style),
        ]));
    }

    if total == 1 {
        let details = suggestion_usage_lines(app.slash_suggestions[selected].as_str());
        if !details.is_empty() {
            lines.push(Line::from(Span::styled("", default_style)));
            for detail in details {
                lines.push(Line::from(Span::styled(detail, default_style)));
            }
        }
    }

    lines
}

fn suggestion_summary(command: &str) -> &'static str {
    match command {
        "/help" => "查看可用命令与说明",
        "/clear" => "清空当前会话显示",
        "/quit" => "退出 SpiritAgent",
        "/exit" => "退出 SpiritAgent",
        "/model" => "查看、切换或管理模型",
        "/compact" => "压缩上下文历史",
        "/sessions" => "保存、加载或选择会话",
        "/image" => "添加、清空或选择图片",
        "/mcp" => "查看、添加或浏览 MCP 服务器能力",
        "/log" => "打开或导出日志",
        _ => "",
    }
}

fn suggestion_usage_lines(command: &str) -> Vec<&'static str> {
    match command {
        "/model" => vec![
            "  Usage",
            "    /model list",
            "    /model use <name>",
            "    /model add <name> <api_base> <api_key>",
            "    /model remove <name>",
        ],
        "/sessions" => vec![
            "  Usage",
            "    /sessions",
            "    /sessions save [path]",
            "    /sessions load <file>",
        ],
        "/image" => vec![
            "  Usage",
            "    /image <path> [prompt]",
            "    /image pick",
            "    /image clear",
        ],
        "/mcp" => vec![
            "  Usage",
            "    /mcp",
            "    /mcp list",
            "    /mcp add",
            "    /mcp inspect [server]",
            "    /mcp tools [server]",
            "    /mcp resources [server]",
            "    /mcp prompts [server]",
            "    /mcp prompt [server] <prompt> [args_json]",
            "  Note",
            "    /mcp add 会打开底部表单；单一 server 场景可省略 [server]",
        ],
        "/log" => vec![
            "  Usage",
            "    /log",
            "    /log export",
            "    /log session export",
        ],
        _ => Vec::new(),
    }
}

fn build_model_picker_lines(app: &TuiViewModel, max_items: usize) -> Vec<Line<'static>> {
    if app.config.models.is_empty() {
        return vec![Line::from(
            "暂无模型，先用 /model add <name> <api_base> <api_key> 添加",
        )];
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
        let active_suffix = if is_active { "  (current)" } else { "" };
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
        return vec![Line::from("暂无已保存对话")];
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

fn build_image_picker_lines(app: &TuiViewModel, max_items: usize) -> Vec<Line<'static>> {
    if app.image_picker_files.is_empty() {
        return vec![Line::from("当前目录暂无可选图片")];
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

fn bottom_form_text_field_outer_height(value: &str, placeholder: &str, text_inner_w: usize) -> u16 {
    bottom_form_text_visual_line_count(value, placeholder, text_inner_w)
        .max(1)
        .saturating_add(2) as u16
}

fn bottom_form_field_outer_height(editor: &BottomFormFieldEditorView, text_inner_w: usize) -> u16 {
    match editor {
        BottomFormFieldEditorView::Text {
            value, placeholder, ..
        } => bottom_form_text_field_outer_height(value, placeholder, text_inner_w),
        BottomFormFieldEditorView::Choice { .. } => 3,
    }
}

fn bottom_form_block_height(form: &BottomFormView, panel_width: u16) -> u16 {
    let text_inner_w = bottom_form_text_inner_width(panel_width);
    let content_w = bottom_form_content_width(panel_width);
    let fields_height = form
        .fields
        .iter()
        .map(|field| u32::from(bottom_form_field_outer_height(&field.editor, text_inner_w)))
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
) -> Option<(u16, u16)> {
    let outer_style = Style::default().fg(Color::White);
    let title = truncate_to_width(&form.title, area.width.saturating_sub(4) as usize);
    let outer_block = Block::default()
        .borders(Borders::ALL)
        .border_style(outer_style)
        .title(Line::from(Span::styled(title, outer_style)));
    let inner_area = outer_block.inner(area);
    frame.render_widget(outer_block, area);

    let content_area = inset_rect(inner_area, 2, 1);
    if content_area.width < 3 || content_area.height == 0 {
        return None;
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
    let mut cursor = None;
    let mut field_y = content_area.y;
    for (index, field) in form.fields.iter().enumerate() {
        let field_h = bottom_form_field_outer_height(&field.editor, text_inner_w);
        let available_h = fields_limit_y.saturating_sub(field_y);
        if available_h == 0 {
            break;
        }
        let field_area = Rect {
            x: content_area.x,
            y: field_y,
            width: content_area.width,
            height: field_h.min(available_h),
        };

        let field_cursor = match &field.editor {
            BottomFormFieldEditorView::Text {
                value,
                placeholder,
                cursor,
            } => draw_bottom_form_text_field(
                frame,
                field_area,
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
        };

        if index == form.selected_field {
            cursor = field_cursor;
        }

        field_y = field_y.saturating_add(field_h.saturating_add(1));
    }

    let footer_area = Rect {
        x: content_area.x,
        y: footer_y,
        width: content_area.width,
        height: footer_height,
    };
    frame.render_widget(Paragraph::new(footer_lines), footer_area);

    cursor
}

fn draw_bottom_form_text_field(
    frame: &mut ratatui::Frame<'_>,
    area: Rect,
    value: &str,
    placeholder: &str,
    cursor_chars: usize,
    is_selected: bool,
) -> Option<(u16, u16)> {
    let block = Block::default()
        .borders(Borders::ALL)
        .border_style(bottom_form_field_style(is_selected));
    let inner = block.inner(area);
    frame.render_widget(block, area);

    let lines = build_bottom_form_text_lines(value, placeholder, inner.width as usize, is_selected);
    frame.render_widget(Paragraph::new(lines), inner);

    if !is_selected {
        return None;
    }

    let prefix: String = value.chars().take(cursor_chars).collect();
    let (row, col) = wrapped_text_cursor_position(&prefix, inner.width as usize);
    Some((
        inner.x + col.min(inner.width.saturating_sub(1) as usize) as u16,
        inner.y + row as u16,
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
        view::{AssistantAuxData, BottomFormFieldEditorView, BottomFormFieldView, BottomFormView},
    };

    fn render_text_lines(lines: Vec<Line<'static>>) -> Vec<String> {
        lines
            .into_iter()
            .map(|line| {
                line.spans
                    .into_iter()
                    .map(|span| span.content.into_owned())
                    .collect::<String>()
            })
            .collect()
    }

    fn build_view_model(message: ChatMessage) -> TuiViewModel {
        TuiViewModel {
            input: String::new(),
            input_cursor: 0,
            shell_mode_active: false,
            pending_image_paths: vec![],
            pending_mcp_resources: vec![],
            messages: vec![message],
            assistant_aux_by_message: HashMap::new(),
            config: AppConfig::default(),
            show_aux_details: true,
            slash_suggestions: vec![],
            selected_suggestion: 0,
            model_picker_active: false,
            model_picker_index: 0,
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
            title: "Add MCP Server".to_string(),
            fields: vec![
                BottomFormFieldView {
                    label: "名称".to_string(),
                    help: String::new(),
                    editor: BottomFormFieldEditorView::Text {
                        value: "github".to_string(),
                        placeholder: "名称，例如 github".to_string(),
                        cursor: 0,
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
                    },
                },
                BottomFormFieldView {
                    label: "环境变量".to_string(),
                    help: String::new(),
                    editor: BottomFormFieldEditorView::Text {
                        value: "GITHUB_TOKEN=demo".to_string(),
                        placeholder: "环境变量，可选，例如 GITHUB_TOKEN=demo".to_string(),
                        cursor: 0,
                    },
                },
            ],
            selected_field: 2,
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
}
