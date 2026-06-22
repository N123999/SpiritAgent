import { BrowserWindow, app } from 'electron';

let mainWindowRef: BrowserWindow | undefined;
let pendingApproval = false;
let pendingQuestions = false;
let pendingTaskComplete = false;
let flashFrameActive = false;
let dockBounceId: number | undefined;

function shouldRequestAttention(away: boolean): boolean {
  return away && (pendingApproval || pendingQuestions || pendingTaskComplete);
}

export function registerDesktopAttention(mainWindow: BrowserWindow): void {
  mainWindowRef = mainWindow;
}

export function setDesktopAttentionPending(flags: {
  needsApproval?: boolean;
  needsQuestions?: boolean;
  needsTaskComplete?: boolean;
}): void {
  if (typeof flags.needsApproval === 'boolean') {
    pendingApproval = flags.needsApproval;
  }
  if (typeof flags.needsQuestions === 'boolean') {
    pendingQuestions = flags.needsQuestions;
  }
  if (typeof flags.needsTaskComplete === 'boolean') {
    pendingTaskComplete = flags.needsTaskComplete;
  }
}

/** Sync taskbar flash when user is away and something needs attention. */
export function refreshDesktopAttention(away: boolean): void {
  if (!away) {
    pendingTaskComplete = false;
  }

  const active = shouldRequestAttention(away);
  if (active === flashFrameActive) {
    return;
  }

  flashFrameActive = active;
  const window = mainWindowRef;
  if (!window || window.isDestroyed()) {
    return;
  }

  if (process.platform === 'win32' || process.platform === 'linux') {
    window.flashFrame(active);
    return;
  }

  if (process.platform === 'darwin' && app.dock) {
    if (dockBounceId !== undefined) {
      app.dock.cancelBounce(dockBounceId);
      dockBounceId = undefined;
    }
    if (active) {
      dockBounceId = app.dock.bounce('informational');
    }
  }
}
