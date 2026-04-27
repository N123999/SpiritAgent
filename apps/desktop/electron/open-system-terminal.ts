import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

import { shell } from 'electron';

function assertDirectory(cwd: string): string {
  const resolved = path.resolve(cwd);
  if (!existsSync(resolved)) {
    throw new Error('工作区目录不存在');
  }
  return resolved;
}

/**
 * 在系统终端中打开目录（独立窗口，不嵌入）。
 * Windows：优先 `wt -d`（常见安装路径或 PATH），失败则 `cmd /c start` 在新控制台打开。
 * macOS：`Terminal.app`，子进程工作目录为工作区。
 * Linux：gnome-terminal、konsole、`x-terminal-emulator`（cwd）；均不可用时退回打开文件夹。
 */
export function openSystemTerminalInDirectory(cwd: string): void {
  const dir = assertDirectory(cwd);

  if (process.platform === 'win32') {
    const wtCandidates = [
      path.join(process.env.LocalAppData || '', 'Microsoft', 'Windows Apps', 'wt.exe'),
      path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Windows Terminal', 'wt.exe'),
    ];
    const wtFromDisk = wtCandidates.find((p) => p.length > 0 && existsSync(p));
    const comspec =
      process.env.ComSpec ||
      path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'cmd.exe');

    const fallback = (): void => {
      spawn(comspec, ['/c', 'start', '', '/D', dir, 'cmd.exe'], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      }).unref();
    };

    const exe = wtFromDisk ?? 'wt.exe';
    const child = spawn(exe, ['-d', dir], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.on('error', fallback);
    child.unref();
    return;
  }

  if (process.platform === 'darwin') {
    spawn('open', ['-a', 'Terminal', '.'], {
      cwd: dir,
      detached: true,
      stdio: 'ignore',
    }).unref();
    return;
  }

  if (existsSync('/usr/bin/gnome-terminal')) {
    spawn('/usr/bin/gnome-terminal', [`--working-directory=${dir}`], {
      detached: true,
      stdio: 'ignore',
    }).unref();
    return;
  }
  if (existsSync('/usr/bin/konsole')) {
    spawn('/usr/bin/konsole', ['--workdir', dir], {
      detached: true,
      stdio: 'ignore',
    }).unref();
    return;
  }

  try {
    spawn('x-terminal-emulator', [], {
      cwd: dir,
      detached: true,
      stdio: 'ignore',
    }).unref();
  } catch {
    void shell.openPath(dir);
  }
}
