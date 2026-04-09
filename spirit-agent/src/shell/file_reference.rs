use ignore::{DirEntry, WalkBuilder};
use std::{collections::HashSet, path::Path};

const DEFAULT_SUGGESTION_LIMIT: usize = 128;

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct ActiveReferenceQuery {
    pub start: usize,
    pub end: usize,
    pub raw: String,
}

pub(crate) fn current_query(input: &str, cursor_chars: usize) -> Option<ActiveReferenceQuery> {
    let cursor = char_to_byte_index(input, cursor_chars);
    let start = token_start(input, cursor);
    let end = token_end(input, cursor);
    if start >= end {
        return None;
    }

    let token = &input[start..end];
    if !token.starts_with('@') || token.contains('\n') {
        return None;
    }

    Some(ActiveReferenceQuery {
        start,
        end,
        raw: token.to_string(),
    })
}

pub(crate) fn replace_query(
    input: &str,
    query: &ActiveReferenceQuery,
    path: &str,
    finalize: bool,
) -> (String, usize) {
    let mut replacement = format!("@{}", path);
    let needs_space = match input[query.end..].chars().next() {
        Some(ch) => !ch.is_whitespace(),
        None => true,
    };
    if finalize && needs_space {
        replacement.push(' ');
    }

    let mut next = String::with_capacity(input.len() + replacement.len());
    next.push_str(&input[..query.start]);
    next.push_str(&replacement);
    next.push_str(&input[query.end..]);

    let next_cursor = input[..query.start].chars().count() + replacement.chars().count();
    (next, next_cursor)
}

pub(crate) fn referenced_paths(input: &str) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut paths = Vec::new();

    for token in input.split_whitespace() {
        let Some(path) = token.strip_prefix('@') else {
            continue;
        };
        if path.is_empty() {
            continue;
        }

        let normalized = path.replace('\\', "/");
        if seen.insert(normalized.clone()) {
            paths.push(normalized);
        }
    }

    paths
}

pub(crate) fn collect_workspace_files(workspace_root: &Path) -> Vec<String> {
    let mut walker = WalkBuilder::new(workspace_root);
    walker
        .current_dir(workspace_root)
        .hidden(false)
        .require_git(false)
        .filter_entry(reference_entry_allowed);

    let mut files = walker
        .build()
        .filter_map(Result::ok)
        .filter(|entry| entry.file_type().is_some_and(|file_type| file_type.is_file()))
        .filter_map(|entry| {
            entry
                .path()
                .strip_prefix(workspace_root)
                .ok()
                .map(|rel| rel.to_string_lossy().replace('\\', "/"))
        })
        .collect::<Vec<_>>();
    files.sort();
    files
}

pub(crate) fn compute_suggestions(query: &str, files: &[String]) -> Vec<String> {
    let needle = query
        .strip_prefix('@')
        .unwrap_or(query)
        .trim()
        .to_ascii_lowercase();

    let mut scored = files
        .iter()
        .filter_map(|path| {
            score_candidate(&needle, path).map(|(score, basename_len, path_len)| {
                (score, basename_len, path_len, path.clone())
            })
        })
        .collect::<Vec<_>>();

    scored.sort_by(|left, right| {
        right
            .0
            .cmp(&left.0)
            .then(left.1.cmp(&right.1))
            .then(left.2.cmp(&right.2))
            .then(left.3.cmp(&right.3))
    });

    scored
        .into_iter()
        .take(DEFAULT_SUGGESTION_LIMIT)
        .map(|(_, _, _, path)| path)
        .collect()
}

fn reference_entry_allowed(entry: &DirEntry) -> bool {
    if !entry.file_type().is_some_and(|file_type| file_type.is_dir()) {
        return true;
    }

    let Some(name) = entry.file_name().to_str() else {
        return true;
    };

    !matches!(name, ".git" | "target" | "node_modules" | "bin" | "obj")
}

