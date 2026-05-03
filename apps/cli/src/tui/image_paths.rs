use anyhow::{Context, Result};
use std::{env, fs, path::Path};

pub(super) fn parse_image_path_and_prompt(input: &str) -> (&str, &str) {
    let tail = input.trim();
    if tail.is_empty() {
        return ("", "");
    }

    if let Some(quote) = tail.chars().next().filter(|c| *c == '"' || *c == '\'') {
        let rest = &tail[quote.len_utf8()..];
        if let Some(end) = rest.find(quote) {
            let path = rest[..end].trim();
            let prompt = rest[end + quote.len_utf8()..].trim();
            return (path, prompt);
        }
    }

    for (idx, ch) in tail.char_indices() {
        if !ch.is_whitespace() {
            continue;
        }
        let candidate = tail[..idx].trim();
        if is_supported_image_path(candidate) {
            return (candidate, tail[idx..].trim());
        }
    }

    (tail, "")
}

pub(super) fn trim_wrapped_quotes(input: &str) -> &str {
    let trimmed = input.trim();
    if trimmed.len() >= 2 {
        let bytes = trimmed.as_bytes();
        if (bytes[0] == b'"' && bytes[trimmed.len() - 1] == b'"')
            || (bytes[0] == b'\'' && bytes[trimmed.len() - 1] == b'\'')
        {
            return &trimmed[1..trimmed.len() - 1];
        }
    }
    trimmed
}

pub(super) fn is_supported_image_path(path: &str) -> bool {
    let ext = Path::new(path)
        .extension()
        .and_then(|s| s.to_str())
        .map(|s| s.to_ascii_lowercase());

    matches!(
        ext.as_deref(),
        Some("png") | Some("jpg") | Some("jpeg") | Some("webp") | Some("gif") | Some("bmp")
    )
}

pub(super) fn list_local_image_files() -> Result<Vec<String>> {
    let cwd = env::current_dir().context("读取当前目录失败")?;
    let mut files = Vec::new();

    for entry in fs::read_dir(&cwd).context("遍历当前目录失败")? {
        let entry = entry.context("读取目录项失败")?;
        let path = entry.path();
        if !path.is_file() {
            continue;
        }

        let Some(path_str) = path.to_str() else {
            continue;
        };
        if !is_supported_image_path(path_str) {
            continue;
        }
        let display = path
            .strip_prefix(&cwd)
            .ok()
            .and_then(|p| p.to_str())
            .unwrap_or(path_str)
            .to_string();
        files.push(display);
    }

    files.sort_by_key(|s| s.to_ascii_lowercase());
    Ok(files)
}
