use ratatui::{
    layout::{Constraint, Direction, Layout, Rect},
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{Block, Borders, Clear, Paragraph, Wrap},
};
use rust_i18n::t;
use unicode_width::{UnicodeWidthChar, UnicodeWidthStr};

mod conversation;
mod forms;
mod input;
mod markdown;
mod marketplace;
mod pickers;
mod subagent;
mod text;
mod theme;

use conversation::*;
use forms::*;
use input::*;
use markdown::*;
use marketplace::*;
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

#[cfg(test)]
mod tests;
