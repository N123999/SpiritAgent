use super::TuiShell;
use crate::{
    conversation_select::{normalize_selection, selection_plain_text, CellPointer},
    ui::{ConversationMessageRenderRange, UiRenderFeedback},
    view::ConversationPanelHit,
};

#[derive(Default)]
pub(crate) struct ConversationUiState {
    pub(crate) history_offset_from_bottom: usize,
    pub(crate) sel_anchor: Option<(usize, usize)>,
    pub(crate) sel_head: Option<(usize, usize)>,
    dragging: bool,
    panel_hit: Option<ConversationPanelHit>,
    plain_rows: Vec<String>,
    message_ranges: Vec<ConversationMessageRenderRange>,
}

impl ConversationUiState {
    pub(crate) fn note_panel(
        &mut self,
        hit: ConversationPanelHit,
        plain_rows: Vec<String>,
        message_ranges: Vec<ConversationMessageRenderRange>,
    ) {
        self.panel_hit = Some(hit);
        self.plain_rows = plain_rows;
        self.message_ranges = message_ranges;
        let max_line = hit.total_lines.saturating_sub(1);
        self.sync_selection_to_bounds(max_line);
    }

    pub(crate) fn anchor_rewind_message_to_current_row(
        &mut self,
        current_message_id: usize,
        next_message_id: usize,
    ) {
        let Some(hit) = self.panel_hit else {
            return;
        };

        let view_height = hit.h.max(1) as usize;
        let max_scroll = hit.total_lines.saturating_sub(view_height);
        let current_offset = self.history_offset_from_bottom.min(max_scroll);
        let current_top_line = max_scroll.saturating_sub(current_offset);
        let anchor_row = self
            .message_start_line(current_message_id)
            .map(|line| line.saturating_sub(current_top_line))
            .filter(|row| *row < view_height)
            .unwrap_or_else(|| view_height.saturating_sub(1));
        let Some(next_start_line) = self.message_start_line(next_message_id) else {
            return;
        };
        let next_top_line = next_start_line.saturating_sub(anchor_row).min(max_scroll);
        self.history_offset_from_bottom = max_scroll.saturating_sub(next_top_line);
    }

    pub(crate) fn clear_selection(&mut self) {
        self.sel_anchor = None;
        self.sel_head = None;
        self.dragging = false;
    }

    pub(crate) fn pointer_from_mouse(&self, column: u16, row: u16) -> Option<(usize, usize)> {
        let hit = self.panel_hit?;
        if column < hit.x || column >= hit.x.saturating_add(hit.w) {
            return None;
        }
        if row < hit.y || row >= hit.y.saturating_add(hit.h) {
            return None;
        }
        let col = (column - hit.x) as usize;
        let vrow = (row - hit.y) as usize;
        let gline = hit.scroll + vrow;
        if gline >= hit.total_lines {
            return None;
        }
        Some((gline, col))
    }

    pub(crate) fn left_down(&mut self, column: u16, row: u16) {
        let Some((line, col)) = self.pointer_from_mouse(column, row) else {
            self.clear_selection();
            return;
        };
        self.sel_anchor = Some((line, col));
        self.sel_head = Some((line, col));
        self.dragging = true;
    }

    pub(crate) fn left_drag(&mut self, column: u16, row: u16) {
        if !self.dragging {
            return;
        }
        let Some((line, col)) = self.pointer_from_mouse(column, row) else {
            return;
        };
        self.sel_head = Some((line, col));
    }

    pub(crate) fn left_up(&mut self) {
        self.dragging = false;
    }

    pub(crate) fn copy_selection(&mut self) -> Result<(), String> {
        let (Some(a), Some(b)) = (self.sel_anchor, self.sel_head) else {
            return Ok(());
        };
        let max_line = self.plain_rows.len().saturating_sub(1);
        let clamp = |(l, c): (usize, usize)| (l.min(max_line), c);
        let a = CellPointer {
            line: clamp(a).0,
            col: a.1,
        };
        let b = CellPointer {
            line: clamp(b).0,
            col: b.1,
        };
        let norm = normalize_selection(a, b);
        let text = selection_plain_text(&self.plain_rows, norm);
        if text.is_empty() {
            return Ok(());
        }
        arboard::Clipboard::new()
            .map_err(|e| e.to_string())?
            .set_text(text)
            .map_err(|e| e.to_string())?;
        self.clear_selection();
        Ok(())
    }

