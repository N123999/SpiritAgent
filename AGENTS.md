# Spirit Agent 开发规则

## 项目结构
- 主应用在 `apps/cli/`，是Rust CLI工具
- TypeScript核心在 `packages/agent-core/`
- 使用Cargo工作区，根目录 `Cargo.toml` 定义工作区成员

## 代码风格
- Rust代码使用 `anyhow::Result` 处理错误
- 保持现有代码结构：显式错误上下文、枚举分发、`match` 结构
- 参考现有文件模式：`main.rs`、`host_runtime.rs`、`ports.rs`、`tool_runtime.rs`、`ts_bridge.rs`、`tui.rs`、`ui.rs`

## 架构约束
- `ports.rs` 定义核心抽象接口，优先通过端口扩展能力
- `ts_bridge.rs` 负责Rust与TypeScript的事件流桥接
- `host_runtime.rs` 处理运行时事件和工具UI格式化
- `main.rs` 是CLI入口和子命令分发
- `tui.rs` 和 `ui.rs` 处理交互界面
- `mcp_manager.rs` 和 `tool_runtime.rs` 处理MCP和工具执行

## 构建与验证
- 默认启用 `tui` feature
- 构建命令：`cargo check -p spirit-agent` 或 `cd apps/cli && cargo check`
- 测试命令：`cargo test -p spirit-agent`
- 修改后必须通过 `cargo check` 和 `cargo test`

## 平台兼容性
- 必须保持跨平台兼容，特别是Windows
- 使用条件编译处理平台特定代码：`#[cfg(target_os = "windows")]`

## 异步处理
- 避免阻塞等待
- 避免不必要的全局状态
- 保持异步流、轮询循环、工具执行路径的非阻塞性

## 目录边界
- Rust代码在 `apps/cli/src/`
- TypeScript代码在 `packages/agent-core/`
- 本地化文件在 `apps/cli/locales/`
- 文档在 `docs/`

## 忽略规则
- 忽略所有 `target/` 目录
- 忽略所有 `node_modules/` 目录
- 忽略所有 `dist/` 目录
- 忽略所有 `*.tsbuildinfo` 文件