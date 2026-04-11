# TypeScript Core 迁移路线

## 目标

把 Spirit Agent 的核心能力收敛到 TypeScript，并把 `packages/agent-core` 明确演进为完整 Agent SDK，而不是只做 runtime orchestration。最终目标包含：provider 接入、streaming、上下文压缩、工具调用循环、MCP client 与资源/提示/工具编排、trace 与 session 语义。

Rust CLI 的目标边界同步收缩为宿主层：TUI 渲染、键盘交互、权限确认、本地 OS 能力桥接、secret/config 持久化与必要桌面集成。

## 最终边界

### TypeScript core 负责

- LLM provider 接入与协议兼容
- tool-calling / reasoning / stream 兼容处理
- AgentRuntime、会话状态与上下文压缩
- MCP client 生命周期、资源/提示/工具编排
- session export / request trace / compaction 语义

### Rust host 负责

- TUI 渲染与交互
- 键盘输入、滚动、选择、复制
- 本地桌面集成与必要宿主能力
- 审批、secret/config 存储与 TypeScript bridge

## 当前状态

- Rust 侧已提供 `TsBridgeRuntime`，通过 stdio + JSON-RPC 启动 `packages/agent-core/dist/host-bridge.js`。
- `RuntimeHandle` 已收敛为 TS-only，Rust LLM runtime backend 已从产品入口和源码中移除。
- TUI 默认直接启动 TypeScript runtime bridge；若 bridge 初始化失败，启动会直接报错，不再回退到 Rust backend。
- MCP 协议执行仍暂时保留在 Rust 侧（`rmcp`），TS core 通过 host callback 复用 Rust 的 MCP 与本地工具能力。
- 当前主对话流、审批恢复、history compaction、图片/资源挂载已接到 TS backend，但 `/mcp` 的管理与执行仍未完成所有权迁移。

## 迁移原则

- 不再把 `rmcp` 留在 Rust 作为最终架构。
- MCP 将迁移到 TypeScript，并以官方 MCP SDK 为基础实现。
- 迁移过程允许短期 shadow mode 或内部 fallback，但不能继续把临时兼容路径固化为长期产品边界。
- 不同时重写 provider、runtime、UI 三层；始终按可验证的 Phase 推进。

## 推荐切法

### Phase 0: 冻结目标边界

- 明确 `packages/agent-core` 是完整 Agent SDK。
- 输出逐项迁移清单，锁定 Rust 与 TS 的职责边界。
- 补充执行文档：见 `docs/ts-mcp-sdk-execution-plan.md`。

### Phase 1: 建立 TS MCP 基础设施

- 在 `packages/agent-core/src/mcp/` 中建立 MCP 子系统骨架。
- 接入官方 MCP SDK，先落配置模型、transport 封装、状态模型与 trace 入口。
- 迁移 Windows 兼容语义、环境变量展开与用户级 `mcp.json` 约束。

### Phase 2: 迁移 MCP 发现与资源读取

- 把 server list、inspect、resources、prompts 等只读能力迁到 TS。
- 收缩 host/core 协议中的 MCP 专用 RPC。

### Phase 3: 迁移 MCP tool execution

- 让 MCP tool call 直接走 TypeScript MCP client。
- 保持 approval、background execution、trace、session export 语义不回退。

### Phase 4: 切默认实现并清桥接

- TS 成为 MCP 的默认且唯一正式产品路径。
- Rust 只消费 TS 导出的状态与事件，不再管理 MCP 连接。

### Phase 5: 删除 Rust MCP runtime 并完善 SDK 交付

- 删除 Rust `rmcp` 执行路径与过时 host callback。
- 完善 `packages/agent-core` 的公开 API、文档与验证矩阵。

## 当前自测方式

1. 在 `packages/agent-core` 执行 `npm run build`
2. 在仓库根执行 `cargo check -p spirit-agent`
3. 在仓库根执行 `cargo test -p spirit-agent`
4. 手动启动 TUI，验证 Rust -> TS 初始化链路与真实对话流

## 不建议的做法

- 不要先重写整个 TUI。
- 不要继续把 MCP 当成 Rust 借给 TS 的长期宿主能力。
- 不要把 Rust 逻辑逐文件翻译成 TypeScript，而不先确定最终 SDK 边界。