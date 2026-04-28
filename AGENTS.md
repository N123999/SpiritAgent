# Spirit Agent — AI 助手指引

与本仓库协作时，请优先阅读下列 **GitHub Copilot** 仓库级配置：

| 文件 | 作用 |
| --- | --- |
| [`.github/copilot-instructions.md`](.github/copilot-instructions.md) | 全局：提交约定摘要、通用约定 |
| [`.github/instructions/agent-core-host-boundary.instructions.md`](.github/instructions/agent-core-host-boundary.instructions.md) | **agent-core / 宿主内部库 / apps** 职责、工具定义 vs 实现、强约束 |
| [`.github/instructions/cli-rust.instructions.md`](.github/instructions/cli-rust.instructions.md) | `apps/cli/**/*.rs` 代码风格与构建习惯 |

## 提交范围约定

- `scope`：英文，可选；表示模块、包或子系统，例如 `cli`、`agent-core`、`desktop`、`tui`。无合适范围时可省略括号段。
- 多范围：仅在无法拆分时使用；多个范围用逗号分隔，且逗号后必须有一个空格，例如 `(desktop, agent-core)`。
- 禁止用多范围来概括“改了很多文件”或逃避拆分提交；只有确实同时修改了多个独立模块时才允许使用。
- 如范围过多，要么改成一个最主要的范围，要么去除所有范围。
