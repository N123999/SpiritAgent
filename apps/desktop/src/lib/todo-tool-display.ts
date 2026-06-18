/** Parse todo_complete host tool JSON output for display title (renderer-safe). */
export function todoTitleFromCompleteOutput(output: unknown): string | undefined {
  let parsed = output;
  if (typeof output === 'string') {
    const trimmed = output.trim();
    if (!trimmed.startsWith('{')) {
      return undefined;
    }
    try {
      parsed = JSON.parse(trimmed) as unknown;
    } catch {
      return undefined;
    }
  }
  if (!parsed || typeof parsed !== 'object') {
    return undefined;
  }
  const todo = (parsed as Record<string, unknown>).todo;
  if (!todo || typeof todo !== 'object') {
    return undefined;
  }
  const title = (todo as Record<string, unknown>).title;
  return typeof title === 'string' && title.trim() ? title.trim() : undefined;
}
