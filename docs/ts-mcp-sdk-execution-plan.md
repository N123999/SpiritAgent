# TypeScript MCP SDK 执行计划

## 背景

`packages/agent-core` 的目标已经明确为完整 Agent SDK，而不是只做 LLM runtime orchestration。当前 MCP 协议执行仍保留在 Rust 侧，这属于迁移中间态，不是最终架构。

本计划的目标是把 MCP 的核心职责迁移到 TypeScript，并以官方 MCP SDK 为基础完成实现；Rust CLI 退回为 UI/宿主层。

## 最终边界

### TypeScript 持有

- MCP server 生命周期与 transport 建连
- MCP tool / resource / prompt 调用
- MCP 上下文注入、trace、session 语义
- AgentRuntime 中的审批、后台执行、streaming 恢复与错误传播

### Rust 持有

- TUI 渲染与交互
- 审批 UI 与本地 OS 级工具能力
- 配置/secret 持久化
- TS bridge 与桌面宿主集成

## 迁移原则

- 官方 MCP SDK 是唯一推荐基础设施，不继续扩展 Rust `rmcp` 产品路径。
- 每个 Phase 都必须可独立验证、可独立回滚。
- 每个 Phase 单独提交，严格使用 Conventional Commits。
- 不允许把临时 fallback 持久化成长期架构。

## Phase 0: 架构冻结

### 目标

- 冻结最终边界与迁移顺序。
- 输出 Rust MCP 职责替换表与 host-bridge 收缩方案。

### 交付物

- 更新 `docs/ts-core-migration.md`
- 新增本执行文档
- 列出 Rust MCP 清理清单与 TS 替代模块边界

### 关键文件

- `docs/ts-core-migration.md`
- `apps/cli/src/mcp.rs`
- `apps/cli/src/mcp_manager.rs`
- `apps/cli/src/ts_bridge.rs`
- `packages/agent-core/src/ports.ts`

### 提交规范

- `docs(architecture): 明确 TS MCP 迁移边界`
- `refactor(bridge): 收敛 MCP 宿主边界`

### 验证

- 文档评审能够明确回答“Rust 还负责什么、TS 新负责什么、哪些 RPC 要删、哪些只是过渡”。

## Phase 1: 建立 TS MCP 基础设施

### 目标

- 在 `packages/agent-core` 建立 MCP 子系统骨架。
- 接入官方 MCP SDK。
- 迁移配置模型、环境变量展开、Windows 兼容入口与状态模型。

### 交付物

- `src/mcp/` 模块目录
- MCP 配置与 transport 封装
- MCP registry / trace / client 基础抽象
- 官方 MCP SDK 依赖与导出入口

### 关键文件

- `packages/agent-core/package.json`
- `packages/agent-core/src/index.ts`
- `packages/agent-core/src/mcp/*`
- `apps/cli/src/mcp.rs`

### 提交规范

- `feat(agent-core/mcp): 接入 MCP SDK 基础设施`
- `feat(agent-core/mcp): 迁移 MCP 配置与 Windows 兼容语义`
- `refactor(agent-core/mcp): 建立 TS 侧 MCP 状态模型`

### 验证

- `npm run build`
- Windows 上能正确解析 `${env:VAR}`、PATH/PATHEXT 与用户级 `mcp.json` 语义

## Phase 2: 迁移只读 MCP 能力

### 目标

- 把 inspect、list tools、list resources、read resource、list prompts、get prompt 从 Rust 迁到 TS。
- 将 Rust MCP RPC 收缩为兼容或 shadow 角色。

### 交付物

- TS 本地 MCP discovery 与 resource/prompt 调用实现
- host-bridge MCP 专用 RPC 削减方案与过渡实现

### 关键文件

- `packages/agent-core/src/mcp/client.ts`
- `packages/agent-core/src/host-bridge.ts`
- `packages/agent-core/src/host-bridge/host-tool-executor.ts`
- `apps/cli/src/ts_bridge.rs`

### 提交规范

- `feat(agent-core/mcp): 迁移 MCP 发现与资源提示读取`
- `refactor(bridge): 移除 MCP 专用宿主 RPC`

### 验证

