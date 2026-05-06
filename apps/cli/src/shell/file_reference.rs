#[cfg(test)]
use std::collections::HashSet;

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

#[cfg(test)]
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
            current_query("@host_runtime.rs", "@host_runtime.rs".chars().count()),
            Some(ActiveReferenceQuery {
                start: 0,
                end: "@host_runtime.rs".len(),
                raw: "@host_runtime.rs".to_string(),
            })
        );
        assert_eq!(
            current_query("先看 @host_runtime.rs 再说", "先看 @host".chars().count()),
            Some(ActiveReferenceQuery {
                start: "先看 ".len(),
                end: "先看 @host_runtime.rs".len(),
                raw: "@host_runtime.rs".to_string(),
            })
        );
        assert_eq!(
            current_query("@host_runtime.rs ", "@host_runtime.rs ".chars().count()),
            None
        );
        assert_eq!(
            current_query("host_runtime.rs", "host_runtime.rs".chars().count()),
            None
        );
    }

    #[test]
    fn replace_query_appends_single_space_when_confirmed() {
        let query = current_query("先看 @host", "先看 @host".chars().count()).unwrap();
        let (next, cursor) = replace_query("先看 @host", &query, "src/host_runtime.rs", true);

        assert_eq!(next, "先看 @src/host_runtime.rs ");
        assert_eq!(cursor, "先看 @src/host_runtime.rs ".chars().count());
    }

    #[test]
    fn referenced_paths_collects_multiple_unique_tokens() {
        assert_eq!(
            referenced_paths("@src/host_runtime.rs 请结合 @README.md 和 @src/host_runtime.rs 看"),
            vec!["src/host_runtime.rs".to_string(), "README.md".to_string()]
        );
    }
}