    fn sync_selection_to_bounds(&mut self, max_line: usize) {
        let clamp = |(l, c): (usize, usize)| (l.min(max_line), c);
        if let Some(point) = &mut self.sel_anchor {
            *point = clamp(*point);
        }
        if let Some(point) = &mut self.sel_head {
            *point = clamp(*point);
        }
    }

    fn message_start_line(&self, message_id: usize) -> Option<usize> {
        self.message_ranges
            .iter()
            .find(|range| range.message_id == message_id)
            .map(|range| range.start_line)
    }
}
impl TuiShell {
    pub fn note_conversation_panel(
        &mut self,
        hit: ConversationPanelHit,
        plain_rows: Vec<String>,
        message_ranges: Vec<ConversationMessageRenderRange>,
    ) {
        self.conversation.note_panel(hit, plain_rows, message_ranges);
    }

    pub fn apply_render_feedback(&mut self, feedback: UiRenderFeedback) {
        if let Some(conversation) = feedback.conversation_panel {
            self.conversation.history_offset_from_bottom = conversation.history_offset_from_bottom;
            self.note_conversation_panel(
                conversation.hit,
                conversation.plain_rows,
                conversation.message_ranges,
            );
        }

        if let Some(scroll_offset) = feedback.bottom_form_scroll_offset {
            self.sync_active_bottom_form_scroll(scroll_offset);
        }

        if let Some(offset) = feedback.subagent_history_offset_from_bottom {
            self.subagent.history_offset_from_bottom = offset;
        }
    }

    pub fn clear_conversation_selection(&mut self) {
        self.conversation.clear_selection();
    }

    /// `column`, `row`：crossterm 终端坐标（与 ratatui 一致）。
    pub fn conversation_pointer_from_mouse(&self, column: u16, row: u16) -> Option<(usize, usize)> {
        self.conversation.pointer_from_mouse(column, row)
    }

    pub fn conversation_left_down(&mut self, column: u16, row: u16) {
        self.conversation.left_down(column, row);
    }

    pub fn conversation_left_drag(&mut self, column: u16, row: u16) {
        self.conversation.left_drag(column, row);
    }

    pub fn conversation_left_up(&mut self) {
        self.conversation.left_up();
    }

    pub fn copy_conversation_selection(&mut self) -> Result<(), String> {
        self.conversation.copy_selection()
    }

    pub fn scroll_history_up(&mut self, lines: usize) {
        self.conversation.history_offset_from_bottom = self
            .conversation
            .history_offset_from_bottom
            .saturating_add(lines);
    }

    pub fn scroll_history_down(&mut self, lines: usize) {
        self.conversation.history_offset_from_bottom = self
            .conversation
            .history_offset_from_bottom
            .saturating_sub(lines);
    }

    pub fn scroll_history_to_top(&mut self) {
        self.conversation.history_offset_from_bottom = usize::MAX;
    }

    pub fn scroll_history_to_bottom(&mut self) {
        self.conversation.history_offset_from_bottom = 0;
    }
}

#[cfg(test)]
mod tests {
    use super::ConversationUiState;
    use crate::{
        ui::ConversationMessageRenderRange,
        view::ConversationPanelHit,
    };

    #[test]
    fn rewind_anchor_preserves_selected_row_across_large_message_gaps() {
        let mut state = ConversationUiState {
            history_offset_from_bottom: 60,
            ..ConversationUiState::default()
        };
        state.note_panel(
            ConversationPanelHit {
                x: 0,
                y: 0,
                w: 80,
                h: 20,
                scroll: 20,
                total_lines: 100,
            },
            Vec::new(),
            vec![
                ConversationMessageRenderRange {
                    message_id: 2,
                    start_line: 25,
                    end_line: 25,
                },
                ConversationMessageRenderRange {
                    message_id: 4,
                    start_line: 60,
                    end_line: 60,
                },
            ],
        );

        state.anchor_rewind_message_to_current_row(2, 4);

        let max_scroll = 100usize.saturating_sub(20);
        let next_top_line = max_scroll.saturating_sub(state.history_offset_from_bottom);

        assert_eq!(next_top_line, 55);
        assert_eq!(60usize.saturating_sub(next_top_line), 5);
    }
}
