# @spirit-agent/host-internal

Shared **host-side implementation** for [Spirit Agent](https://github.com/SpiritAgents/SpiritAgent). It sits between platform hosts (Desktop, CLI, ACP server) and [`@spirit-agent/core`](https://www.npmjs.com/package/@spirit-agent/core), providing discovery, workspace helpers, and local execution plumbing.

## What it provides

- **Discovery** — rules, skills, and workspace instruction metadata for Agent Core system assembly.
- **Tools** — `NodeHostToolService` and related helpers for in-process file, shell, grep/glob, and workspace operations.
- **Extensions & marketplace** — extension catalog, install paths, and marketplace integration used by Desktop.
- **LSP orchestration** — language-server install, probe, and diagnostics wiring after file edits.
- **Storage & runtime helpers** — Spirit data directory access, provider presets, and model listing utilities shared across hosts.

## Requirements

- Node.js 22+
- [`@spirit-agent/core`](https://www.npmjs.com/package/@spirit-agent/core) at a matching version

## Related packages

- [`@spirit-agent/core`](https://www.npmjs.com/package/@spirit-agent/core) — agent runtime, prompts, tool definitions, and transports.
- [`@spirit-agent/acp-server`](https://www.npmjs.com/package/@spirit-agent/acp-server) — ACP server adapter that depends on this package for local tool execution.

## License

MIT — see the [Spirit Agent repository](https://github.com/SpiritAgents/SpiritAgent).
