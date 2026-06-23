---
name: create-rule
description: Author or tighten a workspace or user rule file for future agents to read.
---

Create or update a rule file from the user's request. Enabled rules are injected into later agent system context as additive constraints.

**Scope**
- Default: workspace rule at `<workspace_root>/.spirit/rule.md`
- User rule at `<spirit_data_dir>/rule.md` only when the user explicitly asks for user-level, global, or personal rules
- If this skill is active from `<spirit_data_dir>/skills/create-rule/SKILL.md`, use that same `<spirit_data_dir>` for user scope

**Content**
- Write for future agents, not human process documentation
- Only constraints that materially change coding behavior; omit everything else
- Read the repo first when you need facts; do not invent stack, structure, or workflows
- Workspace rules: repo-specific boundaries, validation commands, coding preferences
- User rules: stable cross-repo collaboration preferences
- Skip release-process templates, contributor governance, severity taxonomies, and other generic checklists
