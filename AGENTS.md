# Spirit Agent — AI 助手指引

与本仓库协作时，请优先阅读下列 **GitHub Copilot** 仓库级配置：

| 文件 | 作用 |
| --- | --- |
| [`.github/copilot-instructions.md`](.github/copilot-instructions.md) | 全局：提交约定、BUG 修复、**模型可见文案**、通用约定 |
| [`.github/instructions/llm-visible-copy.instructions.md`](.github/instructions/llm-visible-copy.instructions.md) | **agent-core**：system / tool description 勿重复 `tools` 已声明能力 |
| [`.github/instructions/agent-core-host-boundary.instructions.md`](.github/instructions/agent-core-host-boundary.instructions.md) | **agent-core / 宿主内部库 / apps** 职责、工具定义 vs 实现、强约束 |
| [`.github/instructions/cli-rust.instructions.md`](.github/instructions/cli-rust.instructions.md) | `apps/cli/**/*.rs` 代码风格与构建习惯 |

## 提交信息约定

- 格式：`type(可选 scope): Subject`，换行后可选 Body。
- `type` / `scope`：英文（如 `feat`、`fix`、`desktop`）。
- **Subject / Body：简体中文**（专有名词、路径、标识符除外）。创建 commit 时不得用英文写 Subject 或 Body。
- 细则见 [`.github/copilot-instructions.md`](.github/copilot-instructions.md)。

## 提交范围约定

- `scope`：英文，可选；表示模块、包或子系统，例如 `cli`、`agent-core`、`desktop`、`tui`。无合适范围时可省略括号段。
- 多范围：仅在无法拆分时使用；多个范围用逗号分隔，且逗号后必须有一个空格，例如 `(desktop, agent-core)`。
- 禁止用多范围来概括“改了很多文件”或逃避拆分提交；只有确实同时修改了多个独立模块时才允许使用。
- 如范围过多，要么改成一个最主要的范围，要么去除所有范围。

## Desktop 内置 Git Skill

首次启动 Desktop Host 时，会将 `apps/desktop/built-in-skills/` 下的 `git-commit`、`git-push`、`git-merge` 种子到 `%APPDATA%/SpiritAgent/skills/`（已存在则不覆盖，可自行编辑）。Git 选项卡按钮与输入框斜杠菜单一致（如 `/git-commit`），在当前会话激活对应 Skill；不再使用后台 ephemeral 会话生成提交信息。

## Shell 流式执行

- `run_shell_command` 的 spawn 执行与增量输出契约在 `packages/host-internal`（`shell-execution.ts`）；`agent-core` 通过 `tool-execution-output-chunk` 事件转发增量文本。
- Desktop 将会话 tool 卡实时投影输出；CLI 经 host-bridge 接收事件但 TUI 暂不渲染 chunk（最终仍一次性展示 `tool-execution-finished` 结果）。

## Agent / LLM 约定

- 发给 LLM 的模型可见文本默认统一使用英文，包括但不限于系统消息、工具定义概述、工具描述、评估文案等；除非某个机制明确要求其他语言，否则不要混入中文或中英混写，以尽量减少输出质量波动。
- 修改 `packages/agent-core` 中与模型可见行为直接相关的内容时，如系统消息大段增删改、新增一个工具、工具概述或描述发生较大调整，应在实现完成后跑一次 eval，观察实际效果，再决定是否继续微调。
- 仅在变更较大时补跑 eval；小范围措辞修正、拼写修复、非模型可见重构，或纯宿主实现调整，通常不需要额外跑 eval。
