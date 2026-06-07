import { existsSync } from 'node:fs';
import path from 'node:path';

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
 * 宿主默认 Shell（集成终端、系统终端、run_shell_command 共用）。
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

export function shellDisplayNameForResolvedShell(file: string): string {
  const base = path.basename(file).toLowerCase();
  if (base === 'pwsh.exe') {
    return 'PowerShell 7 (pwsh)';
  }
  if (base === 'powershell.exe') {
    return 'Windows PowerShell';
  }
  if (base === 'cmd.exe') {
    return 'Command Prompt (cmd.exe)';
  }
  return path.basename(file);
}

export function shellCommandParameterDescriptionForResolvedShell(file: string): string {
  const base = path.basename(file).toLowerCase();
  if (base === 'pwsh.exe' || base === 'powershell.exe') {
    return 'The command to execute in Windows PowerShell. Prefer PowerShell syntax such as Get-ChildItem, Select-String, Get-Content, Set-Location, and Test-Path. Do not assume Bash-only syntax or cmd.exe %VAR% expansion.';
  }
  if (base === 'cmd.exe') {
    return 'The command to execute in Command Prompt (cmd.exe). Prefer cmd.exe syntax such as dir, type, where, findstr, and cd. Do not assume Bash commands like find, ls, grep, or cat.';
  }
  const name = path.basename(file);
  return `The command to execute in ${name}. Prefer syntax native to that shell.`;
}
