# Spirit Agent — 项目指引

## 分层与专项说明

- 能力与宿主边界：`.github/instructions/agent-core-host-boundary.instructions.md`
- Rust CLI：`.github/instructions/cli-rust.instructions.md`

## 提交信息

- 约定式提交：`type`、可选 `scope` 使用英文；**Subject 与 Body 必须使用简体中文**（代码标识符、路径、API 名等除外）。
- `subject`：一行概括变更，简体中文，句末不加句号。
- `body`：可选；写**本次变更的内容与影响**（用户可见行为、对外语义、兼容性等），简体中文。
- **`body` 格式**：若写 body，**必须**用 `-` 列表，**一条一行**；每条句末**不加句号**；**禁止**写成一整段 prose。
- **只写相对父提交的 diff**：subject 与 body 均只描述本次入库相对上一版**实际改了什么、带来什么影响**；不要写会话内的迭代叙事
- **禁止错位对照**：同一次提交里刚新增、父提交里尚不存在的代码，若在会话中又改了一版，**不得**在 subject 或 body 里写「避免与既有 X 重复」「改为读取 Y 以去重」等——父提交里没有 X，Git 上也看不出这层关系，属于错位说明
- `scope`：英文，可选；表示模块、包或子系统，例如 `cli`、`agent-core`、`desktop`、`tui`。无合适范围时可省略括号段。
- 多范围：仅在无法拆分为多个提交时使用。多个范围用逗号分隔，且逗号后必须有一个空格，例如 `(desktop, agent-core)`。
- 禁止用多范围概括“改了很多文件”或代替拆分提交；只有确实同时修改了多个独立模块且无法拆开时，才允许使用多范围。
- 如范围过多，要么改成一个最主要的范围，要么去除所有范围，不要堆叠很长的 scope 列表。

示例（`body`）：

```
feat(desktop): macOS 侧栏切换按钮钉在红绿灯右侧

- 非全屏时侧栏切换按钮 fixed 钉在 hiddenInset 红绿灯右缘
- 全屏时回退顶栏内联布局，沿用 spirit-desktop-darwin-fullscreen 样式
```

❌ 错位：`新增 useDarwinWindowFullscreen 读取 html class，不重复订阅 Electron IPC`——父提交里并无重复订阅，这是会话内对刚写代码的后续改写叙事，与本次 diff 无关

## 通用约定

- 优先保持跨平台兼容（含 Windows 分支与条件编译）。
- 需要引用既有实现时，优先链到源码路径，不在此重复长说明。
- 除非测试目标明确要求，否则不要在单测、快照、fixture、示例输入等场景中加入第三方产品、服务、模型或品牌字符串；优先使用项目内语义或中性描述。
- 本项目处于极早期开发阶段；若变更涉及用户配置结构、持久化格式或迁移策略且需要较大调整，尽量避免叠加过多兼容兜底，优先保持实现直接可演进，并需明确告知开发者这样做的原因、代价与后续演进空间。

## BUG 修复：Log、根因、禁止多重保险

### 流程

1. **先埋 Log**：复现路径上优先加可观测日志（级别、关键状态、时序），再改逻辑；勿无 Log 盲改。
2. **追根因再修**：即使已定位症状触发点，仍须结合当前场景追问「为何会进入该状态」，修复**根因**而非仅打补丁。
3. **修完验证**：用 Log 或测试确认根因已消除；临时 Log 若仅用于排查，合并前删除或降为 debug。

### 禁止「多重保险」

不得为「以防万一」叠多层兜底，例如：

- 同一语义在多处重复校验 / 重试 / 回写
- 症状处 `try/catch` 吞错 + 上游再包一层 fallback
- 「删了 A 再在 B/C 补洞」而不解释为何 A 会丢

**允许**：单一、可证明的必要边界（如对外 API 的参数校验）；须在 PR / 说明中写清为何此处是唯一防线。

```typescript
// ❌ 多重保险：DOM 删 chip 后 sync 重插，Backspace 再删，effect 又插
if (agentMode === 'plan' && !hasChip) reinsertChip();
if (backspace) removeChip();
useEffect(() => { if (agentMode === 'plan') insertChip(); }, [agentMode]);

// ✅ 单一来源：config.agentMode 驱动 pin；Backspace 只改 config，由 effect 同步 UI
```

### 上游 / 无法解释的逻辑

若修复依赖第三方、历史债务或无法完全理解的行为：

- 在 workaround **旁**加**简体中文**注释：现象、已知限制、为何不继续深挖
- 禁止用注释替代根因分析；能修根因仍须修根因

```typescript
// Vercel Gateway /models 仅 type=image 表示生图；tags 推断 vision 易误判，故不采用。
if (record.type === 'image') {
  modelEntry.supportsImageGeneration = true;
}
```

## Agent / LLM 约定

- 发给 LLM 的模型可见文本默认统一使用英文，包括但不限于系统消息、工具定义概述、工具描述、评估文案等；除非某个机制明确要求其他语言，否则不要混入中文或中英混写，以尽量减少输出质量波动。
- **模型可见文案细则**（何时写 system、何时只写 tool definition / API `tools`、坏/好示例）：见 [`.github/instructions/llm-visible-copy.instructions.md`](.github/instructions/llm-visible-copy.instructions.md)。
- 修改 `packages/agent-core` 中与模型可见行为直接相关的内容时，如系统消息大段增删改、新增一个工具、工具概述或描述发生较大调整，应在实现完成后跑一次 eval，观察实际效果，再决定是否继续微调。
- 仅在变更较大时补跑 eval；小范围措辞修正、拼写修复、非模型可见重构，或纯宿主实现调整，通常不需要额外跑 eval。
- 不要过度设计 System Prompt、Tool Description 等文本，避免冗长。**尤其禁止在 system 里重复列举请求 `tools` 字段已声明的能力**（分散注意力、浪费上下文）。短小精悍、有助于 LLM 理解的内容输出效果通常更好。

## 上下文预置（push）vs 按需拉取（pull）

宿主向模型上下文注入事实（cwd、git、打开的文件、目录树等）时，默认**少塞**；上下文越长，有效注意力越摊薄，无关 token 并非「放着不看就行」。目标是在模型实际会读到的位置，放**信号密度最高的最小集合**。

### 何时 push（预置）

须**同时**满足：

- **高信号**：多数任务都会用到
- **省 token**：通常几个到几十个 token
- **pull 不划算**：模型常不会主动查，或一次工具往返成本远高于该事实本身

### 何时 pull（按需）

- 体量大、随任务变化、多数回合用不到
- 能用轻量标识符索引（路径、查询、URL）；路径/命名本身即相关性信号
- 内容会变：pull 拿到最新；**预置快照 stale 比不预置更糟**

### 本仓库常见项

- ✅ push：git 分支、dirty 状态、项目类型、测试命令（如 `[SPIRIT_BASIC_INFO]`）
- ❌ push：完整目录树；用 `glob` / `grep` 按需 pull
- 打开的文件：只 push **引用**（路径 + 光标/选区），不 push 全文；相关再 `read_file`

### 验证与演进

- 平衡点随模型能力、延迟预算、内容静态/动态而移动；**不要凭直觉拍板**某段该不该 push
- 变更模型可见上下文后，用 `npm run eval:compare` 对比 push vs 不 push，看是否转化为正确率
- 把「预置什么」做成可调、可测的旋钮，而非写死的兜底
