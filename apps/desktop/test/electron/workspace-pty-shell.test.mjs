import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { defaultShellForPty } from '../../dist-electron/electron/workspace-pty.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(__dirname, '../..');

test('defaultShellForPty: Windows 优先 pwsh 或 powershell，而非仅 cmd', { skip: process.platform !== 'win32' }, () => {
  const prev = process.env.SPIRIT_TERMINAL_SHELL;
  delete process.env.SPIRIT_TERMINAL_SHELL;
  try {
    const { file } = defaultShellForPty();
    assert.ok(existsSync(file), `shell 路径应存在: ${file}`);
    const base = path.basename(file).toLowerCase();
    assert.ok(
      base === 'pwsh.exe' || base === 'powershell.exe' || base === 'cmd.exe',
      `unexpected shell: ${file}`,
    );
    const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
    const pwsh7 = path.join(programFiles, 'PowerShell', '7', 'pwsh.exe');
    if (existsSync(pwsh7)) {
      assert.equal(path.normalize(file), path.normalize(pwsh7));
    }
  } finally {
    if (prev === undefined) {
      delete process.env.SPIRIT_TERMINAL_SHELL;
    } else {
      process.env.SPIRIT_TERMINAL_SHELL = prev;
    }
  }
});

test('defaultShellForPty: SPIRIT_TERMINAL_SHELL 覆盖', () => {
  const comspec =
    process.env.ComSpec || path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'cmd.exe');
  if (!existsSync(comspec)) {
    return;
  }
  const prev = process.env.SPIRIT_TERMINAL_SHELL;
  process.env.SPIRIT_TERMINAL_SHELL = comspec;
  try {
    const { file } = defaultShellForPty();
    assert.equal(path.normalize(file), path.normalize(comspec));
  } finally {
    if (prev === undefined) {
      delete process.env.SPIRIT_TERMINAL_SHELL;
    } else {
      process.env.SPIRIT_TERMINAL_SHELL = prev;
    }
  }
});

void desktopRoot;
