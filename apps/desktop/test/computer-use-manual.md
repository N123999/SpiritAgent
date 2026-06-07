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
node --test test/cdp-ax-tree.test.mjs
node --test test/computer-use-e2e.test.mjs
node --test test/computer-use-cdp-e2e.test.mjs
```

## Agent 工具链（UIA）

在 Agent 模式中让模型：

1. 调用 `computer_use_snapshot`（`mode=list_windows`）— 应返回顶层窗口列表，无需审批。
2. 打开记事本后调用 `computer_use_snapshot`（`mode=tree`, `process_name=notepad.exe`）— 应返回 `host_kind=native`、`transport=uia` 与带 `w…` ref 的控件树。
3. 调用 `computer_use_action`（`action=set_value`）— 应弹出审批；批准后编辑器出现文本。
4. 打开计算器后对数字按钮 `invoke` — 应通过 Pattern 点击，不移动用户鼠标。

## CDP 回退（CEF / Chromium 宿主）

目标应用须**自行**以远程调试端口启动；Spirit 不会替用户重启或注入启动参数。

### 网易云音乐示例

```powershell
# 路径因安装位置而异
& "C:\Program Files (x86)\Netease\CloudMusic\cloudmusic.exe" --remote-debugging-port=9222
```

验收步骤：

1. 确认 `http://127.0.0.1:9222/json/list` 可访问且含 `type=page` 条目。
2. `computer_use_snapshot`（`mode=tree`, `process_name=cloudmusic.exe` 或匹配窗口标题）— 应返回 `host_kind=cef`、`transport=cdp`、`fallback_reason=cef_host`，树中 ref 为 `c9222n…` 格式。
3. 对搜索框 `set_value`、播放按钮 `invoke` — 使用 `c…` ref；`computer_use_action` 需审批。
4. 可选 `debug_port` 参数覆盖默认 9222。

### 安全提示

`--remote-debugging-port` 会在本机暴露 Chromium 控制面；仅在受信任环境、验收或自动化时使用，勿在生产环境长期开启。

## 已知限制

- 仅 Windows + Electron 宿主暴露工具；Web 宿主与 CLI 无此能力。
- UIA 路径不支持 SendInput / 坐标点击；`pattern_unsupported` 为预期失败。
- CDP 路径仅连接 `127.0.0.1`；未开 debug port 时返回 `cdp_unreachable` / `cdp_target_not_found`。
- 必须显式指定 `process_name` 或 `window_title`；不支持默认全桌面遍历。
- 多 page target 歧义时返回 `target_ambiguous`，需更具体的 `window_title`。
