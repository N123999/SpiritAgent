use super::*;

const SPIRIT_LOGO_LINES: [&str; 6] = [
    " ███████╗██████╗ ██╗██████╗ ██╗████████╗ █████╗  ██████╗ ███████╗███╗   ██╗████████╗",
    " ██╔════╝██╔══██╗██║██╔══██╗██║╚══██╔══╝██╔══██╗██╔════╝ ██╔════╝████╗  ██║╚══██╔══╝",
    " ███████╗██████╔╝██║██████╔╝██║   ██║   ███████║██║  ███╗█████╗  ██╔██╗ ██║   ██║   ",
    " ╚════██║██╔═══╝ ██║██╔══██╗██║   ██║   ██╔══██║██║   ██║██╔══╝  ██║╚██╗██║   ██║   ",
    " ███████║██║     ██║██║  ██║██║   ██║   ██║  ██║╚██████╔╝███████╗██║ ╚████║   ██║   ",
    " ╚══════╝╚═╝     ╚═╝╚═╝  ╚═╝╚═╝   ╚═╝   ╚═╝  ╚═╝ ╚═════╝ ╚══════╝╚═╝  ╚═══╝   ╚═╝   ",
];

pub(in crate::ui) struct HistoryRenderResult {
    pub(in crate::ui) lines: Vec<Line<'static>>,
    pub(in crate::ui) message_ranges: Vec<ConversationMessageRenderRange>,
}

pub(in crate::ui) fn conversation_logo_width(available_width: u16) -> u16 {
    let logo_text_width = SPIRIT_LOGO_LINES
        .iter()
        .map(|line| UnicodeWidthStr::width(*line))
        .max()
        .unwrap_or(0);
    let title_width = UnicodeWidthStr::width(format!(" {} ", t!("ui.brand.title")).as_str());
    let desired_width = logo_text_width.max(title_width).saturating_add(2) as u16;
    desired_width.min(available_width.max(1))
}

pub(in crate::ui) fn conversation_norm_for_paint(
    app: &TuiViewModel,
    total_lines: usize,
) -> Option<NormRange> {
    let (Some(a), Some(b)) = (app.conversation_sel_anchor, app.conversation_sel_head) else {
        return None;
    };
    let max_line = total_lines.saturating_sub(1);
    let a = CellPointer {
        line: a.0.min(max_line),
        col: a.1,
    };
    let b = CellPointer {
        line: b.0.min(max_line),
        col: b.1,
    };
    Some(normalize_selection(a, b))
}

pub(in crate::ui) fn build_history_logo_lines(max_width: usize) -> Vec<Line<'static>> {
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

#[cfg(test)]
pub(in crate::ui) fn build_history_lines(
    app: &TuiViewModel,
    max_width: usize,
) -> Vec<Line<'static>> {
    build_history_render_result(app, max_width).lines
}

pub(in crate::ui) fn build_history_render_result(
    app: &TuiViewModel,
    max_width: usize,
) -> HistoryRenderResult {
    let mut lines = build_history_logo_lines(max_width);
    let (visible_messages, skipped, start_index) = visible_messages(app);
    let effective_standalone_pending_aux = effective_standalone_pending_aux(app);
    let has_pending_aux = effective_standalone_pending_aux.is_some();
    let render_standalone_pending_aux =
        should_render_standalone_pending_aux(app, start_index, visible_messages.len());
    let standalone_insert_before = standalone_pending_aux_insert_before_message_index(
        app,
        start_index,
        visible_messages.len(),
    );
    let standalone_block = if render_standalone_pending_aux {
        effective_standalone_pending_aux.map(|pending_aux| {
            render_standalone_pending_aux_lines(pending_aux, app.show_aux_details)
        })
    } else {
        None
    };
    let mut rendered_blocks: Vec<(Option<usize>, Vec<Line<'static>>)> = Vec::new();
    let mut inserted_standalone_block = false;

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
        if !inserted_standalone_block
            && standalone_insert_before == Some(global_idx)
            && standalone_block.is_some()
        {
            rendered_blocks.push((None, standalone_block.clone().unwrap_or_default()));
            inserted_standalone_block = true;
        }
        let rendered = render_message_lines(app, msg, global_idx);
        if !rendered.is_empty() {
            rendered_blocks.push((Some(global_idx + 1), rendered));
        }
    }

    if !inserted_standalone_block {
        if let Some(standalone_block) = standalone_block {
            rendered_blocks.push((None, standalone_block));
        }
    }

    let mut message_ranges = Vec::new();
    let rendered_count = rendered_blocks.len();
    for (idx, (message_id, block_lines)) in rendered_blocks.into_iter().enumerate() {
        let start_line = lines.len();
        lines.extend(block_lines);
        let end_line = lines.len().saturating_sub(1);
        if let Some(message_id) = message_id {
            if start_line <= end_line {
                message_ranges.push(ConversationMessageRenderRange {
                    message_id,
                    start_line,
                    end_line,
                });
            }
        }
        if idx + 1 < rendered_count {
            lines.push(Line::from(""));
        }
    }

    HistoryRenderResult {
        lines,
        message_ranges,
    }
}

