import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
  defaultShellForPty,
  shellDisplayNameForResolvedShell,
} from './default-terminal-shell.js';
import { detectShellForTools } from './tools.js';

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

test('detectShellForTools: Windows 与 defaultShellForPty 解析结果一致', { skip: process.platform !== 'win32' }, () => {
  const prev = process.env.SPIRIT_TERMINAL_SHELL;
  delete process.env.SPIRIT_TERMINAL_SHELL;
  try {
    const { file } = defaultShellForPty();
    const detected = detectShellForTools();
    assert.equal(detected.shellDisplayName, shellDisplayNameForResolvedShell(file));
    const base = path.basename(file).toLowerCase();
    if (base === 'pwsh.exe') {
      assert.match(detected.shellDisplayName, /pwsh/i);
    }
    if (base === 'cmd.exe') {
      assert.match(detected.shellDisplayName, /cmd/i);
    }
  } finally {
    if (prev === undefined) {
      delete process.env.SPIRIT_TERMINAL_SHELL;
    } else {
      process.env.SPIRIT_TERMINAL_SHELL = prev;
    }
  }
});
