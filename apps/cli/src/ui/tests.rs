use super::*;
use crate::{
    model_registry::AppConfig,
    view::{
        AssistantAuxData, BottomFormFieldEditorView, BottomFormFieldView, BottomFormView,
        MainInputMode, MarketplaceFlowStep, MarketplaceViewModel, PendingAssistantAux,
        RewindPickerView, SlashFlowItemView, SlashFlowSearchView, SlashFlowView,
        SubagentSessionDetailView, SubagentSessionSummaryView,
    },
};
use ratatui::{Terminal, backend::TestBackend};
use rust_i18n::t;
use std::{collections::HashMap, env, fs};
use unicode_width::UnicodeWidthStr;

fn render_text_lines(lines: Vec<Line<'static>>) -> Vec<String> {
    lines
        .into_iter()
        .map(|line| {
            line.spans
                .into_iter()
                .map(|span| span.content.into_owned().replace('\u{00a0}', " "))
                .collect::<String>()
        })
        .collect()
}

fn render_ui_lines(app: &TuiViewModel, width: u16, height: u16) -> Vec<String> {
    render_ui_snapshot(app, width, height).0
}

fn render_ui_snapshot(
    app: &TuiViewModel,
    width: u16,
    height: u16,
) -> (Vec<String>, ratatui::buffer::Buffer) {
    let backend = TestBackend::new(width, height);
    let mut terminal = Terminal::new(backend).expect("test terminal initializes");
    let mut runtime = UiRuntimeState::default();
    terminal
        .draw(|frame| {
            draw_ui(frame, app, &mut runtime);
        })
        .expect("ui renders");

    let buffer = terminal.backend().buffer().clone();
    let lines = (0..height)
        .map(|y| {
            let mut line = String::new();
            for x in 0..width {
                line.push_str(buffer[(x, y)].symbol());
            }
            line
        })
        .collect();

    (lines, buffer)
}

fn test_image_path(label: &str) -> std::path::PathBuf {
    let unique = uuid::Uuid::new_v4().simple().to_string();
    let short = &unique[..8];
    env::current_dir()
        .expect("workspace cwd")
        .join("target")
        .join("ui-tests")
        .join(format!("{}-{}.png", label, short))
}

fn build_view_model(message: ChatMessage) -> TuiViewModel {
    TuiViewModel {
        input: String::new(),
        input_cursor: 0,
        input_mode: MainInputMode::Agent,
        shell_mode_active: false,
        pending_image_paths: vec![],
        pending_mcp_resources: vec![],
        loop_enabled: false,
        approval_level: "default".to_string(),
        history_truncated_before: 0,
        messages: vec![message],
        assistant_aux_by_message: HashMap::new(),
        config: AppConfig::default(),
        show_aux_details: true,
        input_suggestion_kind: None,
        input_suggestion_loading: false,
        slash_suggestions: vec![],
        selected_suggestion: 0,
        rewind_picker: None,
        model_picker_active: false,
        model_picker_index: 0,
        language_picker_active: false,
        language_picker_index: 0,
        chat_picker_active: false,
        chat_picker_index: 0,
        chat_picker_files: vec![],
        subagent_picker_active: false,
        subagent_picker_index: 0,
        subagent_sessions: vec![],
        subagent_view: None,
        subagent_history_offset_from_bottom: 0,
        pending_subagent_approval: None,
        subagent_approval_input: None,
        image_picker_active: false,
        image_picker_index: 0,
        image_picker_files: vec![],
        bottom_form: None,
        marketplace_view: None,
        history_offset_from_bottom: 0,
        pending_response_active: false,
        pending_assistant_msg_index: None,
        pending_aux: None,
        persisted_standalone_pending_aux: None,
        persisted_standalone_pending_aux_anchor: None,
        cli_ui_hooks: vec![],
        conversation_sel_anchor: None,
        conversation_sel_head: None,
    }
}

