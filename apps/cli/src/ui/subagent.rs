use super::conversation::*;
use super::*;

pub(in crate::ui) fn draw_subagent_viewer(
    frame: &mut ratatui::Frame<'_>,
    area: Rect,
    view: &SubagentSessionDetailView,
    offset_from_bottom: usize,
    show_aux_details: bool,
    pending_subagent_approval: Option<&PendingSubagentApprovalView>,
    approval_input: Option<&SubagentApprovalInputView>,
) -> Option<usize> {
    let popup = area;
    frame.render_widget(Clear, popup);

    let approval_panel_slot = CliUiHookSlot::ApprovalPanel;
    let panel_border_style = patch_style_border(
        conversation_body_text_style(),
        cli_ui_border_color(approval_panel_slot).or(cli_ui_accent_color(approval_panel_slot)),
    );
    let panel_title_style = patch_style_foreground(
        subtle_aux_text_style(),
        cli_ui_foreground_color(approval_panel_slot).or(cli_ui_accent_color(approval_panel_slot)),
    );
    let panel_prefix = cli_ui_prefix(approval_panel_slot);
    let panel_suffix = cli_ui_suffix(approval_panel_slot);
    let mut title_spans = Vec::new();
    if let Some(prefix) = panel_prefix.as_ref() {
        title_spans.push(Span::styled(prefix.clone(), panel_title_style));
        title_spans.push(Span::raw(" "));
    }
    title_spans.push(Span::styled(
        format!("SubAgent: {}", view.summary.title),
        panel_title_style,
    ));
    if let Some(suffix) = panel_suffix.as_ref() {
        title_spans.push(Span::raw(" "));
        title_spans.push(Span::styled(suffix.clone(), panel_title_style));
    }

    let block = Block::default()
        .borders(Borders::ALL)
        .border_style(panel_border_style)
        .title(Line::from(title_spans));
    frame.render_widget(block.clone(), popup);

    let inner = block.inner(popup);
    let active_approval =
        pending_subagent_approval.filter(|approval| approval.session_id == view.summary.session_id);
    let approval_input_height = approval_input
        .map(|input| {
            (input_visual_line_count(&input.value, inner.width.saturating_sub(2) as usize)
                .max(1)
                .saturating_add(2)) as u16
        })
        .unwrap_or(0)
        .clamp(3, 6);
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints(if approval_input.is_some() {
            vec![
                Constraint::Length(3),
                Constraint::Min(1),
                Constraint::Length(approval_input_height),
                Constraint::Length(2),
            ]
        } else {
            vec![
                Constraint::Length(3),
                Constraint::Min(1),
                Constraint::Length(2),
            ]
        })
        .split(inner);
    let history_chunk = chunks[1];
    let approval_chunk = if approval_input.is_some() {
        chunks.get(2).copied()
    } else {
        None
    };
    let footer_chunk = if approval_input.is_some() {
        chunks[3]
    } else {
        chunks[2]
    };

    let (status_label, status_style) = subagent_status_badge(view.summary.status, false);
    let mut header_lines = vec![Line::from(vec![
        Span::styled(
            "状态: ",
            patch_style_foreground(
                subtle_aux_text_style(),
                cli_ui_foreground_color(approval_panel_slot),
            ),
        ),
        Span::styled(
            status_label.to_string(),
            patch_style_foreground(status_style, cli_ui_accent_color(approval_panel_slot)),
        ),
        Span::styled(
            format!("   sessionId: {}", view.summary.session_id),
            patch_style_foreground(
                subtle_aux_text_style(),
                cli_ui_foreground_color(approval_panel_slot),
            ),
        ),
    ])];

    if let Some(latest) = view.summary.latest_message.as_deref() {
        header_lines.push(Line::from(Span::styled(
            truncate_to_width(
                &format!("最新进展: {}", latest),
                chunks[0].width.saturating_sub(1) as usize,
            ),
            patch_style_foreground(
                subtle_aux_text_style(),
                cli_ui_foreground_color(approval_panel_slot),
            ),
        )));
    }

    frame.render_widget(
        Paragraph::new(header_lines).wrap(Wrap { trim: true }),
        chunks[0],
    );

    let history_lines = build_subagent_history_lines(view, show_aux_details);
    let (flat, _) = flatten_wrapped_history(history_lines, history_chunk.width.max(1), None);
    let history_view_height = history_chunk.height.max(1) as usize;
    let max_scroll = flat.len().saturating_sub(history_view_height);
    let offset_bottom = offset_from_bottom.min(max_scroll);
    let history_scroll = max_scroll.saturating_sub(offset_bottom);
    let visible = flat
        .into_iter()
        .skip(history_scroll)
        .take(history_view_height)
        .collect::<Vec<_>>();
    frame.render_widget(Paragraph::new(visible), history_chunk);

    if let (Some(editor), Some(editor_area), Some(approval)) =
        (approval_input, approval_chunk, active_approval)
    {
        let editor_lines =
            wrap_editor_text_lines(&editor.value, editor_area.width.saturating_sub(2) as usize)
                .into_iter()
                .map(Line::from)
                .collect::<Vec<_>>();
        let editor_widget = Paragraph::new(editor_lines).block(
            Block::default()
                .borders(Borders::ALL)
                .border_style(patch_style_border(
                    Style::default().fg(Color::Yellow),
                    cli_ui_border_color(approval_panel_slot)
                        .or(cli_ui_accent_color(approval_panel_slot)),
                ))
                .title(Line::from(Span::styled(
                    format!("审批意见: {}", approval.tool_name),
                    panel_title_style,
                ))),
        );
        frame.render_widget(editor_widget, editor_area);

        let prefix: String = editor.value.chars().take(editor.cursor).collect();
        let (cursor_row, cursor_col) =
            wrapped_text_cursor_position(&prefix, editor_area.width.saturating_sub(2) as usize);
        frame.set_cursor_position((
            editor_area.x + 1 + cursor_col as u16,
            editor_area.y + 1 + cursor_row as u16,
        ));
    }

    let footer_text = if active_approval.is_some() && approval_input.is_some() {
        "Esc 取消输入  |  Enter 提交意见  |  Y 允许  |  N 拒绝  |  T 信任  |  Ctrl+O 详情"
            .to_string()
    } else if active_approval.is_some() {
        "Esc 关闭  |  Enter 输入意见  |  Y 允许  |  N 拒绝  |  T 信任  |  Ctrl+O 详情  |  滚轮 / PgUp/PgDn 滚动".to_string()
    } else if let Some(error) = view.error.as_deref() {
        format!(
            "Esc 关闭  |  Ctrl+O 详情  |  滚轮 / PgUp/PgDn 滚动  |  {}",
            truncate_to_width(error, footer_chunk.width.saturating_sub(32) as usize)
        )
    } else if let Some(output) = view.final_output.as_deref() {
        format!(
            "Esc 关闭  |  Ctrl+O 详情  |  滚轮 / PgUp/PgDn 滚动  |  {}",
            truncate_to_width(output, footer_chunk.width.saturating_sub(32) as usize)
        )
    } else {
        "Esc 关闭  |  Ctrl+O 详情  |  滚轮 / PgUp/PgDn 滚动".to_string()
    };
    frame.render_widget(
        Paragraph::new(Line::from(Span::styled(
            footer_text,
            patch_style_foreground(
                subtle_aux_text_style(),
                cli_ui_foreground_color(approval_panel_slot),
            ),
        ))),
        footer_chunk,
    );

    Some(offset_bottom)
}

