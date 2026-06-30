---
name: create-hook
description: Create or update Spirit Agent command hooks in hooks.json and hook scripts under the managed hook roots.
---

Create or update hooks from the user's request. Hooks are command scripts that receive JSON on stdin and may return JSON on stdout to observe, allow, deny, ask, inject context, rewrite tool input, or schedule follow-up work.

When the user asks for a hook, gather missing requirements from context, then create or update the hook files directly. Do not stop at describing the format.

## Gather requirements

Infer from the conversation when possible; only ask for missing pieces:

1. **Scope**: workspace (repo-shared) or user (cross-workspace)?
2. **Event**: which lifecycle point should run the hook?
3. **Behavior**: audit, gate (`allow` / `deny` / `ask`), inject context, rewrite tool input, or follow up after subagent completion?
4. **Filtering**: does it need a `matcher` for specific tools or subagent types?
5. **Safety**: should failures block the action (`failClosed: true`) or fail open?

## Scope and paths

- **Default**: workspace hook at `<workspace_root>/.spirit/hooks.json` with scripts under `<workspace_root>/.spirit/hooks/`
- **User hook**: `<spirit_data_dir>/hooks.json` with scripts under `<spirit_data_dir>/hooks/` only when the user explicitly asks for user-level, global, or cross-repo behavior
- If this skill is active from `<spirit_data_dir>/skills/create-hook/SKILL.md`, use that same `<spirit_data_dir>` for user scope
- `command` paths in `hooks.json` are **relative to the directory that contains that `hooks.json`** (not the script's own folder unless you write `hooks/my-hook.sh`)
- Absolute paths are allowed but prefer managed relative paths so hooks stay portable

## Choose the event

Use the narrowest event that matches the goal:

| Goal | Event |
| --- | --- |
| Session setup or audit on open/resume | `sessionStart` |
| Session teardown audit | `sessionEnd` |
| Validate or gate user prompts | `submitPrompt` |
| Gate or rewrite any tool call | `preToolUse` |
| Add context after a tool succeeds | `postToolUse` |
| Gate subagent delegation | `subagentStart` |
| Auto follow-up after subagent finishes | `subagentEnd` |

**Matcher targets** (JavaScript `RegExp`, not POSIX grep):

- `preToolUse` / `postToolUse`: `toolName` (e.g. `shell`, `grep`, MCP tool names)
- `subagentStart` / `subagentEnd`: `subagentType` (e.g. `generalPurpose`, `explore`, `shell`)
- Other events: matcher is ignored if there is no target; omit matcher unless you need filtering on tool/subagent events

Start without a matcher or with a simple one; tighten after the base hook works.

## hooks.json format

```json
{
  "version": 1,
  "hooks": {
    "preToolUse": [
      {
        "command": "hooks/my-hook.sh",
        "timeout": 30,
        "matcher": "shell",
        "failClosed": false
      }
    ]
  }
}
```

Each entry supports:

- `command` (required): script path relative to the config directory, or absolute
- `timeout` (optional): seconds; defaults to 30
- `matcher` (optional): JS regex tested against tool name or subagent type
- `failClosed` (optional): when true, crash / timeout / invalid JSON / non-executable script blocks the action

When editing an existing setup, preserve unrelated entries and change only what is needed.

## Command hook protocol

Scripts read **one JSON object** on stdin (the serialized hook input). Common fields: `hookEventName`, `sessionId`, `workspaceRoot`, `model`, `timestamp`, plus event-specific fields such as `prompt`, `toolName`, `toolInput`, `toolOutput`, `subagentType`, `task`.

Write JSON to stdout when you need structured output. Supported output fields depend on the event:

| Event | Output fields |
| --- | --- |
| `submitPrompt`, `preToolUse`, `subagentStart` | `permission` (`allow` \| `deny` \| `ask`), `userMessage`, `agentMessage`, `updatedInput` |
| `postToolUse`, `sessionStart`, `sessionEnd` | `additionalContext` |
| `subagentEnd` | `followupMessage` |

**Exit codes**

- `0`: success; parse stdout JSON when present
- `2`: deny (same as `permission: "deny"`)
- Other non-zero: fail open unless `failClosed: true`

Chained pre-event hooks use the **most restrictive** permission (`deny` > `ask` > `allow`).

## Implementation workflow

1. Pick scope, event, and config path
2. Create or update `hooks.json` (append a new entry unless the user asked to replace one)
3. Create the script under the matching `hooks/` directory
4. Read stdin JSON and implement the behavior
5. On Unix, `chmod +x` the script; on Windows, use a shebang-friendly extension (`.sh` with Git Bash, `.ps1`, `.cmd`, or `.js` with `node`)
6. Verify every binary the script calls exists on `PATH` in the hook environment (`jq`, `node`, `python`, etc.)
7. Trigger the real event to test; use Desktop **Settings → Hooks** or CLI hooks UI to confirm the entry appears

## Minimal examples

**Gate shell tool calls (workspace)**

`hooks.json`:

```json
{
  "version": 1,
  "hooks": {
    "preToolUse": [
      {
        "command": "hooks/ask-network-shell.sh",
        "matcher": "shell",
        "failClosed": true
      }
    ]
  }
}
```

`hooks/ask-network-shell.sh`:

```bash
#!/usr/bin/env bash
input=$(cat)
if echo "$input" | jq -e '.toolInput.command | test("curl|wget")' >/dev/null 2>&1; then
  echo '{"permission":"ask","userMessage":"This shell command may use the network."}'
  exit 0
fi
echo '{"permission":"allow"}'
```

**Log all tool results (user)**

Append to user `hooks.json`:

```json
"postToolUse": [{ "command": "hooks/log-tool.sh" }]
```

`hooks/log-tool.sh` can append stdin to a log file and print nothing (empty stdout is fine for audit-only hooks).

## Validation and troubleshooting

- Config reloads when `hooks.json` is saved; restart the app if hooks still do not appear
- Command paths must stay inside the config directory (no `../` escape)
- Invalid matchers are skipped with a warning — prefer simple patterns
- If blocking on failure matters, set `failClosed: true`
- Read the repo first when you need facts; do not invent stack, paths, or workflows
