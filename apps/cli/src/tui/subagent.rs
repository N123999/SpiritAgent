use crate::view::SubagentSessionDetailView;

#[derive(Default)]
pub(crate) struct SubagentUiState {
    pub(crate) picker_active: bool,
    pub(crate) picker_index: usize,
    pub(crate) view: Option<SubagentSessionDetailView>,
    pub(crate) history_offset_from_bottom: usize,
    pub(crate) approval_input: String,
    pub(crate) approval_input_cursor: usize,
    pub(crate) approval_input_active: bool,
}

impl SubagentUiState {
    pub(crate) fn close_view(&mut self) {
        self.view = None;
        self.history_offset_from_bottom = 0;
        self.clear_approval_input();
    }

    pub(crate) fn clear_approval_input(&mut self) {
        self.approval_input.clear();
        self.approval_input_cursor = 0;
        self.approval_input_active = false;
    }
}
