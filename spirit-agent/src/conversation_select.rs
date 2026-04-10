//! 对话区折行、选区归一化与按「显示列」切片——使用 ratatui 公开 API（WordWrapper）。

use ratatui::{
    layout::Alignment,
    style::{Modifier, Style},
    text::{Line, Span, StyledGrapheme},
};
use unicode_width::{UnicodeWidthChar, UnicodeWidthStr};

use crate::word_wrap::{LineComposer, WordWrapper};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct CellPointer {
    pub line: usize,
    pub col: usize,
}

#[derive(Clone, Copy, Debug)]
pub struct NormRange {
    pub line_start: usize,
    pub col_start: usize,
    pub line_end: usize,
    /// 最后一列的 **不包含** 上界（显示列坐标）。
    pub col_end_excl: usize,
}

pub fn normalize_selection(a: CellPointer, b: CellPointer) -> NormRange {
    let (start, end) = if (a.line, a.col) <= (b.line, b.col) {
        (a, b)
    } else {
        (b, a)
    };
    NormRange {
        line_start: start.line,
        col_start: start.col,
        line_end: end.line,
        col_end_excl: end.col.saturating_add(1),
    }
}

impl NormRange {
    pub fn covers_grapheme(self, row: usize, g_col: usize, g_width: usize) -> bool {
        if row < self.line_start || row > self.line_end {
            return false;
        }
        let g_end = g_col.saturating_add(g_width);
        if self.line_start == self.line_end {
            return g_col < self.col_end_excl && g_end > self.col_start;
        }
        if row == self.line_start {
            return g_end > self.col_start;
        }
        if row == self.line_end {
            return g_col < self.col_end_excl;
        }
        true
    }
}

fn grapheme_line_to_owned(
    line: &[StyledGrapheme<'_>],
    row: usize,
    sel: Option<NormRange>,
) -> Line<'static> {
    let mut spans: Vec<Span<'static>> = Vec::new();
    let mut col = 0usize;
    for g in line {
        let w = g.symbol.width();
        let rev = sel.is_some_and(|s| s.covers_grapheme(row, col, w));
        let st = if rev {
            g.style.add_modifier(Modifier::REVERSED)
        } else {
            g.style
        };
        spans.push(Span::styled(g.symbol.to_string(), st));
        col += w;
    }
    Line::from(spans)
}

fn graphemes_to_plain(line: &[StyledGrapheme<'_>]) -> String {
    line.iter()
        .map(|g| if g.symbol == "\u{00a0}" { " " } else { g.symbol })
        .collect()
}

#[derive(Clone, Debug, Default)]
struct HangingIndent {
    spans: Vec<Span<'static>>,
    plain: String,
}

fn display_space_for_width(width: usize) -> String {
    " ".repeat(width.max(1))
}

fn is_display_space(symbol: &str) -> bool {
    symbol == "\u{00a0}" || symbol.chars().all(char::is_whitespace)
}

fn build_hanging_indent(line: &[StyledGrapheme<'_>]) -> HangingIndent {
    let mut indent = HangingIndent::default();

    if let Some(first) = line.first().filter(|g| g.symbol == ">") {
        let space = display_space_for_width(first.symbol.width());
        indent.plain.push_str(&space);
        indent.spans.push(Span::styled(space, first.style));

        for grapheme in line.iter().skip(1) {
            if !is_display_space(grapheme.symbol) {
                break;
            }

            let space = display_space_for_width(grapheme.symbol.width());
            indent.plain.push_str(&space);
            indent.spans.push(Span::styled(space, grapheme.style));
        }

        return indent;
    }

    for grapheme in line {
        if !is_display_space(grapheme.symbol) {
            break;
        }

        let space = display_space_for_width(grapheme.symbol.width());
        indent.plain.push_str(&space);
        indent.spans.push(Span::styled(space, grapheme.style));
    }

    indent
}

fn prepend_hanging_indent(
    line: Line<'static>,
    plain: String,
    indent: &HangingIndent,
) -> (Line<'static>, String) {
    if indent.spans.is_empty() {
        return (line, plain);
    }

    let mut spans = indent.spans.clone();
    spans.extend(line.spans);
    (Line::from(spans), format!("{}{}", indent.plain, plain))
}

/// 与 `Paragraph::wrap(Wrap { trim: false })` 相同管线：按宽度折成若干视口行。
pub fn flatten_wrapped_history(
    logical_lines: Vec<Line<'static>>,
    width: u16,
    sel: Option<NormRange>,
) -> (Vec<Line<'static>>, Vec<String>) {
    let mut out_lines = Vec::new();
    let mut plain_rows = Vec::new();
    let mut row = 0usize;

    for line in logical_lines {
        let alignment = line.alignment.unwrap_or(Alignment::Left);
        let graphemes = line
            .styled_graphemes(Style::default())
            .collect::<Vec<_>>();
        let indent = build_hanging_indent(&graphemes);
        let mut composer = WordWrapper::new(std::iter::once((graphemes.into_iter(), alignment)), width, false);
        let mut visual_index = 0usize;

        while let Some(wl) = composer.next_line() {
            let line_plain = graphemes_to_plain(wl.line);
            let display_line = grapheme_line_to_owned(wl.line, row, sel);
            let (display_line, line_plain) = if visual_index == 0 {
                (display_line, line_plain)
            } else {
                prepend_hanging_indent(display_line, line_plain, &indent)
            };

            plain_rows.push(line_plain);
            out_lines.push(display_line);
            row += 1;
            visual_index += 1;
        }
    }

    (out_lines, plain_rows)
}

fn slice_row_by_display_cols(row: &str, start: usize, end_excl: usize) -> String {
    let mut out = String::new();
    let mut col = 0usize;
    for ch in row.chars() {
        let w = UnicodeWidthChar::width(ch).unwrap_or(0);
        let c0 = col;
        let c1 = col.saturating_add(w);
        if c1 > start && c0 < end_excl {
            out.push(ch);
        }
        col = c1;
    }
    out
}

pub fn selection_plain_text(rows: &[String], sel: NormRange) -> String {
    let mut chunks: Vec<String> = Vec::new();
    for line_idx in sel.line_start..=sel.line_end {
        let Some(row) = rows.get(line_idx) else {
            break;
        };
        let cs = if line_idx == sel.line_start {
            sel.col_start
        } else {
            0
        };
        let ce = if line_idx == sel.line_end {
            sel.col_end_excl
        } else {
            usize::MAX
        };
        chunks.push(slice_row_by_display_cols(row, cs, ce));
    }
    chunks.join("\n")
}
