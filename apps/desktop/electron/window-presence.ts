import { BrowserWindow } from 'electron';

import { refreshDesktopAttention } from './desktop-attention.js';

let mainWindowRef: BrowserWindow | undefined;
let rendererHidden = false;

function broadcastAwayChanged(away: boolean): void {
  const window = mainWindowRef;
  if (!window || window.isDestroyed()) {
    return;
  }
  window.webContents.send('desktop:app-away-changed', { away });
}

function recomputeAway(): boolean {
  const away = isAppAwayFromUser();
  broadcastAwayChanged(away);
  refreshDesktopAttention(away);
  return away;
}

export function registerWindowPresence(mainWindow: BrowserWindow): void {
  mainWindowRef = mainWindow;
  const update = () => {
    recomputeAway();
  };
  mainWindow.on('blur', update);
  mainWindow.on('focus', update);
  mainWindow.on('minimize', update);
  mainWindow.on('restore', update);
  mainWindow.on('hide', update);
  mainWindow.on('show', update);
  recomputeAway();
}

export function setRendererVisibility(hidden: boolean): void {
  rendererHidden = hidden;
  recomputeAway();
}

export function isAppAwayFromUser(): boolean {
  const window = mainWindowRef;
  if (!window || window.isDestroyed()) {
    return false;
  }
  if (rendererHidden) {
    return true;
  }
  if (window.isMinimized()) {
    return true;
  }
  return !window.isFocused();
}

export function getAppAwayFromUser(): boolean {
  return isAppAwayFromUser();
}
