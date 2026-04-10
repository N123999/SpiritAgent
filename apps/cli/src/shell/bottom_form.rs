//! TUI bottom-form helpers.

use std::collections::BTreeMap;
use rust_i18n::t;

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
        title: t!("form.mcp.title").into_owned(),
        fields: vec![
            BottomFormFieldView {
                label: t!("form.mcp.field.name.label").into_owned(),
                help: String::new(),
                editor: BottomFormFieldEditorView::Text {
                    value: String::new(),
                    placeholder: t!("form.mcp.field.name.placeholder").into_owned(),
                    cursor: 0,
                },
            },
            BottomFormFieldView {
                label: t!("form.mcp.field.transport.label").into_owned(),
                help: String::new(),
                editor: BottomFormFieldEditorView::Choice {
                    options: vec![
                        t!("form.mcp.field.transport.stdio").into_owned(),
                        t!("form.mcp.field.transport.http").into_owned(),
                    ],
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
        footer_hint: t!("form.mcp.footer_hint").into_owned(),
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
        return Err(t!("form.mcp.validation.server_name_empty").into_owned());
    }
    if server_name.chars().any(char::is_whitespace) {
        return Err(t!("form.mcp.validation.server_name_whitespace").into_owned());
    }

    let endpoint = bottom_form_text_value(form, MCP_ADD_FIELD_ENDPOINT)
        .trim()
        .to_string();
    if endpoint.is_empty() {
        let label = form
            .fields
            .get(MCP_ADD_FIELD_ENDPOINT)
            .map(|field| field.label.clone())
            .unwrap_or_else(|| t!("form.mcp.field.endpoint.fallback_label").into_owned());
        return Err(t!("form.mcp.validation.field_required", label = label).into_owned());
    }

    let metadata_text = bottom_form_text_value(form, MCP_ADD_FIELD_METADATA);
    let transport = match selected_transport_kind(form).unwrap_or(McpAddTransportKind::Stdio) {
        McpAddTransportKind::Stdio => {
            let tokens = split_command_line(&endpoint)?;
            let Some((command, args)) = tokens.split_first() else {
                return Err(t!("form.mcp.validation.command_empty").into_owned());
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
                field.label = t!("form.mcp.field.endpoint.command.label").into_owned();
                field.help = String::new();
                if let BottomFormFieldEditorView::Text { placeholder, .. } = &mut field.editor {
                    *placeholder = t!("form.mcp.field.endpoint.command.placeholder").into_owned();
                }
            }
            McpAddTransportKind::Http => {
                field.label = t!("form.mcp.field.endpoint.url.label").into_owned();
                field.help = String::new();
                if let BottomFormFieldEditorView::Text { placeholder, .. } = &mut field.editor {
                    *placeholder = t!("form.mcp.field.endpoint.url.placeholder").into_owned();
                }
            }
        }
    }

    if let Some(field) = form.fields.get_mut(MCP_ADD_FIELD_METADATA) {
        match transport {
            McpAddTransportKind::Stdio => {
                field.label = t!("form.mcp.field.metadata.env.label").into_owned();
                field.help = String::new();
                if let BottomFormFieldEditorView::Text { placeholder, .. } = &mut field.editor {
                    *placeholder = t!("form.mcp.field.metadata.env.placeholder").into_owned();
                }
            }
            McpAddTransportKind::Http => {
                field.label = t!("form.mcp.field.metadata.headers.label").into_owned();
                field.help = String::new();
                if let BottomFormFieldEditorView::Text { placeholder, .. } = &mut field.editor {
                    *placeholder = t!("form.mcp.field.metadata.headers.placeholder").into_owned();
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
                MetadataFieldKind::Env => t!("form.mcp.validation.env_format").into_owned(),
                MetadataFieldKind::Header => t!("form.mcp.validation.header_format").into_owned(),
            });
        };

        let key = key.trim();
        if key.is_empty() {
            return Err(match kind {
                MetadataFieldKind::Env => t!("form.mcp.validation.env_empty_key").into_owned(),
                MetadataFieldKind::Header => {
                    t!("form.mcp.validation.header_empty_key").into_owned()
                }
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
        return Err(t!("form.mcp.validation.command_unclosed_quote").into_owned());
    }
    if !current.is_empty() {
        tokens.push(current);
    }
    if tokens.is_empty() {
        return Err(t!("form.mcp.validation.command_empty").into_owned());
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
    use rust_i18n::t;

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

        assert_eq!(form.fields[2].label, t!("form.mcp.field.endpoint.command.label"));
        assert_eq!(form.fields[3].label, t!("form.mcp.field.metadata.env.label"));
    }
}
