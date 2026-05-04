use ratatui::{
    layout::{Constraint, Direction, Layout, Rect},
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{Block, Borders, Clear, Paragraph, Wrap},
};
use rust_i18n::t;
use unicode_width::{UnicodeWidthChar, UnicodeWidthStr};

mod conversation;
mod input;
mod markdown;
mod pickers;
mod subagent;
mod text;
mod theme;

use conversation::*;
use input::*;
use markdown::*;
use pickers::*;
use subagent::*;
use text::*;
use theme::*;

use crate::{
    conversation_select::{CellPointer, NormRange, flatten_wrapped_history, normalize_selection},
    logging,
    ports::SubagentSessionStatus,
    session::PendingMcpResource,
    shell::{ask_questions as ask_questions_form, manual_shell},
    view::{
        AskQuestionsOptionView, AskQuestionsQuestionView, AssistantAuxKind,
        BottomFormFieldEditorView, BottomFormFieldView, BottomFormKind, BottomFormView,
        ChatMessage, CliUiHookSlot, ConversationPanelHit, InputSuggestion, InputSuggestionKind,
        MainInputMode, MarketplaceViewModel, MessageRole, PendingAssistantAux,
        PendingSubagentApprovalView, SubagentApprovalInputView, SubagentSessionDetailView,
        ToolUiBlock, ToolUiPhase, TuiViewModel,
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

struct BottomFormRenderResult {
    cursor: Option<(u16, u16)>,
    scroll_offset: Option<usize>,
}

#[derive(Clone, Debug, Default)]
pub struct UiRenderFeedback {
    pub conversation_panel: Option<ConversationPanelRenderFeedback>,
    pub bottom_form_scroll_offset: Option<usize>,
    pub subagent_history_offset_from_bottom: Option<usize>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ConversationMessageRenderRange {
    pub message_id: usize,
    pub start_line: usize,
    pub end_line: usize,
}

#[derive(Clone, Debug)]
pub struct ConversationPanelRenderFeedback {
    pub hit: ConversationPanelHit,
    pub plain_rows: Vec<String>,
    pub message_ranges: Vec<ConversationMessageRenderRange>,
    pub history_offset_from_bottom: usize,
}

struct HistoryRenderResult {
    lines: Vec<Line<'static>>,
    message_ranges: Vec<ConversationMessageRenderRange>,
}

struct RulesBottomFormLayout {
    content_lines: Vec<Line<'static>>,
    field_ranges: Vec<Option<(usize, usize)>>,
    footer_lines: Vec<Line<'static>>,
}

pub fn draw_ui(frame: &mut ratatui::Frame<'_>, app: &TuiViewModel) -> UiRenderFeedback {
    let mut feedback = UiRenderFeedback::default();
    set_active_cli_ui_hooks(app.cli_ui_hooks.clone());
    let show_model_picker = app.model_picker_active;
    let show_language_picker = app.language_picker_active;
    let show_chat_picker = app.chat_picker_active;
    let show_subagent_picker = app.subagent_picker_active;
    let show_image_picker = app.image_picker_active;
    let show_rewind_picker = app.rewind_picker.is_some();
    let show_bottom_form = app.bottom_form.is_some();
    let show_marketplace = app.marketplace_view.is_some();
    let show_picker = show_model_picker
        || show_language_picker
        || show_chat_picker
        || show_subagent_picker
        || show_image_picker;
    let show_suggestions = app.input_suggestion_kind.is_some()
        && !show_picker
        && !show_rewind_picker
        && !show_bottom_form
        && !show_marketplace;

    let root_chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints(
            if show_suggestions || show_bottom_form || show_model_picker {
                vec![Constraint::Min(0)]
            } else {
                vec![Constraint::Min(0), Constraint::Length(1)]
            },
        )
        .split(frame.area());
    let content_area = root_chunks[0];
    let input_inner_width = content_area.width.saturating_sub(2) as usize;
    let input_height = input_block_height(&app, input_inner_width);
    let bottom_form_height = app
        .bottom_form
        .as_ref()
        .map(|f| {
            bottom_form_display_height(f, content_area.width, content_area.height, input_height)
        })
        .unwrap_or(0);
    let marketplace_height = app
        .marketplace_view
        .as_ref()
        .map(|view| marketplace_panel_height(view, content_area.height, input_height))
        .unwrap_or(0);

    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints(if show_model_picker {
            vec![
                Constraint::Min(5),
                Constraint::Length(input_height),
                Constraint::Length(7),
            ]
        } else if show_picker {
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
        } else if show_marketplace {
            vec![
                Constraint::Min(0),
                Constraint::Length(input_height),
                Constraint::Length(marketplace_height),
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

    let history_render =
        build_history_render_result(&app, chunks[0].width.saturating_sub(1) as usize);
    let history_lines = history_render.lines;
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
    let norm = conversation_norm_for_paint(app, total_visual_lines);
    let (flat, plain) = flatten_wrapped_history(history_lines, w, norm);
    debug_assert_eq!(flat.len(), total_visual_lines);
    let max_scroll = flat.len().saturating_sub(history_view_height);
    let offset_bottom = app.history_offset_from_bottom.min(max_scroll);
    let history_scroll = max_scroll.saturating_sub(offset_bottom);
    let visible: Vec<Line<'static>> = flat
        .into_iter()
        .skip(history_scroll)
        .take(history_view_height)
        .collect();
    let history = Paragraph::new(visible);
    frame.render_widget(history, chunks[0]);
    feedback.conversation_panel = Some(ConversationPanelRenderFeedback {
        hit: ConversationPanelHit {
            x: inner_x,
            y: inner_y,
            w: inner_w,
            h: inner_h,
            scroll: history_scroll,
            total_lines: total_visual_lines,
        },
        plain_rows: plain,
        message_ranges: history_render.message_ranges,
        history_offset_from_bottom: offset_bottom,
    });

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
                feedback.bottom_form_scroll_offset = Some(scroll_offset);
            }
            if let Some((cursor_x, cursor_y)) = render.cursor {
                frame.set_cursor_position((cursor_x, cursor_y));
            }
        }
    } else if show_marketplace {
        if let Some(view) = &app.marketplace_view {
            draw_marketplace_view(frame, chunks[2], view);
        }
    } else if !show_picker && !show_marketplace {
        // Use terminal display width so CJK/full-width characters keep cursor aligned.
        let max_cursor_offset = chunks[1].width.saturating_sub(3) as usize;
        let cursor_offset = input_cursor_col.min(max_cursor_offset as u16) as usize;
        let cursor_x = chunks[1].x + 1 + cursor_offset as u16;
        let cursor_y = chunks[1].y + 1 + input_cursor_row;
        frame.set_cursor_position((cursor_x, cursor_y));
    }

    if show_model_picker {
        let picker_lines = build_model_picker_lines(&app, 5);
        let picker_area = model_picker_area(chunks[2]);
        let picker_widget = Paragraph::new(picker_lines).wrap(Wrap { trim: true });
        frame.render_widget(Clear, chunks[2]);
        frame.render_widget(picker_widget, picker_area);
    } else if show_language_picker {
        let picker_lines = build_language_picker_lines(&app, 5);
        let picker_widget = Paragraph::new(picker_lines)
            .block(
                Block::default()
                    .borders(Borders::ALL)
                    .title(t!("ui.picker.language")),
            )
            .wrap(Wrap { trim: true });
        frame.render_widget(picker_widget, chunks[2]);
    } else if show_chat_picker {
        let picker_lines = build_chat_picker_lines(&app, 5);
        let picker_widget = Paragraph::new(picker_lines)
            .block(
                Block::default()
                    .borders(Borders::ALL)
                    .title(t!("ui.picker.sessions")),
            )
            .wrap(Wrap { trim: true });
        frame.render_widget(picker_widget, chunks[2]);
    } else if show_subagent_picker {
        let picker_lines =
            build_subagent_picker_lines(&app, 6, chunks[2].width.saturating_sub(2) as usize);
        let picker_widget = Paragraph::new(picker_lines)
            .block(
                Block::default()
                    .borders(Borders::ALL)
                    .title("SubAgent 会话"),
            )
            .wrap(Wrap { trim: true });
        frame.render_widget(picker_widget, chunks[2]);
    } else if show_image_picker {
        let picker_lines = build_image_picker_lines(&app, 5);
        let picker_widget = Paragraph::new(picker_lines)
            .block(
                Block::default()
                    .borders(Borders::ALL)
                    .title(t!("ui.picker.image")),
            )
            .wrap(Wrap { trim: true });
        frame.render_widget(picker_widget, chunks[2]);
    } else if show_suggestions {
        let suggestions = build_suggestion_lines(
            &app,
            SLASH_SUGGESTION_VISIBLE_ITEMS,
            chunks[2].width.saturating_sub(2) as usize,
        );
        let suggestion_frame_style = patch_style_border(
            conversation_body_text_style(),
            cli_ui_border_color(CliUiHookSlot::SlashSuggestions)
                .or(cli_ui_accent_color(CliUiHookSlot::SlashSuggestions)),
        );
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

    if !show_suggestions && !show_bottom_form && !show_marketplace && !show_model_picker {
        let help_idx = if show_picker { 3 } else { 2 };
        let footer = Paragraph::new(build_footer_line(&app, chunks[help_idx].width as usize));
        frame.render_widget(footer, chunks[help_idx]);
        frame.render_widget(Clear, root_chunks[1]);
    }

    if let Some(view) = &app.subagent_view {
        feedback.subagent_history_offset_from_bottom = draw_subagent_viewer(
            frame,
            frame.area(),
            view,
            app.subagent_history_offset_from_bottom,
            app.show_aux_details,
            app.pending_subagent_approval.as_ref(),
            app.subagent_approval_input.as_ref(),
        );
    }

    clear_active_cli_ui_hooks();
    feedback
}

fn marketplace_review_label(status: &str) -> &'static str {
    match status.trim() {
        "verified" => "已验证",
        "revoked" => "已撤销",
        _ => "未验证",
    }
}

fn marketplace_channel_label(channel: &str) -> String {
    match channel.trim() {
        "stable" => "稳定".to_string(),
        "preview" => "预览".to_string(),
        "experimental" => "实验".to_string(),
        other => other.to_string(),
    }
}

fn draw_marketplace_view(frame: &mut ratatui::Frame<'_>, area: Rect, view: &MarketplaceViewModel) {
    frame.render_widget(Clear, area);
    match view.step {
        crate::view::MarketplaceFlowStep::CatalogPicker => {
            draw_marketplace_catalog_picker(frame, area, view);
        }
        _ => draw_marketplace_detail_page(frame, area, view),
    }
}

fn marketplace_panel_height(
    view: &MarketplaceViewModel,
    panel_height: u16,
    input_height: u16,
) -> u16 {
    let available = panel_height.saturating_sub(input_height).max(8);
    match view.step {
        crate::view::MarketplaceFlowStep::CatalogPicker => {
            let half = available.saturating_add(1) / 2;
            available.min(half.max(10))
        }
        _ => {
            let expanded = available.saturating_mul(4) / 5;
            available.min(expanded.max(22))
        }
    }
}

fn draw_marketplace_catalog_picker(
    frame: &mut ratatui::Frame<'_>,
    area: Rect,
    view: &MarketplaceViewModel,
) {
    let border_style = input_block_border_style(false, MainInputMode::Agent, false);
    let block = Block::default()
        .borders(Borders::ALL)
        .border_style(border_style)
        .title(Line::from(Span::styled("扩展市场", border_style)));
    let inner = block.inner(area);
    frame.render_widget(block, area);
    draw_slash_flow_body(frame, inner, &view.slash, view.error.as_deref());
}

fn draw_marketplace_detail_page(
    frame: &mut ratatui::Frame<'_>,
    area: Rect,
    view: &MarketplaceViewModel,
) {
    let border_style = input_block_border_style(false, MainInputMode::Agent, false);
    let panel_title_style = Style::default().fg(Color::Rgb(225, 225, 225));
    let block = Block::default()
        .borders(Borders::ALL)
        .border_style(border_style)
        .title(Line::from(Span::styled("扩展详情", border_style)));
    frame.render_widget(block.clone(), area);
    let inner = block.inner(area);
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(if view.error.is_some() { 7 } else { 6 }),
            Constraint::Min(8),
            Constraint::Length(10),
        ])
        .split(inner);

    render_marketplace_overview(
        frame,
        chunks[0],
        view,
        panel_title_style,
        subtle_aux_text_style(),
    );
    render_marketplace_readme(frame, chunks[1], view, panel_title_style);
    draw_slash_flow_panel(frame, chunks[2], &view.slash, None);
}

fn render_marketplace_overview(
    frame: &mut ratatui::Frame<'_>,
    area: Rect,
    view: &MarketplaceViewModel,
    title_style: Style,
    subtle_style: Style,
) {
    let Some(item) = view.selected_item.as_ref() else {
        frame.render_widget(
            Paragraph::new("找不到该扩展，请按 Esc 返回列表。").wrap(Wrap { trim: true }),
            area,
        );
        return;
    };

    let mut lines = vec![Line::from(vec![
        Span::styled(item.display_name.clone(), title_style),
        Span::raw("  "),
        Span::styled(format!("@{}", item.default_version), subtle_style),
        Span::raw("  "),
        Span::styled(
            marketplace_review_label(&item.default_review_status),
            review_status_style(&item.default_review_status),
        ),
        Span::raw("  "),
        Span::styled(
            item.installed_version
                .as_ref()
                .map(|installed| format!("已安装 {}", installed))
                .unwrap_or_else(|| "未安装".to_string()),
            Style::default().fg(Color::Rgb(215, 215, 215)),
        ),
    ])];

    if !item.description.trim().is_empty() {
        let mut description = String::new();
        if let Some(author) = item.author.as_deref() {
            description.push_str(author);
            description.push_str(" · ");
        }
        description.push_str(&item.description);
        lines.push(Line::from(Span::styled(description, subtle_style)));
    }

    lines.push(Line::from(vec![
        Span::styled("id ", subtle_style),
        Span::styled(
            item.extension_id.clone(),
            Style::default().fg(Color::Rgb(205, 205, 205)),
        ),
        Span::raw("  "),
        Span::styled("package ", subtle_style),
        Span::styled(
            item.package_name.clone(),
            Style::default().fg(Color::Rgb(205, 205, 205)),
        ),
    ]));

    if let Some(detail) = view.detail.as_ref() {
        lines.push(Line::from(vec![
            Span::styled("状态 ", subtle_style),
            Span::styled(
                detail.status.clone(),
                Style::default().fg(Color::Rgb(185, 185, 185)),
            ),
            Span::raw("  "),
            Span::styled("默认通道 ", subtle_style),
            Span::styled(
                marketplace_channel_label(&item.default_channel),
                Style::default().fg(Color::Rgb(185, 185, 185)),
            ),
        ]));
    }

    if let Some(error) = view.error.as_deref() {
        lines.push(Line::from(Span::styled(
            truncate_to_width(error, area.width.saturating_sub(1) as usize),
            Style::default().fg(Color::Rgb(220, 220, 220)),
        )));
    }

    frame.render_widget(Paragraph::new(lines).wrap(Wrap { trim: true }), area);
}

fn render_marketplace_readme(
    frame: &mut ratatui::Frame<'_>,
    area: Rect,
    view: &MarketplaceViewModel,
    title_style: Style,
) {
    let block = Block::default()
        .title(Line::from(Span::styled("README", title_style)))
        .borders(Borders::TOP);
    frame.render_widget(block.clone(), area);
    let inner = block.inner(area);

    let lines = view
        .detail
        .as_ref()
        .and_then(|detail| detail.readme.as_deref())
        .filter(|readme| !readme.trim().is_empty())
        .map(marketplace_markdown_lines)
        .unwrap_or_else(|| {
            vec![Line::from(Span::styled(
                "暂无 README 内容。",
                subtle_aux_text_style(),
            ))]
        });

    let visible_height = inner.height.max(1) as usize;
    let max_scroll = lines.len().saturating_sub(visible_height);
    let scroll = view.readme_scroll.min(max_scroll);
    let visible = lines
        .into_iter()
        .skip(scroll)
        .take(visible_height)
        .collect::<Vec<_>>();
    frame.render_widget(Paragraph::new(visible).wrap(Wrap { trim: false }), inner);
}

fn draw_slash_flow_panel(
    frame: &mut ratatui::Frame<'_>,
    area: Rect,
    flow: &crate::view::SlashFlowView,
    error: Option<&str>,
) {
    let border_style = input_block_border_style(false, MainInputMode::Agent, false);
    let title_style = Style::default().fg(Color::Rgb(225, 225, 225));
    let block = Block::default()
        .borders(Borders::ALL)
        .border_style(border_style)
        .title(Line::from(Span::styled(flow.title.clone(), title_style)));
    frame.render_widget(block.clone(), area);
    let inner = block.inner(area);
    draw_slash_flow_body(frame, inner, flow, error);
}

fn draw_slash_flow_body(
    frame: &mut ratatui::Frame<'_>,
    area: Rect,
    flow: &crate::view::SlashFlowView,
    error: Option<&str>,
) {
    let subtle_style = subtle_aux_text_style();
    let title_style = Style::default().fg(Color::Rgb(225, 225, 225));
    let header_height = if flow.show_filter {
        if error.is_some() { 4 } else { 3 }
    } else if error.is_some() {
        1
    } else {
        0
    };
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(header_height),
            Constraint::Min(1),
            Constraint::Length(1),
        ])
        .split(area);

    if header_height > 0 {
        let mut header_lines = Vec::new();
        if flow.show_filter {
            header_lines.push(Line::from(vec![
                Span::styled("过滤 ", subtle_style),
                Span::styled(
                    if flow.filter.trim().is_empty() {
                        "（未输入，直接键入即可）".to_string()
                    } else {
                        flow.filter.clone()
                    },
                    title_style,
                ),
            ]));
            header_lines.push(Line::from(vec![
                Span::styled("共 ", subtle_style),
                Span::styled(flow.items.len().to_string(), title_style),
                Span::styled(" 项", subtle_style),
            ]));
        }
        if let Some(error) = error {
            header_lines.push(Line::from(Span::styled(
                truncate_to_width(error, chunks[0].width.saturating_sub(1) as usize),
                Style::default().fg(Color::Rgb(220, 220, 220)),
            )));
        }
        frame.render_widget(
            Paragraph::new(header_lines).wrap(Wrap { trim: true }),
            chunks[0],
        );
    }

    let body_lines = build_slash_flow_lines(
        flow,
        chunks[1].width.saturating_sub(1) as usize,
        flow.compact_items,
    );
    frame.render_widget(
        Paragraph::new(body_lines).wrap(Wrap { trim: false }),
        chunks[1],
    );
    frame.render_widget(
        Paragraph::new(Line::from(Span::styled(
            flow.footer_hint.clone(),
            subtle_style,
        ))),
        chunks[2],
    );
}

