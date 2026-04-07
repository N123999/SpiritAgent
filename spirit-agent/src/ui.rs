use comrak::{
    Arena, Options,
    nodes::{AstNode, ListType, NodeValue},
    parse_document,
};
use ratatui::{
    layout::{Constraint, Direction, Layout},
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{Block, Borders, Paragraph, Wrap},
};
use std::{cell::RefCell, collections::HashMap};
use unicode_width::UnicodeWidthChar;

use crate::{
    conversation_select::flatten_wrapped_history,
    tui::{ConversationPanelHit, TuiShell},
    view::{ChatMessage, MessageRole, ToolUiBlock, ToolUiPhase, TuiViewModel},
};

const MAX_RENDERED_MESSAGES: usize = 180;

thread_local! {
    static MARKDOWN_CACHE: RefCell<HashMap<String, Vec<Vec<Span<'static>>>>> =
        RefCell::new(HashMap::new());
}

pub fn draw_ui(frame: &mut ratatui::Frame<'_>, shell: &mut TuiShell) {
    let app = shell.view_model();
    let show_model_picker = app.model_picker_active;
    let show_chat_picker = app.chat_picker_active;
    let show_image_picker = app.image_picker_active;
    let show_picker = show_model_picker || show_chat_picker || show_image_picker;
    let show_suggestions = app.input.starts_with('/') && !show_picker;

    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints(if show_picker {
            vec![
                Constraint::Length(8),
                Constraint::Min(5),
                Constraint::Length(3),
                Constraint::Length(7),
                Constraint::Length(1),
            ]
        } else if show_suggestions {
            vec![
                Constraint::Length(8),
                Constraint::Min(5),
                Constraint::Length(3),
                Constraint::Length(5),
                Constraint::Length(1),
            ]
        } else {
            vec![
                Constraint::Length(8),
                Constraint::Min(6),
                Constraint::Length(3),
                Constraint::Length(1),
            ]
        })
        .split(frame.area());

    let logo = Paragraph::new(vec![
        Line::from(
            " ███████╗██████╗ ██╗██████╗ ██╗████████╗ █████╗  ██████╗ ███████╗███╗   ██╗████████╗",
        ),
        Line::from(
            " ██╔════╝██╔══██╗██║██╔══██╗██║╚══██╔══╝██╔══██╗██╔════╝ ██╔════╝████╗  ██║╚══██╔══╝",
        ),
        Line::from(
            " ███████╗██████╔╝██║██████╔╝██║   ██║   ███████║██║  ███╗█████╗  ██╔██╗ ██║   ██║   ",
        ),
        Line::from(
            " ╚════██║██╔═══╝ ██║██╔══██╗██║   ██║   ██╔══██║██║   ██║██╔══╝  ██║╚██╗██║   ██║   ",
        ),
        Line::from(
            " ███████║██║     ██║██║  ██║██║   ██║   ██║  ██║╚██████╔╝███████╗██║ ╚████║   ██║   ",
        ),
        Line::from(
            " ╚══════╝╚═╝     ╚═╝╚═╝  ╚═╝╚═╝   ╚═╝   ╚═╝  ╚═╝ ╚═════╝ ╚══════╝╚═╝  ╚═══╝   ╚═╝   ",
        ),
    ])
    .block(Block::default().borders(Borders::ALL).title("SpiritAgent"))
    .style(Style::default().fg(Color::Cyan));
    frame.render_widget(logo, chunks[0]);

    let history_lines = build_history_lines(&app);
    let inner_x = chunks[1].x.saturating_add(1);
    let inner_y = chunks[1].y.saturating_add(1);
    let inner_w = chunks[1].width.saturating_sub(2);
    let inner_h = chunks[1].height.saturating_sub(2);
    let history_view_height = inner_h as usize;
    let w = inner_w.max(1) as u16;
    let total_visual_lines = Paragraph::new(history_lines.clone())
        .wrap(Wrap { trim: false })
        .line_count(w) as usize;
    let norm = shell.conversation_norm_for_paint(total_visual_lines);
    let (flat, plain) = flatten_wrapped_history(history_lines, w, norm);
    debug_assert_eq!(flat.len(), total_visual_lines);
    let max_scroll = flat.len().saturating_sub(history_view_height);
    let history_scroll = max_scroll.saturating_sub(app.history_offset_from_bottom);
    let visible: Vec<Line<'static>> = flat
        .into_iter()
        .skip(history_scroll)
        .take(history_view_height)
        .collect();
    let history =
        Paragraph::new(visible).block(Block::default().borders(Borders::ALL).title("Conversation"));
    frame.render_widget(history, chunks[1]);
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

    let input = Paragraph::new(app.input.as_str())
        .block(Block::default().borders(Borders::ALL).title("Input"))
        .style(Style::default().fg(Color::Yellow));
    frame.render_widget(input, chunks[2]);

    if !show_picker {
        // Use terminal display width so CJK/full-width characters keep cursor aligned.
        let max_cursor_offset = chunks[2].width.saturating_sub(3) as usize;
        let cursor_visual_col = app
            .input
            .chars()
            .take(app.input_cursor)
            .map(|ch| UnicodeWidthChar::width(ch).unwrap_or(0))
            .sum::<usize>();
        let cursor_offset = cursor_visual_col.min(max_cursor_offset);
        let cursor_x = chunks[2].x + 1 + cursor_offset as u16;
        let cursor_y = chunks[2].y + 1;
        frame.set_cursor_position((cursor_x, cursor_y));
    }

    if show_model_picker {
        let picker_lines = build_model_picker_lines(&app, 5);
        let picker_widget = Paragraph::new(picker_lines)
            .block(Block::default().borders(Borders::ALL).title("Model Picker"))
            .wrap(Wrap { trim: true });
        frame.render_widget(picker_widget, chunks[3]);
    } else if show_chat_picker {
        let picker_lines = build_chat_picker_lines(&app, 5);
        let picker_widget = Paragraph::new(picker_lines)
            .block(Block::default().borders(Borders::ALL).title("Chat Picker"))
            .wrap(Wrap { trim: true });
        frame.render_widget(picker_widget, chunks[3]);
    } else if show_image_picker {
        let picker_lines = build_image_picker_lines(&app, 5);
        let picker_widget = Paragraph::new(picker_lines)
            .block(Block::default().borders(Borders::ALL).title("Image Picker"))
            .wrap(Wrap { trim: true });
        frame.render_widget(picker_widget, chunks[3]);
    } else if show_suggestions {
        let suggestions = build_suggestion_lines(&app, 3);
        let suggestions_widget = Paragraph::new(suggestions)
            .block(
                Block::default()
                    .borders(Borders::ALL)
                    .title("Slash Commands"),
            )
            .wrap(Wrap { trim: true });
        frame.render_widget(suggestions_widget, chunks[3]);
    }

    let help = if show_picker {
        Paragraph::new(Line::from(vec![
            Span::styled("Up/Down", Style::default().add_modifier(Modifier::BOLD)),
            Span::raw(" choose  |  "),
            Span::styled("Enter", Style::default().add_modifier(Modifier::BOLD)),
            Span::raw(" confirm  |  "),
            Span::styled("Esc", Style::default().add_modifier(Modifier::BOLD)),
            Span::raw(" cancel  |  "),
            Span::styled("Ctrl+C", Style::default().add_modifier(Modifier::BOLD)),
            Span::raw(" quit"),
        ]))
    } else {
        Paragraph::new(Line::from(vec![
            Span::styled("Enter", Style::default().add_modifier(Modifier::BOLD)),
            Span::raw(if app.pending_response_active {
                " wait  |  "
            } else {
                " send  |  "
            }),
            Span::styled("Tab", Style::default().add_modifier(Modifier::BOLD)),
            Span::raw(" complete  |  "),
            Span::styled(
                "Ctrl+Shift+C",
                Style::default().add_modifier(Modifier::BOLD),
            ),
            Span::raw(" copy conv  |  "),
            Span::styled("PgUp/PgDn", Style::default().add_modifier(Modifier::BOLD)),
            Span::raw(" scroll  |  "),
            Span::styled("Up/Down", Style::default().add_modifier(Modifier::BOLD)),
            Span::raw(" pick  |  "),
            Span::styled("/model", Style::default().add_modifier(Modifier::BOLD)),
            Span::raw(" picker  |  "),
            Span::styled("/chat", Style::default().add_modifier(Modifier::BOLD)),
            Span::raw(" picker  |  "),
            Span::styled("/image pick", Style::default().add_modifier(Modifier::BOLD)),
            Span::raw(" picker  |  "),
            Span::styled(
                "Esc / Ctrl+C",
                Style::default().add_modifier(Modifier::BOLD),
            ),
            Span::raw(" quit"),
        ]))
    };
    let help_idx = if show_suggestions { 4 } else { 3 };
    let help_idx = if show_picker { 4 } else { help_idx };
    frame.render_widget(help, chunks[help_idx]);
}

