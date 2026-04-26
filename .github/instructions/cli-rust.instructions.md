---
applyTo: "apps/cli/**/*.rs"
---

# Spirit Agent — Rust CLI（`apps/cli`）

## 代码风格

- 优先沿用现有 Rust 风格：`anyhow::Result`、显式错误上下文、清晰的枚举分发和 `match` 结构。
- 保持改动局部化，避免为格式化而重排无关代码。
- 参考这些文件中的现有模式：`apps/cli/src/main.rs`、`apps/cli/src/host_runtime.rs`、`apps/cli/src/ports.rs`、`apps/cli/src/tool_runtime.rs`、`apps/cli/src/ts_bridge.rs`、`apps/cli/src/tui.rs`、`apps/cli/src/ui.rs`。

## 架构（本目录内）

- `apps/cli/src/ports.rs` 定义核心抽象接口；优先通过端口扩展能力，而不是把实现细节散落到上层。
- `apps/cli/src/ts_bridge.rs` 负责桥接事件流；`apps/cli/src/host_runtime.rs` 负责宿主仍需复用的运行时事件与工具 UI 格式化。
- `apps/cli/src/main.rs` 负责 CLI 入口与子命令分发；`apps/cli/src/tui.rs` 与 `apps/cli/src/ui.rs` 负责交互界面。
- MCP 主链路与协议实现以 `packages/agent-core` 为准；`apps/cli/src/tool_runtime.rs` 等负责内置工具执行，Rust 侧保留与宿主、桥接相关的配合代码。

## 构建与测试

- 默认在仓库根目录执行 Rust 命令：`cargo check -p spirit-agent`、`cargo test -p spirit-agent`（或先 `cd apps/cli` 使用本地 `cargo check`）。
- 该仓库默认启用 `tui` feature；涉及界面代码时，确保修改不会破坏默认构建路径。
- 修改 CLI、运行时或工具链后，优先补一次 `cargo test`，必要时 `cargo check` 做验证。

## 约定

- 优先保持跨平台兼容，尤其是 Windows 相关分支和条件编译。
- 修改异步流、轮询循环或工具执行路径时，避免引入阻塞等待或不必要的全局状态。
