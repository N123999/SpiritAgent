# Spirit Agent — 项目指引

## 分层与专项说明

- 能力与宿主边界：`.github/instructions/agent-core-host-boundary.instructions.md`
- Rust CLI：`.github/instructions/cli-rust.instructions.md`

## 提交信息

- 约定式提交：`type` / 可选 `scope` 英文；`subject` 中文。
- 多范围时逗号后空格，例如 `(cli, agent-core)`；多范围适用条件见 `.cursor/rules/commit-messages.zh.mdc`（若存在）。

## 通用约定

- 优先保持跨平台兼容（含 Windows 分支与条件编译）。
- 需要引用既有实现时，优先链到源码路径，不在此重复长说明。
