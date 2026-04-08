//! TUI bottom-form helpers.

use std::collections::BTreeMap;

use crate::{
    mcp::{McpCapabilityToggles, McpServerConfig, McpTransportConfig},
    view::{BottomFormFieldEditorView, BottomFormFieldView, BottomFormView},
};

const MCP_ADD_FIELD_NAME: usize = 0;
const MCP_ADD_FIELD_TRANSPORT: usize = 1;
const MCP_ADD_FIELD_ENDPOINT: usize = 2;
const MCP_ADD_FIELD_METADATA: usize = 3;
const MCP_DEFAULT_TIMEOUT_MS: u64 = 20_000;

pub(crate) fn new_mcp_add_form() -> BottomFormView {
    let mut form = BottomFormView {
        title: "Add MCP Server".to_string(),
        fields: vec![
            BottomFormFieldView {
                label: "名称".to_string(),
                help: String::new(),
                editor: BottomFormFieldEditorView::Text {
                    value: String::new(),
                    placeholder: "名称，例如 github".to_string(),
                    cursor: 0,
                },
            },
            BottomFormFieldView {
                label: "类型".to_string(),
                help: String::new(),
                editor: BottomFormFieldEditorView::Choice {
                    options: vec!["STDIO".to_string(), "HTTP".to_string()],
                    selected: 0,
                },
            },
            BottomFormFieldView {
                label: String::new(),
                help: String::new(),
                editor: BottomFormFieldEditorView::Text {
                    value: String::new(),
                    placeholder: String::new(),
                    cursor: 0,
                },
            },
            BottomFormFieldView {
                label: String::new(),
                help: String::new(),
                editor: BottomFormFieldEditorView::Text {
                    value: String::new(),
                    placeholder: String::new(),
                    cursor: 0,
                },
            },
        ],
        selected_field: MCP_ADD_FIELD_NAME,
        footer_hint: "↑/↓ 切换字段  ←/→ 移动光标或切换类型  Enter 保存  Shift+Enter 换行  Esc 取消"
            .to_string(),
    };
    sync_mcp_add_form_fields(&mut form);
    form
}

pub(crate) fn select_next_field(form: &mut BottomFormView) {
    if form.fields.is_empty() {
        return;
    }
    form.selected_field = (form.selected_field + 1) % form.fields.len();
}

pub(crate) fn select_prev_field(form: &mut BottomFormView) {
    if form.fields.is_empty() {
        return;
    }
    if form.selected_field == 0 {
        form.selected_field = form.fields.len() - 1;
    } else {
        form.selected_field -= 1;
    }
}

pub(crate) fn move_left(form: &mut BottomFormView) {
    let selected = form.selected_field.min(form.fields.len().saturating_sub(1));
    let Some(field) = form.fields.get_mut(selected) else {
        return;
    };

    match &mut field.editor {
        BottomFormFieldEditorView::Text { value, cursor, .. } => {
            *cursor = (*cursor).min(value.chars().count());
            if *cursor > 0 {
                *cursor -= 1;
            }
        }
        BottomFormFieldEditorView::Choice { options, selected } => {
            if options.is_empty() {
                return;
            }
            if *selected == 0 {
                *selected = options.len() - 1;
            } else {
                *selected -= 1;
            }
            sync_mcp_add_form_fields(form);
        }
    }
}

pub(crate) fn move_right(form: &mut BottomFormView) {
    let selected = form.selected_field.min(form.fields.len().saturating_sub(1));
    let Some(field) = form.fields.get_mut(selected) else {
        return;
    };

    match &mut field.editor {
        BottomFormFieldEditorView::Text { value, cursor, .. } => {
            *cursor = (*cursor + 1).min(value.chars().count());
        }
        BottomFormFieldEditorView::Choice { options, selected } => {
            if options.is_empty() {
                return;
            }
            *selected = (*selected + 1) % options.len();
            sync_mcp_add_form_fields(form);
        }
    }
}

pub(crate) fn move_home(form: &mut BottomFormView) {
    let Some(BottomFormFieldEditorView::Text { cursor, .. }) = selected_editor_mut(form) else {
        return;
    };
    *cursor = 0;
}

pub(crate) fn move_end(form: &mut BottomFormView) {
    let Some(BottomFormFieldEditorView::Text { value, cursor, .. }) = selected_editor_mut(form)
    else {
        return;
    };
    *cursor = value.chars().count();
}

pub(crate) fn insert_char(form: &mut BottomFormView, ch: char) {
    let Some(BottomFormFieldEditorView::Text { value, cursor, .. }) = selected_editor_mut(form)
    else {
        return;
    };
    let idx = char_cursor_to_byte_index(value, *cursor);
    value.insert(idx, ch);
    *cursor += 1;
}

pub(crate) fn insert_text(form: &mut BottomFormView, text: &str) {
    let normalized = text.replace("\r\n", " ").replace(['\r', '\n'], " ");
    if normalized.is_empty() {
        return;
    }

    let Some(BottomFormFieldEditorView::Text { value, cursor, .. }) = selected_editor_mut(form)
    else {
        return;
    };
    let idx = char_cursor_to_byte_index(value, *cursor);
    value.insert_str(idx, &normalized);
    *cursor += normalized.chars().count();
}

