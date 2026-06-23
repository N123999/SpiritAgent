---
name: create-skill
description: Author or tighten a workspace or user skill and write it to the managed skill roots.
---

Create or update a `SKILL.md` from the user's request under the managed skill roots. Active skills are injected into later agent context when enabled.

**Scope**
- Default: workspace skill at `<workspace_root>/.spirit/skills/<skill_name>/SKILL.md`
- User skill at `<spirit_data_dir>/skills/<skill_name>/SKILL.md` only when the user explicitly asks for user-level, global, cross-repo reuse, or writing to the user directory
- If this skill is active from `<spirit_data_dir>/skills/create-skill/SKILL.md`, use that same `<spirit_data_dir>` for user scope

**Naming**
- Choose `skill_name` from the user request: 1–64 characters, lowercase letters, digits, and hyphens only; no leading/trailing `-` or `--`
- Directory name, frontmatter `name`, and path must all match `skill_name`
- Start with YAML frontmatter containing at least `name` and `description`

**Content**
- Explain what the skill does, when to use it, and how; prefer steps, examples, edge cases, and relative file paths over vague governance language
- Read the repo first when you need facts; do not invent stack, structure, directories, or workflows
- Workspace skills: reusable knowledge and constraints from the current repository
- User skills: stable cross-repo personal workflow guidance
