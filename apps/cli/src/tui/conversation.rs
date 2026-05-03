use super::TuiShell;
use crate::{
    conversation_select::{normalize_selection, selection_plain_text, CellPointer},
    ui::UiRenderFeedback,
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
}

impl ConversationUiState {
    pub(crate) fn note_panel(&mut self, hit: ConversationPanelHit, plain_rows: Vec<String>) {
        self.panel_hit = Some(hit);
        self.plain_rows = plain_rows;
        let max_line = hit.total_lines.saturating_sub(1);
        self.sync_selection_to_bounds(max_line);
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
}
impl TuiShell {
    pub fn note_conversation_panel(&mut self, hit: ConversationPanelHit, plain_rows: Vec<String>) {
        self.conversation.note_panel(hit, plain_rows);
    }

    pub fn apply_render_feedback(&mut self, feedback: UiRenderFeedback) {
        if let Some(conversation) = feedback.conversation_panel {
            self.conversation.history_offset_from_bottom = conversation.history_offset_from_bottom;
            self.note_conversation_panel(conversation.hit, conversation.plain_rows);
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
