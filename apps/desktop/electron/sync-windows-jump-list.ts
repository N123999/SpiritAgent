import path from 'node:path';

import { app } from 'electron';

import { invokeDesktopHostCommand } from '../src/host/service.js';
import i18nHost from '../src/lib/i18n-host.js';
import { buildWindowsJumpListCategories } from '../src/lib/windows-jump-list-build.js';
import type { SessionListItem } from '../src/types.js';

function resolveDevMainScript(): string | undefined {
  if (app.isPackaged || process.defaultApp !== true) {
    return undefined;
  }
  const entry = process.argv[1];
  if (!entry) {
    return undefined;
  }
  return path.resolve(entry);
}

export async function syncWindowsJumpList(iconPath?: string): Promise<void> {
  if (process.platform !== 'win32') {
    return;
  }

  const resolvedIcon = iconPath?.trim() || process.execPath;
  let sessions: SessionListItem[] = [];
  try {
    const listed = await invokeDesktopHostCommand('listSessions');
    sessions = Array.isArray(listed) ? (listed as SessionListItem[]) : [];
  } catch (error) {
    console.warn('[spirit-desktop] jump list listSessions failed:', error);
  }

  const categories = buildWindowsJumpListCategories({
    recentLabel: i18nHost.t('jumpList.recent'),
    newAgentLabel: i18nHost.t('jumpList.newSession'),
    sessions,
    execPath: process.execPath,
    iconPath: resolvedIcon,
    devMainScript: resolveDevMainScript(),
  });

  const result = app.setJumpList(categories);
  if (result !== 'ok') {
    console.warn('[spirit-desktop] setJumpList returned', result);
  }
}
