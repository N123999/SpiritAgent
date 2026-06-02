import { randomUUID } from 'node:crypto';
import { existsSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

import type { WebContents } from 'electron';

const require = createRequire(import.meta.url);

type PtySession = {
  webContentsId: number;
  kill: () => void;
  resize: (cols: number, rows: number) => void;
  write: (data: string) => void;
};

function resolveValidatedCwd(raw: string): string {
  const resolved = path.resolve(raw.trim());
  if (!existsSync(resolved) || !statSync(resolved).isDirectory()) {
    throw new Error('cwd 不是有效目录');
  }
  return resolved;
}

function firstExistingFile(candidates: string[]): string | undefined {
  for (const candidate of candidates) {
    const trimmed = candidate.trim();
    if (trimmed && existsSync(trimmed)) {
      return trimmed;
    }
  }
  return undefined;
}

/**
 * 集成终端默认 Shell。
 * Windows：优先 pwsh（PowerShell 7+），其次 Windows PowerShell，最后 cmd。
 * 可通过环境变量 SPIRIT_TERMINAL_SHELL 指定可执行文件完整路径。
 */
export function defaultShellForPty(): { file: string; args: string[] } {
  const override = process.env.SPIRIT_TERMINAL_SHELL?.trim();
  if (override) {
    if (!existsSync(override)) {
      throw new Error(`SPIRIT_TERMINAL_SHELL 不存在: ${override}`);
    }
    return { file: override, args: [] };
  }

  if (process.platform === 'win32') {
    const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
    const systemRoot = process.env.SystemRoot || 'C:\\Windows';
    const pwsh =
      firstExistingFile([
        process.env.PWSH_PATH || '',
        path.join(programFiles, 'PowerShell', '7', 'pwsh.exe'),
        path.join(programFiles, 'PowerShell', '7-preview', 'pwsh.exe'),
        path.join(
          process.env.LOCALAPPDATA || '',
          'Microsoft',
          'WindowsApps',
          'pwsh.exe',
        ),
      ]) ||
      firstExistingFile([
        path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
      ]);
    if (pwsh) {
      return { file: pwsh, args: [] };
    }
    const comspec =
      process.env.ComSpec || path.join(systemRoot, 'System32', 'cmd.exe');
    return { file: comspec, args: [] };
  }

  const shellPath = process.env.SHELL || '/bin/bash';
  return { file: shellPath, args: [] };
}

function loadPtyModule(): typeof import('node-pty') {
  return require('node-pty') as typeof import('node-pty');
}

export class WorkspacePtyManager {
  private readonly sessions = new Map<string, PtySession>();

  createSession(
    webContents: WebContents,
    request: { cwd: string; cols: number; rows: number },
  ): { ok: true; id: string } | { ok: false; error: string } {
    const cwd = resolveValidatedCwd(request.cwd);
    const cols = Math.max(2, Math.min(512, Math.floor(request.cols)));
    const rows = Math.max(1, Math.min(256, Math.floor(request.rows)));
    let pty: import('node-pty').IPty;
    try {
      const mod = loadPtyModule();
      const { file, args } = defaultShellForPty();
      const spawnOptions = {
        name: 'xterm-256color',
        cols,
        rows,
        cwd,
        env: process.env as Record<string, string>,
      };
      const preferConpty =
        process.platform === 'win32' && process.env.SPIRIT_PTY_USE_WINPTY !== '1';
      try {
        pty = mod.spawn(file, args, {
          ...spawnOptions,
          // ConPTY 在 Windows 上 resize/reflow 明显优于 WinPTY；失败时回退 WinPTY。
          useConpty: preferConpty,
        });
      } catch (firstErr) {
        if (!preferConpty) {
          throw firstErr;
        }
        pty = mod.spawn(file, args, {
          ...spawnOptions,
          useConpty: false,
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: message };
    }

    const id = randomUUID();
    const wcId = webContents.id;

    const forward = (data: string): void => {
      if (!webContents.isDestroyed()) {
        webContents.send('desktop:pty-data', { id, data });
      }
    };

    pty.onData(forward);
    pty.onExit(({ exitCode, signal }) => {
      this.sessions.delete(id);
      if (!webContents.isDestroyed()) {
        webContents.send('desktop:pty-exit', { id, exitCode, signal });
      }
    });

    this.sessions.set(id, {
      webContentsId: wcId,
      kill: () => {
        try {
          pty.kill();
        } catch {
          /* ignore */
        }
      },
      resize: (c: number, r: number) => {
        try {
          pty.resize(
            Math.max(2, Math.min(512, Math.floor(c))),
            Math.max(1, Math.min(256, Math.floor(r))),
          );
        } catch {
          /* ignore */
        }
      },
      write: (data: string) => {
        try {
          pty.write(data);
        } catch {
          /* ignore */
        }
      },
    });

    return { ok: true, id };
  }

  assertOwner(webContents: WebContents, id: string): PtySession | null {
    const s = this.sessions.get(id);
    if (!s || s.webContentsId !== webContents.id) {
      return null;
    }
    return s;
  }

  write(webContents: WebContents, id: string, data: string): void {
    this.assertOwner(webContents, id)?.write(data);
  }

  resize(webContents: WebContents, id: string, cols: number, rows: number): void {
    this.assertOwner(webContents, id)?.resize(cols, rows);
  }

  kill(webContents: WebContents, id: string): void {
    const s = this.assertOwner(webContents, id);
    if (s) {
      s.kill();
      this.sessions.delete(id);
    }
  }

  disposeAllForWebContents(webContentsId: number): void {
    for (const [id, s] of this.sessions) {
      if (s.webContentsId === webContentsId) {
        s.kill();
        this.sessions.delete(id);
      }
    }
  }
}
