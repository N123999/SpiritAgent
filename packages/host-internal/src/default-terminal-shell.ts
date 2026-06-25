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
 * 宿主默认 Shell（集成终端、系统终端、shell 共用）。
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

export function isWindowsPowerShellExecutable(file: string): boolean {
  const base = path.basename(file).toLowerCase();
  return base === 'pwsh.exe' || base === 'powershell.exe';
}

export function isWindowsCmdExecutable(file: string): boolean {
  return path.basename(file).toLowerCase() === 'cmd.exe';
}

/**
 * 非交互子进程（shell）在 Windows 上默认不走 ConPTY，需显式对齐 UTF-8 输出。
 * PowerShell：设置 OutputEncoding；cmd：保留 chcp 65001 前缀（输出解码见 {@link decodeShellHostOutput}）。
 */
export function prepareShellForHostExecution(shellFile: string, command: string): string {
  if (process.platform !== 'win32') {
    return command;
  }
  if (isWindowsPowerShellExecutable(shellFile)) {
    return `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; $OutputEncoding = [System.Text.Encoding]::UTF8; ${command}`;
  }
  if (isWindowsCmdExecutable(shellFile)) {
    return `chcp 65001 >nul & ${command}`;
  }
  return command;
}

/** cmd.exe 子进程在中文 Windows 上常输出 GBK；PowerShell 经 UTF-8 前缀后按 utf8 解码。 */
export function decodeShellHostOutput(shellFile: string, chunk: Buffer): string {
  if (chunk.length === 0) {
    return '';
  }
  if (process.platform === 'win32' && isWindowsCmdExecutable(shellFile)) {
    return new TextDecoder('gbk').decode(chunk);
  }
  return chunk.toString('utf8');
}

export function shellHostExecUsesBufferOutput(shellFile: string): boolean {
  return process.platform === 'win32' && isWindowsCmdExecutable(shellFile);
}

export function commandParameterDescriptionForResolvedShell(file: string): string {
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