pub(in crate::ui) fn should_prefer_persisted_subagent_status(app: &TuiViewModel) -> bool {
    let persisted_has_named_subagent_status = app
        .persisted_standalone_pending_aux
        .as_ref()
        .and_then(|aux| parse_pending_subagent_status_text(&aux.status_text))
        .is_some();
    let live_has_named_subagent_status = app
        .pending_aux_state()
        .and_then(|aux| parse_pending_subagent_status_text(&aux.status_text))
        .is_some();

    persisted_has_named_subagent_status && !live_has_named_subagent_status
}

pub(in crate::ui) fn effective_standalone_pending_aux(
    app: &TuiViewModel,
) -> Option<&PendingAssistantAux> {
    if should_prefer_persisted_subagent_status(app) {
        return app.persisted_standalone_pending_aux.as_ref();
    }

    app.pending_aux_state()
        .or(app.persisted_standalone_pending_aux.as_ref())
}

pub(in crate::ui) fn standalone_pending_aux_insert_before_message_index(
    app: &TuiViewModel,
    start_index: usize,
    visible_message_count: usize,
) -> Option<usize> {
    if !should_prefer_persisted_subagent_status(app) {
        return None;
    }

    if let Some(index) = app
        .persisted_standalone_pending_aux_anchor
        .or(app.pending_assistant_msg_index)
    {
        if index < start_index || index >= start_index.saturating_add(visible_message_count) {
            return None;
        }

        return Some(index);
    }

    if visible_message_count == 0 {
        return None;
    }

    Some(start_index + visible_message_count - 1)
}

pub(in crate::ui) fn should_render_standalone_pending_aux(
    app: &TuiViewModel,
    start_index: usize,
    visible_message_count: usize,
) -> bool {
    if effective_standalone_pending_aux(app).is_none() {
        return false;
    }

    if should_prefer_persisted_subagent_status(app) {
        return match app.persisted_standalone_pending_aux_anchor {
            Some(index) => {
                index >= start_index && index < start_index.saturating_add(visible_message_count)
            }
            None => true,
        };
    }

    if app.pending_aux_state().is_none() {
        return true;
    }

    match app.pending_assistant_msg_index {
        Some(index) => {
            index < start_index || index >= start_index.saturating_add(visible_message_count)
        }
        None => true,
    }
}

pub(in crate::ui) fn should_hide_pending_assistant_placeholder(
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

pub(in crate::ui) fn message_prefix_text() -> &'static str {
    ">\u{00a0}"
}

pub(in crate::ui) fn message_gutter_padding() -> &'static str {
    "  "
}

pub(in crate::ui) fn assistant_message_prefix_style() -> Style {
    patch_style_foreground(
        Style::default()
            .fg(Color::Cyan)
            .add_modifier(Modifier::BOLD),
        cli_ui_accent_color(CliUiHookSlot::MessageAssistant),
    )
}

pub(in crate::ui) fn pending_aux_status_style(kind: AssistantAuxKind) -> Style {
    let base = match kind {
        AssistantAuxKind::Thinking => Style::default()
            .fg(Color::Yellow)
            .add_modifier(Modifier::ITALIC),
        AssistantAuxKind::Compressing => {
            assistant_message_prefix_style().add_modifier(Modifier::ITALIC)
        }
    };

    patch_style_foreground(
        base,
        cli_ui_foreground_color(CliUiHookSlot::AssistantThinking),
    )
}

pub(in crate::ui) fn assistant_aux_title(kind: AssistantAuxKind) -> String {
    match kind {
        AssistantAuxKind::Thinking => t!("ui.aux.thinking").into_owned(),
        AssistantAuxKind::Compressing => t!("ui.aux.compacting").into_owned(),
    }
}

