const SPIRIT_NOTIFICATION_PROTOCOL = 'spirit-agent';

function buildApprovalProtocolUrl(decision: 'allow' | 'deny', tag?: string): string {
  const params = new URLSearchParams({ decision });
  const trimmedTag = tag?.trim();
  if (trimmedTag) {
    params.set('tag', trimmedTag);
  }
  return `${SPIRIT_NOTIFICATION_PROTOCOL}://notification-approval?${params.toString()}`;
}

function buildFocusProtocolUrl(tag?: string): string {
  const trimmedTag = tag?.trim();
  if (!trimmedTag) {
    return `${SPIRIT_NOTIFICATION_PROTOCOL}://notification-focus`;
  }
  const params = new URLSearchParams({ tag: trimmedTag });
  return `${SPIRIT_NOTIFICATION_PROTOCOL}://notification-focus?${params.toString()}`;
}

export type WindowsToastPayload = {
  title: string;
  body?: string;
  tag?: string;
  actions?: Array<{ type: 'button'; text: string }>;
};

const TOAST_TEXT_LINE_MAX = 4;
const TOAST_ACTION_MAX = 2;

export function escapeToastXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function toastTextLines(payload: WindowsToastPayload): string[] {
  const lines: string[] = [];
  const title = payload.title?.trim();
  if (title) {
    lines.push(title);
  }
  if (payload.body) {
    for (const line of payload.body.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (trimmed) {
        lines.push(trimmed);
      }
    }
  }
  return lines.slice(0, TOAST_TEXT_LINE_MAX);
}

/** Build WinRT toast XML with explicit action buttons (Electron `actions` alone may not render on Windows). */
export function buildWindowsToastXml(payload: WindowsToastPayload): string {
  const textXml = toastTextLines(payload)
    .map((line) => `<text>${escapeToastXml(line)}</text>`)
    .join('');
  const tag = payload.tag?.trim();
  const actionsXml = (payload.actions ?? [])
    .slice(0, TOAST_ACTION_MAX)
    .map((action, index) => {
      const decision = index === 0 ? 'allow' : 'deny';
      const protocolUrl = buildApprovalProtocolUrl(decision, tag);
      return `<action content="${escapeToastXml(action.text)}" arguments="${escapeToastXml(protocolUrl)}" activationType="protocol" />`;
    })
    .join('');
  const launch = escapeToastXml(buildFocusProtocolUrl(tag));
  return `<toast launch="${launch}" activationType="protocol"><visual><binding template="ToastGeneric">${textXml}</binding></visual><actions>${actionsXml}</actions></toast>`;
}

export function shouldUseWindowsToastXml(payload: WindowsToastPayload): boolean {
  return Boolean(payload.actions && payload.actions.length > 0);
}

export type WindowsToastActivationDetails = {
  type?: string;
  actionIndex?: number;
  arguments?: string;
};

/** Normalize WinRT activation payload from `Notification.handleActivation` / `action` events. */
export function parseWindowsToastActivation(
  details: WindowsToastActivationDetails,
): { kind: 'click' } | { kind: 'action'; actionIndex: number } {
  if (details.type?.toLowerCase() === 'action') {
    const directIndex = details.actionIndex;
    if (typeof directIndex === 'number' && directIndex >= 0) {
      return { kind: 'action', actionIndex: directIndex };
    }
  }

  const rawArguments = details.arguments?.trim() ?? '';
  const params = new URLSearchParams(rawArguments.replace(/;/g, '&'));
  const activationType = (params.get('type') ?? details.type ?? 'click').toLowerCase();
  if (activationType !== 'action') {
    return { kind: 'click' };
  }
  const fromDetails =
    typeof details.actionIndex === 'number' && details.actionIndex >= 0
      ? details.actionIndex
      : undefined;
  const fromArguments = params.get('actionIndex');
  const actionIndex =
    fromDetails ?? (fromArguments !== null ? Number(fromArguments) : Number.NaN);
  if (!Number.isFinite(actionIndex) || actionIndex < 0) {
    return { kind: 'click' };
  }
  return { kind: 'action', actionIndex };
}

export function resolveNotificationActionIndex(
  event: unknown,
  legacyIndex?: number,
): number | undefined {
  if (typeof event === 'object' && event !== null && 'actionIndex' in event) {
    const fromEvent = (event as { actionIndex?: number }).actionIndex;
    if (typeof fromEvent === 'number' && fromEvent >= 0) {
      return fromEvent;
    }
  }
  if (typeof legacyIndex === 'number' && legacyIndex >= 0) {
    return legacyIndex;
  }
  return undefined;
}
