export const SPIRIT_NOTIFICATION_PROTOCOL = 'spirit';

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

export function buildNewSessionProtocolUrl(): string {
  return `${SPIRIT_NOTIFICATION_PROTOCOL}://new-session`;
}

export function buildOpenSessionProtocolUrl(sessionPath: string): string {
  const trimmed = sessionPath.trim();
  const params = new URLSearchParams({ path: trimmed });
  return `${SPIRIT_NOTIFICATION_PROTOCOL}://open-session?${params.toString()}`;
}

export type SpiritNotificationProtocolAction =
  | { kind: 'approval'; decision: 'allow' | 'deny' }
  | { kind: 'focus' }
  | { kind: 'new-session' }
  | { kind: 'open-session'; path: string };

export function parseSpiritNotificationProtocolUrl(
  raw: string,
): SpiritNotificationProtocolAction | null {
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
    if (host === 'new-session') {
      return { kind: 'new-session' };
    }
    if (host === 'open-session') {
      const sessionPath = url.searchParams.get('path')?.trim();
      if (!sessionPath) {
        return null;
      }
      return { kind: 'open-session', path: sessionPath };
    }
    return null;
  } catch {
    return null;
  }
}

export function findSpiritNotificationProtocolUrl(argv: readonly string[]): string | undefined {
  return argv.find((entry) => entry.startsWith(`${SPIRIT_NOTIFICATION_PROTOCOL}://`));
}
