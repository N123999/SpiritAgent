export function commitSubject(message: string | null | undefined): string {
  const trimmed = message?.trim() || '';
  if (!trimmed) {
    return '(no message)';
  }
  const firstLine = trimmed.split('\n')[0]?.trim();
  return firstLine || '(no message)';
}