fn build_bottom_form_view(value: &str, footer_hint: &str) -> BottomFormView {
    BottomFormView {
        kind: crate::view::BottomFormKind::McpAdd,
        title: "Add MCP Server".to_string(),
        fields: vec![
            BottomFormFieldView {
                label: "名称".to_string(),
                help: String::new(),
                editor: BottomFormFieldEditorView::Text {
                    value: "github".to_string(),
                    placeholder: "名称，例如 github".to_string(),
                    cursor: 0,
                    mask: false,
                    disabled: false,
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
                label: "命令".to_string(),
                help: String::new(),
                editor: BottomFormFieldEditorView::Text {
                    value: value.to_string(),
                    placeholder: "命令，例如 npx -y @modelcontextprotocol/server-github"
                        .to_string(),
                    cursor: 0,
                    mask: false,
                    disabled: false,
                },
            },
            BottomFormFieldView {
                label: "环境变量".to_string(),
                help: String::new(),
                editor: BottomFormFieldEditorView::Text {
                    value: "GITHUB_TOKEN=demo".to_string(),
                    placeholder: "环境变量，可选，例如 GITHUB_TOKEN=demo".to_string(),
                    cursor: 0,
                    mask: false,
                    disabled: false,
                },
            },
        ],
        selected_field: 2,
        scroll_offset: 0,
        footer_hint: footer_hint.to_string(),
    }
}

fn build_subagent_detail_view(
    pending_aux: Option<PendingAssistantAux>,
) -> SubagentSessionDetailView {
    SubagentSessionDetailView {
        summary: SubagentSessionSummaryView {
            session_id: "subagent-1".to_string(),
            title: "检查子会话状态".to_string(),
            status: crate::ports::SubagentSessionStatus::Running,
            updated_at_unix_ms: 0,
            latest_message: None,
        },
        messages: vec![],
        pending_aux,
        final_output: None,
        error: None,
    }
}

#[test]
fn bottom_form_block_height_grows_for_multiline_text() {
    let single = build_bottom_form_view(
        "npx -y @modelcontextprotocol/server-github",
        "Enter 保存 Esc 取消",
    );
    let multi = build_bottom_form_view(
        "npx -y @modelcontextprotocol/server-github\n--stdio\n--verbose",
        "Enter 保存 Esc 取消",
    );

    assert!(bottom_form_block_height(&multi, 80) > bottom_form_block_height(&single, 80));
}

#[test]
fn bottom_form_block_height_grows_for_wrapped_footer_hint() {
    let form = build_bottom_form_view(
        "npx -y @modelcontextprotocol/server-github",
        "↑/↓ 切换字段  ←/→ 移动光标或切换类型  Enter 保存  Shift+Enter 换行  Esc 取消",
    );

    assert!(bottom_form_block_height(&form, 28) > bottom_form_block_height(&form, 96));
}

#[test]
fn input_cursor_matches_wrapped_render_for_exact_width_line_before_newline() {
    let mut app = build_view_model(ChatMessage::new(MessageRole::Agent, "welcome"));
    app.input = "你好你好\nA".to_string();
    app.input_cursor = app.input.chars().count();

    let lines = render_text_lines(build_input_lines(&app, 8, false));
    let (row, col) = input_cursor_position(&app, 8);

    assert_eq!(lines, vec!["你好你好", "A"]);
    assert_eq!((row, col), (1, 1));
}

#[test]
fn input_cursor_moves_to_trailing_empty_row_when_last_line_fills_width() {
    let mut app = build_view_model(ChatMessage::new(MessageRole::Agent, "welcome"));
    app.input = "你好你好".to_string();
    app.input_cursor = app.input.chars().count();

    let lines = render_text_lines(build_input_lines(&app, 8, false));
    let (row, col) = input_cursor_position(&app, 8);

    assert_eq!(lines, vec!["你好你好", ""]);
    assert_eq!((row, col), (1, 0));
}

#[test]
fn plan_mode_input_uses_yellow_border_and_text_and_plan_title() {
    let title = input_mode_title(MainInputMode::Plan);
    let border = input_block_border_style(false, MainInputMode::Plan, false);
    let text = input_text_style(false, MainInputMode::Plan, false);

    assert_eq!(title, t!("ui.input.title_plan").into_owned());
    assert_eq!(border.fg, Some(Color::Yellow));
    assert_eq!(text.fg, Some(Color::Yellow));
}

#[test]
fn agent_mode_input_softens_only_border_text_stays_white() {
    let border = input_block_border_style(false, MainInputMode::Agent, false);
    let text = input_text_style(false, MainInputMode::Agent, false);

    assert_eq!(border.fg, conversation_body_text_style().fg);
    assert_eq!(text.fg, Some(Color::White));
}

#[test]
fn footer_shows_mode_without_tab_toggle_hint() {
    let agent_footer = render_text_lines(vec![build_footer_line(
        &build_view_model(ChatMessage::new(MessageRole::Agent, "welcome")),
        80,
    )]);

    let mut plan_app = build_view_model(ChatMessage::new(MessageRole::Agent, "welcome"));
    plan_app.input_mode = MainInputMode::Plan;
    let plan_footer = render_text_lines(vec![build_footer_line(&plan_app, 80)]);

    assert!(!agent_footer[0].contains("Tab"));
    assert!(!plan_footer[0].contains("Tab"));
    assert!(agent_footer[0].contains(format!(" |  {}", t!("ui.footer.mode.agent")).as_str()));
    assert!(plan_footer[0].contains(format!(" |  {}", t!("ui.footer.mode.plan")).as_str()));
}

#[test]
fn inline_picker_window_keeps_selection_near_middle() {
    assert_eq!(inline_picker_bounds(8, 0, 5), (0, 5));
    assert_eq!(inline_picker_bounds(8, 2, 5), (0, 5));
    assert_eq!(inline_picker_bounds(8, 3, 5), (1, 6));
    assert_eq!(inline_picker_bounds(8, 7, 5), (3, 8));
}

#[test]
fn sessions_picker_reuses_inline_picker_styles_and_scroll_window() {
    let mut app = build_view_model(ChatMessage::new(MessageRole::User, "/sessions"));
    app.chat_picker_files = (0..7).map(|idx| format!("session-{idx}.json")).collect();
    app.chat_picker_index = 3;

    let lines = build_chat_picker_lines(&app, 5);
    let text = render_text_lines(lines.clone());

    assert_eq!(text[0], "  session-1.json");
    assert_eq!(text[2], "> session-3.json");
    assert_eq!(lines[0].spans[0].style.fg, subtle_aux_text_style().fg);
    assert_eq!(lines[2].spans[0].style.fg, Some(Color::White));
}

#[test]
fn sessions_picker_uses_inline_layout_without_footer_or_title() {
    let mut app = build_view_model(ChatMessage::new(MessageRole::User, "/sessions"));
    app.chat_picker_active = true;
    app.chat_picker_files = vec![
        "session-0.json".to_string(),
        "session-1.json".to_string(),
        "session-2.json".to_string(),
    ];
    app.chat_picker_index = 1;

    let lines = render_ui_lines(&app, 80, 20);

    assert!(lines.iter().any(|line| line.contains("> session-1.json")));
    assert!(
        !lines
            .iter()
            .any(|line| line.contains(t!("ui.picker.sessions").as_ref()))
    );
    assert!(
        !lines
            .iter()
            .any(|line| line.contains(t!("ui.footer.preview").as_ref()))
    );
}

#[test]
fn slash_suggestions_reuse_inline_picker_styles_and_scroll_window() {
    let mut app = build_view_model(ChatMessage::new(MessageRole::User, "/"));
    app.input_suggestion_kind = Some(InputSuggestionKind::Slash);
    app.slash_suggestions = (0..7)
        .map(|idx| InputSuggestion {
            label: format!("/cmd-{idx}"),
            replacement: format!("/cmd-{idx}"),
            summary: format!("summary-{idx}"),
            details: Vec::new(),
        })
        .collect();
    app.selected_suggestion = 3;

    let lines = build_suggestion_lines(&app, 5, 48);
    let text = render_text_lines(lines.clone());

    assert!(suggestions_use_inline_picker(&app));
    assert!(text[0].starts_with("  /cmd-1"));
    assert!(text[2].starts_with("> /cmd-3"));
    assert_eq!(lines[0].spans[0].style.fg, subtle_aux_text_style().fg);
    assert_eq!(lines[2].spans[0].style.fg, Some(Color::White));
}

#[test]
fn slash_suggestions_use_inline_layout_without_footer_or_title() {
    let mut app = build_view_model(ChatMessage::new(MessageRole::User, "/"));
    app.input_suggestion_kind = Some(InputSuggestionKind::Slash);
    app.slash_suggestions = vec![
        InputSuggestion::simple("/help"),
        InputSuggestion::simple("/model"),
        InputSuggestion::simple("/sessions"),
    ];
    app.selected_suggestion = 1;

    let lines = render_ui_lines(&app, 80, 20);

    assert!(lines.iter().any(|line| line.contains("> /model")));
    assert!(
        !lines
            .iter()
            .any(|line| line.contains(t!("ui.suggestion.title.slash").as_ref()))
    );
    assert!(
        !lines
            .iter()
            .any(|line| line.contains(t!("ui.footer.preview").as_ref()))
    );
}

#[test]
fn marketplace_catalog_reuses_minimal_picker_with_search() {
    let mut app = build_view_model(ChatMessage::new(
        MessageRole::User,
        "/extensions marketplace",
    ));
    app.marketplace_view = Some(MarketplaceViewModel {
        step: MarketplaceFlowStep::CatalogPicker,
        query: "css".to_string(),
        error: None,
        catalog_items: Vec::new(),
        selected_item: None,
        detail: None,
        slash: SlashFlowView {
            title: "扩展".to_string(),
            subtitle: None,
            search: Some(SlashFlowSearchView {
                value: "css".to_string(),
                placeholder: "输入扩展名称、作者或关键词".to_string(),
            }),
            empty_text: "没有匹配的扩展。".to_string(),
            selected_index: 1,
            items: vec![
                SlashFlowItemView {
                    label: "System message demo".to_string(),
                    summary: "This is an extension example.".to_string(),
                    details: Vec::new(),
                    disabled: false,
                    muted: false,
                },
                SlashFlowItemView {
                    label: "Void Desktop CSS".to_string(),
                    summary: "Desktop CSS extension.".to_string(),
                    details: Vec::new(),
                    disabled: false,
                    muted: false,
                },
            ],
            compact_items: true,
            footer_hint: "Enter 打开  Esc 关闭".to_string(),
        },
        readme_scroll: 0,
    });

    let lines = render_ui_lines(&app, 80, 20);

    assert!(
        lines
            .iter()
            .any(|line| line.contains("搜") && line.contains(":") && line.contains("css"))
    );
    assert!(lines.iter().any(|line| line.contains("> Void Desktop CSS")));
    assert!(!lines.iter().any(|line| line.contains("扩展市场")));
    assert!(!lines.iter().any(|line| line.contains("共 2 项")));
    assert!(!lines.iter().any(|line| line.contains("Enter 打开")));
}

#[test]
fn single_slash_suggestion_details_align_with_usage_heading() {
    let mut app = build_view_model(ChatMessage::new(MessageRole::User, "/model"));
    app.input_suggestion_kind = Some(InputSuggestionKind::Slash);
    app.slash_suggestions = vec![InputSuggestion::simple("/model")];

    let lines = render_text_lines(build_suggestion_lines(&app, 5, 64));
    let usage_idx = lines
        .iter()
        .position(|line| line == "Usage")
        .expect("usage heading exists");

    assert_eq!(lines[usage_idx + 1], "/model list");
    assert_eq!(lines[usage_idx + 2], "/model use <name>");
}

#[test]
fn start_implementing_slash_suggestion_shows_summary() {
    let suggestion = InputSuggestion::simple("/start-implementing");
    let summary = super::pickers::suggestion_summary(&suggestion);

    assert_eq!(
        summary,
        t!("ui.suggestion.summary.start_implementing").into_owned()
    );
    assert!(!summary.is_empty());
}

#[test]
fn file_reference_suggestions_reuse_inline_picker_styles_and_scroll_window() {
    let mut app = build_view_model(ChatMessage::new(MessageRole::User, "@src/"));
    app.input_suggestion_kind = Some(InputSuggestionKind::FileReference);
    app.slash_suggestions = (0..7)
        .map(|idx| InputSuggestion {
            label: format!("src/file-{idx}.rs"),
            replacement: format!("src/file-{idx}.rs"),
            summary: String::new(),
            details: Vec::new(),
        })
        .collect();
    app.selected_suggestion = 3;

    let lines = build_suggestion_lines(&app, 5, 48);
    let text = render_text_lines(lines.clone());

    assert!(suggestions_use_inline_picker(&app));
    assert!(text[0].starts_with("  src/file-1.rs"));
    assert!(text[2].starts_with("> src/file-3.rs"));
    assert_eq!(lines[0].spans[0].style.fg, subtle_aux_text_style().fg);
    assert_eq!(lines[2].spans[0].style.fg, Some(Color::White));
}

#[test]
fn file_reference_suggestions_use_inline_layout_without_footer_or_title() {
    let mut app = build_view_model(ChatMessage::new(MessageRole::User, "@src/"));
    app.input_suggestion_kind = Some(InputSuggestionKind::FileReference);
    app.slash_suggestions = vec![InputSuggestion::simple("src/ui.rs")];

    let lines = render_ui_lines(&app, 80, 20);

    assert!(lines.iter().any(|line| line.contains("> src/ui.rs")));
    assert!(
        !lines
            .iter()
            .any(|line| line.contains(t!("ui.suggestion.title.file_reference").as_ref()))
    );
    assert!(
        !lines
            .iter()
            .any(|line| line.contains(t!("ui.footer.preview").as_ref()))
    );
}

#[test]
fn bottom_form_wrap_preserves_zero_width_combining_marks() {
    let lines = bottom_form_wrap_logical_line("e\u{301}", 1);

    assert_eq!(lines, vec!["e\u{301}".to_string(), String::new()]);
}

#[test]
fn bottom_form_wrap_skips_glyphs_wider_than_available_width() {
    let lines = bottom_form_wrap_logical_line("你A", 1);

    assert_eq!(lines, vec!["A".to_string(), String::new()]);
}

#[test]
fn truncate_from_left_keeps_combining_marks_on_tail() {
    assert_eq!(truncate_from_left_to_width("abce\u{301}", 3), "…ce\u{301}");
}

#[test]
fn rewind_picker_renders_selected_message_in_history_panel() {
    let mut app = build_view_model(ChatMessage::new(MessageRole::User, "先确认需求"));
    app.messages
        .push(ChatMessage::new(MessageRole::Agent, "我先看一下上下文。"));
    app.messages
        .push(ChatMessage::new(MessageRole::User, "再整理一下实现方案"));
    app.rewind_picker = Some(RewindPickerView {
        selected_message_id: 3,
        selectable_message_ids: vec![1, 3],
    });

    let history_lines = render_text_lines(build_history_lines(&app, 120));
    let selected_lines = render_message_lines(&app, &app.messages[2], 2);

    assert!(
        history_lines
            .iter()
            .any(|line| line.contains("我先看一下上下文。"))
    );
    assert!(
        history_lines
            .iter()
            .any(|line| line.contains("再整理一下实现方案"))
    );
    assert!(
        history_lines
            .iter()
            .all(|line| !line.contains("消息回溯") && !line.contains("Message Rewind"))
    );
    assert_eq!(selected_lines[0].spans[0].style.fg, Some(Color::White));
    assert!(
        selected_lines[0]
            .spans
            .iter()
            .skip(1)
            .any(|span| span.style.fg == Some(Color::White))
    );
}

#[test]
fn rewind_picker_deemphasizes_assistant_messages() {
    let mut app = build_view_model(ChatMessage::new(MessageRole::Agent, "我先看一下上下文。"));
    app.rewind_picker = Some(RewindPickerView {
        selected_message_id: 2,
        selectable_message_ids: vec![2],
    });

    let lines = render_message_lines(&app, &app.messages[0], 0);

    assert!(
        lines[0]
            .spans
            .iter()
            .all(|span| span.style.add_modifier.contains(Modifier::DIM))
    );
}

#[test]
fn rewind_picker_deemphasizes_tool_messages() {
    let mut app = build_view_model(ChatMessage::with_tool_block(
        MessageRole::Agent,
        "",
        ToolUiBlock {
            tool_call_id: Some("tool-1".to_string()),
            tool_name: "read_file".to_string(),
            phase: ToolUiPhase::Succeeded,
            headline: "读取了一个文件".to_string(),
            detail_lines: vec!["/tmp/demo.txt".to_string()],
            image_paths: Vec::new(),
            args_excerpt: None,
            output_excerpt: None,
        },
    ));
    app.rewind_picker = Some(RewindPickerView {
        selected_message_id: 2,
        selectable_message_ids: vec![2],
    });

    let lines = render_message_lines(&app, &app.messages[0], 0);

    assert!(lines.iter().all(|line| {
        line.spans
            .iter()
            .all(|span| span.style.add_modifier.contains(Modifier::DIM))
    }));
}

#[test]
fn rewind_picker_deemphasizes_non_selectable_user_messages() {
    let mut app = build_view_model(ChatMessage::new(MessageRole::User, "/sessions"));
    app.messages
        .push(ChatMessage::new(MessageRole::User, "真正发给模型的消息"));
    app.rewind_picker = Some(RewindPickerView {
        selected_message_id: 2,
        selectable_message_ids: vec![2],
    });

    let lines = render_message_lines(&app, &app.messages[0], 0);

    assert!(
        lines[0]
            .spans
            .iter()
            .all(|span| span.style.add_modifier.contains(Modifier::DIM))
    );
}

#[test]
fn stored_tool_progress_renders_after_agent_message_body() {
    let mut app = build_view_model(ChatMessage::new(
        MessageRole::Agent,
        "我来帮您执行这个命令。",
    ));
    app.assistant_aux_by_message.insert(
        0,
        AssistantAuxData {
            thinking: Some("准备调用工具: run_shell_command".to_string()),
            compaction: None,
        },
    );

    let lines = render_text_lines(render_message_lines(&app, &app.messages[0], 0));
    let body_idx = lines
        .iter()
        .position(|line| line.contains("我来帮您执行这个命令。"))
        .expect("body line exists");
    let tool_idx = lines
        .iter()
        .position(|line| line.contains("准备调用工具: run_shell_command"))
        .expect("tool progress line exists");

    assert!(body_idx < tool_idx);
}

#[test]
fn real_thinking_stays_before_agent_message_body() {
    let mut app = build_view_model(ChatMessage::new(
        MessageRole::Agent,
        "我来帮您执行这个命令。",
    ));
    app.assistant_aux_by_message.insert(
        0,
        AssistantAuxData {
            thinking: Some("先检查命令参数是否安全。".to_string()),
            compaction: None,
        },
    );

    let lines = render_text_lines(render_message_lines(&app, &app.messages[0], 0));
    let thinking_idx = lines
        .iter()
        .position(|line| line.contains("先检查命令参数是否安全。"))
        .expect("thinking line exists");
    let body_idx = lines
        .iter()
        .position(|line| line.contains("我来帮您执行这个命令。"))
        .expect("body line exists");

    assert!(thinking_idx < body_idx);
}

#[test]
fn embedded_thinking_renders_in_aux_details_without_raw_tags() {
    let app = build_view_model(ChatMessage::new(
        MessageRole::Agent,
        "<think>先看一下项目结构。</think>\n\n我已经梳理完主要模块。",
    ));

    let lines = render_text_lines(render_message_lines(&app, &app.messages[0], 0));
    let thinking_idx = lines
        .iter()
        .position(|line| line.contains("先看一下项目结构。"))
        .expect("embedded thinking line exists");
    let body_idx = lines
        .iter()
        .position(|line| line.contains("我已经梳理完主要模块。"))
        .expect("body line exists");

    assert!(thinking_idx < body_idx);
    assert!(lines.iter().all(|line| !line.contains("<think>")));
    assert!(lines.iter().all(|line| !line.contains("</think>")));
}

#[test]
fn embedded_thinking_is_hidden_when_aux_details_collapsed() {
    let mut app = build_view_model(ChatMessage::new(
        MessageRole::Agent,
        "<think>先看一下项目结构。</think>\n\n我已经梳理完主要模块。",
    ));
    app.show_aux_details = false;

    let lines = render_text_lines(render_message_lines(&app, &app.messages[0], 0));

    assert!(
        lines
            .iter()
            .any(|line| line.contains("我已经梳理完主要模块。"))
    );
    assert!(
        lines
            .iter()
            .all(|line| !line.contains("先看一下项目结构。"))
    );
    assert!(lines.iter().all(|line| !line.contains("<think>")));
}

#[test]
fn thinking_only_message_stays_invisible_when_aux_details_collapsed() {
    let mut app = build_view_model(ChatMessage::new(
        MessageRole::Agent,
        "<think>先看一下项目结构。</think>",
    ));
    app.show_aux_details = false;

    let lines = render_text_lines(render_message_lines(&app, &app.messages[0], 0));

    assert!(lines.is_empty());
}

#[test]
fn pending_thinking_detail_is_hidden_when_aux_details_collapsed() {
    let mut app = build_view_model(ChatMessage::new(MessageRole::Agent, "我来处理这个问题。"));
    app.show_aux_details = false;
    app.pending_response_active = true;
    app.pending_assistant_msg_index = Some(0);
    app.pending_aux = Some(PendingAssistantAux {
        kind: AssistantAuxKind::Thinking,
        status_text: "Thinking...".to_string(),
        detail_text: Some("先检查当前渲染分支。".to_string()),
    });

    let lines = render_text_lines(render_message_lines(&app, &app.messages[0], 0));

    assert!(lines.iter().any(|line| line.contains("Thinking...")));
    assert!(lines.iter().any(|line| line.contains("我来处理这个问题。")));
    assert!(
        lines
            .iter()
            .all(|line| !line.contains("先检查当前渲染分支。"))
    );
}

#[test]
fn pending_thinking_detail_is_visible_when_aux_details_expanded() {
    let mut app = build_view_model(ChatMessage::new(MessageRole::Agent, "我来处理这个问题。"));
    app.pending_response_active = true;
    app.pending_assistant_msg_index = Some(0);
    app.pending_aux = Some(PendingAssistantAux {
        kind: AssistantAuxKind::Thinking,
        status_text: "Thinking...".to_string(),
        detail_text: Some("先检查当前渲染分支。".to_string()),
    });

    let lines = render_text_lines(render_message_lines(&app, &app.messages[0], 0));

    assert!(lines.iter().any(|line| line.contains("Thinking...")));
    assert!(
        lines
            .iter()
            .any(|line| line.contains("先检查当前渲染分支。"))
    );
}

#[test]
fn standalone_subagent_pending_aux_renders_in_history() {
    let mut app = build_view_model(ChatMessage::new(MessageRole::Agent, "已开始处理。"));
    app.pending_response_active = true;
    app.pending_assistant_msg_index = None;
    app.pending_aux = Some(PendingAssistantAux {
        kind: AssistantAuxKind::Thinking,
        status_text: "| 官方新闻抓取: 正在执行".to_string(),
        detail_text: None,
    });

    let lines = render_text_lines(build_history_lines(&app, 120));

    assert!(lines.iter().any(|line| line.contains("已开始处理。")));
    assert!(
        lines
            .iter()
            .any(|line| line.contains("官方新闻抓取: 正在执行"))
    );
    assert!(
        lines
            .iter()
            .all(|line| !line.contains("| 官方新闻抓取: 正在执行"))
    );
}

#[test]
fn standalone_pending_aux_hides_detail_when_collapsed() {
    let mut app = build_view_model(ChatMessage::new(MessageRole::Agent, "已开始处理。"));
    app.show_aux_details = false;
    app.pending_response_active = true;
    app.pending_assistant_msg_index = None;
    app.pending_aux = Some(PendingAssistantAux {
        kind: AssistantAuxKind::Thinking,
        status_text: "| Thinking...".to_string(),
        detail_text: Some("继续等待子会话返回。".to_string()),
    });

    let lines = render_text_lines(build_history_lines(&app, 120));

    assert!(lines.iter().any(|line| line.contains("Thinking...")));
    assert!(
        lines
            .iter()
            .all(|line| !line.contains("继续等待子会话返回。"))
    );
}

#[test]
fn persisted_standalone_subagent_pending_aux_renders_after_completion() {
    let mut app = build_view_model(ChatMessage::new(MessageRole::Agent, "子代理已完成任务。"));
    app.pending_response_active = false;
    app.pending_assistant_msg_index = None;
    app.pending_aux = None;
    app.persisted_standalone_pending_aux = Some(PendingAssistantAux {
        kind: AssistantAuxKind::Thinking,
        status_text: "| 官方新闻抓取: 已完成".to_string(),
        detail_text: None,
    });
    app.persisted_standalone_pending_aux_anchor = Some(0);

    let lines = render_text_lines(build_history_lines(&app, 120));

    assert!(lines.iter().any(|line| line.contains("子代理已完成任务。")));
    assert!(
        lines
            .iter()
            .any(|line| line.contains("官方新闻抓取: 已完成"))
    );
}

#[test]
fn persisted_subagent_status_wins_over_generic_pending_thinking() {
    let mut app = build_view_model(ChatMessage::new(MessageRole::Agent, "父会话准备整理结果。"));
    app.messages
        .push(ChatMessage::new(MessageRole::Agent, String::new()));
    app.pending_response_active = true;
    app.pending_assistant_msg_index = Some(1);
    app.pending_aux = Some(PendingAssistantAux {
        kind: AssistantAuxKind::Thinking,
        status_text: "| Thinking...".to_string(),
        detail_text: Some("继续等待父会话收尾。".to_string()),
    });
    app.persisted_standalone_pending_aux = Some(PendingAssistantAux {
        kind: AssistantAuxKind::Thinking,
        status_text: "| 整理当前会话结果: 成功".to_string(),
        detail_text: None,
    });
    app.persisted_standalone_pending_aux_anchor = Some(1);

    let lines = render_text_lines(build_history_lines(&app, 120));
    let status_idx = lines
        .iter()
        .position(|line| line.contains("整理当前会话结果: 成功"))
        .expect("status line exists");
    let thinking_idx = lines
        .iter()
        .position(|line| line.contains("Thinking..."))
        .expect("thinking line exists");

    assert!(status_idx < thinking_idx);
}

#[test]
fn persisted_subagent_status_renders_before_parent_streaming_reply() {
    let mut app = build_view_model(ChatMessage::new(MessageRole::Agent, "子代理已完成任务。"));
    app.messages.push(ChatMessage::new(
        MessageRole::Agent,
        "工具调用成功！子代理已经返回了结构化结果。",
    ));
    app.pending_response_active = true;
    app.pending_assistant_msg_index = Some(1);
    app.pending_aux = Some(PendingAssistantAux {
        kind: AssistantAuxKind::Thinking,
        status_text: "| Thinking...".to_string(),
        detail_text: Some("父会话还在组织总结。".to_string()),
    });
    app.persisted_standalone_pending_aux = Some(PendingAssistantAux {
        kind: AssistantAuxKind::Thinking,
        status_text: "| 执行一次疯狂的压力测试: 成功".to_string(),
        detail_text: None,
    });
    app.persisted_standalone_pending_aux_anchor = Some(1);

    let lines = render_text_lines(build_history_lines(&app, 120));
    let status_idx = lines
        .iter()
        .position(|line| line.contains("执行一次疯狂的压力测试: 成功"))
        .expect("status line exists");
    let thinking_idx = lines
        .iter()
        .position(|line| line.contains("Thinking..."))
        .expect("thinking line exists");
    let parent_idx = lines
        .iter()
        .position(|line| line.contains("工具调用成功！子代理已经返回了结构化结果。"))
        .expect("parent reply line exists");

    assert!(status_idx < parent_idx);
    assert!(thinking_idx < parent_idx);
}

#[test]
fn persisted_subagent_status_stays_above_parent_reply_after_completion() {
    let mut app = build_view_model(ChatMessage::new(MessageRole::Agent, "子代理已完成任务。"));
    app.messages.push(ChatMessage::new(
        MessageRole::Agent,
        "开发者调试测试任务：子代理测试任务执行成功。",
    ));
    app.pending_response_active = false;
    app.pending_assistant_msg_index = None;
    app.pending_aux = None;
    app.persisted_standalone_pending_aux = Some(PendingAssistantAux {
        kind: AssistantAuxKind::Thinking,
        status_text: "| 子代理调试任务: 成功".to_string(),
        detail_text: None,
    });
    app.persisted_standalone_pending_aux_anchor = Some(1);

    let lines = render_text_lines(build_history_lines(&app, 120));
    let status_idx = lines
        .iter()
        .position(|line| line.contains("子代理调试任务: 成功"))
        .expect("status line exists");
    let parent_idx = lines
        .iter()
        .position(|line| line.contains("开发者调试测试任务：子代理测试任务执行成功。"))
        .expect("parent reply line exists");

    assert!(status_idx < parent_idx);
}

#[test]
fn persisted_subagent_status_stays_anchored_after_later_user_message() {
    let mut app = build_view_model(ChatMessage::new(MessageRole::Agent, "子代理已完成任务。"));
    app.messages.push(ChatMessage::new(
        MessageRole::Agent,
        "开发者调试测试任务：子代理测试任务执行成功。",
    ));
    app.messages
        .push(ChatMessage::new(MessageRole::User, "/model"));
    app.pending_response_active = false;
    app.pending_assistant_msg_index = None;
    app.pending_aux = None;
    app.persisted_standalone_pending_aux = Some(PendingAssistantAux {
        kind: AssistantAuxKind::Thinking,
        status_text: "| 子代理调试任务: 成功".to_string(),
        detail_text: None,
    });
    app.persisted_standalone_pending_aux_anchor = Some(1);

    let lines = render_text_lines(build_history_lines(&app, 120));
    let status_idx = lines
        .iter()
        .position(|line| line.contains("子代理调试任务: 成功"))
        .expect("status line exists");
    let parent_idx = lines
        .iter()
        .position(|line| line.contains("开发者调试测试任务：子代理测试任务执行成功。"))
        .expect("parent reply line exists");
    let later_user_idx = lines
        .iter()
        .position(|line| line.contains("/model"))
        .expect("later user line exists");

    assert!(status_idx < parent_idx);
    assert!(parent_idx < later_user_idx);
}

#[test]
fn persisted_subagent_status_renders_as_separate_message_before_parent_reply_after_later_user_message()
 {
    let mut app = build_view_model(ChatMessage::new(MessageRole::Agent, "子代理已完成任务。"));
    app.messages.push(ChatMessage::new(
        MessageRole::Agent,
        "开发者调试测试任务：子代理测试任务执行成功。",
    ));
    app.messages
        .push(ChatMessage::new(MessageRole::User, "/model"));
    app.pending_response_active = false;
    app.pending_assistant_msg_index = None;
    app.pending_aux = None;
    app.persisted_standalone_pending_aux = Some(PendingAssistantAux {
        kind: AssistantAuxKind::Thinking,
        status_text: "| 子代理调试任务: 成功".to_string(),
        detail_text: None,
    });
    app.persisted_standalone_pending_aux_anchor = Some(1);

    let lines = render_text_lines(build_history_lines(&app, 120));
    let status_idx = lines
        .iter()
        .position(|line| line.contains("子代理调试任务: 成功"))
        .expect("status line exists");
    let parent_idx = lines
        .iter()
        .position(|line| line.contains("开发者调试测试任务：子代理测试任务执行成功。"))
        .expect("parent reply line exists");

    assert!(lines[status_idx].starts_with("> "));
    assert!(lines[parent_idx].starts_with("> "));
    assert!(parent_idx > status_idx + 1);
}

#[test]
fn subagent_pending_aux_detail_is_hidden_when_aux_details_collapsed() {
    let view = build_subagent_detail_view(Some(PendingAssistantAux {
        kind: AssistantAuxKind::Thinking,
        status_text: "| Thinking...".to_string(),
        detail_text: Some("先检查子会话当前进展。".to_string()),
    }));

    let lines = render_text_lines(build_subagent_history_lines(&view, false));

    assert!(lines.iter().any(|line| line.contains("Thinking...")));
    assert!(
        lines
            .iter()
            .all(|line| !line.contains("先检查子会话当前进展。"))
    );
}

#[test]
fn subagent_pending_aux_detail_is_visible_when_aux_details_expanded() {
    let view = build_subagent_detail_view(Some(PendingAssistantAux {
        kind: AssistantAuxKind::Thinking,
        status_text: "| Thinking...".to_string(),
        detail_text: Some("先检查子会话当前进展。".to_string()),
    }));

    let lines = render_text_lines(build_subagent_history_lines(&view, true));

    assert!(lines.iter().any(|line| line.contains("Thinking...")));
    assert!(
        lines
            .iter()
            .any(|line| line.contains("先检查子会话当前进展。"))
    );
}

#[test]
fn subagent_tool_card_hides_output_when_aux_details_collapsed() {
    let tool = ToolUiBlock {
        tool_call_id: Some("call-1".to_string()),
        tool_name: "grep".to_string(),
        phase: ToolUiPhase::Succeeded,
        headline: "搜索完成".to_string(),
        detail_lines: vec!["查询: 最近变更".to_string()],
        image_paths: Vec::new(),
        args_excerpt: Some("{\n  \"limit\": 3\n}".to_string()),
        output_excerpt: Some("命中 3 个结果。".to_string()),
    };
    let message = ChatMessage::with_tool_block(MessageRole::Agent, String::new(), tool);

    let lines = render_text_lines(render_subagent_message_lines(&message, false));

    assert!(lines.iter().any(|line| line.contains("搜索完成")));
    assert!(lines.iter().all(|line| !line.contains("命中 3 个结果。")));
    assert!(lines.iter().all(|line| !line.contains("\"limit\": 3")));
}

#[test]
fn subagent_tool_card_shows_output_when_aux_details_expanded() {
    let tool = ToolUiBlock {
        tool_call_id: Some("call-1".to_string()),
        tool_name: "grep".to_string(),
        phase: ToolUiPhase::Succeeded,
        headline: "搜索完成".to_string(),
        detail_lines: vec!["查询: 最近变更".to_string()],
        image_paths: Vec::new(),
        args_excerpt: Some("{\n  \"limit\": 3\n}".to_string()),
        output_excerpt: Some("命中 3 个结果。".to_string()),
    };
    let message = ChatMessage::with_tool_block(MessageRole::Agent, String::new(), tool);

    let lines = render_text_lines(render_subagent_message_lines(&message, true));

    assert!(lines.iter().any(|line| line.contains("搜索完成")));
    assert!(lines.iter().any(|line| line.contains("命中 3 个结果。")));
    assert!(lines.iter().any(|line| line.contains("\"limit\": 3")));
}

#[test]
fn shell_pending_approval_title_line_shows_reason_instead_of_call_id() {
    let app = build_view_model(ChatMessage::with_tool_block(
        MessageRole::Agent,
        String::new(),
        ToolUiBlock {
            tool_call_id: Some("call_00_demo_reason".to_string()),
            tool_name: "run_shell_command".to_string(),
            phase: ToolUiPhase::PendingApproval,
            headline: "查看构建输出".to_string(),
            detail_lines: vec![
                "高风险工具调用: shell".to_string(),
                "命令: cargo test -p spirit-agent".to_string(),
            ],
            image_paths: Vec::new(),
            args_excerpt: None,
            output_excerpt: None,
        },
    ));

    let lines = render_text_lines(render_message_lines(&app, &app.messages[0], 0));

    assert!(lines[0].contains("run_shell_command"));
    assert!(lines[0].contains(t!("ui.tool.phase.pending_approval").as_ref()));
    assert!(lines[0].contains("查看构建输出"));
    assert!(!lines[0].contains("call_00_demo_reason"));
    assert!(!lines.iter().any(|line| line == "  ▌ 查看构建输出"));
}

#[test]
fn generate_image_tool_card_shows_structured_path_when_aux_details_collapsed() {
    let mut app = build_view_model(ChatMessage::with_tool_block(
        MessageRole::Agent,
        String::new(),
        ToolUiBlock {
            tool_call_id: Some("call-image-1".to_string()),
            tool_name: "generate_image".to_string(),
            phase: ToolUiPhase::Succeeded,
            headline: "图片生成完成".to_string(),
            detail_lines: Vec::new(),
            image_paths: vec![
                "C:/Users/pc/AppData/Roaming/SpiritAgent/generated-images/example.png"
                    .to_string(),
            ],
            args_excerpt: Some("{\n  \"prompt\": \"画一张图\"\n}".to_string()),
            output_excerpt: Some("[generated image]\npath: C:/Users/pc/AppData/Roaming/SpiritAgent/generated-images/example.png".to_string()),
        },
    ));
    app.show_aux_details = false;

    let lines = render_text_lines(render_message_lines(&app, &app.messages[0], 0));

    assert!(lines.iter().any(|line| line.contains("图片生成完成")));
    assert!(lines.iter().any(|line| {
        line.contains("路径: C:/Users/pc/AppData/Roaming/SpiritAgent/generated-images/example.png")
    }));
    assert!(
        lines
            .iter()
            .all(|line| !line.contains("\"prompt\": \"画一张图\""))
    );
    assert!(lines.iter().all(|line| !line.contains("[generated image]")));
}

#[test]
fn generate_image_tool_card_keeps_rail_on_wrapped_path_lines() {
    let mut app = build_view_model(ChatMessage::with_tool_block(
        MessageRole::Agent,
        String::new(),
        ToolUiBlock {
            tool_call_id: Some("call-image-wrap".to_string()),
            tool_name: "generate_image".to_string(),
            phase: ToolUiPhase::Succeeded,
            headline: "图片生成完成".to_string(),
            detail_lines: vec![
                "路径: C:/Users/pc/AppData/Roaming/SpiritAgent/generated-images/this-is-a-very-long-image-name-that-must-wrap/example-output.png"
                    .to_string(),
            ],
            image_paths: Vec::new(),
            args_excerpt: None,
            output_excerpt: None,
        },
    ));
    app.show_aux_details = false;

    let (flat, _) = crate::conversation_select::flatten_wrapped_history(
        render_message_lines(&app, &app.messages[0], 0),
        28,
        None,
    );
    let lines = render_text_lines(flat);
    let path_line_index = lines
        .iter()
        .position(|line| line.contains("路径:"))
        .expect("path line exists");

    assert!(
        lines
            .get(path_line_index + 1)
            .is_some_and(|line| line.starts_with("  ▌ ")),
        "wrapped path continuation should keep tool rail: {lines:#?}"
    );
}

#[test]
fn generate_image_tool_card_selection_highlights_wrapped_rail_consistently() {
    let mut app = build_view_model(ChatMessage::with_tool_block(
        MessageRole::Agent,
        String::new(),
        ToolUiBlock {
            tool_call_id: Some("call-image-select-wrap".to_string()),
            tool_name: "generate_image".to_string(),
            phase: ToolUiPhase::Succeeded,
            headline: "图片生成完成".to_string(),
            detail_lines: vec![
                "路径: C:/Users/pc/AppData/Roaming/SpiritAgent/generated-images/this-is-a-very-long-image-name-that-must-wrap/example-output.png"
                    .to_string(),
            ],
            image_paths: Vec::new(),
            args_excerpt: None,
            output_excerpt: None,
        },
    ));
    app.show_aux_details = false;

    let message_lines = render_message_lines(&app, &app.messages[0], 0);
    let (flat, _) =
        crate::conversation_select::flatten_wrapped_history(message_lines.clone(), 28, None);
    let plain_lines = render_text_lines(flat);
    let continuation_index = plain_lines
        .iter()
        .position(|line| line.starts_with("  ▌ "))
        .expect("wrapped continuation line exists");

    let selection = crate::conversation_select::normalize_selection(
        crate::conversation_select::CellPointer {
            line: continuation_index,
            col: 0,
        },
        crate::conversation_select::CellPointer {
            line: continuation_index,
            col: 3,
        },
    );
    let (selected_flat, _) =
        crate::conversation_select::flatten_wrapped_history(message_lines, 28, Some(selection));
    let selected_line = &selected_flat[continuation_index];

    let mut covered_width = 0usize;
    let mut covered_spans = 0usize;
    for span in &selected_line.spans {
        let width = UnicodeWidthStr::width(span.content.as_ref());
        if width == 0 {
            continue;
        }
        covered_width += width;
        covered_spans += 1;
        assert!(
            span.style.add_modifier.contains(Modifier::REVERSED),
            "wrapped continuation prefix should be selection-highlighted: {selected_line:#?}"
        );
        if covered_width >= 4 {
            break;
        }
    }

    assert!(covered_spans > 0);
    assert!(covered_width >= 4);
}

#[test]
fn generate_image_history_render_reserves_image_block() {
    let app = build_view_model(ChatMessage::with_tool_block(
        MessageRole::Agent,
        String::new(),
        ToolUiBlock {
            tool_call_id: Some("call-image-range".to_string()),
            tool_name: "generate_image".to_string(),
            phase: ToolUiPhase::Succeeded,
            headline: "图片生成完成".to_string(),
            detail_lines: vec!["路径: demo.png".to_string()],
            image_paths: vec!["demo.png".to_string()],
            args_excerpt: None,
            output_excerpt: None,
        },
    ));

    let render = build_history_render_result(&app, 80);

    assert_eq!(render.image_blocks.len(), 1);
    assert!(render.image_blocks[0].reserved_rows >= 6);
    assert!(render.image_blocks[0].x_offset > 0);
}

#[test]
fn generate_image_ui_renders_halfblock_preview_from_local_file() {
    let file_path = test_image_path("halfblock-preview");
    if let Some(parent) = file_path.parent() {
        fs::create_dir_all(parent).expect("create ui test image dir");
    }
    let image = image::RgbaImage::from_pixel(16, 16, image::Rgba([255, 0, 0, 255]));
    image.save(&file_path).expect("save temp image");

    let app = build_view_model(ChatMessage::with_tool_block(
        MessageRole::Agent,
        String::new(),
        ToolUiBlock {
            tool_call_id: Some("call-image-render".to_string()),
            tool_name: "generate_image".to_string(),
            phase: ToolUiPhase::Succeeded,
            headline: "图片生成完成".to_string(),
            detail_lines: vec![format!("路径: {}", file_path.display())],
            image_paths: vec![file_path.to_string_lossy().to_string()],
            args_excerpt: None,
            output_excerpt: None,
        },
    ));

    let (lines, buffer) = render_ui_snapshot(&app, 80, 36);
    let file_name = file_path
        .file_name()
        .and_then(|name| name.to_str())
        .expect("temp image file name");
    let path_index = lines
        .iter()
        .position(|line| line.contains(file_name))
        .expect("path line exists");

    let has_red_pixels = ((path_index + 1) as u16..=(path_index + 12) as u16).any(|y| {
        (0..80).any(|x| {
            let cell = &buffer[(x, y)];
            cell.fg == ratatui::style::Color::Rgb(255, 0, 0)
                || cell.bg == ratatui::style::Color::Rgb(255, 0, 0)
        })
    });

    assert!(
        has_red_pixels,
        "expected colored image pixels below generated path"
    );

    let _ = fs::remove_file(file_path);
}

#[test]
fn assistant_prefix_stays_with_first_wrapped_cjk_line() {
    let app = build_view_model(ChatMessage::new(
        MessageRole::Agent,
        "我注意到您使用了中文表达情绪。请问有什么我可以帮助您解决的问题吗？",
    ));

    let (flat, _) = crate::conversation_select::flatten_wrapped_history(
        render_message_lines(&app, &app.messages[0], 0),
        18,
        None,
    );
    let lines = render_text_lines(flat);

    assert!(lines.first().is_some_and(|line| line.contains("我")));
    assert!(lines.first().is_some_and(|line| !line.trim().eq(">")));
}

#[test]
fn assistant_soft_wrap_continuation_aligns_with_text_column() {
    let app = build_view_model(ChatMessage::new(
        MessageRole::Agent,
        "我理解您可能感到沮丧或生气，但使用粗口并不能帮助我们解决问题。如果您遇到了什么困难或需要帮助，请告诉我具体的情况，我会尽力为您提供有用的支持和建议。",
    ));

    let (flat, _) = crate::conversation_select::flatten_wrapped_history(
        render_message_lines(&app, &app.messages[0], 0),
        28,
        None,
    );
    let lines = render_text_lines(flat);

    assert!(lines.first().is_some_and(|line| line.starts_with("> ")));
    assert!(lines.get(1).is_some_and(|line| line.starts_with("  ")));
    assert!(lines.get(1).is_some_and(|line| !line.starts_with("> ")));
}
