export const SPIRIT_NOTIFICATION_PROTOCOL = 'spirit-agent';

export function buildNotificationApprovalProtocolUrl(
  decision: 'allow' | 'deny',
  tag?: string,
): string {
  const params = new URLSearchParams({ decision });
  const trimmedTag = tag?.trim();
  if (trimmedTag) {
    params.set('tag', trimmedTag);
  }
  return `${SPIRIT_NOTIFICATION_PROTOCOL}://notification-approval?${params.toString()}`;
}

export function buildNotificationFocusProtocolUrl(tag?: string): string {
  const trimmedTag = tag?.trim();
  if (!trimmedTag) {
    return `${SPIRIT_NOTIFICATION_PROTOCOL}://notification-focus`;
  }
  const params = new URLSearchParams({ tag: trimmedTag });
  return `${SPIRIT_NOTIFICATION_PROTOCOL}://notification-focus?${params.toString()}`;
}

export function parseSpiritNotificationProtocolUrl(
  raw: string,
): { kind: 'approval'; decision: 'allow' | 'deny' } | { kind: 'focus' } | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== `${SPIRIT_NOTIFICATION_PROTOCOL}:`) {
      return null;
    }
    const host = url.hostname || url.pathname.replace(/^\/+/, '');
    if (host === 'notification-approval') {
      const decision = url.searchParams.get('decision');
      if (decision === 'allow' || decision === 'deny') {
        return { kind: 'approval', decision };
      }
      return null;
    }
    if (host === 'notification-focus') {
      return { kind: 'focus' };
    }
    return null;
  } catch {
    return null;
  }
}

export function findSpiritNotificationProtocolUrl(argv: readonly string[]): string | undefined {
  return argv.find((entry) => entry.startsWith(`${SPIRIT_NOTIFICATION_PROTOCOL}://`));
}