- 手动验证 `/mcp` 列表、inspect、resource read、prompt get 与当前产品语义一致
- 如保留 shadow mode，需要做结果 diff 采样

## Phase 3: 迁移 MCP 工具执行主链路

### 目标

- 让 MCP tool execution 完全走 TypeScript。
- 保持 approval、background execution、trace、session export 与 streaming 恢复语义。

### 交付物

- MCP tool call 进入 TS runtime 主路径
- 后台执行与断连/超时/恢复语义补齐
- trace、tool memory、session export 保真

### 关键文件

- `packages/agent-core/src/runtime.ts`
- `packages/agent-core/src/runtime/tool-execution.ts`
- `packages/agent-core/src/runtime/background-tools.ts`
- `packages/agent-core/src/runtime/streaming.ts`
- `packages/agent-core/src/mcp/*`

### 提交规范

- `feat(agent-core/mcp): 迁移 MCP 工具执行链路`
- `refactor(agent-core/runtime): 收敛 MCP 上下文与 trace 语义`
- `test(agent-core/mcp): 补齐 MCP 迁移回归覆盖`

### 验证

- MCP tool 不阻塞 AgentRuntime 主轮询与 TUI
- 自动 tool call、审批恢复、失败回退、trace 导出与 session save/load 行为一致

## Phase 4: 切换默认实现

### 目标

- TS 成为 MCP 的唯一正式产品路径。
- Rust 只消费 TS 导出的 snapshot/events。

### 交付物

- MCP 默认后端切到 TS
- Rust host 不再直接管理 MCP 连接
- `/mcp` UI 的数据来源切换到 TS snapshot

### 关键文件

- `apps/cli/src/runtime_handle.rs`
- `apps/cli/src/tui.rs`
- `apps/cli/src/ts_bridge.rs`
- `packages/agent-core/src/host-bridge.ts`

### 提交规范

- `feat(runtime): 默认启用 TS MCP 后端`
- `refactor(cli): 精简 Rust MCP 宿主桥接`

### 验证

- 完整端到端回归：启动 CLI、连接 MCP server、读取 resource、应用 prompt、自动 tool call、保存/重载会话、重启后继续使用

## Phase 5: 删除 Rust MCP runtime

### 目标

- 删除 Rust `rmcp` 产品路径与过时桥接。
- 完成 SDK 级文档与外部交付收尾。

### 交付物

- 删除 `mcp_manager.rs` 的执行职责与相关依赖
- 清理 MCP 专用 host callback
- 完善 SDK 使用文档、Node 要求、配置入口与验证矩阵

### 关键文件

- `apps/cli/src/mcp_manager.rs`
- `apps/cli/src/mcp.rs`
- `packages/agent-core/package.json`
- `docs/ts-core-migration.md`

### 提交规范

- `refactor(mcp): 删除 Rust MCP 运行时实现`
- `docs(agent-core): 完善 MCP SDK 使用文档`
- `chore(agent-core): 清理遗留依赖与脚本`

### 验证

- Rust 侧不再依赖 `rmcp` 承担正式产品路径
- bridge 中不存在 MCP 专用正式 RPC
- `packages/agent-core` 可以被解释为完整 Agent SDK

## 风险与额外约束

- Windows stdio 命令解析必须保留 PATH/PATHEXT 兼容语义，避免 `npx`、`.cmd`、`.bat` 等 server 无法拉起。
- 环境变量展开必须支持嵌入式 `${env:VAR}`，不能只支持整值替换。
- MCP 长耗时操作必须保持后台执行，不得阻塞 UI 或 streaming 轮询。
- trace、session export、approval resume 不能在迁移中丢失，否则排障能力会明显回退。

## 最低持续验证矩阵

1. `npm run build`
2. `cargo check -p spirit-agent`
3. `cargo test -p spirit-agent`
4. MCP discovery / resource / prompt / tool execution smoke
5. Windows 专项手工验证

## 当前起点

本仓库已经完成 TS runtime bridge 的产品化接入，本次计划从 Phase 0 和 Phase 1 起步：先冻结架构，再把 MCP 子系统骨架和官方 SDK 接入到 `packages/agent-core`。