//! TUI bottom-form helpers.

use std::collections::BTreeMap;

use rust_i18n::t;
use serde_json::{Map, Value};

use crate::{
    mcp_types::McpDiscoveredPrompt,
    mcp::{McpCapabilityToggles, McpServerConfig, McpTransportConfig},
    rules::{RuleEntry, RuleScope},
    skills::{SkillEntry, SkillScope},
    view::{
        BottomFormFieldEditorView, BottomFormFieldView, BottomFormKind, BottomFormView,
        McpPromptArgumentBinding,
    },
};

const MCP_ADD_FIELD_NAME: usize = 0;
const MCP_ADD_FIELD_TRANSPORT: usize = 1;
const MCP_ADD_FIELD_ENDPOINT: usize = 2;
const MCP_ADD_FIELD_METADATA: usize = 3;

const MODEL_ADD_FIELD_PROVIDER: usize = 0;
const MODEL_ADD_FIELD_API_BASE: usize = 1;
const MODEL_ADD_FIELD_API_KEY: usize = 2;

const MCP_DEFAULT_TIMEOUT_MS: u64 = 20_000;

pub(crate) fn new_mcp_add_form() -> BottomFormView {
    let mut form = BottomFormView {
        kind: BottomFormKind::McpAdd,
        title: t!("form.mcp.title").into_owned(),
        fields: vec![
            BottomFormFieldView {
                label: t!("form.mcp.field.name.label").into_owned(),
                help: String::new(),
                editor: BottomFormFieldEditorView::Text {
                    value: String::new(),
                    placeholder: t!("form.mcp.field.name.placeholder").into_owned(),
                    cursor: 0,
                    mask: false,
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
                    mask: false,
                },
            },
            BottomFormFieldView {
                label: String::new(),
                help: String::new(),
                editor: BottomFormFieldEditorView::Text {
                    value: String::new(),
                    placeholder: String::new(),
                    cursor: 0,
                    mask: false,
                },
            },
        ],
        selected_field: MCP_ADD_FIELD_NAME,
        scroll_offset: 0,
        footer_hint: t!("form.mcp.footer_hint").into_owned(),
    };
    sync_mcp_add_form_fields(&mut form);
    form
}

fn model_add_provider_choice_labels() -> Vec<String> {
    vec![
        t!("form.model.provider.test1").into_owned(),
        t!("form.model.provider.test2").into_owned(),
        t!("form.model.provider.test3").into_owned(),
        t!("form.model.provider.custom").into_owned(),
    ]
}

fn preset_api_base_for_model_add(selected: usize) -> Option<&'static str> {
    match selected {
        0 => Some("https://test1.example/v1"),
        1 => Some("https://test2.example/v1"),
        2 => Some("https://test3.example/v1"),
        _ => None,
    }
}

/// Mock `GET /v1/models` ids for the add-model UI test flow (no network).
pub(crate) fn model_add_mock_model_ids(provider_index: usize) -> Vec<String> {
    match provider_index {
        0 => vec!["test1-alpha".to_string(), "test1-beta".to_string()],
        1 => vec!["test2-fast".to_string(), "test2-slow".to_string()],
        2 => vec!["test3-pro".to_string()],
        _ => vec!["custom-model-a".to_string(), "custom-model-b".to_string()],
    }
}

fn model_add_provider_selected(form: &BottomFormView) -> Option<usize> {
    match form.fields.get(MODEL_ADD_FIELD_PROVIDER).map(|f| &f.editor) {
        Some(BottomFormFieldEditorView::Choice { selected, options }) if !options.is_empty() => {
            Some((*selected).min(options.len().saturating_sub(1)))
        }
        _ => None,
    }
}

fn sync_model_add_form_fields(form: &mut BottomFormView) {
    if !matches!(form.kind, BottomFormKind::ModelAdd) {
        return;
    }
    let Some(selected) = model_add_provider_selected(form) else {
        return;
    };
    if let Some(base) = preset_api_base_for_model_add(selected) {
        if let Some(field) = form.fields.get_mut(MODEL_ADD_FIELD_API_BASE) {
            if let BottomFormFieldEditorView::Text { value, cursor, .. } = &mut field.editor {
                *value = base.to_string();
                *cursor = value.chars().count();
            }
        }
    } else if let Some(field) = form.fields.get_mut(MODEL_ADD_FIELD_API_BASE) {
        if let BottomFormFieldEditorView::Text { value, cursor, .. } = &mut field.editor {
            value.clear();
            *cursor = 0;
        }
    }
}

