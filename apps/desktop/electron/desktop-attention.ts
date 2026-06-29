import { BrowserWindow, app } from 'electron';

let mainWindowRef: BrowserWindow | undefined;
let pendingApproval = false;
let pendingQuestions = false;
let pendingTaskComplete = false;
let flashFrameActive = false;
let dockBounceId: number | undefined;
let attentionBlockKey: string | undefined;
/** 用户在前台见过该阻挡后，同一 block 不再重复请求任务栏关注。 */
let attentionSuppressedForKey: string | undefined;

function shouldRequestAttention(away: boolean): boolean {
  if (!away) {
    return false;
  }
  if (pendingTaskComplete) {
    return true;
  }
  if (!(pendingApproval || pendingQuestions)) {
    return false;
  }
  if (attentionBlockKey && attentionSuppressedForKey === attentionBlockKey) {
    return false;
  }
  return true;
}

export function registerDesktopAttention(mainWindow: BrowserWindow): void {
  mainWindowRef = mainWindow;
}

export function setDesktopAttentionPending(flags: {
  needsApproval?: boolean;
  needsQuestions?: boolean;
  needsTaskComplete?: boolean;
  attentionBlockKey?: string;
}): void {
  const prevKey = attentionBlockKey;

  if (typeof flags.needsApproval === 'boolean') {
    pendingApproval = flags.needsApproval;
  }
  if (typeof flags.needsQuestions === 'boolean') {
    pendingQuestions = flags.needsQuestions;
  }
  if (typeof flags.needsTaskComplete === 'boolean') {
    pendingTaskComplete = flags.needsTaskComplete;
  }

  if (typeof flags.attentionBlockKey === 'string' && flags.attentionBlockKey.length > 0) {
    attentionBlockKey = flags.attentionBlockKey;
  } else if (!pendingApproval && !pendingQuestions) {
    attentionBlockKey = undefined;
    attentionSuppressedForKey = undefined;
  }

  if (attentionBlockKey !== prevKey && attentionBlockKey !== undefined) {
    attentionSuppressedForKey = undefined;
  }
}

/** Sync taskbar flash when user is away and something needs attention. */
export function refreshDesktopAttention(away: boolean): void {
  if (!away) {
    pendingTaskComplete = false;
    if ((pendingApproval || pendingQuestions) && attentionBlockKey) {
      attentionSuppressedForKey = attentionBlockKey;
    }
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