pub(crate) fn backspace(form: &mut BottomFormView) {
    let Some(BottomFormFieldEditorView::Text { value, cursor, .. }) = selected_editor_mut(form)
    else {
        return;
    };
    if *cursor == 0 {
        return;
    }
    let end = char_cursor_to_byte_index(value, *cursor);
    let start = char_cursor_to_byte_index(value, cursor.saturating_sub(1));
    value.replace_range(start..end, "");
    *cursor -= 1;
}

pub(crate) fn delete(form: &mut BottomFormView) {
    let Some(BottomFormFieldEditorView::Text { value, cursor, .. }) = selected_editor_mut(form)
    else {
        return;
    };
    if *cursor >= value.chars().count() {
        return;
    }
    let start = char_cursor_to_byte_index(value, *cursor);
    let end = char_cursor_to_byte_index(value, cursor.saturating_add(1));
    value.replace_range(start..end, "");
}

pub(crate) fn to_config(
    form: &BottomFormView,
) -> std::result::Result<(String, McpServerConfig), String> {
    let server_name = bottom_form_text_value(form, MCP_ADD_FIELD_NAME)
        .trim()
        .to_string();
    if server_name.is_empty() {
        return Err("server 名称不能为空".to_string());
    }
    if server_name.chars().any(char::is_whitespace) {
        return Err("server 名称不能包含空白字符，请使用 - 或 _".to_string());
    }

    let endpoint = bottom_form_text_value(form, MCP_ADD_FIELD_ENDPOINT)
        .trim()
        .to_string();
    if endpoint.is_empty() {
        let label = form
            .fields
            .get(MCP_ADD_FIELD_ENDPOINT)
            .map(|field| field.label.as_str())
            .unwrap_or("命令或 URL");
        return Err(format!("{} 不能为空", label));
    }

    let metadata_text = bottom_form_text_value(form, MCP_ADD_FIELD_METADATA);
    let transport = match selected_transport_kind(form).unwrap_or(McpAddTransportKind::Stdio) {
        McpAddTransportKind::Stdio => {
            let tokens = split_command_line(&endpoint)?;
            let Some((command, args)) = tokens.split_first() else {
                return Err("命令不能为空".to_string());
            };
            McpTransportConfig::Stdio {
                command: command.clone(),
                args: args.to_vec(),
                env: parse_metadata_map(metadata_text, MetadataFieldKind::Env)?,
                cwd: None,
                timeout_ms: Some(MCP_DEFAULT_TIMEOUT_MS),
            }
        }
        McpAddTransportKind::Http => McpTransportConfig::Http {
            url: endpoint,
            headers: parse_metadata_map(metadata_text, MetadataFieldKind::Header)?,
            timeout_ms: Some(MCP_DEFAULT_TIMEOUT_MS),
        },
    };

    Ok((
        server_name.clone(),
        McpServerConfig {
            display_name: Some(server_name),
            enabled: true,
            capabilities: McpCapabilityToggles::default(),
            transport,
        },
    ))
}

fn sync_mcp_add_form_fields(form: &mut BottomFormView) {
    let transport = selected_transport_kind(form).unwrap_or(McpAddTransportKind::Stdio);

    if let Some(field) = form.fields.get_mut(MCP_ADD_FIELD_ENDPOINT) {
        match transport {
            McpAddTransportKind::Stdio => {
                field.label = "命令".to_string();
                field.help = String::new();
                if let BottomFormFieldEditorView::Text { placeholder, .. } = &mut field.editor {
                    *placeholder =
                        "命令，例如 npx -y @modelcontextprotocol/server-github".to_string();
                }
            }
            McpAddTransportKind::Http => {
                field.label = "URL".to_string();
                field.help = String::new();
                if let BottomFormFieldEditorView::Text { placeholder, .. } = &mut field.editor {
                    *placeholder = "URL，例如 https://example.com/mcp".to_string();
                }
            }
        }
    }

    if let Some(field) = form.fields.get_mut(MCP_ADD_FIELD_METADATA) {
        match transport {
            McpAddTransportKind::Stdio => {
                field.label = "环境变量".to_string();
                field.help = String::new();
                if let BottomFormFieldEditorView::Text { placeholder, .. } = &mut field.editor {
                    *placeholder =
                        "环境变量，可选，例如 GITHUB_PERSONAL_ACCESS_TOKEN=${env:GITHUB_TOKEN}"
                            .to_string();
                }
            }
            McpAddTransportKind::Http => {
                field.label = "请求头".to_string();
                field.help = String::new();
                if let BottomFormFieldEditorView::Text { placeholder, .. } = &mut field.editor {
                    *placeholder =
                        "请求头，可选，例如 Authorization: Bearer ${env:GITHUB_TOKEN}".to_string();
                }
            }
        }
    }

    form.selected_field = form.selected_field.min(form.fields.len().saturating_sub(1));
}