pub(crate) fn new_model_add_form() -> BottomFormView {
    let mut form = BottomFormView {
        kind: BottomFormKind::ModelAdd,
        title: t!("form.model.title").into_owned(),
        fields: vec![
            BottomFormFieldView {
                label: t!("form.model.field.provider.label").into_owned(),
                help: String::new(),
                editor: BottomFormFieldEditorView::Choice {
                    options: model_add_provider_choice_labels(),
                    selected: 0,
                },
            },
            BottomFormFieldView {
                label: t!("form.model.field.api_base.label").into_owned(),
                help: String::new(),
                editor: BottomFormFieldEditorView::Text {
                    value: String::new(),
                    placeholder: t!("form.model.field.api_base.placeholder").into_owned(),
                    cursor: 0,
                    mask: false,
                },
            },
            BottomFormFieldView {
                label: t!("form.model.field.api_key.label").into_owned(),
                help: t!("form.model.field.api_key.help").into_owned(),
                editor: BottomFormFieldEditorView::Text {
                    value: String::new(),
                    placeholder: t!("form.model.field.api_key.placeholder").into_owned(),
                    cursor: 0,
                    mask: true,
                },
            },
        ],
        selected_field: MODEL_ADD_FIELD_PROVIDER,
        scroll_offset: 0,
        footer_hint: t!("form.model.footer_hint").into_owned(),
    };
    sync_model_add_form_fields(&mut form);
    form
}

pub(crate) fn new_rules_form(entries: &[RuleEntry]) -> BottomFormView {
    let mut fields = Vec::new();
    push_rules_section(
        &mut fields,
        t!("form.rules.section.workspace").as_ref(),
        RuleScope::Workspace,
        entries,
    );
    push_rules_section(
        &mut fields,
        t!("form.rules.section.user").as_ref(),
        RuleScope::User,
        entries,
    );

    let mut form = BottomFormView {
        kind: BottomFormKind::Rules,
        title: t!("form.rules.title").into_owned(),
        fields,
        selected_field: 0,
        scroll_offset: 0,
        footer_hint: t!("form.rules.footer_hint").into_owned(),
    };
    ensure_selectable_field(&mut form);
    form
}

pub(crate) fn new_skills_form(entries: &[SkillEntry]) -> BottomFormView {
    let mut fields = Vec::new();
    push_skills_section(
        &mut fields,
        t!("form.skills.section.workspace").as_ref(),
        SkillScope::Workspace,
        entries,
    );
    push_skills_section(
        &mut fields,
        t!("form.skills.section.user").as_ref(),
        SkillScope::User,
        entries,
    );

    let mut form = BottomFormView {
        kind: BottomFormKind::Skills,
        title: t!("form.skills.title").into_owned(),
        fields,
        selected_field: 0,
        scroll_offset: 0,
        footer_hint: t!("form.skills.footer_hint").into_owned(),
    };
    ensure_selectable_field(&mut form);
    form
}

