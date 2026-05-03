use comrak::{
    nodes::{AstNode, ListType, NodeValue},
    parse_document, Arena, Options,
};
use ratatui::{
    style::{Color, Modifier, Style},
    text::{Line, Span},
};
use std::{cell::RefCell, collections::HashMap};

use super::theme::conversation_body_text_style;

thread_local! {
    static MARKDOWN_CACHE: RefCell<HashMap<String, Vec<Vec<Span<'static>>>>> =
        RefCell::new(HashMap::new());
}

pub(in crate::ui) fn markdown_lines(text: &str) -> Vec<Vec<Span<'static>>> {
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

/// 扩展详情 README：复用 Markdown AST，但强制灰阶以匹配终端黑白灰审美。
pub(in crate::ui) fn marketplace_markdown_lines(text: &str) -> Vec<Line<'static>> {
    markdown_lines(text)
        .into_iter()
        .map(|row| {
            Line::from(
                row.into_iter()
                    .map(marketplace_grayscale_span)
                    .collect::<Vec<_>>(),
            )
        })
        .collect()
}

fn marketplace_grayscale_span(span: Span<'static>) -> Span<'static> {
    let content = span.content;
    let st = span.style;
    let m = st.add_modifier;
    let looks_inline_code = content.starts_with('`') && content.ends_with('`');
    let fg = if m.contains(Modifier::BOLD) && m.contains(Modifier::UNDERLINED) {
        Color::Rgb(238, 238, 238)
    } else if m.contains(Modifier::BOLD) {
        Color::Rgb(215, 215, 215)
    } else if looks_inline_code {
        Color::Rgb(190, 190, 190)
    } else if m.contains(Modifier::ITALIC) {
        Color::Rgb(155, 155, 155)
    } else {
        Color::Rgb(168, 168, 168)
    };
    let mut keep = Modifier::empty();
    for flag in [
        Modifier::BOLD,
        Modifier::ITALIC,
        Modifier::UNDERLINED,
        Modifier::CROSSED_OUT,
    ] {
        if m.contains(flag) {
            keep |= flag;
        }
    }
    Span::styled(content, Style::default().fg(fg).add_modifier(keep))
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
