<div align="center">

<img src="https://github.com/user-attachments/assets/fa10cc7d-381c-4a70-b4ab-d145ba1363f1" alt="Spirit Agent" />

# Spirit Agent

**An open-source AI agent built to multiply your productivity** — grounded in your workspace, equipped with real tools, and ready to plan, execute, and ship alongside you.

[Desktop app](#desktop) · [CLI](#cli) · [ACP Server](#acp-server) · [Agent Core](#agent-core) · [Development](#development)

> This project is under active development. Behavior and APIs may change between releases.

[Simplified Chinese](docs/README_zh-CN.md)

</div>

## Overview

Spirit Agent is a monorepo for a **tool-using coding agent** that runs against a real project root. The same runtime powers a native desktop workspace and a terminal UI. Shared logic lives in TypeScript packages; hosts add platform-specific execution, discovery, and UI.

```
┌───────────────────────────────────────────────────────┐
│  Hosts                                                │
│  ┌──────────────┐ ┌──────────┐ ┌───────────────────┐  │
│  │   Desktop    │ │   CLI    │ │    ACP Server     │  │
│  │  (Electron)  │ │  (Rust)  │ │  stdio / ndJSON   │  │
│  └──────┬───────┘ └─────┬────┘ └───────────┬───────┘  │
│         └───────────────┼──────────────────┘          │
│                         ▼                             │
│               packages/host-internal                  │
│            discovery, tools, workspace                │
│                         │                             │
│                         ▼                             │
│                packages/agent-core                    │
│          runtime, prompts, tool contracts             │
└───────────────────────────────────────────────────────┘
```

## Agent Core

[`packages/agent-core`](packages/agent-core) is the **single source of agent semantics** in this repository. Hosts consume it.

### Runtime and modes

- **Turn machine** — streaming assistant output, tool rounds, compaction, and context usage tracking.
- **Agent / Plan / Ask modes** — full tool access, planning-only workflows, or read-only Q&A with edit tools stripped at the contract layer.
- **Subagents** — `run_subagent` delegates focused work to child runs with their own tool surface.
- **Loop control** — optional `finish_task` when multitask-style looping is enabled.
- **Rewind-friendly history** — message archive formats designed for host-side rollback and resubmit.

### Model transports

Agent Core routes inference through multiple transports behind one runtime:

| Transport | Typical providers |
| --- | --- |
| **OpenAI-compatible** | OpenAI, DeepSeek, Moonshot, MiniMax, Volcengine, custom endpoints |
| **Open Responses** | OpenAI, xAI, Vercel AI Gateway, OpenRouter, Alibaba (Bailian) |
| **Anthropic** | Claude via Messages API |

Provider-native capabilities (for example web search on Open Responses, Alibaba built-in search and code interpreter) are injected through the request `tools` field.

### Host tool contracts

Built-in tools are defined once in Agent Core (name, description, JSON Schema). Hosts implement execution:

- **Workspace** — `read_file`, `write_file` / `create_file` / `edit_file` / `delete_file`, `apply_patch` (V4A on supported transports), `glob`, `grep`, `list_directory_files`
- **Shell** — `run_shell_command` with host-controlled approval
- **Web** — `web_fetch`; search via provider tools or host search where configured
- **Delegation** — `run_subagent`
- **Planning** — `create_plan`, session TODO tools (`todo_list`, `todo_create`, `todo_update`, `todo_complete`)
- **Multimodal** — `generate_image`, `generate_video`
- **Dreams** — `dream_list`, `dream_read`, `dream_record`, `dream_update`, `dream_delete` for workspace memory summaries
- **LSP** — language-server diagnostics surfaced after edits

### System context assembly

Agent Core owns how the model sees project context:

- **Rules** — `AGENTS.md`, `.spirit/rule.md`, and user rule slots merged into system sections.
- **Skills** — catalog and active-skill injection; hosts discover files on disk.
- **MCP** — Model Context Protocol client, registry, and tool/resource/prompt bridging.
- **Mode prompts** — Agent, Plan, and Ask boundaries without re-listing tools in system text.

### Quality and evaluation

- **Smoke suites** — contract, runtime, and live provider checks under `packages/agent-core/src/smoke`.
- **Eval harness** — scenario comparison and judging for prompt or tool-definition changes (`npm run eval:compare` from the repo root).

`@spirit-agent/core` is published to npm; [`packages/host-internal`](packages/host-internal) is private and holds shared host-side discovery, extensions, marketplace, workspace helpers, and LSP orchestration used by Desktop.

## Desktop

The [Desktop app](apps/desktop) is the primary graphical host: a workspace-bound IDE surface with a conversational agent.

- **Docked panels** — file explorer with Monaco editor, embedded terminal (Electron), Git changes and history, in-app browser for local dev servers.
- **Sessions** — multi-conversation history, worktree-per-session workflows, tool approval, subagent viewer, structured questionnaires, context usage, and rewind.
- **Configuration** — model providers and API keys, Skills and Rules, MCP servers, extensions marketplace, Dreams (beta), LSP, themes, and UI locale (English / Simplified Chinese).
- **Platforms** — Electron on Windows, macOS, and Linux; optional web host with remote pairing.

See [apps/desktop/README.md](apps/desktop/README.md) for Desktop-specific development and layout.

## CLI

The [Rust CLI](apps/cli) (`spirit-agent`) provides a terminal-first host with an optional Ratatui UI. It shares the same Agent Core runtime via the Node bridge and suits scripting, SSH sessions, and minimal environments.

```bash
npm run dev:cli    # build TS packages, then cargo run -p spirit-agent
```

## ACP Server

[`packages/acp-server`](packages/acp-server) is a thin adapter that exposes Spirit Agent as an [Agent Client Protocol](https://agentclientprotocol.com) (ACP) server over stdio / ndJSON. Any ACP-compatible editor — such as **Zed** or **JetBrains Junie** — can connect to Spirit Agent as its AI coding engine without bespoke integration.

- **Protocol surface** — `initialize`, `session/new`, `session/prompt`, `session/cancel`, `session/close`, `session/set_mode`.
- **Streaming & thinking** — real-time `agent_message_chunk` streaming and `agent_thought_chunk` for model reasoning output.
- **Permission bridge** — tool approval via ACP `request_permission` with allow-once / always-allow / reject options.
- **Slash commands** — workspace and user Skills are advertised as `available_commands_update`; typing `/skill-name` activates the skill and injects its instructions into the system prompt.
- **Local execution** — tools run in-process via `NodeHostToolService` (no JSON-RPC peer over stdio, which is reserved for ACP ndJSON).

### Quick start (Zed)

Add to your Zed `settings.json`:

```json
"agent_servers": {
  "Spirit Agent": {
    "command": "node",
    "args": ["path/to/packages/acp-server/dist/src/stdio-entry.js"],
    "env": {
      "SPIRIT_ACP_API_KEY": "${SPIRIT_ACP_API_KEY}",
      "SPIRIT_ACP_MODEL": "",
      "SPIRIT_ACP_BASE_URL": ""
    }
  }
}
```

| Environment variable | Required | Description |
| --- | --- | --- |
| `SPIRIT_ACP_API_KEY` | Yes | LLM provider API key |
| `SPIRIT_ACP_MODEL` | No | Model name (default: `gpt-4.1-mini`) |
| `SPIRIT_ACP_BASE_URL` | No | Custom LLM endpoint URL |
| `SPIRIT_ACP_WORKSPACE` | No | Workspace root (default: `cwd` from client) |

## Development

**Requirements:** Node.js 22+, npm. Rust toolchain required for CLI builds.

| Command | Description |
| --- | --- |
| `npm run dev:desktop` | Build shared packages and start Desktop (Vite + Electron) |
| `npm run dev:desktop:web` | Desktop renderer with browser web host |
| `npm run dev:cli` | CLI with TUI |
| `npm run build` | Production build of agent-core, host-internal, acp-server, and Desktop |
| `npm run eval:compare` | Run eval comparison after agent-core changes |

### Repository layout

```
apps/
  desktop/           Electron + React host
  cli/               Rust CLI and TUI
packages/
  agent-core/        Agent runtime, prompts, tool definitions, transports, MCP, eval
  host-internal/     Shared host discovery, tools, extensions, LSP helpers
  acp-server/        ACP (Agent Client Protocol) server adapter for editor integration
scripts/             Release, eval, and repo automation
```

## Contributing

Read [AGENTS.md](AGENTS.md) and [`.github/copilot-instructions.md`](.github/copilot-instructions.md) for architecture boundaries, commit conventions, and agent-core change guidelines.

## License

[MIT](LICENSE)
