---
name: create-skill
description: Author or tighten a workspace or user skill and write it to the managed skill roots.
---

## Goal

Turn the user's request into a high-signal `SKILL.md` under the managed skill roots.

## Default scope

- Default to the workspace skill root.
- Switch to the user skill root only when the user explicitly asks for user-level, global, cross-repo reuse, or writing to the user directory.

## Target paths

- Workspace skill path: `<workspace_root>/.spirit/skills/<skill_name>/SKILL.md`
- User skill path: `<spirit_data_dir>/skills/<skill_name>/SKILL.md`
- If this active skill file lives at `<spirit_data_dir>/skills/create-skill/SKILL.md`, use that same `<spirit_data_dir>` when targeting the user scope.

## Requirements

1. Treat the task as a normal assistant conversation. Do not pretend to be a silent background generator.
2. Choose a `skill_name` from the user request. It must be 1-64 characters, use only lowercase letters, digits, and hyphens, and must not start or end with `-` or contain `--`.
3. The target directory name and frontmatter `name` must exactly match that `skill_name`.
4. The final file path must be `<selected_root>/<skill_name>/SKILL.md`.
5. If the target skill already exists, read the existing `SKILL.md` first and compress or tighten it instead of appending boilerplate.
6. `SKILL.md` must start with YAML frontmatter containing at least `name` and `description`.
7. The body should explain what the skill does, when to use it, and how to do it. Prefer steps, input/output examples, edge cases, and relative paths over vague governance language.
8. When facts are needed, read repository files first. Do not invent project structure, stack, directories, or workflows.
9. If the skill references other files, use relative paths in the skill body.
10. For workspace scope, prioritize reusable knowledge and constraints from the current repository. For user scope, prioritize cross-repo personal workflow guidance.
11. Do not claim a file was created or updated before a tool call succeeds.

## Delivery

- If you can write to the target path, create or update the file directly after confirming the content.
- Otherwise, provide the full final `SKILL.md` in the reply and clearly state that it was not written.