pub(crate) fn new_mcp_prompt_form(
    server: &str,
    prompt: &McpDiscoveredPrompt,
    initial_user_message: Option<&str>,
) -> BottomFormView {
    let arguments = prompt
        .arguments
        .iter()
        .map(|argument| McpPromptArgumentBinding {
            name: argument.name.clone(),
            required: argument.required,
        })
        .collect::<Vec<_>>();
    let mut fields = prompt
        .arguments
        .iter()
        .map(|argument| {
            let label_suffix = if argument.required {
                t!("form.prompt.field.required_suffix").into_owned()
            } else {
                t!("form.prompt.field.optional_suffix").into_owned()
            };
            let mut help_lines = Vec::new();
            if let Some(title) = argument.title.as_ref().filter(|title| *title != &argument.name) {
                help_lines.push(title.clone());
            }
            if let Some(description) = argument.description.as_ref().filter(|value| !value.is_empty()) {
                help_lines.push(description.clone());
            }

            BottomFormFieldView {
                label: format!("{}{}", argument.name, label_suffix),
                help: help_lines.join("\n"),
                editor: BottomFormFieldEditorView::Text {
                    value: String::new(),
                    placeholder: if argument.required {
                        t!("form.prompt.field.required.placeholder").into_owned()
                    } else {
                        t!("form.prompt.field.optional.placeholder").into_owned()
                    },
                    cursor: 0,
                    mask: false,
                },
            }
        })
        .collect::<Vec<_>>();

    fields.push(BottomFormFieldView {
        label: t!("form.prompt.field.user_message.label").into_owned(),
        help: t!("form.prompt.field.user_message.help").into_owned(),
        editor: BottomFormFieldEditorView::Text {
            value: initial_user_message.unwrap_or_default().to_string(),
            placeholder: t!("form.prompt.field.user_message.placeholder").into_owned(),
            cursor: initial_user_message.unwrap_or_default().chars().count(),
            mask: false,
        },
    });

    let mut form = BottomFormView {
        kind: BottomFormKind::McpPrompt {
            server: server.to_string(),
            prompt: prompt.name.clone(),
            arguments,
        },
        title: format!(
            "{} · {} / {}",
            t!("form.prompt.title"),
            server,
            prompt.name
        ),
        fields,
        selected_field: 0,
        scroll_offset: 0,
        footer_hint: t!("form.prompt.footer_hint").into_owned(),
    };
    ensure_selectable_field(&mut form);
    form
}

pub(crate) fn select_next_field(form: &mut BottomFormView) {
    if form.fields.is_empty() || !has_selectable_field(form) {
        return;
    }
    let start = form.selected_field.min(form.fields.len().saturating_sub(1));
    let mut next = start;
    loop {
        next = (next + 1) % form.fields.len();
        if is_field_selectable(&form.fields[next]) {
            form.selected_field = next;
            return;
        }
        if next == start {
            return;
        }
    }
}

pub(crate) fn select_prev_field(form: &mut BottomFormView) {
    if form.fields.is_empty() || !has_selectable_field(form) {
        return;
    }
    let start = form.selected_field.min(form.fields.len().saturating_sub(1));
    let mut next = start;
    loop {
        next = if next == 0 {
            form.fields.len() - 1
        } else {
            next - 1
        };
        if is_field_selectable(&form.fields[next]) {
            form.selected_field = next;
            return;
        }
        if next == start {
            return;
        }
    }
}

pub(crate) fn move_left(form: &mut BottomFormView) {
    let selected = form.selected_field.min(form.fields.len().saturating_sub(1));
    let Some(field) = form.fields.get_mut(selected) else {
        return;
    };

    match &mut field.editor {
        BottomFormFieldEditorView::Section { .. } => {}
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
            sync_model_add_form_fields(form);
        }
        BottomFormFieldEditorView::Checkbox { .. } => {}
        BottomFormFieldEditorView::AskQuestion { .. } => {}
    }
}

pub(crate) fn move_right(form: &mut BottomFormView) {
    let selected = form.selected_field.min(form.fields.len().saturating_sub(1));
    let Some(field) = form.fields.get_mut(selected) else {
        return;
    };

    match &mut field.editor {
        BottomFormFieldEditorView::Section { .. } => {}
        BottomFormFieldEditorView::Text { value, cursor, .. } => {
            *cursor = (*cursor + 1).min(value.chars().count());
        }
        BottomFormFieldEditorView::Choice { options, selected } => {
            if options.is_empty() {
                return;
            }
            *selected = (*selected + 1) % options.len();
            sync_mcp_add_form_fields(form);
            sync_model_add_form_fields(form);
        }
        BottomFormFieldEditorView::Checkbox { .. } => {}
        BottomFormFieldEditorView::AskQuestion { .. } => {}
    }
}

