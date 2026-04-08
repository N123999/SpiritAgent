//! TUI slash command helpers.

pub(crate) fn default_commands() -> Vec<String> {
	vec![
		"/help".to_string(),
		"/clear".to_string(),
		"/quit".to_string(),
		"/exit".to_string(),
		"/model".to_string(),
		"/compact".to_string(),
		"/sessions".to_string(),
		"/image".to_string(),
		"/mcp".to_string(),
		"/log".to_string(),
	]
}

pub(crate) fn current_query(input: &str) -> Option<&str> {
	if !input.starts_with('/') || input.contains('\n') {
		return None;
	}
	Some(input.trim_end())
}

pub(crate) fn compute_suggestions(query: &str, slash_commands: &[String]) -> Vec<String> {
	let mut suggestions = slash_commands
		.iter()
		.filter(|cmd| cmd.starts_with(query))
		.cloned()
		.collect::<Vec<_>>();

	if suggestions.is_empty() {
		suggestions = contextual_suggestions(query)
			.into_iter()
			.map(ToString::to_string)
			.collect();
	}

	suggestions
}

pub(crate) fn apply_value(selected: &str) -> String {
	match selected {
		"/model" | "/sessions" | "/image" | "/mcp" | "/log" => {
			format!("{} ", selected)
		}
		_ => selected.to_string(),
	}
}

fn contextual_suggestions(query: &str) -> Vec<&'static str> {
	let q = query.trim_end();

	if q == "/model" || q.starts_with("/model ") {
		return vec!["/model"];
	}

	if q == "/sessions" || q.starts_with("/sessions ") {
		return vec![
			"/sessions",
			"/sessions save",
			"/sessions save <path>",
			"/sessions load <file>",
		];
	}

	if q == "/image" || q.starts_with("/image ") {
		return vec!["/image"];
	}

	if q == "/mcp" || q.starts_with("/mcp ") {
		return vec!["/mcp"];
	}

	if q == "/log" || q.starts_with("/log ") {
		return vec!["/log"];
	}

	Vec::new()
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn current_query_rejects_multiline_input() {
		assert_eq!(current_query("/mcp list"), Some("/mcp list"));
		assert_eq!(current_query("/mcp\nlist"), None);
		assert_eq!(current_query("hello"), None);
	}

	#[test]
	fn compute_suggestions_falls_back_to_contextual_matches() {
		let suggestions = compute_suggestions("/sessions ", &default_commands());

		assert_eq!(
			suggestions,
			vec![
				"/sessions".to_string(),
				"/sessions save".to_string(),
				"/sessions save <path>".to_string(),
				"/sessions load <file>".to_string(),
			]
		);
	}

	#[test]
	fn apply_value_appends_space_for_group_commands() {
		assert_eq!(apply_value("/mcp"), "/mcp ");
		assert_eq!(apply_value("/clear"), "/clear");
	}
}
