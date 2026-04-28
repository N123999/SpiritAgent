# Spirit Agent — 项目指引

## 分层与专项说明

- 能力与宿主边界：`.github/instructions/agent-core-host-boundary.instructions.md`
- Rust CLI：`.github/instructions/cli-rust.instructions.md`

## 提交信息

- 约定式提交：`type` / 可选 `scope` 英文；`subject` 中文。
- `scope`：英文，可选；表示模块、包或子系统，例如 `cli`、`agent-core`、`desktop`、`tui`。无合适范围时可省略括号段。
- 多范围：仅在无法拆分为多个提交时使用。多个范围用逗号分隔，且逗号后必须有一个空格，例如 `(desktop, agent-core)`。
- 禁止用多范围概括“改了很多文件”或代替拆分提交；只有确实同时修改了多个独立模块且无法拆开时，才允许使用多范围。
- 如范围过多，要么改成一个最主要的范围，要么去除所有范围，不要堆叠很长的 scope 列表。

## 通用约定

- 优先保持跨平台兼容（含 Windows 分支与条件编译）。
- 需要引用既有实现时，优先链到源码路径，不在此重复长说明。