pub(in crate::ui) fn build_subagent_history_lines(
    view: &SubagentSessionDetailView,
    show_aux_details: bool,
) -> Vec<Line<'static>> {
    let messages = &view.messages;
    if messages.is_empty() {
        if let Some(pending_aux) = view.pending_aux.as_ref() {
            return render_subagent_pending_aux_lines(pending_aux, show_aux_details);
        }

        return vec![Line::from(Span::styled(
            "子会话尚未产生可见消息。",
            subtle_aux_text_style(),
        ))];
    }

    let mut lines = Vec::new();
    let rendered_count = messages.len();
    for (idx, msg) in messages.iter().enumerate() {
        let rendered = render_subagent_message_lines(msg, show_aux_details);
        lines.extend(rendered);
        if idx + 1 < rendered_count {
            lines.push(Line::from(""));
        }
    }

    if let Some(pending_aux) = view.pending_aux.as_ref() {
        if !lines.is_empty() {
            lines.push(Line::from(""));
        }
        lines.extend(render_subagent_pending_aux_lines(
            pending_aux,
            show_aux_details,
        ));
    }

    lines
}

pub(in crate::ui) fn render_subagent_pending_aux_lines(
    pending_aux: &PendingAssistantAux,
    show_aux_details: bool,
) -> Vec<Line<'static>> {
    let detail_text = if show_aux_details {
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

    render_pending_aux_lines(&mut push_message_line, pending_aux, detail_text);
    out
}

pub(in crate::ui) fn render_subagent_message_lines(
    msg: &ChatMessage,
    show_aux_details: bool,
) -> Vec<Line<'static>> {
    let prefix_style = match msg.role {
        MessageRole::User => conversation_body_text_style(),
        MessageRole::Agent => assistant_message_prefix_style(),
    };

    if let Some(ref tool) = msg.tool_block {
        return render_tool_card_lines(prefix_style, tool, show_aux_details);
    }

    let content_lines = match msg.role {
        MessageRole::User => plain_text_lines(&msg.content),
        MessageRole::Agent => markdown_lines(&msg.content),
    };

    let mut out = Vec::new();
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

    let mut iter = content_lines.into_iter();
    if let Some(first) = iter.next() {
        push_message_line(first);
    } else if msg.role == MessageRole::User {
        push_message_line(Vec::new());
    }

    for line in iter {
        push_message_line(line);
    }

    out
}

pub(in crate::ui) fn subagent_status_badge(
    status: SubagentSessionStatus,
    selected: bool,
) -> (String, Style) {
    let base = match status {
        SubagentSessionStatus::Running => Style::default().fg(Color::Yellow),
        SubagentSessionStatus::Completed => Style::default().fg(Color::Green),
        SubagentSessionStatus::Failed => Style::default().fg(Color::Red),
        SubagentSessionStatus::Blocked => Style::default().fg(Color::LightYellow),
    };
    let style = if selected {
        base.add_modifier(Modifier::BOLD | Modifier::REVERSED)
    } else {
        base.add_modifier(Modifier::BOLD)
    };
    let label = match status {
        SubagentSessionStatus::Running => "running",
        SubagentSessionStatus::Completed => "completed",
        SubagentSessionStatus::Failed => "failed",
        SubagentSessionStatus::Blocked => "blocked",
    };
    (label.to_string(), style)
}
