export function sanitizeSessionIdForFilename(sessionId: string | undefined): string {
  const normalized = sessionId?.trim();
  if (!normalized) {
    return 'unknown';
  }

  const sanitized = normalized.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return sanitized.length > 0 ? sanitized : 'unknown';
}

export function sanitizeToolCallIdForFilename(toolCallId: string | undefined, messageIndex?: number): string {
  const normalized = toolCallId?.trim();
  if (normalized) {
    const sanitized = normalized.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
    if (sanitized.length > 0) {
      return sanitized;
    }
  }

  if (messageIndex !== undefined) {
    return `msg-${messageIndex}`;
  }

  return 'unknown';
}
