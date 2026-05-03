use std::collections::HashMap;

use crate::{
    ts_bridge::{CliMarketplaceCatalogItem, CliMarketplaceDetail},
    view::MarketplaceFlowStep,
};

#[derive(Debug, Default)]
pub(crate) struct MarketplaceState {
    pub(crate) catalog: Vec<CliMarketplaceCatalogItem>,
    pub(crate) detail_cache: HashMap<String, CliMarketplaceDetail>,
    pub(crate) readme_cache: HashMap<String, String>,
    pub(crate) open: bool,
    pub(crate) step_stack: Vec<MarketplaceFlowStep>,
    pub(crate) catalog_filter: String,
    pub(crate) detail_action_filter: String,
    pub(crate) version_filter: String,
    pub(crate) confirm_filter: String,
    pub(crate) catalog_selected_index: usize,
    pub(crate) detail_action_selected_index: usize,
    pub(crate) version_selected_index: usize,
    pub(crate) confirm_selected_index: usize,
    pub(crate) current_extension_id: Option<String>,
    pub(crate) error: Option<String>,
    pub(crate) readme_scroll: usize,
    pub(crate) install_guard: Option<(String, String)>,
}

impl MarketplaceState {
    pub(crate) fn close(&mut self) {
        self.open = false;
        self.step_stack.clear();
        self.current_extension_id = None;
        self.install_guard = None;
        self.error = None;
        self.readme_scroll = 0;
    }
}