fn score_candidate(needle: &str, path: &str) -> Option<(i32, usize, usize)> {
    let path_lower = path.to_ascii_lowercase();
    let basename = path.rsplit('/').next().unwrap_or(path);
    let basename_lower = basename.to_ascii_lowercase();
    let basename_len = basename.chars().count();
    let path_len = path.chars().count();

    if needle.is_empty() {
        return Some((0, basename_len, path_len));
    }

    if basename_lower == needle {
        return Some((10_000, basename_len, path_len));
    }
    if path_lower == needle {
        return Some((9_700, basename_len, path_len));
    }
    if basename_lower.starts_with(needle) {
        return Some((9_400 - basename_len as i32, basename_len, path_len));
    }
    if path_lower.ends_with(needle) {
        return Some((9_100 - path_len as i32, basename_len, path_len));
    }
    if let Some(pos) = basename_lower.find(needle) {
        return Some((8_600 - pos as i32 * 10, basename_len, path_len));
    }
    if let Some(pos) = path_lower.find(needle) {
        return Some((8_100 - pos as i32, basename_len, path_len));
    }
    if let Some(score) = subsequence_score(needle, &basename_lower) {
        return Some((7_000 + score, basename_len, path_len));
    }
    if let Some(score) = subsequence_score(needle, &path_lower) {
        return Some((6_000 + score, basename_len, path_len));
    }

    None
}

fn subsequence_score(needle: &str, haystack: &str) -> Option<i32> {
    let needle_chars = needle.chars().collect::<Vec<_>>();
    let haystack_chars = haystack.chars().collect::<Vec<_>>();
    let mut haystack_index = 0usize;
    let mut first_match = None;
    let mut last_match = 0usize;
    let mut consecutive_bonus = 0i32;
    let mut previous_match = None;

    for needle_char in needle_chars {
        let mut found = None;
        while haystack_index < haystack_chars.len() {
            if haystack_chars[haystack_index] == needle_char {
                found = Some(haystack_index);
                haystack_index += 1;
                break;
            }
            haystack_index += 1;
        }

        let found = found?;
        first_match.get_or_insert(found);
        if let Some(previous) = previous_match {
            if found == previous + 1 {
                consecutive_bonus += 12;
            }
        }
        previous_match = Some(found);
        last_match = found;
    }

    let first_match = first_match?;
    let span = last_match.saturating_sub(first_match);
    Some(1_000 - span as i32 - first_match as i32 + consecutive_bonus)
}

fn char_to_byte_index(input: &str, cursor_chars: usize) -> usize {
    if cursor_chars == 0 {
        return 0;
    }

    input
        .char_indices()
        .nth(cursor_chars)
        .map(|(idx, _)| idx)
        .unwrap_or(input.len())
}

fn token_start(input: &str, cursor: usize) -> usize {
    input[..cursor]
        .char_indices()
        .rev()
        .find(|(_, ch)| ch.is_whitespace())
        .map(|(idx, ch)| idx + ch.len_utf8())
        .unwrap_or(0)
}

fn token_end(input: &str, cursor: usize) -> usize {
    input[cursor..]
        .char_indices()
        .find(|(_, ch)| ch.is_whitespace())
        .map(|(idx, _)| cursor + idx)
        .unwrap_or(input.len())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn current_query_tracks_token_under_cursor() {
        assert_eq!(
            current_query("@runtime.rs", "@runtime.rs".chars().count()),
            Some(ActiveReferenceQuery {
                start: 0,
                end: "@runtime.rs".len(),
                raw: "@runtime.rs".to_string(),
            })
        );
        assert_eq!(
            current_query("先看 @runtime.rs 再说", "先看 @run".chars().count()),
            Some(ActiveReferenceQuery {
                start: "先看 ".len(),
                end: "先看 @runtime.rs".len(),
                raw: "@runtime.rs".to_string(),
            })
        );
        assert_eq!(current_query("@runtime.rs ", "@runtime.rs ".chars().count()), None);
        assert_eq!(current_query("runtime.rs", "runtime.rs".chars().count()), None);
    }

    #[test]
    fn fuzzy_suggestions_prioritize_exact_basename_match() {
        let files = vec![
            "src/view/runtime.rs".to_string(),
            "src/runtime.rs".to_string(),
            "src/tool_runtime.rs".to_string(),
            "README.md".to_string(),
        ];

        let suggestions = compute_suggestions("@runtime.rs", &files);

        assert_eq!(suggestions.first().map(String::as_str), Some("src/runtime.rs"));
    }

    #[test]
    fn replace_query_appends_single_space_when_confirmed() {
        let query = current_query("先看 @run", "先看 @run".chars().count()).unwrap();
        let (next, cursor) = replace_query("先看 @run", &query, "src/runtime.rs", true);

        assert_eq!(next, "先看 @src/runtime.rs ");
        assert_eq!(cursor, "先看 @src/runtime.rs ".chars().count());
    }

    #[test]
    fn referenced_paths_collects_multiple_unique_tokens() {
        assert_eq!(
            referenced_paths("@src/runtime.rs 请结合 @README.md 和 @src/runtime.rs 看"),
            vec!["src/runtime.rs".to_string(), "README.md".to_string()]
        );
    }
}