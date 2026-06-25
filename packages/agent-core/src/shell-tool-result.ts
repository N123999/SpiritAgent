export type ShellToolResult = {
  terminal: string;
  workspace: string;
  command: string;
  exitCode: number;
  output: string;
  truncated?: boolean;
};

export function combineShellToolOutput(stdout: string, stderr: string): string {
  const hasStdout = stdout.length > 0;
  const hasStderr = stderr.length > 0;
  if (!hasStdout && !hasStderr) {
    return '';
  }
  if (!hasStdout) {
    return stderr;
  }
  if (!hasStderr) {
    return stdout;
  }
  const separator = stdout.endsWith('\n') || stderr.startsWith('\n') ? '' : '\n';
  return `${stdout}${separator}${stderr}`;
}

export function buildShellToolResult(input: {
  terminal: string;
  workspace: string;
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
}): ShellToolResult {
  return {
    terminal: input.terminal,
    workspace: input.workspace,
    command: input.command,
    exitCode: input.exitCode,
    output: combineShellToolOutput(input.stdout, input.stderr),
  };
}

export function serializeShellToolResult(result: ShellToolResult): string {
  const payload: ShellToolResult = {
    terminal: result.terminal,
    workspace: result.workspace,
    command: result.command,
    exitCode: result.exitCode,
    output: result.output,
  };
  return JSON.stringify(payload);
}

export function parseShellToolResult(text: string): ShellToolResult | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith('{')) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (!isShellToolResult(parsed)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function isShellToolResult(value: unknown): value is ShellToolResult {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.terminal === 'string' &&
    typeof record.workspace === 'string' &&
    typeof record.command === 'string' &&
    typeof record.exitCode === 'number' &&
    Number.isFinite(record.exitCode) &&
    typeof record.output === 'string' &&
    (record.truncated === undefined || typeof record.truncated === 'boolean')
  );
}