pub(in crate::ui) fn assistant_aux_title_style(kind: AssistantAuxKind) -> Style {
    let base = match kind {
        AssistantAuxKind::Thinking => Style::default().fg(Color::DarkGray),
        AssistantAuxKind::Compressing => subtle_aux_text_style(),
    };

    patch_style_foreground(
        base,
        cli_ui_foreground_color(CliUiHookSlot::AssistantThinking),
    )
}

pub(in crate::ui) fn assistant_aux_body_style(kind: AssistantAuxKind) -> Style {
    let base = match kind {
        AssistantAuxKind::Thinking => Style::default().fg(Color::DarkGray),
        AssistantAuxKind::Compressing => subtle_aux_text_style(),
    };

    patch_style_foreground(
        base,
        cli_ui_foreground_color(CliUiHookSlot::AssistantThinking),
    )
}

pub(in crate::ui) fn is_tool_progress_only_text(text: &str) -> bool {
    let mut saw_line = false;
    for segment in text.lines().map(str::trim).filter(|line| !line.is_empty()) {
        saw_line = true;
        if !segment.starts_with("准备调用工具:") {
            return false;
        }
    }
    saw_line
}

pub(in crate::ui) fn should_render_aux_after_message_body(
    text: Option<&str>,
    has_message_body: bool,
) -> bool {
    has_message_body && text.is_some_and(is_tool_progress_only_text)
}

pub(in crate::ui) fn render_aux_text_lines(
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

pub(in crate::ui) fn render_pending_aux_lines(
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

pub(in crate::ui) fn render_standalone_pending_aux_lines(
    pending_aux: &PendingAssistantAux,
    show_aux_details: bool,
) -> Vec<Line<'static>> {
    let synthetic_subagent_status_text =
        parse_pending_subagent_status_text(&pending_aux.status_text);
    let detail_text = if synthetic_subagent_status_text.is_none() && show_aux_details {
        pending_aux.detail_text.as_deref()
    } else {
        None
    };
    let mut out = Vec::new();
    let mut has_rendered_visible_line = false;
    let mut push_message_line = |content_spans: Vec<Span<'static>>| {
        let mut spans = if has_rendered_visible_line {
            vec![Span::raw(message_gutter_padding())]
        } else {
            has_rendered_visible_line = true;
            vec![Span::styled(
                message_prefix_text(),
                assistant_message_prefix_style(),
            )]
        };
        spans.extend(content_spans);
        out.push(Line::from(spans));
    };

    if let Some(status_text) = synthetic_subagent_status_text {
        let mut iter = markdown_lines(&status_text).into_iter();
        if let Some(first) = iter.next() {
            push_message_line(first);
        }
        for line in iter {
            push_message_line(line);
        }
    } else {
        render_pending_aux_lines(&mut push_message_line, pending_aux, detail_text);
    }

    out
}

