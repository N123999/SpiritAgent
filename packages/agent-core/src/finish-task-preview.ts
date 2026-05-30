function decodeJsonStringFragment(fragment: string): string {
  try {
    return JSON.parse(`"${fragment}"`) as string;
  } catch {
    return fragment
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\')
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, '\r')
      .replace(/\\t/g, '\t');
  }
}

export function finishTaskArgumentsJsonComplete(argumentsJson: string): boolean {
  const normalized = argumentsJson.trim();
  if (!normalized) {
    return false;
  }
  try {
    JSON.parse(normalized);
    return true;
  } catch {
    return false;
  }
}

export function finishTaskSummaryFromStreamingArguments(argumentsJson: string): string | undefined {
  const normalized = argumentsJson.trim();
  if (!normalized) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(normalized) as { summary?: unknown };
    if (typeof parsed.summary === 'string') {
      return parsed.summary;
    }
  } catch {
    // Fall through to partial extraction.
  }

  const match = normalized.match(/"summary"\s*:\s*"((?:\\.|[^"\\])*)(")?/);
  if (!match) {
    return undefined;
  }
  return decodeJsonStringFragment(match[1] ?? '');
}

/** True once finish_task summary JSON value has started streaming. */
export function finishTaskStreamingPreviewReady(toolName: string, argumentsJson: string): boolean {
  if (toolName !== 'finish_task') {
    return false;
  }
  return finishTaskSummaryFromStreamingArguments(argumentsJson) !== undefined;
}

export function finishTaskNoticeFromSummary(summary: string): string {
  const normalized = summary.trim();
  if (!normalized) {
    return '任务已完成。';
  }
  return `任务因 ${normalized} 完成。`;
}

export function finishTaskNoticePreviewFromArguments(argumentsJson: string): string | undefined {
  const summary = finishTaskSummaryFromStreamingArguments(argumentsJson);
  if (summary === undefined) {
    return undefined;
  }
  if (!summary.trim()) {
    return finishTaskArgumentsJsonComplete(argumentsJson) ? '任务已完成。' : undefined;
  }
  if (finishTaskArgumentsJsonComplete(argumentsJson)) {
    return finishTaskNoticeFromSummary(summary);
  }
  return `任务因 ${summary}`;
}
