---
applyTo: "packages/agent-core/**"
---

# 模型可见文案（System Message / Tool Description）

修改 `packages/agent-core` 中系统消息、工具描述、`*PromptSection` 时遵守。

Spirit Agent 中，**工具定义（name / description / schema）与 system message 共用上下文**。模型在 function-calling / Responses 请求里**已经能看到 `tools` 字段**时，不要在 system 里重复列举、复述或「再教一遍」同名能力。

**原则**：system 只写**工具定义无法表达**的宿主策略；能力用法写在 **tool description** 或 **API `tools` 注入**里。英文、短句、可删则删。较大改动后补跑 eval。

LLM 上下文段使用小写 XML 标签（如 `<rules>`、`<agent_mode>`、`<compact_summary>`），由 `llm-context-block.ts` 的 `wrapLlmContextBlock` 生成；**不是**模型契约外的第二套能力声明。新段落优先 plain 文案或用户/assistant 消息 meta（如 `<active_skill>`、`<user_message_at>`）。

## 当前注入位置（简表）

| 内容 | 注入位置 | 说明 |
| --- | --- | --- |
| Host 主策略 + Rules / Skills catalog / MCP catalog / Agent mode / Loop / Extensions / Dreams / Basic info | 单条 `role: system`（`buildToolAgentMessages`） | 各段分别包在 `<rules>`、`<skills_catalog>`、`<mcp_catalog>`、`<agent_mode>`、`<loop_mode>`、`<extensions>`、`<dreams>`、`<basic_info>` 中 |
| 用户显式激活的 Skill 全文 | 该条用户消息最前的 `<active_skill>…</active_skill>` | 与 `<user_message_at>` 同属 user meta，非 system |
| Plan 模式指引 | `<agent_mode>` 段（Plan 模式文案） | **无** 单独 plan 系统段；plan 文件由 `create_plan` 等工具落盘 |
| apply_patch transport | system 内一行 plain 英文 | `buildApplyPatchFileToolsPromptSection` |
| 历史压缩摘要 | history 内 `role: system` | `<compact_summary>`（压缩管线专用） |
| 压缩进度 UI 文案 | compaction 事件 `text` | `<compact_progress>` |
| Dream Collector 子代理 | 独立 collector runtime 的 system | `<dream_collector>` |

## 何时写 system / 何时不写

| 场景 | 写在哪 | system 是否再写 |
| --- | --- | --- |
| 宿主 function tool | `host-tools` 等 tool definition | 否（除非全 transport 级策略） |
| OpenAI/xAI SDK `webSearch()` | 请求 `tools` | 否 |
| Alibaba Responses `{ type: web_search }` | HTTP `tools` 注入 | 否 |
| Alibaba Chat `extra_body` flags | fetch 层 / extra_body | 否（无 function 名可声明） |
| `apply_patch` 取代 create/edit/delete | SDK built-in + 必要时 **一行** transport 说明 | 仅 V4A/不可用工具等 definition 未覆盖处 |
| Ask / Plan / Agent 模式 | `<agent_mode>` 段（无单独 plan 系统段） | 是，但 **不枚举工具** |
| 用户显式激活 Skill | 该条 user 消息 `<active_skill>` meta | 否（不进 system） |

## 坏 / 好示例（≥5）

### 1. Ask 模式：在 system 里列工具能力

**坏** — 模型已从 `tools` 看到列表，system 重复分散注意力：

```text
Help read-only: explain, read and search the repo, and fetch web pages.
Do not edit files, run shell commands, or generate images.
You may use run_subagent; delegated agents stay in Ask mode.
```

**好** — 只约束模式与边界：

```text
Help read-only. Only call tools that are available in this request.
If the user wants edits or execution, ask them to switch to Agent mode.
```

### 2. Alibaba Open Responses：built-in 写进 system

**坏** — `web_search` / `code_interpreter` 已在请求 `tools` 里，system 长篇解释：

```text
Provider-native capabilities on Alibaba (Bailian):
On Open Responses, use the declared built-in tools (web_search, code_interpreter) when you need...
```

**好** — 能力只经 `buildAlibabaResponsesBuiltInTools()` 注入；URL 正文走宿主 `web_fetch`。**不**追加 `buildAlibabaNativeToolsPromptSection` 类 system 段。

### 3. OpenAI / xAI Responses：web search 双份说明

**坏** — SDK 已挂 `web_search`，system 再写 `buildProviderWebSearchPromptSection` 小作文。

**好** — 依赖 `buildToolAgentHostPrompt`：「Available tools are defined only by the tools field in this request.」`buildProviderWebSearchPromptSection` 不注入 system。

### 4. 在 system 里枚举宿主工具名

**坏**：`You have read_file, write_file, grep, glob, web_fetch, bash...`

**好** — 工具名与用法只在各 tool 的 `description`；system 仅保留安全 mandatory 策略。

### 5. Provider 能力小作文 / 重复「不要用未声明工具」

**坏** — 同义反复多段。

**好** — host prompt **一处**说明即可。

### 6. apply_patch：在 system 复述整份 API 教程

**坏** — 多行重复 SDK / schema 已有信息 + 点名禁止未声明的 create_file 等。

**好** — 一行：`File edits on this transport: use apply_patch with headerless V4A unified diffs only.`

### 7. Skills catalog：元数据段写成使用手册

**坏** — `<skills_catalog>` 内多段激活教程。

**好** — catalog 只列 id/name/path/description。

## 自检清单

1. 该能力是否已在本请求 `tools`（或 Chat `extra_body`）里可见？
2. 若可见，system 是否仍在复述？→ 删 system 段或改 tool description / API 注入。
3. 是否仅为「以防万一」多写？→ 删。
4. 是否英文、能否再短一半？
5. 上游 workaround 是否在代码旁有中文注释（见 copilot-instructions BUG 修复节）？
