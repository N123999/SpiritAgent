#[derive(Clone, Debug)]
pub struct LlmMessage {
    pub role: &'static str,
    pub content: String,
    pub image_paths: Vec<String>,
}
