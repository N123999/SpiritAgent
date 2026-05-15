use serde_json::Value;

#[derive(Clone, Debug)]
pub struct LlmToolCall {
    pub id: String,
    pub name: String,
    pub arguments_json: String,
}

#[derive(Clone, Debug)]
pub struct LlmMessage {
    pub role: &'static str,
    pub content: String,
    pub image_paths: Vec<String>,
    pub tool_call_id: Option<String>,
    pub tool_calls: Option<Vec<LlmToolCall>>,
    pub provider_state: Option<Value>,
}
