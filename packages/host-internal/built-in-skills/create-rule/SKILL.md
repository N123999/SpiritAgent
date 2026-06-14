---
name: create-rule
description: Author or tighten a workspace or user rule file for future agents to read.
---

## Goal

Turn the user's request into a concise rule file that changes later agent behavior.

## Default scope

- Default to the workspace rule file.
- Switch to the user rule file only when the user explicitly asks for user-level, global, or personal rules.

## Target paths

- Workspace rule path: `<workspace_root>/.spirit/rule.md`
- User rule path: `<spirit_data_dir>/rule.md`
- If this active skill file lives at `<spirit_data_dir>/skills/create-rule/SKILL.md`, use that same `<spirit_data_dir>` when targeting the user scope.

## Requirements

1. Treat the task as a normal assistant conversation. Do not act like a silent generator.
2. The final rule file is for future agents or LLMs, not for human process management.
3. Keep the content short, strict, and actionable. Prefer only constraints that materially affect future coding behavior.
4. Read repository files first when facts are needed. Do not invent project structure, stack, or workflows.
5. Avoid low-signal process boilerplate such as release流程, contributor governance, severity taxonomies, or long generic checklists.
6. The rule file must start with a Markdown H1 heading.
7. Prefer short sections and short bullet lists.
8. If a fact will not change later agent behavior, leave it out.
9. For workspace scope, prioritize real repository-specific constraints, boundaries, validation commands, and coding preferences. For user scope, prioritize stable cross-repo personal collaboration preferences.
10. If the target rule file already exists, read it first and compress or tighten it instead of appending boilerplate.
11. Do not claim a file was created or updated before a tool call succeeds.

## Delivery

- If you can write to the target path, create or update the rule file directly after confirming the content.
- Otherwise, provide the full final rule file in the reply and clearly state that it was not written.
