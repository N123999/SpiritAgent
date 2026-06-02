import { app, BrowserWindow, Notification } from 'electron';

const DESKTOP_APP_USER_MODEL_ID = 'ai.spiritagent.desktop';

export type DesktopNotificationAction = {
  type: 'button';
  text: string;
};

export type DesktopNotificationPayload = {
  title: string;
  body?: string;
  tag?: string;
  silent?: boolean;
  actions?: DesktopNotificationAction[];
  /** When set, action index 0/1 map to allow/deny approval. */
  kind?: 'task-complete' | 'approval' | 'ask-questions' | 'generic';
};

export type ApprovalNotificationHandler = (
  decision: 'allow' | 'deny',
) => Promise<void>;

let mainWindowRef: BrowserWindow | undefined;
let approvalHandler: ApprovalNotificationHandler | undefined;
let permissionRequested = false;

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
  options?: { onApprovalAction?: ApprovalNotificationHandler },
): void {
  mainWindowRef = mainWindow;
  approvalHandler = options?.onApprovalAction;

  if (process.platform === 'win32') {
    app.setAppUserModelId(DESKTOP_APP_USER_MODEL_ID);
  }
}

export function setApprovalNotificationHandler(handler: ApprovalNotificationHandler | undefined): void {
  approvalHandler = handler;
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

  const notification = new Notification({
    title: payload.title,
    body: payload.body,
    silent: payload.silent === true,
    ...(tag ? { tag } : {}),
    ...(payload.actions && payload.actions.length > 0
      ? { actions: payload.actions }
      : {}),
  });

  notification.on('click', () => {
    focusMainWindow();
  });

  if (payload.kind === 'approval' && payload.actions && payload.actions.length > 0) {
    notification.on('action', (_event, index) => {
      void (async () => {
        if (index === 0) {
          await approvalHandler?.('allow');
        } else if (index === 1) {
          await approvalHandler?.('deny');
        }
        focusMainWindow();
      })();
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