fn selected_editor_mut(form: &mut BottomFormView) -> Option<&mut BottomFormFieldEditorView> {
    let selected = form.selected_field.min(form.fields.len().saturating_sub(1));
    form.fields.get_mut(selected).map(|field| &mut field.editor)
}

fn bottom_form_text_value(form: &BottomFormView, index: usize) -> &str {
    match form.fields.get(index).map(|field| &field.editor) {
        Some(BottomFormFieldEditorView::Text { value, .. }) => value.as_str(),
        _ => "",
    }
}

fn selected_transport_kind(form: &BottomFormView) -> Option<McpAddTransportKind> {
    match form
        .fields
        .get(MCP_ADD_FIELD_TRANSPORT)
        .map(|field| &field.editor)
    {
        Some(BottomFormFieldEditorView::Choice { options, selected }) => options
            .get((*selected).min(options.len().saturating_sub(1)))
            .map(|value| {
                if value.eq_ignore_ascii_case("http") {
                    McpAddTransportKind::Http
                } else {
                    McpAddTransportKind::Stdio
                }
            }),
        _ => None,
    }
}

fn parse_metadata_map(
    input: &str,
    kind: MetadataFieldKind,
) -> std::result::Result<BTreeMap<String, String>, String> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Ok(BTreeMap::new());
    }

    let mut result = BTreeMap::new();
    for item in trimmed.split(';') {
        let pair = item.trim();
        if pair.is_empty() {
            continue;
        }

        let parsed = match kind {
            MetadataFieldKind::Env => pair.split_once('='),
            MetadataFieldKind::Header => pair.split_once(':').or_else(|| pair.split_once('=')),
        };

        let Some((key, value)) = parsed else {
            return Err(match kind {
                MetadataFieldKind::Env => {
                    "环境变量 格式错误，应为 KEY=VALUE; KEY2=VALUE".to_string()
                }
                MetadataFieldKind::Header => {
                    "请求头 格式错误，应为 Header: Value; Header2: Value2".to_string()
                }
            });
        };

        let key = key.trim();
        if key.is_empty() {
            return Err(match kind {
                MetadataFieldKind::Env => "环境变量 中存在空键名".to_string(),
                MetadataFieldKind::Header => "请求头 中存在空键名".to_string(),
            });
        }
        result.insert(key.to_string(), value.trim().to_string());
    }
    Ok(result)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum MetadataFieldKind {
    Env,
    Header,
}

fn split_command_line(input: &str) -> std::result::Result<Vec<String>, String> {
    let mut tokens = Vec::new();
    let mut current = String::new();
    let mut chars = input.chars().peekable();
    let mut quote: Option<char> = None;

    while let Some(ch) = chars.next() {
        match quote {
            Some(active_quote) if ch == active_quote => {
                quote = None;
            }
            Some(_) => {
                current.push(ch);
            }
            None if ch == '\'' || ch == '"' => {
                quote = Some(ch);
            }
            None if ch.is_whitespace() => {
                if !current.is_empty() {
                    tokens.push(std::mem::take(&mut current));
                }
                while chars.next_if(|c| c.is_whitespace()).is_some() {}
            }
            None => {
                current.push(ch);
            }
        }
    }

    if quote.is_some() {
        return Err("命令中存在未闭合的引号".to_string());
    }
    if !current.is_empty() {
        tokens.push(current);
    }
    if tokens.is_empty() {
        return Err("命令不能为空".to_string());
    }
    Ok(tokens)
}

fn char_cursor_to_byte_index(value: &str, cursor: usize) -> usize {
    if cursor == 0 {
        return 0;
    }
    value
        .char_indices()
        .nth(cursor)
        .map(|(idx, _)| idx)
        .unwrap_or(value.len())
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum McpAddTransportKind {
    Stdio,
    Http,
}

#[cfg(test)]
mod tests {
    use super::{MetadataFieldKind, new_mcp_add_form, parse_metadata_map};

    #[test]
    fn parse_header_metadata_supports_colon_syntax() {
        let parsed = parse_metadata_map(
            "Authorization: Bearer ${env:GITHUB_TOKEN}; X-Client: spirit-agent",
            MetadataFieldKind::Header,
        )
        .expect("headers parse");

        assert_eq!(
            parsed.get("Authorization"),
            Some(&"Bearer ${env:GITHUB_TOKEN}".to_string())
        );
        assert_eq!(parsed.get("X-Client"), Some(&"spirit-agent".to_string()));
    }

    #[test]
    fn parse_header_metadata_allows_empty_input() {
        let parsed = parse_metadata_map("   ", MetadataFieldKind::Header).expect("empty ok");
        assert!(parsed.is_empty());
    }

    #[test]
    fn new_form_defaults_to_stdio_command_placeholders() {
        let form = new_mcp_add_form();

        assert_eq!(form.fields[2].label, "命令");
        assert_eq!(form.fields[3].label, "环境变量");
    }
}
