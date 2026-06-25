<div align="center">

<img width="1552" height="1032" alt="Spirit Agent Desktop" src="https://github.com/user-attachments/assets/7b07e79d-c800-405a-bee6-40dda9d75b13" />

# Spirit Agent

**一款旨在成倍提升生产力的开源 AI 智能体** — 扎根于你的工作区，配备真实工具，随时与你一起规划、执行并交付成果。

[Desktop 应用](#desktop) · [CLI](#cli) · [ACP Server](#acp-server) · [Agent Core](#agent-core) · [开发](#开发)

> 本项目仍在积极开发中。各版本之间的行为与 API 可能发生变化。

[English](../README.md)

</div>

## 概览

Spirit Agent 是一个 **工具型编程智能体** 的 monorepo，以真实项目根目录为运行上下文。同一套运行时同时驱动原生桌面工作区与终端界面。共享逻辑位于 TypeScript 包中；各宿主在此基础上叠加平台相关的执行、发现与 UI。

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

[`packages/agent-core`](../packages/agent-core) 是本仓库中 **智能体语义的唯一来源**，由各宿主消费。

### 运行时与模式

- **回合状态机（Turn machine）** — 流式助手输出、工具轮次、上下文压缩，以及上下文用量追踪。
- **Agent / Plan / Ask 模式** — 完整工具访问、仅规划工作流，或在契约层剥离编辑工具的只读问答。
- **子智能体（Subagents）** — `run_subagent` 将聚焦任务委派给子运行，子运行拥有独立工具面。
- **循环控制** — 启用多任务式循环时，可选 `finish_task`。
- **可回退的历史** — 消息归档格式便于宿主侧回滚并重新提交。

### 模型传输层

Agent Core 在统一运行时背后路由多种推理传输层：

| 传输层 | 典型提供商 |
| --- | --- |
| **OpenAI-compatible** | OpenAI、DeepSeek、Moonshot、MiniMax、Volcengine、自定义端点 |
| **Open Responses** | OpenAI、xAI、Vercel AI Gateway、OpenRouter、Alibaba（百炼） |
| **Anthropic** | 通过 Messages API 的 Claude |

提供商原生能力（例如 Open Responses 上的网页搜索、Alibaba 内置搜索与代码解释器）通过请求中的 `tools` 字段注入。

### 宿主工具契约

内置工具在 Agent Core 中统一定义（名称、描述、JSON Schema），由宿主负责执行：

- **工作区** — `read_file`、`write_file` / `create_file` / `edit_file` / `delete_file`、`apply_patch`（在支持的传输层上使用 V4A）、`glob`、`grep`、`list_directory_files`
- **Shell** — `shell`，由宿主控制审批
- **Web** — `web_fetch`；搜索通过提供商工具或已配置的宿主搜索实现
- **委派** — `run_subagent`
- **规划** — `create_plan`，会话 TODO 工具（`todo_list`、`todo_create`、`todo_update`、`todo_complete`）
- **多模态** — `generate_image`、`generate_video`
- **Dreams** — `dream_list`、`dream_read`、`dream_record`、`dream_update`、`dream_delete`，用于工作区记忆摘要
- **LSP** — 编辑后展示语言服务器诊断信息

### 系统上下文组装

Agent Core 决定模型如何「看见」项目上下文：

- **Rules** — `AGENTS.md`、`.spirit/rule.md` 与用户规则槽位合并进 system 段落。
- **Skills** — 目录与激活 Skill 注入；宿主在磁盘上发现文件。
- **MCP** — Model Context Protocol 客户端、注册表，以及 tool/resource/prompt 桥接。
- **模式提示词** — Agent、Plan、Ask 边界约束，不在 system 文本中重复列举工具。

### 质量与评估

- **Smoke 套件** — 位于 `packages/agent-core/src/smoke` 的契约、运行时与线上提供商检查。
- **Eval 框架** — 针对提示词或工具定义变更的场景对比与评判（在仓库根目录执行 `npm run eval:compare`）。

`@spirit-agent/core` 发布至 npm；[`packages/host-internal`](../packages/host-internal) 为私有包，承载 Desktop 共用的宿主侧发现、扩展、市场、工作区辅助与 LSP 编排。

## Desktop

[Desktop 应用](../apps/desktop) 是主要的图形宿主：绑定工作区的 IDE 界面，内嵌对话式智能体。

- **停靠面板** — 带 Monaco 编辑器的文件浏览器、嵌入式终端（Electron）、Git 变更与历史、用于本地开发服务器的应用内浏览器。
- **会话** — 多对话历史、按会话隔离的 worktree 工作流、工具审批、子智能体查看器、结构化问卷、上下文用量与回退（rewind）。
- **配置** — 模型提供商与 API 密钥、Skills 与 Rules、MCP 服务器、扩展市场、Dreams（beta）、LSP、主题，以及 UI 语言（英文 / 简体中文）。
- **平台** — Windows、macOS、Linux 上的 Electron；可选带远程配对的 Web 宿主。

Desktop 专属开发与目录说明见 [apps/desktop/README.md](../apps/desktop/README.md)。

## CLI

<img width="1014" height="744" alt="Spirit Agent CLI" src="https://github.com/user-attachments/assets/ecf4fcec-6a9b-4562-b0da-cc14816f36d3" />


[Rust CLI](../apps/cli)（`spirit-agent`）提供终端优先的宿主，可选 Ratatui 界面。通过 Node 桥接共享同一套 Agent Core 运行时，适合脚本化、SSH 会话与极简环境。

```bash
npm run dev:cli    # 构建 TS 包，然后 cargo run -p spirit-agent
```

## ACP Server

[`packages/acp-server`](../packages/acp-server) 是一个薄适配层，通过 stdio / ndJSON 将 Spirit Agent 以 [Agent Client Protocol](https://agentclientprotocol.com)（ACP）服务器的形式对外暴露。任何兼容 ACP 的编辑器 — 如 **Zed** 或 **JetBrains Junie** — 都可以直接接入 Spirit Agent 作为其 AI 编码引擎，无需定制集成。

- **Terminal Auth** — `initialize` 声明 `type: "terminal"` 认证方式；客户端可 spawn `spirit-agent-acp --setup` 进行交互式 provider 配置，随后 `authenticate`，再 `session/new`。
- **协议表面** — `initialize`、`authenticate`、`logout`、`session/new`、`session/prompt`、`session/cancel`、`session/close`、`session/set_mode`。
- **流式与思考** — 实时 `agent_message_chunk` 流式输出，以及 `agent_thought_chunk` 用于模型推理过程展示。
- **权限桥接** — 通过 ACP `request_permission` 进行工具审批，支持 allow-once / always-allow / reject 选项。
- **Slash 命令** — 工作区与用户级 Skills 通过 `available_commands_update` 注册为命令；输入 `/skill-name` 即可激活 Skill 并将其指令注入系统提示词。
- **本地执行** — 工具通过 `NodeHostToolService` 在进程内执行（stdio 保留给 ACP ndJSON，不使用 JSON-RPC peer）。

### 快速开始（Zed）

1. 构建 server：`npm run build:acp-server`
2. 在 Zed 的 `settings.json` 中添加（`env` 中无需 API Key）：

```json
"agent_servers": {
  "Spirit Agent": {
    "command": "node",
    "args": ["path/to/packages/acp-server/dist/src/stdio-entry.js"]
  }
}
```

3. 客户端提示认证时选择 **Run in terminal**，会 spawn `--setup`：选择 provider、填写凭据、选定模型。
4. Setup 写入 Spirit 共享数据目录（`config.json` + 系统 keyring，与 Desktop/CLI 共用）。完成后客户端调用 `authenticate`，再 `session/new`。

也可在编辑器外手动 setup：

```bash
node path/to/packages/acp-server/dist/src/stdio-entry.js --setup
```

| 环境变量 | 必填 | 说明 |
| --- | --- | --- |
| `SPIRIT_ACP_WORKSPACE` | 否 | 工作区根路径（默认：客户端 `cwd`） |
| `SPIRIT_ACP_DATA_DIR` | 否 | Spirit 数据目录（默认：`%APPDATA%/SpiritAgent` 或 `~/.spirit-agent`） |

## 开发

**环境要求：** Node.js 22+、npm。构建 CLI 需要 Rust 工具链。

| 命令 | 说明 |
| --- | --- |
| `npm run dev:desktop` | 构建共享包并启动 Desktop（Vite + Electron） |
| `npm run dev:desktop:web` | Desktop 渲染器 + 浏览器 Web 宿主 |
| `npm run dev:cli` | 带 TUI 的 CLI |
| `npm run build` | 生产构建 agent-core、host-internal、acp-server 与 Desktop |
| `npm run eval:compare` | 在 agent-core 变更后运行 eval 对比 |

### 仓库结构

```
apps/
  desktop/           Electron + React 宿主
  cli/               Rust CLI 与 TUI
packages/
  agent-core/        智能体运行时、提示词、工具定义、传输层、MCP、eval
  host-internal/     共享宿主发现、工具、扩展、LSP 辅助
  acp-server/        ACP (Agent Client Protocol) 服务器适配器，用于编辑器集成
scripts/             发布、eval 与仓库自动化
```

## 参与贡献

架构边界、提交约定与 agent-core 变更指南见 [AGENTS.md](../AGENTS.md) 与 [`.github/copilot-instructions.md`](../.github/copilot-instructions.md)。

## 许可证

[MIT](../LICENSE)
