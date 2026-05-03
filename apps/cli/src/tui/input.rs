use std::sync::mpsc::Receiver;

use crate::view::MainInputMode;

pub(crate) struct InputState {
    pub(crate) value: String,
    pub(crate) cursor: usize,
    pub(crate) mode: MainInputMode,
    pub(crate) shell_mode_active: bool,
    pub(crate) file_reference_index: Vec<String>,
    pub(crate) pending_file_reference_index_rx: Option<Receiver<Vec<String>>>,
    pub(crate) file_reference_indexing: bool,
}

impl InputState {
    pub(crate) fn new(file_reference_index_rx: Receiver<Vec<String>>) -> Self {
        Self {
            value: String::new(),
            cursor: 0,
            mode: MainInputMode::Agent,
            shell_mode_active: false,
            file_reference_index: Vec::new(),
            pending_file_reference_index_rx: Some(file_reference_index_rx),
            file_reference_indexing: true,
        }
    }

    pub(crate) fn len_chars(&self) -> usize {
        self.value.chars().count()
    }

    pub(crate) fn cursor_byte_index(&self) -> usize {
        self.value
            .char_indices()
            .nth(self.cursor)
            .map(|(index, _)| index)
            .unwrap_or_else(|| self.value.len())
    }

    pub(crate) fn set_value(&mut self, value: String) {
        self.value = value;
        self.cursor = self.len_chars();
    }
}

#[cfg(test)]
mod tests {
    use super::InputState;
    use std::sync::mpsc;

    #[test]
    fn cursor_byte_index_handles_multibyte_input() {
        let (_tx, rx) = mpsc::channel();
        let mut input = InputState::new(rx);
        input.value = "a你b".to_string();
        input.cursor = 2;

        assert_eq!(input.cursor_byte_index(), "a你".len());
    }

    #[test]
    fn set_value_moves_cursor_to_end() {
        let (_tx, rx) = mpsc::channel();
        let mut input = InputState::new(rx);

        input.set_value("计划".to_string());

        assert_eq!(input.cursor, 2);
    }
}
