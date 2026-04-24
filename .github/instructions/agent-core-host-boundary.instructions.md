---
applyTo: "**/*"
---

# Spirit Agent 能力边界说明

## 目的

这份说明用于统一 `agent-core`、宿主内部库、以及最终应用层的职责边界，避免 CLI 与 Desktop 各自复制一套语义、提示词、工具契约与宿主细节。

核心原则只有一条：

`agent-core` 是唯一的 Agent 能力库；宿主内部库负责宿主侧发现、管理与执行细节；应用层只做薄适配与 UI。

## 术语

### 工具定义

这里的“工具定义”只指模型可见的工具契约，不指宿主执行实现。

它只包含这些内容：

- 工具名
- 工具用途描述
- JSON Schema 参数定义

它不包含这些内容：

- 宿主内部请求类型
- 参数解析实现
- 审批与授权实现
- shell / 文件 / 搜索 / 网络 等实际执行实现

### 工具实现

“工具实现”指宿主为了兑现工具契约而提供的本地能力，包括：

- function call 到宿主请求对象的解析
- 参数校验与错误文案
- 授权、审批、提问流程
- 具体执行逻辑
- 平台相关适配

## 分层边界

### 1. agent-core

`agent-core` 是唯一的 Agent 能力库，也是唯一允许承载模型语义资产的地方。

它负责：

- 主系统提示词
- Rules / Skills / Plan / Active Skills 这些系统段落的语义与拼装
- 内建工具的模型可见定义：名称、描述、JSON Schema
- MCP 协议、MCP 工具 / resource / prompt 语义与运行时接入
- Agent runtime、turn machine、streaming、tool round 等通用编排能力
- 面向宿主的接口定义

它不负责：

- 扫描工作区、用户目录、AppData、Keyring
- 发现和启用 `rules`、`skills`、`plan` 文件
- 管理这些宿主元数据的持久化状态
- 直接执行 shell、文件系统、网页抓取、搜索
- UI 表单、窗口、TUI、Electron、Rust 宿主交互

结论：

`agent-core` 负责“让模型看见什么”和“运行时如何消费这些能力”，不负责“宿主怎样把这些能力接到本机上”。

### 2. 宿主内部库

宿主内部库是 Host / UI 层的共享实现，不是公共 Agent SDK。

它负责：

- `rules`、`skills`、`plan` 的发现逻辑
- 这些元数据的启用、禁用、状态持久化与解析
- 内建工具的宿主实现注册表
- 工具请求类型、参数解析、参数校验
- 授权、审批、追问、宿主错误文案
- 搜索、文件读写、网页抓取、shell 执行等宿主能力实现
- 与平台、路径、权限、配置、用户目录相关的细节

它不负责：

- 再定义一份模型可见的工具名、工具描述、JSON Schema
- 再复制一份系统提示词文本
- 再解释一遍 Rules / Skills / Plan 对模型的语义
- 取代 `agent-core` 成为第二个“能力库”

结论：

宿主内部库是 `agent-core` 的实现侧配套，不是第二个 Agent Core。

### 3. apps

最终应用层只保留宿主接线和 UI。

它负责：

- Rust CLI、Electron、Desktop Web、TUI 等最终入口
- 将平台事件、UI 交互、权限确认结果接到宿主内部库
- 将宿主内部库接到 `agent-core`

它不负责：

- 自己维护一份工具契约
- 自己维护一份系统提示词
- 自己维护一份共享发现 / 管理逻辑

结论：

apps 必须尽量薄，避免 CLI 与 Desktop 再次分叉。

## 所有权表

| 资产 | 归属 |
| --- | --- |
| 主系统提示词 | `agent-core` |
| Rules / Skills / Plan 的系统段落语义 | `agent-core` |
| 内建工具名称、描述、JSON Schema | `agent-core` |
| MCP 协议、MCP tool / resource / prompt 运行时 | `agent-core` |
| Host 接口定义 | `agent-core` |
| Rules / Skills / Plan 的发现与管理 | 宿主内部库 |
| 宿主工具请求类型、解析、校验、审批、执行 | 宿主内部库 |
| shell / search / file / web fetch 的平台适配 | 宿主内部库 |
| CLI / Desktop UI 与平台接线 | apps |

## 强约束

为了避免后续再次漂移，约束如下：

1. 任意模型可见文本，如果它描述的是工具契约或系统规则语义，只能在 `agent-core` 定义。
2. 任意宿主扫描、路径、权限、状态持久化逻辑，不进入 `agent-core`。
3. 任意应用入口都不能再定义一份新的工具 Schema 或系统提示词副本。
4. 宿主内部库只能实现 `agent-core` 暴露的契约，不能重写契约语义。

## 当前仓库对应解释

按这个边界解释，当前仓库应这样理解：

- `packages/agent-core` 继续承载 runtime、MCP、系统提示词、工具契约。
- CLI 与 Desktop 当前重复的宿主工具实现、rules / skills / plan 发现与管理逻辑，应收敛到宿主内部库。
- `agent-core` 不应吸收这些发现与管理实现，因为那会把 Host / UI 责任错误抬升成 Agent SDK 的一部分。

## 设计判断

“把 Rules / Skills / Plan 的发现与管理留在宿主内部库”并不违背 `agent-core` 作为唯一能力库的目标。

恰恰相反，这样才能保证：

- `agent-core` 只表达能力契约与运行时语义
- 宿主内部库只表达本机如何提供这些能力
- apps 不再重复造轮子

如果未来第三方接入 `agent-core`，他们应自行实现宿主发现与管理逻辑，而不是把本仓库的宿主扫描策略当成 SDK 强绑定的一部分。

这正是 SDK 与 Host 之间应该有的边界。