pub(crate) fn activate(form: &mut BottomFormView) {
    let selected = form.selected_field.min(form.fields.len().saturating_sub(1));
    let Some(field) = form.fields.get_mut(selected) else {
        return;
    };

    if let BottomFormFieldEditorView::Checkbox {
        checked,
        disabled,
        ..
    } = &mut field.editor
    {
        if !*disabled {
            *checked = !*checked;
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
    let normalized = normalize_inserted_text(form, text);
    if normalized.is_empty() {
        return;
    }

    let Some(BottomFormFieldEditorView::Text { value, cursor, .. }) = selected_editor_mut(form)
    else {
        return;
    };
    let idx = char_cursor_to_byte_index(value, *cursor);
    value.insert_str(idx, normalized.as_str());
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

/// Provider index, resolved API base, API key. Model id is chosen in the next mock list step.
pub(crate) fn parse_model_add_connection(
    form: &BottomFormView,
) -> std::result::Result<(usize, String, String), String> {
    if !matches!(form.kind, BottomFormKind::ModelAdd) {
        return Err(t!("form.model.validation.invalid_form_kind").into_owned());
    }

    let Some(provider_index) = model_add_provider_selected(form) else {
        return Err(t!("form.model.validation.provider_invalid").into_owned());
    };

    let api_key = bottom_form_text_value(form, MODEL_ADD_FIELD_API_KEY).trim().to_string();
    if api_key.is_empty() {
        return Err(t!("form.model.validation.api_key_empty").into_owned());
    }

    let api_base = if let Some(preset) = preset_api_base_for_model_add(provider_index) {
        preset.to_string()
    } else {
        let v = bottom_form_text_value(form, MODEL_ADD_FIELD_API_BASE).trim().to_string();
        if v.is_empty() {
            return Err(t!("form.model.validation.api_base_empty").into_owned());
        }
        v
    };

    Ok((provider_index, api_base, api_key))
}

pub(crate) fn to_prompt_args_json(
    form: &BottomFormView,
) -> std::result::Result<Option<String>, String> {
    let BottomFormKind::McpPrompt { arguments, .. } = &form.kind else {
        return Err(t!("form.prompt.validation.invalid_form_kind").into_owned());
    };

    let mut args = Map::new();
    for (index, argument) in arguments.iter().enumerate() {
        let value = bottom_form_text_value(form, index);
        if value.trim().is_empty() {
            if argument.required {
                let label = form
                    .fields
                    .get(index)
                    .map(|field| field.label.clone())
                    .unwrap_or_else(|| argument.name.clone());
                return Err(t!("form.prompt.validation.required", label = label).into_owned());
            }
            continue;
        }

        args.insert(argument.name.clone(), Value::String(value.to_string()));
    }

    if args.is_empty() {
        Ok(None)
    } else {
        Ok(Some(Value::Object(args).to_string()))
    }
}

pub(crate) fn prompt_user_message(
    form: &BottomFormView,
) -> std::result::Result<Option<String>, String> {
    let BottomFormKind::McpPrompt { arguments, .. } = &form.kind else {
        return Err(t!("form.prompt.validation.invalid_form_kind").into_owned());
    };

    let value = bottom_form_text_value(form, arguments.len()).trim().to_string();
    if value.is_empty() {
        Ok(None)
    } else {
        Ok(Some(value))
    }
}

pub(crate) fn rules_form_overrides(form: &BottomFormView) -> Vec<(String, bool)> {
    form.fields
        .iter()
        .filter_map(|field| match &field.editor {
            BottomFormFieldEditorView::Checkbox {
                id,
                checked,
                disabled,
                ..
            } if !disabled => Some((id.clone(), *checked)),
            _ => None,
        })
        .collect()
}

pub(crate) fn skills_form_overrides(form: &BottomFormView) -> Vec<(String, bool)> {
    rules_form_overrides(form)
}

fn sync_mcp_add_form_fields(form: &mut BottomFormView) {
    if !matches!(form.kind, BottomFormKind::McpAdd) {
        return;
    }
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

    ensure_selectable_field(form);
}

fn push_rules_section(
    fields: &mut Vec<BottomFormFieldView>,
    title: &str,
    scope: RuleScope,
    entries: &[RuleEntry],
) {
    fields.push(BottomFormFieldView {
        label: String::new(),
        help: String::new(),
        editor: BottomFormFieldEditorView::Section {
            text: title.to_string(),
        },
    });

    for entry in entries.iter().filter(|entry| entry.source.scope == scope) {
        fields.push(BottomFormFieldView {
            label: entry.source.short_label.clone(),
            help: String::new(),
            editor: BottomFormFieldEditorView::Checkbox {
                id: entry.source.id.clone(),
                checked: entry.enabled,
                disabled: !entry.exists,
                path: Some(entry.source.path.display().to_string()),
            },
        });
    }
}

fn push_skills_section(
    fields: &mut Vec<BottomFormFieldView>,
    title: &str,
    scope: SkillScope,
    entries: &[SkillEntry],
) {
    fields.push(BottomFormFieldView {
        label: String::new(),
        help: String::new(),
        editor: BottomFormFieldEditorView::Section {
            text: title.to_string(),
        },
    });

    for entry in entries.iter().filter(|entry| entry.source.scope == scope) {
        fields.push(BottomFormFieldView {
            label: entry.source.name.clone(),
            help: entry.source.description.clone(),
            editor: BottomFormFieldEditorView::Checkbox {
                id: entry.source.id.clone(),
                checked: entry.enabled,
                disabled: false,
                path: Some(entry.source.path.display().to_string()),
            },
        });
    }
}

fn is_field_selectable(field: &BottomFormFieldView) -> bool {
    match &field.editor {
        BottomFormFieldEditorView::Section { .. } => false,
        BottomFormFieldEditorView::Checkbox { disabled, .. } => !*disabled,
        BottomFormFieldEditorView::Text { .. }
        | BottomFormFieldEditorView::Choice { .. }
        | BottomFormFieldEditorView::AskQuestion { .. } => true,
    }
}

fn has_selectable_field(form: &BottomFormView) -> bool {
    form.fields.iter().any(is_field_selectable)
}

fn ensure_selectable_field(form: &mut BottomFormView) {
    if form.fields.is_empty() {
        form.selected_field = 0;
        return;
    }

    let selected = form.selected_field.min(form.fields.len().saturating_sub(1));
    if form
        .fields
        .get(selected)
        .is_some_and(is_field_selectable)
    {
        form.selected_field = selected;
        return;
    }

    form.selected_field = form
        .fields
        .iter()
        .position(is_field_selectable)
        .unwrap_or(0);
}

fn selected_editor_mut(form: &mut BottomFormView) -> Option<&mut BottomFormFieldEditorView> {
    let selected = form.selected_field.min(form.fields.len().saturating_sub(1));
    form.fields.get_mut(selected).map(|field| &mut field.editor)
}

fn normalize_inserted_text(form: &BottomFormView, text: &str) -> String {
    match form.kind {
        BottomFormKind::McpPrompt { .. } => text.replace("\r\n", "\n").replace('\r', "\n"),
        BottomFormKind::McpAdd
        | BottomFormKind::AskQuestions { .. }
        | BottomFormKind::ModelAdd
        | BottomFormKind::Rules
        | BottomFormKind::Skills => text.replace("\r\n", " ").replace(['\r', '\n'], " "),
    }
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
    use super::{
        MetadataFieldKind, activate, insert_text, move_right, new_mcp_add_form, new_mcp_prompt_form,
        new_model_add_form, new_rules_form, new_skills_form, parse_metadata_map,
        parse_model_add_connection, prompt_user_message, rules_form_overrides, select_next_field,
        skills_form_overrides, sync_model_add_form_fields, to_prompt_args_json,
    };
    use rust_i18n::t;
    use std::path::PathBuf;

    use crate::{
        mcp_types::{McpDiscoveredPrompt, McpDiscoveredPromptArgument},
        rules::{RuleEntry, RulePreview, RuleScope, RuleSource},
        skills::{SkillEntry, SkillPreview, SkillRootKind, SkillScope, SkillSource},
        view::BottomFormFieldEditorView,
    };

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

    #[test]
    fn new_rules_form_selects_first_available_checkbox() {
        let form = new_rules_form(&[sample_rule_entry(RuleScope::Workspace, true, true)]);

        assert_eq!(form.selected_field, 1);
    }

    #[test]
    fn select_next_field_skips_sections_and_disabled_checkboxes() {
        let mut form = new_rules_form(&[
            sample_rule_entry(RuleScope::Workspace, true, true),
            sample_rule_entry(RuleScope::User, false, false),
        ]);

        select_next_field(&mut form);

        assert_eq!(form.selected_field, 1);
    }

    #[test]
    fn activate_toggles_selected_checkbox() {
        let mut form = new_rules_form(&[sample_rule_entry(RuleScope::Workspace, true, true)]);

        activate(&mut form);

        assert_eq!(rules_form_overrides(&form), vec![("workspace-rule".to_string(), false)]);
    }

    #[test]
    fn new_skills_form_selects_first_available_checkbox() {
        let form = new_skills_form(&[sample_skill_entry(SkillScope::Workspace, true)]);

        assert_eq!(form.selected_field, 1);
    }

    #[test]
    fn skills_activate_toggles_selected_checkbox() {
        let mut form = new_skills_form(&[sample_skill_entry(SkillScope::Workspace, true)]);

        activate(&mut form);

        assert_eq!(skills_form_overrides(&form), vec![("workspace-skill".to_string(), false)]);
    }

    #[test]
    fn existing_rule_does_not_render_preview_help() {
        let mut entry = sample_rule_entry(RuleScope::Workspace, true, true);
        entry.preview = Some(RulePreview {
            excerpt: "line1\nline2".to_string(),
            truncated: true,
        });

        let form = new_rules_form(&[entry]);
        let help = &form.fields[1].help;
        let path = match &form.fields[1].editor {
            crate::view::BottomFormFieldEditorView::Checkbox { path, .. } => {
                path.as_deref().unwrap_or("")
            }
            _ => "",
        };

        assert!(help.is_empty());
        assert!(path.contains(".spirit") && path.ends_with("rule.md"));
    }

    #[test]
    fn missing_rule_keeps_disabled_row_without_extra_hint() {
        let form = new_rules_form(&[sample_rule_entry(RuleScope::User, false, false)]);
        let help = &form.fields[2].help;
        let disabled = match &form.fields[2].editor {
            crate::view::BottomFormFieldEditorView::Checkbox { disabled, .. } => *disabled,
            _ => false,
        };

        assert!(disabled);
        assert!(help.is_empty());
    }

    #[test]
    fn prompt_form_marks_required_arguments() {
        let form = new_mcp_prompt_form("github", &sample_prompt(true), None);

        assert_eq!(form.fields[0].label, format!("issue{}", t!("form.prompt.field.required_suffix")));
        assert_eq!(form.fields[1].label, format!("style{}", t!("form.prompt.field.optional_suffix")));
    }

    #[test]
    fn prompt_form_args_json_requires_required_fields() {
        let form = new_mcp_prompt_form("github", &sample_prompt(true), None);

        let err = to_prompt_args_json(&form).expect_err("missing required field should fail");
        assert!(err.contains("issue"));
    }

    #[test]
    fn prompt_form_args_json_omits_empty_optional_fields() {
        let mut form = new_mcp_prompt_form("github", &sample_prompt(true), None);
        insert_text(&mut form, "123");

        let json = to_prompt_args_json(&form)
            .expect("args json")
            .expect("non-empty args json");

        assert_eq!(json, r#"{"issue":"123"}"#);
    }

    #[test]
    fn prompt_form_preserves_multiline_paste() {
        let mut form = new_mcp_prompt_form("github", &sample_prompt(false), None);

        insert_text(&mut form, "line1\r\nline2");

        let json = to_prompt_args_json(&form)
            .expect("args json")
            .expect("non-empty args json");
        assert_eq!(json, r#"{"issue":"line1\nline2"}"#);
    }

    #[test]
    fn prompt_form_user_message_round_trips() {
        let mut form = new_mcp_prompt_form("github", &sample_prompt(true), Some("帮我看看用途"));

        form.selected_field = 2;
        insert_text(&mut form, "\n并给出例子");

        let user_message = prompt_user_message(&form)
            .expect("user message")
            .expect("non-empty user message");

        assert_eq!(user_message, "帮我看看用途\n并给出例子");
    }

    #[test]
    fn mcp_add_form_normalizes_multiline_paste_to_spaces() {
        let mut form = new_mcp_add_form();

        insert_text(&mut form, "line1\r\nline2");

        let value = match &form.fields[0].editor {
            crate::view::BottomFormFieldEditorView::Text { value, .. } => value,
            _ => panic!("expected text field"),
        };
        assert_eq!(value, "line1 line2");
    }

    #[test]
    fn model_add_form_parses_preset_connection() {
        let mut form = new_model_add_form();
        assert!(matches!(form.kind, crate::view::BottomFormKind::ModelAdd));
        form.selected_field = 2;
        insert_text(&mut form, "sk-secret");
        let parsed = parse_model_add_connection(&form).expect("parse");
        assert_eq!(parsed.0, 0);
        assert_eq!(parsed.1, "https://test1.example/v1");
        assert_eq!(parsed.2, "sk-secret");
    }

    #[test]
    fn model_add_provider_choice_does_not_overwrite_api_key_with_mcp_command_label() {
        let mut form = new_model_add_form();
        let expected_key_label = t!("form.model.field.api_key.label").into_owned();
        move_right(&mut form);
        assert_eq!(form.fields[2].label, expected_key_label);
    }

    #[test]
    fn model_add_form_parses_custom_connection() {
        let mut form = new_model_add_form();
        if let Some(f) = form.fields.get_mut(0) {
            if let BottomFormFieldEditorView::Choice { selected, .. } = &mut f.editor {
                *selected = 3;
            }
        }
        sync_model_add_form_fields(&mut form);
        form.selected_field = 1;
        insert_text(&mut form, "https://custom.example/v1");
        form.selected_field = 2;
        insert_text(&mut form, "sk-c");
        let parsed = parse_model_add_connection(&form).expect("parse");
        assert_eq!(parsed.0, 3);
        assert_eq!(parsed.1, "https://custom.example/v1");
        assert_eq!(parsed.2, "sk-c");
    }

    fn sample_rule_entry(scope: RuleScope, exists: bool, enabled: bool) -> RuleEntry {
        let (id, title, short_label, path) = match scope {
            RuleScope::Workspace => (
                "workspace-rule",
                "工作区规则",
                ".spirit/rule.md",
                PathBuf::from("C:/workspace/.spirit/rule.md"),
            ),
            RuleScope::User => (
                "user-rule",
                "用户规则",
                "rule.md",
                PathBuf::from("C:/users/demo/AppData/Roaming/SpiritAgent/rule.md"),
            ),
        };

        RuleEntry {
            source: RuleSource {
                id: id.to_string(),
                scope,
                title: title.to_string(),
                short_label: short_label.to_string(),
                path,
            },
            exists,
            enabled,
            content: exists.then(|| "body".to_string()),
            preview: exists.then(|| RulePreview {
                excerpt: "body".to_string(),
                truncated: false,
            }),
        }
    }

    fn sample_prompt(required: bool) -> McpDiscoveredPrompt {
        McpDiscoveredPrompt {
            name: "issue-summary".to_string(),
            title: Some("Issue Summary".to_string()),
            description: Some("Summarize an issue with extra context".to_string()),
            arguments: vec![
                McpDiscoveredPromptArgument {
                    name: "issue".to_string(),
                    title: Some("Issue Number".to_string()),
                    description: Some("The issue number to summarize".to_string()),
                    required,
                },
                McpDiscoveredPromptArgument {
                    name: "style".to_string(),
                    title: Some("Style".to_string()),
                    description: Some("Optional style hint".to_string()),
                    required: false,
                },
            ],
        }
    }

    fn sample_skill_entry(scope: SkillScope, enabled: bool) -> SkillEntry {
        let (id, name, description, short_label, path, root_kind) = match scope {
            SkillScope::Workspace => (
                "workspace-skill",
                "code-review",
                "Review code when the user asks for diff analysis.",
                ".spirit/skills/code-review/SKILL.md",
                PathBuf::from("C:/workspace/.spirit/skills/code-review/SKILL.md"),
                SkillRootKind::WorkspaceSpirit,
            ),
            SkillScope::User => (
                "user-skill",
                "data-analysis",
                "Analyze datasets and summarize findings.",
                "skills/data-analysis/SKILL.md",
                PathBuf::from(
                    "C:/users/demo/AppData/Roaming/SpiritAgent/skills/data-analysis/SKILL.md",
                ),
                SkillRootKind::User,
            ),
        };

        SkillEntry {
            source: SkillSource {
                id: id.to_string(),
                scope,
                root_kind,
                name: name.to_string(),
                description: description.to_string(),
                short_label: short_label.to_string(),
                path,
            },
            enabled,
            content: "# Skill body".to_string(),
            preview: SkillPreview {
                excerpt: "# Skill body".to_string(),
                truncated: false,
            },
        }
    }
}
