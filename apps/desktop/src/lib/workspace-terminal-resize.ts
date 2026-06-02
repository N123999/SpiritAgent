import type { FitAddon } from "@xterm/addon-fit";
import type { WebglAddon } from "@xterm/addon-webgl";
import type { Terminal } from "@xterm/xterm";

const RESIZE_DEBOUNCE_MS = 100;
const MIN_TERMINAL_WIDTH_PX = 48;
const MIN_TERMINAL_HEIGHT_PX = 48;

function isContainerMeasurable(container: HTMLElement): boolean {
  if (!container.isConnected) {
    return false;
  }
  const rect = container.getBoundingClientRect();
  return rect.width >= MIN_TERMINAL_WIDTH_PX && rect.height >= MIN_TERMINAL_HEIGHT_PX;
}

export type WorkspaceTerminalResizeController = {
  /** 在布局稳定后触发一次 fit（例如侧栏拖拽结束）。 */
  scheduleFit: () => void;
  dispose: () => void;
};

export function attachWorkspaceTerminalResizeObserver(options: {
  container: HTMLElement;
  terminal: Terminal;
  fitAddon: FitAddon;
  webglAddon?: WebglAddon | null;
  /** 为 true 时忽略 ResizeObserver（例如侧栏仍在拖拽中）。 */
  isSuspended?: () => boolean;
}): WorkspaceTerminalResizeController {
  const { container, terminal, fitAddon, webglAddon, isSuspended } = options;

  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;

  const runFit = (): void => {
    if (disposed || isSuspended?.()) {
      return;
    }
    if (!isContainerMeasurable(container)) {
      return;
    }

    const beforeCols = terminal.cols;
    const beforeRows = terminal.rows;
    fitAddon.fit();

    if (terminal.cols === beforeCols && terminal.rows === beforeRows) {
      return;
    }

    try {
      webglAddon?.clearTextureAtlas();
    } catch {
      /* ignore */
    }
    try {
      terminal.clearTextureAtlas();
    } catch {
      /* ignore */
    }
  };

  const scheduleFit = (): void => {
    if (disposed) {
      return;
    }
    if (debounceTimer !== undefined) {
      clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(() => {
      debounceTimer = undefined;
      requestAnimationFrame(runFit);
    }, RESIZE_DEBOUNCE_MS);
  };

  const resizeObserver = new ResizeObserver(() => {
    scheduleFit();
  });
  resizeObserver.observe(container);

  return {
    scheduleFit,
    dispose: () => {
      disposed = true;
      if (debounceTimer !== undefined) {
        clearTimeout(debounceTimer);
        debounceTimer = undefined;
      }
      resizeObserver.disconnect();
    },
  };
}