fn build_slash_flow_lines(
    flow: &crate::view::SlashFlowView,
    width: usize,
    compact_items: bool,
) -> Vec<Line<'static>> {
    if flow.items.is_empty() {
        return vec![Line::from(Span::styled(
            flow.empty_text.clone(),
            subtle_aux_text_style(),
        ))];
    }

    flow.items
        .iter()
        .enumerate()
        .flat_map(|(index, item)| {
            let is_selected = index == flow.selected_index;
            let marker = if is_selected { "▸ " } else { "  " };
            let label_style = if item.disabled {
                Style::default().fg(Color::Rgb(125, 125, 125))
            } else if is_selected {
                Style::default().fg(Color::Rgb(235, 235, 235))
            } else if item.muted {
                Style::default().fg(Color::Rgb(155, 155, 155))
            } else {
                Style::default().fg(Color::Rgb(205, 205, 205))
            };
            let mut lines = vec![Line::from(vec![
                Span::styled(marker, label_style),
                Span::styled(
                    truncate_to_width(&item.label, width.saturating_sub(2)),
                    label_style,
                ),
            ])];

            if !item.summary.trim().is_empty() {
                let summary_indent = "  ";
                let summary_width = width.saturating_sub(summary_indent.len());
                lines.push(Line::from(Span::styled(
                    format!(
                        "{}{}",
                        summary_indent,
                        truncate_to_width(&item.summary, summary_width)
                    ),
                    if item.disabled {
                        Style::default().fg(Color::Rgb(115, 115, 115))
                    } else {
                        subtle_aux_text_style()
                    },
                )));
            }

            if !compact_items {
                for detail in &item.details {
                    if detail.trim().is_empty() {
                        continue;
                    }
                    lines.push(Line::from(Span::styled(
                        format!("  {}", truncate_to_width(detail, width.saturating_sub(2))),
                        Style::default().fg(Color::Rgb(145, 145, 145)),
                    )));
                }
            }

            lines.push(Line::from(""));
            lines
        })
        .collect()
}

fn review_status_style(status: &str) -> Style {
    match status.trim() {
        "verified" => Style::default()
            .fg(Color::Rgb(228, 228, 228))
            .add_modifier(Modifier::BOLD),
        "revoked" => Style::default()
            .fg(Color::Rgb(135, 135, 135))
            .add_modifier(Modifier::DIM),
        _ => Style::default().fg(Color::Rgb(175, 175, 175)),
    }
}

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

fn bottom_form_field_outer_height(
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

fn bottom_form_block_height(form: &BottomFormView, panel_width: u16) -> u16 {
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

fn draw_rules_bottom_form(
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

fn draw_bottom_form_section_field(frame: &mut ratatui::Frame<'_>, area: Rect, text: &str) {
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

fn draw_bottom_form_text_field(
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

#[cfg(test)]
mod tests;
