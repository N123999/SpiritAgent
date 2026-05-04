use super::*;

pub(in crate::ui) fn marketplace_review_label(status: &str) -> &'static str {
    match status.trim() {
        "verified" => "已验证",
        "revoked" => "已撤销",
        _ => "未验证",
    }
}

pub(in crate::ui) fn marketplace_channel_label(channel: &str) -> String {
    match channel.trim() {
        "stable" => "稳定".to_string(),
        "preview" => "预览".to_string(),
        "experimental" => "实验".to_string(),
        other => other.to_string(),
    }
}

pub(in crate::ui) fn draw_marketplace_view(
    frame: &mut ratatui::Frame<'_>,
    area: Rect,
    view: &MarketplaceViewModel,
) {
    frame.render_widget(Clear, area);
    match view.step {
        crate::view::MarketplaceFlowStep::CatalogPicker => {
            draw_marketplace_catalog_picker(frame, area, view);
        }
        _ => draw_marketplace_detail_page(frame, area, view),
    }
}

pub(in crate::ui) fn marketplace_panel_height(
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

pub(in crate::ui) fn draw_marketplace_catalog_picker(
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

pub(in crate::ui) fn draw_marketplace_detail_page(
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

pub(in crate::ui) fn render_marketplace_overview(
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

pub(in crate::ui) fn render_marketplace_readme(
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

pub(in crate::ui) fn draw_slash_flow_panel(
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

pub(in crate::ui) fn draw_slash_flow_body(
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

pub(in crate::ui) fn build_slash_flow_lines(
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

pub(in crate::ui) fn review_status_style(status: &str) -> Style {
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
