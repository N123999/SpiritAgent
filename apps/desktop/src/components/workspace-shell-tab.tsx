import { useEffect, useRef, useState } from "react";

import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type WorkspaceShellTabProps = {
  workspaceRoot: string;
};

/** 与 `.dark` 下 `--background`（oklch(0.145 0 0) ≈ #0a0a0a）一致。 */
const TERMINAL_DARK_BG = "#0a0a0a";

/** Windows 上优先系统 Cascadia / Consolas；不把 webfont 置于栈首，以免覆盖已安装的系统等宽字体。 */
const TERMINAL_FONT_FAMILY =
  '"Cascadia Code", "Cascadia Mono", Consolas, "Lucida Console", "Courier New", monospace';

function terminalTheme(): import("@xterm/xterm").ITheme {
  const dark = document.documentElement.classList.contains("dark");
  if (dark) {
    return {
      background: TERMINAL_DARK_BG,
      foreground: "#fafafa",
      cursor: "#fafafa",
      cursorAccent: TERMINAL_DARK_BG,
      selectionBackground: "rgba(100, 100, 100, 0.35)",
    };
  }
  return {
    background: "#ffffff",
    foreground: "#0a0a0a",
    cursor: "#0a0a0a",
    cursorAccent: "#ffffff",
    selectionBackground: "rgba(0, 0, 0, 0.15)",
  };
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

export function WorkspaceShellTab({ workspaceRoot }: WorkspaceShellTabProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const activePtyIdRef = useRef<string | null>(null);
  const [embedError, setEmbedError] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);
  const bridge = typeof window !== "undefined" ? window.spiritDesktop : undefined;
  const canEmbed = Boolean(bridge?.ptyCreate);
  const trimmed = workspaceRoot.trim();

  useEffect(() => {
    setEmbedError(null);
    activePtyIdRef.current = null;
    termRef.current = null;
    const b = typeof window !== "undefined" ? window.spiritDesktop : undefined;
    if (!trimmed || !b?.ptyCreate || !b.ptySubscribe) {
      return;
    }

    const el = containerRef.current;
    if (!el) {
      return;
    }

    let alive = true;
    let termDisposed = false;
    let ptyId: string | undefined;
    let ro: ResizeObserver | undefined;
    let unsubPty: (() => void) | undefined;

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 12,
      lineHeight: 1.2,
      fontFamily: TERMINAL_FONT_FAMILY,
      fontWeight: "normal",
      theme: terminalTheme(),
      scrollback: 8000,
    });
    termRef.current = term;
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(el);
    fitAddon.fit();

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
      void navigator.clipboard.readText().then((t) => {
        if (t) {
          term.paste(t);
        }
      });
    };
    el.addEventListener("contextmenu", onContextMenu, true);

    unsubPty = b.ptySubscribe({
      onData: (payload) => {
        if (payload.id === activePtyIdRef.current) {
          term.write(payload.data);
        }
      },
      onExit: (payload) => {
        if (payload.id === activePtyIdRef.current) {
          term.write(`\r\n\x1b[90m[已退出，代码 ${payload.exitCode}]\x1b[0m\r\n`);
          activePtyIdRef.current = null;
        }
      },
    });

    const disposeTerminal = (): void => {
      if (termDisposed) {
        return;
      }
      termDisposed = true;
      term.dispose();
      if (termRef.current === term) {
        termRef.current = null;
      }
    };

    const teardown = (): void => {
      el.removeEventListener("contextmenu", onContextMenu, true);
      unsubPty?.();
      unsubPty = undefined;
      ro?.disconnect();
      ro = undefined;
      if (ptyId) {
        void b.ptyKill(ptyId);
        ptyId = undefined;
      }
      disposeTerminal();
      activePtyIdRef.current = null;
    };

    void (async () => {
      const created = await b.ptyCreate({
        cwd: trimmed,
        cols: term.cols,
        rows: term.rows,
      });

      if (!alive) {
        if (created.ok) {
          void b.ptyKill(created.id);
        }
        el.removeEventListener("contextmenu", onContextMenu, true);
        unsubPty?.();
        ro?.disconnect();
        disposeTerminal();
        activePtyIdRef.current = null;
        return;
      }

      if (!created.ok) {
        setEmbedError(created.error);
        teardown();
        return;
      }

      ptyId = created.id;
      activePtyIdRef.current = created.id;
      term.onData((data) => {
        b.ptyWrite(created.id, data);
      });

      ro = new ResizeObserver(() => {
        fitAddon.fit();
        b.ptyResize(created.id, term.cols, term.rows);
      });
      ro.observe(el);

      queueMicrotask(() => {
        if (alive) {
          term.focus();
        }
      });
    })();

    return () => {
      alive = false;
      teardown();
    };
  }, [trimmed, canEmbed, retryNonce]);

  const openExternal = (): void => {
    if (!bridge?.openSystemTerminal || !trimmed) {
      return;
    }
    void bridge.openSystemTerminal(trimmed);
  };

  if (!trimmed) {
    return <p className="text-muted-foreground">打开工作区后可用。</p>;
  }

  if (!canEmbed || !bridge?.openSystemTerminal) {
    return <p className="text-muted-foreground">Shell 仅在 Electron 桌面版可用。</p>;
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 overflow-hidden">
      {embedError ? (
        <div className="flex shrink-0 flex-col gap-2">
          <p className="text-xs text-destructive">{embedError}</p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setEmbedError(null);
                setRetryNonce((n) => n + 1);
              }}
            >
              重试
            </Button>
            <Button type="button" variant="secondary" size="sm" onClick={openExternal}>
              打开系统终端
            </Button>
          </div>
        </div>
      ) : null}
      <div
        ref={containerRef}
        className={cn(
          "workspace-shell-xterm min-h-0 min-w-0 flex-1 overflow-hidden rounded-md border border-border/40 bg-background",
          embedError ? "hidden" : "block",
        )}
      />
    </div>
  );
}
