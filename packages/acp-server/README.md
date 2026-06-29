# @spirit-agent/acp-server

ACP ([Agent Client Protocol](https://agentclientprotocol.com)) server adapter for [Spirit Agent](https://github.com/SpiritAgents/SpiritAgent). Exposes the same agent runtime as Desktop and CLI over **stdio / ndJSON**, so ACP-compatible editors (for example **Zed** or **JetBrains Junie**) can use Spirit Agent without bespoke integration.

## What it provides

- **Terminal Auth** — `initialize` advertises a `type: "terminal"` auth method; clients run `--setup` for interactive provider configuration, then call `authenticate` before `session/new`.
- **Protocol surface** — `initialize`, `authenticate`, `logout`, `session/new`, `session/prompt`, `session/cancel`, `session/close`, `session/set_mode`.
- **Streaming** — real-time `agent_message_chunk` and `agent_thought_chunk` for model output and reasoning.
- **Permission bridge** — tool approval via ACP `request_permission`.
- **Slash commands** — workspace and user Skills advertised as `available_commands_update`.
- **Local execution** — tools run in-process via `NodeHostToolService` (stdio reserved for ACP ndJSON).

## Quick start

```bash
npx @spirit-agent/acp-server --setup
```

Setup writes to the shared Spirit data directory (`config.json` + OS keyring — same store as Desktop/CLI). After setup, your ACP client calls `authenticate`, then `session/new`.

| Environment variable | Required | Description |
| --- | --- | --- |
| `SPIRIT_ACP_WORKSPACE` | No | Workspace root (default: client `cwd`) |
| `SPIRIT_ACP_DATA_DIR` | No | Spirit data directory (default: `%APPDATA%/SpiritAgent` or `~/.spirit-agent`) |

## Requirements

- Node.js 22+

## Related packages

- [`@spirit-agent/core`](https://www.npmjs.com/package/@spirit-agent/core) — agent runtime and tool contracts.
- [`@spirit-agent/host-internal`](https://www.npmjs.com/package/@spirit-agent/host-internal) — local tool execution and discovery.

## License

MIT — see the [Spirit Agent repository](https://github.com/SpiritAgents/SpiritAgent).