fn build_history_lines(app: &TuiViewModel) -> Vec<Line<'static>> {
    let mut lines = Vec::new();
    let (visible_messages, skipped, start_index) = visible_messages(app);

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
        let _global_idx = start_index + idx;
        lines.extend(render_message_lines(msg));
    }

    if let Some(status) = app.thinking_status_text() {
        lines.push(Line::from(vec![
            Span::styled("    ", Style::default()),
            Span::styled(
                status,
                Style::default()
                    .fg(Color::Yellow)
                    .add_modifier(Modifier::ITALIC),
            ),
        ]));

        if let Some(thinking) = app.thinking_content_text() {
            for segment in thinking.lines() {
                lines.push(Line::from(vec![
                    Span::styled("    ", Style::default()),
                    Span::styled(segment.to_string(), Style::default().fg(Color::DarkGray)),
                ]));
            }
        }
    }

    lines
}

fn render_message_lines(msg: &ChatMessage) -> Vec<Line<'static>> {
    let (prefix, prefix_color) = match msg.role {
        MessageRole::User => ("You", Color::Green),
        MessageRole::Agent => ("Spirit", Color::Cyan),
    };

    if let Some(ref tool) = msg.tool_block {
        return render_tool_card_lines(prefix, prefix_color, tool);
    }

    let content_lines = match msg.role {
        MessageRole::User => plain_text_lines(&msg.content),
        MessageRole::Agent => markdown_lines(&msg.content),
    };

    let mut out = Vec::new();
    let mut iter = content_lines.into_iter();
    if let Some(first) = iter.next() {
        let mut spans = vec![Span::styled(
            format!("{}> ", prefix),
            Style::default()
                .fg(prefix_color)
                .add_modifier(Modifier::BOLD),
        )];
        spans.extend(first);
        out.push(Line::from(spans));
    } else {
        out.push(Line::from(vec![Span::styled(
            format!("{}> ", prefix),
            Style::default()
                .fg(prefix_color)
                .add_modifier(Modifier::BOLD),
        )]));
    }

    for line in iter {
        let mut spans = vec![Span::raw("    ")];
        spans.extend(line);
        out.push(Line::from(spans));
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
    prefix: &'static str,
    prefix_color: Color,
    tool: &ToolUiBlock,
) -> Vec<Line<'static>> {
    let (phase_label, phase_color) = tool_phase_label(tool.phase);
    let rail = Style::default().fg(Color::Rgb(96, 110, 130));
    let rail_sym = "▌ ";
    let indent = "    ";

    let mut out = Vec::new();

    let mut title_spans = vec![
        Span::styled(
            format!("{}> ", prefix),
            Style::default()
                .fg(prefix_color)
                .add_modifier(Modifier::BOLD),
        ),
        Span::styled(
            "[tool] ",
            Style::default()
                .fg(Color::Magenta)
                .add_modifier(Modifier::BOLD),
        ),
        Span::styled(
            tool.tool_name.clone(),
            Style::default()
                .fg(Color::White)
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
    if let Some(ref id) = tool.tool_call_id {
        let short = if id.chars().count() > 14 {
            let mut t = id.chars().take(14).collect::<String>();
            t.push('…');
            t
        } else {
            id.clone()
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
                .fg(Color::White)
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
                    Span::styled((*seg).to_string(), Style::default().fg(Color::White)),
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

    out
}

fn plain_text_lines(text: &str) -> Vec<Vec<Span<'static>>> {
    let mut lines = Vec::new();
    for part in text.split('\n') {
        lines.push(vec![Span::raw(part.to_string())]);
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
        render_markdown_node(root, &mut builder, Style::default().fg(Color::White), 0);
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

fn build_suggestion_lines(app: &TuiViewModel, max_items: usize) -> Vec<Line<'static>> {
    if !app.input.starts_with('/') {
        return vec![Line::from("输入 / 触发命令补全")];
    }

    if app.slash_suggestions.is_empty() {
        return vec![Line::from("没有匹配的命令")];
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

    let mut lines = Vec::new();
    for idx in start..end {
        let cmd = &app.slash_suggestions[idx];
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
            format!("{}{}", marker, cmd),
            style,
        )));
    }

    lines
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
