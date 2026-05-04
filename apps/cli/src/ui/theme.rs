use ratatui::{
    style::{Color, Style},
    text::{Line, Span},
};
use std::cell::RefCell;

use crate::view::{
    CliUiHookSlot, CliUiHookTokenRole, CliUiHookTokensView, CliUiHookVariant, CliUiHookView,
};

thread_local! {
    static ACTIVE_CLI_UI_HOOKS: RefCell<Vec<CliUiHookView>> = RefCell::new(Vec::new());
}

pub(in crate::ui) fn set_active_cli_ui_hooks(hooks: Vec<CliUiHookView>) {
    ACTIVE_CLI_UI_HOOKS.with(|active| {
        *active.borrow_mut() = hooks;
    });
}

pub(in crate::ui) fn clear_active_cli_ui_hooks() {
    ACTIVE_CLI_UI_HOOKS.with(|hooks| hooks.borrow_mut().clear());
}

pub(in crate::ui) fn subtle_aux_text_style() -> Style {
    Style::default().fg(Color::Rgb(128, 128, 128))
}

pub(in crate::ui) fn conversation_body_text_style() -> Style {
    Style::default().fg(Color::Rgb(170, 170, 170))
}

fn active_cli_ui_hook(slot: CliUiHookSlot) -> Option<CliUiHookView> {
    ACTIVE_CLI_UI_HOOKS.with(|hooks| {
        hooks
            .borrow()
            .iter()
            .rev()
            .find(|hook| hook.slot == slot)
            .cloned()
    })
}

fn cli_ui_token_color(role: CliUiHookTokenRole) -> Option<Color> {
    match role {
        CliUiHookTokenRole::Default => None,
        CliUiHookTokenRole::Primary => Some(Color::Cyan),
        CliUiHookTokenRole::Secondary => Some(Color::Rgb(190, 195, 205)),
        CliUiHookTokenRole::Muted => Some(Color::DarkGray),
        CliUiHookTokenRole::Accent => Some(Color::Magenta),
        CliUiHookTokenRole::Success => Some(Color::Green),
        CliUiHookTokenRole::Warning => Some(Color::Yellow),
        CliUiHookTokenRole::Danger => Some(Color::Red),
    }
}

fn cli_ui_variant_colors(variant: CliUiHookVariant) -> CliUiHookTokensView {
    match variant {
        CliUiHookVariant::Default => CliUiHookTokensView::default(),
        CliUiHookVariant::Accented => CliUiHookTokensView {
            border: Some(CliUiHookTokenRole::Accent),
            accent: Some(CliUiHookTokenRole::Accent),
            ..CliUiHookTokensView::default()
        },
        CliUiHookVariant::Muted => CliUiHookTokensView {
            foreground: Some(CliUiHookTokenRole::Muted),
            border: Some(CliUiHookTokenRole::Muted),
            ..CliUiHookTokensView::default()
        },
        CliUiHookVariant::Warning => CliUiHookTokensView {
            foreground: Some(CliUiHookTokenRole::Warning),
            border: Some(CliUiHookTokenRole::Warning),
            accent: Some(CliUiHookTokenRole::Warning),
        },
        CliUiHookVariant::Success => CliUiHookTokensView {
            foreground: Some(CliUiHookTokenRole::Success),
            border: Some(CliUiHookTokenRole::Success),
            accent: Some(CliUiHookTokenRole::Success),
        },
        CliUiHookVariant::Danger => CliUiHookTokensView {
            foreground: Some(CliUiHookTokenRole::Danger),
            border: Some(CliUiHookTokenRole::Danger),
            accent: Some(CliUiHookTokenRole::Danger),
        },
    }
}

fn cli_ui_token_role(
    hook: &CliUiHookView,
    selector: impl Fn(&CliUiHookTokensView) -> Option<CliUiHookTokenRole>,
) -> Option<CliUiHookTokenRole> {
    selector(&hook.tokens).or_else(|| {
        hook.variant
            .and_then(|variant| selector(&cli_ui_variant_colors(variant)))
    })
}

pub(in crate::ui) fn cli_ui_foreground_color(slot: CliUiHookSlot) -> Option<Color> {
    active_cli_ui_hook(slot)
        .and_then(|hook| cli_ui_token_role(&hook, |tokens| tokens.foreground))
        .and_then(cli_ui_token_color)
}

pub(in crate::ui) fn cli_ui_border_color(slot: CliUiHookSlot) -> Option<Color> {
    active_cli_ui_hook(slot)
        .and_then(|hook| cli_ui_token_role(&hook, |tokens| tokens.border))
        .and_then(cli_ui_token_color)
}

pub(in crate::ui) fn cli_ui_accent_color(slot: CliUiHookSlot) -> Option<Color> {
    active_cli_ui_hook(slot)
        .and_then(|hook| cli_ui_token_role(&hook, |tokens| tokens.accent))
        .and_then(cli_ui_token_color)
}

pub(in crate::ui) fn cli_ui_prefix(slot: CliUiHookSlot) -> Option<String> {
    active_cli_ui_hook(slot).and_then(|hook| hook.prefix)
}

pub(in crate::ui) fn cli_ui_suffix(slot: CliUiHookSlot) -> Option<String> {
    active_cli_ui_hook(slot).and_then(|hook| hook.suffix)
}

pub(in crate::ui) fn patch_style_foreground(style: Style, color: Option<Color>) -> Style {
    match color {
        Some(color) => style.fg(color),
        None => style,
    }
}

pub(in crate::ui) fn patch_style_border(style: Style, color: Option<Color>) -> Style {
    match color {
        Some(color) => style.fg(color),
        None => style,
    }
}

pub(in crate::ui) fn patch_lines_foreground(
    lines: Vec<Vec<Span<'static>>>,
    color: Option<Color>,
) -> Vec<Vec<Span<'static>>> {
    let Some(color) = color else {
        return lines;
    };

    lines
        .into_iter()
        .map(|line| {
            line.into_iter()
                .map(|span| Span::styled(span.content, span.style.fg(color)))
                .collect()
        })
        .collect()
}

pub(in crate::ui) fn patch_line_foreground(
    line: Line<'static>,
    color: Option<Color>,
) -> Line<'static> {
    let Some(color) = color else {
        return line;
    };

    let spans: Vec<Span<'static>> = line
        .spans
        .into_iter()
        .map(|span| Span::styled(span.content, span.style.fg(color)))
        .collect();
    Line::from(spans)
}

pub(in crate::ui) fn patch_line_style(
    line: Line<'static>,
    map: impl Fn(Style) -> Style + Copy,
) -> Line<'static> {
    let spans: Vec<Span<'static>> = line
        .spans
        .into_iter()
        .map(|span| Span::styled(span.content, map(span.style)))
        .collect();
    Line::from(spans)
}

pub(in crate::ui) fn patch_lines_style(
    lines: Vec<Line<'static>>,
    map: impl Fn(Style) -> Style + Copy,
) -> Vec<Line<'static>> {
    lines
        .into_iter()
        .map(|line| patch_line_style(line, map))
        .collect()
}
