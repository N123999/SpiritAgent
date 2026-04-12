# Spirit Agent 开发规则

## 项目结构
- Rust CLI 主应用在 `apps/cli/`
- TypeScript 核心在 `packages/agent-core/`
- Cargo 工作区：根目录 `Cargo.toml` 定义成员 `["apps/cli"]`

## 代码风格
- Rust 错误处理：使用 `anyhow::Result`
- 保持现有模式：显式错误上下文、枚举分发、`match` 结构
- 参考文件模式：`main.rs`、`host_runtime.rs`、`ports.rs`、`tool_runtime.rs`、`ts_bridge.rs`、`tui.rs`、`ui.rs`

## 架构约束
- `ports.rs`：核心抽象接口，优先通过端口扩展
- `ts_bridge.rs`：Rust 与 TypeScript 事件流桥接
- `host_runtime.rs`：运行时事件和工具 UI 格式化
- `main.rs`：CLI 入口和子命令分发
- `tui.rs`/`ui.rs`：交互界面
- `mcp_manager.rs`/`tool_runtime.rs`：MCP 和工具执行

## 构建与验证
- 默认启用 `tui` feature
- 构建命令：`cargo check -p spirit-agent` 或 `cd apps/cli && cargo check`
- 测试命令：`cargo test -p spirit-agent`
- 修改后必须通过 `cargo check` 和 `cargo test`

## 平台兼容性
- 必须保持跨平台兼容，特别是 Windows
- 使用条件编译：`#[cfg(target_os = "windows")]`

## 异步处理
- 避免阻塞等待
- 避免不必要的全局状态
- 保持异步流、轮询循环、工具执行路径的非阻塞性

## 目录边界
- Rust 代码在 `apps/cli/src/`
- TypeScript 代码在 `packages/agent-core/`
- 本地化文件在 `apps/cli/locales/`
- 文档在 `docs/`

## 忽略规则
- 忽略所有 `target/` 目录
- 忽略所有 `node_modules/` 目录
- 忽略所有 `dist/` 目录
- 忽略所有 `*.tsbuildinfo` 文件