# Spirit Agent 项目指引

## 代码风格
- 优先沿用现有 Rust 风格：`anyhow::Result`、显式错误上下文、清晰的枚举分发和 `match` 结构。
- 保持改动局部化，避免为格式化而重排无关代码。
- 参考这些文件中的现有模式： [apps/cli/src/main.rs](apps/cli/src/main.rs), [apps/cli/src/host_runtime.rs](apps/cli/src/host_runtime.rs), [apps/cli/src/ports.rs](apps/cli/src/ports.rs), [apps/cli/src/tool_runtime.rs](apps/cli/src/tool_runtime.rs), [apps/cli/src/ts_bridge.rs](apps/cli/src/ts_bridge.rs), [apps/cli/src/tui.rs](apps/cli/src/tui.rs), [apps/cli/src/ui.rs](apps/cli/src/ui.rs)。

## 架构
- Rust CLI 位于 `apps/cli/`；[apps/cli/src/ports.rs](apps/cli/src/ports.rs) 定义核心抽象接口；优先通过端口扩展能力，而不是把实现细节散落到上层。
- **TS 库与宿主边界**：`packages/agent-core` 承载可复用的 Agent 语义（LLM 编排、协议、面向模型的提示拼装；业务逻辑优先落在此）。`apps/cli`（Rust）承载宿主与 UI（交互、工作区路径与规则/配置的扫描与本地状态、桥接与持久化），不把应跨 CLI / Desktop 复用的核心能力长期堆在 Rust。
- TypeScript core（`packages/agent-core`）负责运行时编排；Rust 侧的 [apps/cli/src/ts_bridge.rs](apps/cli/src/ts_bridge.rs) 负责桥接事件流，[apps/cli/src/host_runtime.rs](apps/cli/src/host_runtime.rs) 负责宿主仍需复用的运行时事件与工具 UI 格式化。
- [apps/cli/src/main.rs](apps/cli/src/main.rs) 负责 CLI 入口与子命令分发；[apps/cli/src/tui.rs](apps/cli/src/tui.rs) 和 [apps/cli/src/ui.rs](apps/cli/src/ui.rs) 负责交互界面。
- MCP 主链路与协议实现以 `packages/agent-core` 为准；[apps/cli/src/tool_runtime.rs](apps/cli/src/tool_runtime.rs) 等负责内置工具执行，Rust 侧保留与宿主、桥接相关的配合代码。

## 构建与测试
- 默认在仓库根目录执行 Rust 命令：`cargo check -p spirit-agent`、`cargo test -p spirit-agent`（或先 `cd apps/cli` 使用本地 `cargo check`）
- 该仓库默认启用 `tui` feature；涉及界面代码时，确保修改不会破坏默认构建路径。
- 修改 CLI、运行时或工具链后，优先补一次 `cargo test`，必要时 `cargo check` 做验证。

## 提交规范
- 提交信息必须遵守约定式提交（Conventional Commits）。
- `type` 与可选 `scope` 使用英文；`scope` 尽量与模块、目录或功能边界一致。
- `subject` 使用中文，简洁说明本次变更。
- 需要补充说明时必须带 `body`，并且 `body` 也使用中文，写清背景、原因、影响或验证方式。
- 推荐格式示例：
  - `feat(tui): 优化消息滚动体验`
  - `fix(runtime): 修复工具调用超时回退`
  - `refactor(mcp): 拆分服务器状态更新逻辑`

## 约定
- 优先保持跨平台兼容，尤其是 Windows 相关分支和条件编译。
- 修改异步流、轮询循环或工具执行路径时，避免引入阻塞等待或不必要的全局状态。
- 如果需要更详细的设计说明，优先链接现有源码位置，而不是在这里重复展开。