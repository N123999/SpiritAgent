import type { SessionListItem } from '../types.js';
import { buildNewSessionProtocolUrl, buildOpenSessionProtocolUrl } from './spirit-notification-protocol.js';

export const JUMP_LIST_RECENT_LIMIT = 5;
export const JUMP_LIST_TITLE_MAX = 260;

export type JumpListTaskItem = {
  type: 'task';
  title: string;
  program: string;
  args: string;
  iconPath: string;
  iconIndex: number;
};

export type JumpListCategoryBuilt =
  | { type: 'custom'; name: string; items: JumpListTaskItem[] }
  | { type: 'tasks'; items: JumpListTaskItem[] };

export function pickRecentSessionsForJumpList(sessions: readonly SessionListItem[]): SessionListItem[] {
  return [...sessions]
    .sort((left, right) => right.modifiedAtUnixMs - left.modifiedAtUnixMs)
    .slice(0, JUMP_LIST_RECENT_LIMIT);
}

export function truncateJumpListTitle(title: string, maxLength = JUMP_LIST_TITLE_MAX): string {
  const trimmed = title.trim();
  if (trimmed.length <= maxLength) {
    return trimmed;
  }
  if (maxLength <= 1) {
    return '…';
  }
  return `${trimmed.slice(0, maxLength - 1)}…`;
}

export function buildJumpListLaunchArgs(protocolUrl: string, devMainScript?: string): string {
  const script = devMainScript?.trim();
  if (script) {
    return `"${script}" "${protocolUrl}"`;
  }
  return protocolUrl;
}

export function buildWindowsJumpListCategories(input: {
  recentLabel: string;
  newAgentLabel: string;
  sessions: readonly SessionListItem[];
  execPath: string;
  iconPath: string;
  devMainScript?: string;
}): JumpListCategoryBuilt[] {
  const devMainScript = input.devMainScript?.trim() || undefined;
  const categories: JumpListCategoryBuilt[] = [];
  const recentSessions = pickRecentSessionsForJumpList(input.sessions);

  if (recentSessions.length > 0) {
    categories.push({
      type: 'custom',
      name: input.recentLabel,
      items: recentSessions.map((session) => ({
        type: 'task',
        title: truncateJumpListTitle(session.displayName),
        program: input.execPath,
        args: buildJumpListLaunchArgs(buildOpenSessionProtocolUrl(session.path), devMainScript),
        iconPath: input.iconPath,
        iconIndex: 0,
      })),
    });
  }

  categories.push({
    type: 'tasks',
    items: [
      {
        type: 'task',
        title: input.newAgentLabel,
        program: input.execPath,
        args: buildJumpListLaunchArgs(buildNewSessionProtocolUrl(), devMainScript),
        iconPath: input.iconPath,
        iconIndex: 0,
      },
    ],
  });

  return categories;
}
