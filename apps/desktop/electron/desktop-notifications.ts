import { app, BrowserWindow, Notification } from 'electron';

import type {
  DesktopNotificationAction,
  DesktopNotificationContext,
  DesktopNotificationKind,
} from '../src/lib/desktop-notification-types.js';

import {
  buildWindowsToastXml,
  parseWindowsToastActivation,
  resolveNotificationActionIndex,
  shouldUseWindowsToastXml,
} from '../src/lib/windows-toast-xml.js';

const DESKTOP_APP_USER_MODEL_ID = 'ai.spiritagent.desktop';

export type DesktopNotificationPayload = {
  title: string;
  body?: string;
  tag?: string;
  silent?: boolean;
  actions?: DesktopNotificationAction[];
  kind?: DesktopNotificationKind;
  context?: DesktopNotificationContext;
};

export type DesktopNotificationReplyPayload = {
  kind: Extract<DesktopNotificationKind, 'approval' | 'ask-questions'>;
  text: string;
  context?: DesktopNotificationContext;
};

export type ApprovalNotificationHandler = (
  decision: 'allow' | 'deny',
) => Promise<void>;

export type NotificationReplyHandler = (
  payload: DesktopNotificationReplyPayload,
) => void | Promise<void>;

let mainWindowRef: BrowserWindow | undefined;
let approvalHandler: ApprovalNotificationHandler | undefined;
let replyHandler: NotificationReplyHandler | undefined;
let permissionRequested = false;
let windowsActivationHandlerRegistered = false;
let approvalActionInFlight = false;

const activeTags = new Map<string, Notification>();

function focusMainWindow(): void {
  const window = mainWindowRef;
  if (!window || window.isDestroyed()) {
    return;
  }
  if (window.isMinimized()) {
    window.restore();
  }
  window.show();
  window.focus();
}

function handleApprovalActionIndex(index: number | undefined): void {
  if (index !== 0 && index !== 1) {
    focusMainWindow();
    return;
  }
  void (async () => {
    if (approvalActionInFlight) {
      return;
    }
    approvalActionInFlight = true;
    try {
      if (index === 0) {
        await approvalHandler?.('allow');
      } else {
        await approvalHandler?.('deny');
      }
    } finally {
      approvalActionInFlight = false;
      focusMainWindow();
    }
  })();
}

function handleWindowsToastActivation(details: {
  type?: string;
  actionIndex?: number;
  arguments?: string;
}): void {
  const parsed = parseWindowsToastActivation(details);
  if (parsed.kind === 'action') {
    handleApprovalActionIndex(parsed.actionIndex);
    return;
  }
  focusMainWindow();
}

function registerWindowsNotificationActivationHandler(): void {
  if (windowsActivationHandlerRegistered || process.platform !== 'win32') {
    return;
  }
  const notificationWithActivation = Notification as typeof Notification & {
    handleActivation?: (
      callback: (details: {
        type?: string;
        actionIndex?: number;
        arguments?: string;
      }) => void,
    ) => void;
  };
  if (typeof notificationWithActivation.handleActivation !== 'function') {
    return;
  }
  windowsActivationHandlerRegistered = true;
  notificationWithActivation.handleActivation((details) => {
    handleWindowsToastActivation(details);
  });
}

/** Register early in `app.whenReady()` so toast button clicks are not missed. */
export function registerWindowsToastActivationHandler(): void {
  if (process.platform === 'win32') {
    app.setAppUserModelId(DESKTOP_APP_USER_MODEL_ID);
    registerWindowsNotificationActivationHandler();
  }
}

async function ensureNotificationPermission(): Promise<boolean> {
  if (!Notification.isSupported()) {
    return false;
  }
  if (process.platform !== 'darwin') {
    return true;
  }
  const notificationWithPermission = Notification as typeof Notification & {
    requestPermission?: () => Promise<'granted' | 'denied' | 'default'>;
  };
  if (!permissionRequested && typeof notificationWithPermission.requestPermission === 'function') {
    permissionRequested = true;
    try {
      await notificationWithPermission.requestPermission();
    } catch {
      // ignore permission errors
    }
  }
  return true;
}

export function registerDesktopNotifications(
  mainWindow: BrowserWindow,
  options?: {
    onApprovalAction?: ApprovalNotificationHandler;
    onNotificationReply?: NotificationReplyHandler;
  },
): void {
  mainWindowRef = mainWindow;
  approvalHandler = options?.onApprovalAction;
  replyHandler = options?.onNotificationReply;
  registerWindowsToastActivationHandler();
}

export function setApprovalNotificationHandler(handler: ApprovalNotificationHandler | undefined): void {
  approvalHandler = handler;
}

export function setNotificationReplyHandler(handler: NotificationReplyHandler | undefined): void {
  replyHandler = handler;
}

export async function showDesktopNotification(payload: DesktopNotificationPayload): Promise<boolean> {
  if (!(await ensureNotificationPermission())) {
    return false;
  }

  const tag = payload.tag?.trim() || undefined;
  if (tag) {
    const previous = activeTags.get(tag);
    if (previous) {
      previous.close();
      activeTags.delete(tag);
    }
  }

  const textAction = payload.actions?.find((action) => action.type === 'text');
  const buttonActions = payload.actions?.filter((action) => action.type === 'button') ?? [];
  const replyKind = payload.kind === 'approval' || payload.kind === 'ask-questions' ? payload.kind : undefined;
  const windowsToastPayload = {
    title: payload.title,
    body: payload.body,
    tag,
    actions: buttonActions.map((action) => ({ type: 'button' as const, text: action.text })),
  };
  const useWindowsToastXml =
    process.platform === 'win32' && shouldUseWindowsToastXml(windowsToastPayload);

  const notification = useWindowsToastXml
    ? new Notification({
        toastXml: buildWindowsToastXml(windowsToastPayload),
        silent: payload.silent === true,
        ...(tag ? { tag } : {}),
      })
    : new Notification({
        title: payload.title,
        body: payload.body,
        silent: payload.silent === true,
        ...(tag ? { tag } : {}),
        ...(buttonActions.length > 0
          ? { actions: buttonActions.map((action) => ({ type: 'button' as const, text: action.text })) }
          : {}),
        ...(textAction && replyKind && process.platform === 'darwin'
          ? { hasReply: true, replyPlaceholder: textAction.placeholder ?? textAction.text }
          : {}),
      });

  notification.on('click', () => {
    focusMainWindow();
  });

  if (payload.kind === 'approval' && buttonActions.length > 0) {
    notification.on('action', (event, legacyIndex) => {
      handleApprovalActionIndex(resolveNotificationActionIndex(event, legacyIndex));
    });
  }

  if (replyKind && textAction) {
    notification.on('reply', (_event, reply) => {
      void Promise.resolve(
        replyHandler?.({
          kind: replyKind,
          text: reply,
          context: payload.context,
        }),
      ).catch(() => undefined);
    });
  }

  notification.on('close', () => {
    if (tag) {
      activeTags.delete(tag);
    }
  });

  notification.show();
  if (tag) {
    activeTags.set(tag, notification);
  }
  return true;
}
