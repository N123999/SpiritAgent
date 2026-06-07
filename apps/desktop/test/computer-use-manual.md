# Computer Use 手工验收清单（Windows）

开发环境前置：

1. `npm run build:win-uia-helper`
2. `npm run build:electron`
3. Desktop 以 Electron 宿主启动（`npm run dev`）

## Helper 冒烟

```powershell
cd apps/desktop
node --test test/computer-use-helper.test.mjs
node --test test/computer-use-tree.test.mjs
node --test test/computer-use-e2e.test.mjs
```

## Agent 工具链

在 Agent 模式中让模型：

1. 调用 `computer_use_snapshot`（`mode=list_windows`）— 应返回顶层窗口列表，无需审批。
2. 打开记事本后调用 `computer_use_snapshot`（`mode=tree`, `process_name=notepad.exe`）— 应返回带 `ref` 的控件树。
3. 调用 `computer_use_action`（`action=set_value`）— 应弹出审批；批准后编辑器出现文本。
4. 打开计算器后对数字按钮 `invoke` — 应通过 Pattern 点击，不移动用户鼠标。

## 已知限制

- 仅 Windows + Electron 宿主暴露工具；Web 宿主与 CLI 无此能力。
- 不支持 SendInput / 坐标点击；`pattern_unsupported` 为预期失败。
- 必须显式指定 `process_name` 或 `window_title`；不支持默认全桌面遍历。
- 部分 Electron 应用 UIA 树可能不完整。