pub(in crate::ui) fn render_message_lines(
    app: &TuiViewModel,
    msg: &ChatMessage,
    message_index: usize,
) -> Vec<Line<'static>> {
    let message_id = message_index + 1;
    let selected_rewind_user_message =
        msg.role == MessageRole::User && app.is_rewind_selected_message(message_id);
    let rewind_deemphasized_message = should_rewind_deemphasize_message(app, message_id);
    let message_slot = match msg.role {
        MessageRole::User => CliUiHookSlot::MessageUser,
        MessageRole::Agent => CliUiHookSlot::MessageAssistant,
    };
    let prefix_style = match msg.role {
        MessageRole::User if selected_rewind_user_message => Style::default().fg(Color::White),
        MessageRole::User => patch_style_foreground(
            conversation_body_text_style(),
            cli_ui_accent_color(CliUiHookSlot::MessageUser),
        ),
        MessageRole::Agent => assistant_message_prefix_style(),
    };

    if let Some(ref tool) = msg.tool_block {
        return maybe_rewind_deemphasize_lines(
            render_tool_card_lines(prefix_style, tool, app.show_aux_details),
            rewind_deemphasized_message,
        );
    }

    let is_pending_assistant =
        msg.role == MessageRole::Agent && app.is_pending_assistant_message(message_index);

    let (message_body, embedded_thinking) = match msg.role {
        MessageRole::Agent => split_embedded_thinking_content(&msg.content),
        MessageRole::User => (msg.content.clone(), None),
    };

    let mut pending_aux = if is_pending_assistant {
        app.pending_aux_state()
    } else {
        None
    };
    let raw_pending_aux_status_text = pending_aux.map(|aux| aux.status_text.as_str());
    let synthetic_subagent_status_text = if message_body.trim().is_empty() {
        raw_pending_aux_status_text.and_then(parse_pending_subagent_status_text)
    } else {
        None
    };
    if synthetic_subagent_status_text.is_some() {
        pending_aux = None;
    }

    let effective_message_body = if !message_body.trim().is_empty() {
        message_body.clone()
    } else {
        synthetic_subagent_status_text.clone().unwrap_or_default()
    };
    let has_message_body = !effective_message_body.trim().is_empty();
    let content_lines = if has_message_body {
        match msg.role {
            MessageRole::User if selected_rewind_user_message => patch_lines_foreground(
                plain_text_lines(&effective_message_body),
                Some(Color::White),
            ),
            MessageRole::User => patch_lines_foreground(
                plain_text_lines(&effective_message_body),
                cli_ui_foreground_color(CliUiHookSlot::MessageUser),
            ),
            MessageRole::Agent => patch_lines_foreground(
                markdown_lines(&effective_message_body),
                cli_ui_foreground_color(CliUiHookSlot::MessageAssistant),
            ),
        }
    } else {
        Vec::new()
    };

    let mut out = Vec::new();
    let stored_aux = if synthetic_subagent_status_text.is_none()
        && msg.role == MessageRole::Agent
        && app.show_aux_details
    {
        app.assistant_aux_for_message(message_index)
    } else {
        None
    };
    let stored_compaction_text = stored_aux
        .and_then(|aux| aux.compaction.as_deref())
        .filter(|value| !value.trim().is_empty())
        .filter(|_| !matches!(pending_aux, Some(aux) if aux.kind == AssistantAuxKind::Compressing));
    let embedded_thinking_text = if msg.role == MessageRole::Agent && app.show_aux_details {
        embedded_thinking
            .as_deref()
            .filter(|value| !value.trim().is_empty())
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
    let pending_aux_detail_text =
        if synthetic_subagent_status_text.is_none() && app.show_aux_details {
            pending_aux.and_then(|aux| aux.detail_text.as_deref())
        } else {
            None
        };
    let render_stored_thinking_after_body =
        should_render_aux_after_message_body(stored_thinking_text, has_message_body);
    let render_pending_aux_after_body = pending_aux.is_some_and(|_| {
        should_render_aux_after_message_body(pending_aux_detail_text, has_message_body)
    });
    let slot_prefix = cli_ui_prefix(message_slot);
    let slot_suffix = cli_ui_suffix(message_slot);

    let mut has_rendered_visible_line = false;
    let mut push_message_line = |content_spans: Vec<Span<'static>>| {
        let mut spans = if has_rendered_visible_line {
            vec![Span::raw(message_gutter_padding())]
        } else {
            has_rendered_visible_line = true;
            vec![Span::styled(message_prefix_text(), prefix_style)]
        };
        if let Some(prefix) = slot_prefix.as_ref() {
            spans.push(Span::styled(prefix.clone(), prefix_style));
            spans.push(Span::raw(" "));
        }
        spans.extend(content_spans);
        if let Some(suffix) = slot_suffix.as_ref() {
            spans.push(Span::raw(" "));
            spans.push(Span::styled(suffix.clone(), prefix_style));
        }
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
            render_aux_text_lines(
                &mut push_message_line,
                AssistantAuxKind::Thinking,
                thinking_text,
            );
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
            render_aux_text_lines(
                &mut push_message_line,
                AssistantAuxKind::Thinking,
                thinking_text,
            );
        }
    }

    if let Some(pending_aux) = pending_aux {
        if render_pending_aux_after_body {
            render_pending_aux_lines(&mut push_message_line, pending_aux, pending_aux_detail_text);
        }
    }

    maybe_rewind_deemphasize_lines(out, rewind_deemphasized_message)
}

pub(in crate::ui) fn should_rewind_deemphasize_message(
    app: &TuiViewModel,
    message_id: usize,
) -> bool {
    app.rewind_picker.is_some()
        && !app.is_rewind_selected_message(message_id)
        && !app.is_rewind_selectable_message(message_id)
}

pub(in crate::ui) fn maybe_rewind_deemphasize_lines(
    lines: Vec<Line<'static>>,
    enabled: bool,
) -> Vec<Line<'static>> {
    if !enabled {
        return lines;
    }

    patch_lines_style(lines, |style| style.add_modifier(Modifier::DIM))
}

