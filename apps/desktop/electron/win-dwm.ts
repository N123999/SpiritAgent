/**
 * Tauri `frame_chrome::apply_dwm_chrome_if_any` 在 Win32 上显式设置
 * `DWMWA_USE_IMMERSIVE_DARK_MODE`。Electron 的 `nativeTheme` + `setBackgroundMaterial`
 * 在「系统浅色 / 应用深色」组合下仍常把 Mica 合成成浅色块；必须对 HWND 写入 DWM 属性。
 */
import type { BrowserWindow } from 'electron';
import koffi from 'koffi';

const DWMWA_USE_IMMERSIVE_DARK_MODE = 20;
const SWP_NOSIZE = 0x0001;
const SWP_NOMOVE = 0x0002;
const SWP_NOZORDER = 0x0004;
const SWP_FRAMECHANGED = 0x0020;

let dwmSetWindowAttribute:
  | ((hwnd: bigint, attr: number, ptr: Uint8Array, cb: number) => number)
  | undefined;
let setWindowPos:
  | ((
      hwnd: bigint,
      insertAfter: bigint,
      x: number,
      y: number,
      cx: number,
      cy: number,
      flags: number,
    ) => number)
  | undefined;

function ensureWin32Api(): boolean {
  if (process.platform !== 'win32') {
    return false;
  }
  if (dwmSetWindowAttribute && setWindowPos) {
    return true;
  }
  try {
    const dwm = koffi.load('dwmapi.dll');
    // HWND 用 uintptr_t，避免 void* 与 JS BigInt 转换歧义
    dwmSetWindowAttribute = dwm.func(
      'int __stdcall DwmSetWindowAttribute(uintptr_t hwnd, uint32_t dwAttribute, void *pvAttribute, uint32_t cbAttribute)',
    ) as typeof dwmSetWindowAttribute;

    const user32 = koffi.load('user32.dll');
    setWindowPos = user32.func(
      'int __stdcall SetWindowPos(uintptr_t hWnd, uintptr_t hWndInsertAfter, int X, int Y, int cx, int cy, uint32_t uFlags)',
    ) as typeof setWindowPos;
    return true;
  } catch (err) {
    console.error('[spirit-desktop] koffi load dwmapi/user32 failed', err);
    dwmSetWindowAttribute = undefined;
    setWindowPos = undefined;
    return false;
  }
}

function hwndFromBrowserWindow(window: BrowserWindow): bigint | undefined {
  const raw = window.getNativeWindowHandle();
  if (!raw || raw.length < 4) {
    return undefined;
  }
  if (process.arch === 'x64' || process.arch === 'arm64') {
    if (raw.length >= 8) {
      return raw.readBigUInt64LE(0);
    }
  }
  return BigInt(raw.readUInt32LE(0));
}

/** 将云母 / 标题栏非客户区的「深浅」与页面 `html.dark` 对齐（不跟系统设置走）。 */
export function syncWindowsImmersiveDarkMode(window: BrowserWindow, darkContent: boolean): void {
  if (!ensureWin32Api() || !dwmSetWindowAttribute || !setWindowPos) {
    return;
  }
  const hwnd = hwndFromBrowserWindow(window);
  if (hwnd === undefined || hwnd === 0n) {
    return;
  }
  const attr = new Uint8Array(4);
  new DataView(attr.buffer).setUint32(0, darkContent ? 1 : 0, true);
  try {
    dwmSetWindowAttribute(hwnd, DWMWA_USE_IMMERSIVE_DARK_MODE, attr, 4);
    const flags = SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_FRAMECHANGED;
    setWindowPos(hwnd, 0n, 0, 0, 0, 0, flags);
  } catch (err) {
    console.error('[spirit-desktop] DWM/SetWindowPos failed', err);
  }
}
