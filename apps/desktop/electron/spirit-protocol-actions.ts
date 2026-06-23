import { BrowserWindow } from 'electron';

export type SpiritProtocolActionDeps = {
  focusWindows: () => void;
  openSession: (path: string) => Promise<void>;
};

let deps: SpiritProtocolActionDeps | undefined;
let pendingNewSession = false;

export function bindSpiritProtocolActionHandlers(next: SpiritProtocolActionDeps): void {
  deps = next;
}

function broadcastNewSessionToRenderers(): boolean {
  let sent = false;
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed() || window.webContents.isDestroyed()) {
      continue;
    }
    if (window.webContents.isLoading()) {
      continue;
    }
    window.webContents.send('desktop:new-session');
    sent = true;
  }
  return sent;
}

export function handleSpiritNewSessionRequest(): void {
  deps?.focusWindows();
  if (broadcastNewSessionToRenderers()) {
    return;
  }
  pendingNewSession = true;
}

export async function handleSpiritOpenSessionRequest(sessionPath: string): Promise<void> {
  deps?.focusWindows();
  try {
    await deps?.openSession(sessionPath);
  } catch (error) {
    console.error('[spirit-desktop] open-session protocol failed:', error);
  }
}

/** Call after the main window finishes its initial load. */
export function flushPendingSpiritProtocolActions(): void {
  if (!pendingNewSession) {
    return;
  }
  if (broadcastNewSessionToRenderers()) {
    pendingNewSession = false;
  }
}
