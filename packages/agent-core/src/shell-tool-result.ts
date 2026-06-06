export type RunShellCommandToolResult = {
  terminal: string;
  workspace: string;
  command: string;
  exitCode: number;
  output: string;
  truncated?: boolean;
};

export const DEFAULT_SHELL_TOOL_OUTPUT_MAX_CHARS = 16_000;

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

export function buildRunShellCommandToolResult(input: {
  terminal: string;
  workspace: string;
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
}): RunShellCommandToolResult {
  return {
    terminal: input.terminal,
    workspace: input.workspace,
    command: input.command,
    exitCode: input.exitCode,
    output: combineShellToolOutput(input.stdout, input.stderr),
  };
}

export function serializeRunShellCommandToolResult(
  result: RunShellCommandToolResult,
  maxOutputChars: number = DEFAULT_SHELL_TOOL_OUTPUT_MAX_CHARS,
): string {
  let output = result.output;
  let truncated = result.truncated === true;
  if ([...output].length > maxOutputChars) {
    output = truncateChars(output, maxOutputChars);
    truncated = true;
  }

  const payload: RunShellCommandToolResult = {
    terminal: result.terminal,
    workspace: result.workspace,
    command: result.command,
    exitCode: result.exitCode,
    output,
    ...(truncated ? { truncated: true } : {}),
  };
  return JSON.stringify(payload);
}

export function parseRunShellCommandToolResult(text: string): RunShellCommandToolResult | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith('{')) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (!isRunShellCommandToolResult(parsed)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function isRunShellCommandToolResult(value: unknown): value is RunShellCommandToolResult {
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

function truncateChars(value: string, maxChars: number): string {
  const chars = [...value];
  if (chars.length <= maxChars) {
    return value;
  }
  return chars.slice(0, maxChars).join('');
}