pub(in crate::ui) fn parse_pending_subagent_status_text(text: &str) -> Option<String> {
    let status = text
        .trim()
        .strip_prefix("| ")
        .or_else(|| text.trim().strip_prefix("/ "))
        .or_else(|| text.trim().strip_prefix("- "))
        .or_else(|| text.trim().strip_prefix("\\ "))
        .unwrap_or(text.trim())
        .trim();

    if status.is_empty() || status == "Thinking..." || status == "Compressing..." {
        return None;
    }

    Some(status.to_string())
}

pub(in crate::ui) fn split_embedded_thinking_content(text: &str) -> (String, Option<String>) {
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

pub(in crate::ui) fn tool_phase_label(phase: ToolUiPhase) -> (String, Color) {
    match phase {
        ToolUiPhase::PendingApproval => (
            t!("ui.tool.phase.pending_approval").into_owned(),
            Color::Yellow,
        ),
        ToolUiPhase::Running => (t!("ui.tool.phase.running").into_owned(), Color::Yellow),
        ToolUiPhase::Succeeded => (t!("ui.tool.phase.succeeded").into_owned(), Color::Green),
        ToolUiPhase::Failed => (t!("ui.tool.phase.failed").into_owned(), Color::Red),
    }
}

pub(in crate::ui) fn render_tool_card_lines(
    prefix_style: Style,
    tool: &ToolUiBlock,
    show_aux_details: bool,
) -> Vec<Line<'static>> {
    let (phase_label, phase_color) = tool_phase_label(tool.phase);
    let rail = patch_style_foreground(
        Style::default().fg(Color::Rgb(96, 110, 130)),
        cli_ui_border_color(CliUiHookSlot::MessageTool)
            .or(cli_ui_accent_color(CliUiHookSlot::MessageTool)),
    );
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
            patch_style_foreground(
                Style::default()
                    .fg(Color::Magenta)
                    .add_modifier(Modifier::BOLD),
                cli_ui_accent_color(CliUiHookSlot::MessageTool),
            ),
        ),
        Span::styled(
            tool.tool_name.clone(),
            patch_style_foreground(
                Style::default()
                    .fg(Color::Rgb(170, 170, 170))
                    .add_modifier(Modifier::BOLD),
                cli_ui_foreground_color(CliUiHookSlot::MessageTool),
            ),
        ),
        Span::raw(" · "),
        Span::styled(
            phase_label.to_string(),
            patch_style_foreground(
                Style::default()
                    .fg(phase_color)
                    .add_modifier(Modifier::BOLD),
                cli_ui_accent_color(CliUiHookSlot::MessageTool),
            ),
        ),
    ];
    if let Some(prefix) = cli_ui_prefix(CliUiHookSlot::MessageTool) {
        title_spans.push(Span::raw(" "));
        title_spans.push(Span::styled(prefix, prefix_style));
    }
    if let Some(suffix) = cli_ui_suffix(CliUiHookSlot::MessageTool) {
        title_spans.push(Span::raw(" "));
        title_spans.push(Span::styled(suffix, prefix_style));
    }
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
            patch_style_foreground(
                Style::default()
                    .fg(Color::Rgb(170, 170, 170))
                    .add_modifier(Modifier::BOLD),
                cli_ui_foreground_color(CliUiHookSlot::MessageTool),
            ),
        ),
    ]));

    for line in &tool.detail_lines {
        if line.is_empty() {
            continue;
        }
        out.push(Line::from(vec![
            Span::raw(indent),
            Span::styled(rail_sym, rail),
            Span::styled(
                line.clone(),
                patch_style_foreground(
                    Style::default().fg(Color::Rgb(190, 195, 205)),
                    cli_ui_foreground_color(CliUiHookSlot::MessageTool),
                ),
            ),
        ]));
    }

    if expand_details {
        if let Some(ref args) = tool.args_excerpt {
            if !args.trim().is_empty() {
                out.push(Line::from(vec![
                    Span::raw(indent),
                    Span::styled(rail_sym, rail),
                    Span::styled(
                        t!("ui.tool.args_json").into_owned(),
                        Style::default().fg(Color::DarkGray),
                    ),
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
                    Span::styled(
                        t!("ui.tool.output").into_owned(),
                        Style::default().fg(Color::DarkGray),
                    ),
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
                            t!(
                                "ui.tool.more_lines_hidden",
                                count = total_ln.saturating_sub(48)
                            )
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

pub(in crate::ui) fn plain_text_lines(text: &str) -> Vec<Vec<Span<'static>>> {
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

pub(in crate::ui) fn visible_messages(app: &TuiViewModel) -> (&[ChatMessage], usize, usize) {
    (
        &app.messages,
        app.history_truncated_before,
        app.history_truncated_before,
    )
}
