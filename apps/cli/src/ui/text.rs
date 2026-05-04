use ratatui::layout::Rect;
use unicode_width::{UnicodeWidthChar, UnicodeWidthStr};

pub(in crate::ui) fn input_visual_line_count(text: &str, max_width: usize) -> usize {
    wrap_editor_text_lines(text, max_width).len().max(1)
}

pub(in crate::ui) fn wrapped_text_cursor_position(text: &str, max_width: usize) -> (usize, usize) {
    let visual_lines = wrap_editor_text_lines(text, max_width);
    let row = visual_lines.len().saturating_sub(1);
    let col = visual_lines
        .last()
        .map(|line| UnicodeWidthStr::width(line.as_str()))
        .unwrap_or(0);
    (row, col)
}

pub(in crate::ui) fn wrap_editor_text_lines(text: &str, max_width: usize) -> Vec<String> {
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

        lines.last_mut().expect("wrap_editor_text_lines").push(ch);

        if ch_width > 0 {
            col += ch_width;
        }
    }

    if !text.is_empty() && col == width {
        lines.push(String::new());
    }

    lines
}

pub(in crate::ui) fn truncate_to_width(text: &str, max_width: usize) -> String {
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

pub(in crate::ui) fn clip_to_width(text: &str, max_width: usize) -> String {
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

pub(in crate::ui) fn pad_right_to_width(text: &str, width: usize) -> String {
    let used = UnicodeWidthStr::width(text);
    if used >= width {
        return text.to_string();
    }
    format!("{}{}", text, " ".repeat(width - used))
}

pub(in crate::ui) fn build_logo_top_border(inner_width: usize, title: &str) -> String {
    if inner_width == 0 {
        return String::new();
    }

    let title_width = UnicodeWidthStr::width(title);
    if title_width >= inner_width {
        return format!("┌{}┐", "─".repeat(inner_width));
    }

    format!("┌{}{}┐", title, "─".repeat(inner_width - title_width))
}

pub(in crate::ui) fn truncate_from_left_to_width(text: &str, max_width: usize) -> String {
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
        if used_width + ch_width > max_width {
            break;
        }
        collected.push(ch);
        used_width += ch_width;
    }
    collected.reverse();

    format!("…{}", collected.into_iter().collect::<String>())
}

pub(in crate::ui) fn inset_rect(area: Rect, horizontal: u16, vertical: u16) -> Rect {
    let double_h = horizontal.saturating_mul(2);
    let double_v = vertical.saturating_mul(2);
    Rect {
        x: area.x.saturating_add(horizontal.min(area.width)),
        y: area.y.saturating_add(vertical.min(area.height)),
        width: area.width.saturating_sub(double_h),
        height: area.height.saturating_sub(double_v),
    }
}
