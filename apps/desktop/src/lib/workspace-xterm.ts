import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { Terminal } from "@xterm/xterm";

import { configureWorkspaceTerminalLinks } from "@/lib/workspace-terminal-links";
import { attachWorkspaceTerminalResizeObserver } from "@/lib/workspace-terminal-resize";
import {
  readTerminalThemeFromDocument,
  trackTerminalTheme,
} from "@/lib/workspace-terminal-theme";

/** Windows 上优先系统 Cascadia / Consolas；不把 webfont 置于栈首，以免覆盖已安装的系统等宽字体。 */
export const WORKSPACE_TERMINAL_FONT_FAMILY =
  '"Cascadia Code", "Cascadia Mono", Consolas, "Lucida Console", "Courier New", monospace';

const WORKSPACE_TERMINAL_FONT_SIZE = 14;
const WORKSPACE_TERMINAL_LINE_HEIGHT = 1;
const WORKSPACE_TERMINAL_LETTER_SPACING = 0;

/** 在 open + fit 之后加载 WebGL；失败或上下文丢失时回退默认渲染器。 */
export function loadWorkspaceTerminalWebgl(term: Terminal): WebglAddon | null {
  try {
    const webgl = new WebglAddon();
    webgl.onContextLoss(() => {
      console.warn("[workspace-xterm] WebGL context lost; falling back to default renderer.");
      webgl.dispose();
    });
    term.loadAddon(webgl);
    return webgl;
  } catch (error) {
    console.warn("[workspace-xterm] WebGL addon failed to load; using default renderer.", error);
    return null;
  }
}

/** 有选区：复制；无选区：粘贴（与常见集成终端一致，不弹出菜单）。 */
function writeClipboard(text: string): void {
  const b = window.spiritDesktop;
  if (b?.writeClipboardText) {
    b.writeClipboardText(text);
    return;
  }
  void navigator.clipboard.writeText(text);
}

function readClipboardSync(): string | null {
  const b = window.spiritDesktop;
  if (b?.readClipboardText) {
    try {
      return b.readClipboardText();
    } catch {
      return null;
    }
  }
  return null;
}

export type WorkspaceTerminalPtyBridge = Pick<
  NonNullable<typeof window.spiritDesktop>,
  "ptyCreate" | "ptyWrite" | "ptyResize" | "ptyKill" | "ptySubscribe"
>;

export type CreateWorkspaceTerminalOptions = {
  container: HTMLElement;
  cwd: string;
  bridge: WorkspaceTerminalPtyBridge;
  onTitleChange?: (title: string | undefined) => void;
  onEmbedError: (message: string) => void;
  shellExitedMessage: (exitCode: number) => string;
  /** 侧栏拖拽等连续布局变化期间暂停 fit，避免 PTY 与渲染器尺寸不同步。 */
  isResizeSuspended?: () => boolean;
};

export type WorkspaceTerminalSession = {
  terminal: Terminal;
  fitAddon: FitAddon;
  /** 在布局稳定后手动触发 fit（例如侧栏拖拽结束）。 */
  scheduleFit: () => void;
  dispose: () => void;
};

export function createWorkspaceTerminalSession(
  options: CreateWorkspaceTerminalOptions,
): WorkspaceTerminalSession {
  const {
    container,
    cwd,
    bridge,
    onTitleChange,
    onEmbedError,
    shellExitedMessage,
    isResizeSuspended,
  } = options;

  let termDisposed = false;
  let ptyId: string | undefined;
  let resizeController: ReturnType<typeof attachWorkspaceTerminalResizeObserver> | undefined;
  let resizePtyDisposable: { dispose(): void } | undefined;
  let unsubPty: (() => void) | undefined;
  let sessionAlive = true;
  let activePtyId: string | null = null;
  let untrackTheme: (() => void) | undefined;

  const term = new Terminal({
    cursorBlink: true,
    fontSize: WORKSPACE_TERMINAL_FONT_SIZE,
    lineHeight: WORKSPACE_TERMINAL_LINE_HEIGHT,
    letterSpacing: WORKSPACE_TERMINAL_LETTER_SPACING,
    fontFamily: WORKSPACE_TERMINAL_FONT_FAMILY,
    fontWeight: "normal",
    theme: readTerminalThemeFromDocument(),
    scrollback: 8000,
  });
  untrackTheme = trackTerminalTheme(term);
  configureWorkspaceTerminalLinks(term);

  term.onTitleChange((title) => {
    onTitleChange?.(title || undefined);
  });

  const fitAddon = new FitAddon();
  term.loadAddon(fitAddon);
  term.open(container);
  fitAddon.fit();
  const webglAddon = loadWorkspaceTerminalWebgl(term);
  fitAddon.fit();

  resizeController = attachWorkspaceTerminalResizeObserver({
    container,
    terminal: term,
    fitAddon,
    webglAddon,
    isSuspended: isResizeSuspended,
  });

  const onContextMenu = (e: MouseEvent): void => {
    e.preventDefault();
    e.stopPropagation();
    const sel = term.getSelection();
    if (sel.length > 0) {
      writeClipboard(sel);
      term.clearSelection();
      return;
    }
    const sync = readClipboardSync();
    if (sync != null) {
      term.paste(sync);
      return;
    }
    void navigator.clipboard.readText().then((text) => {
      if (text) {
        term.paste(text);
      }
    });
  };
  container.addEventListener("contextmenu", onContextMenu, true);

  unsubPty = bridge.ptySubscribe({
    onData: (payload) => {
      if (payload.id === activePtyId) {
        term.write(payload.data);
      }
    },
    onExit: (payload) => {
      if (payload.id === activePtyId) {
        term.write(`\r\n\x1b[90m[${shellExitedMessage(payload.exitCode)}]\x1b[0m\r\n`);
        activePtyId = null;
      }
    },
  });

  const disposeTerminal = (): void => {
    if (termDisposed) {
      return;
    }
    termDisposed = true;
    untrackTheme?.();
    untrackTheme = undefined;
    term.dispose();
  };

  const teardown = (): void => {
    sessionAlive = false;
    container.removeEventListener("contextmenu", onContextMenu, true);
    unsubPty?.();
    unsubPty = undefined;
    resizeController?.dispose();
    resizeController = undefined;
    resizePtyDisposable?.dispose();
    resizePtyDisposable = undefined;
    if (ptyId) {
      void bridge.ptyKill(ptyId);
      ptyId = undefined;
    }
    disposeTerminal();
    activePtyId = null;
  };

  void (async () => {
    const created = await bridge.ptyCreate({
      cwd,
      cols: term.cols,
      rows: term.rows,
    });

    if (!sessionAlive) {
      if (created.ok) {
        void bridge.ptyKill(created.id);
      }
      container.removeEventListener("contextmenu", onContextMenu, true);
      unsubPty?.();
      resizeController?.dispose();
      resizeController = undefined;
      disposeTerminal();
      activePtyId = null;
      return;
    }

    if (!created.ok) {
      onEmbedError(created.error);
      teardown();
      return;
    }

    ptyId = created.id;
    activePtyId = created.id;
    term.onData((data) => {
      bridge.ptyWrite(created.id, data);
    });

    resizePtyDisposable = term.onResize(({ cols, rows }) => {
      bridge.ptyResize(created.id, cols, rows);
    });
    resizeController?.scheduleFit();

    queueMicrotask(() => {
      if (sessionAlive) {
        term.focus();
      }
    });
  })();

  return {
    terminal: term,
    fitAddon,
    scheduleFit: () => {
      resizeController?.scheduleFit();
    },
    dispose: teardown,
  };
}
