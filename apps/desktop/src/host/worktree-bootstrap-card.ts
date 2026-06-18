import type { PendingWorkspaceFile } from '@spirit-agent/core';

import i18n from '../lib/i18n-host.js';
import { phaseToVerbContext } from '../lib/tool-verb-context.js';
import type { ToolBlockSnapshot } from '../types.js';
import type { DesktopRewindCheckpointSnapshot } from './rewind.js';
import type { DesktopMessageTimeline } from './message-timeline.js';

export const WORKTREE_BOOTSTRAP_TOOL_NAME = 'worktree_bootstrap';

export type WorktreeBootstrapPhase = 'running' | 'succeeded' | 'failed';

export interface PendingWorktreeBootstrap {
  toolCallId: string;
  userPrompt: string;
  displayText: string;
  explicitWorkspaceFiles?: PendingWorkspaceFile[];
  userMessageId: number;
  beforeUserCheckpoint: DesktopRewindCheckpointSnapshot;
  phase: WorktreeBootstrapPhase;
  error?: string;
}

export function worktreeBootstrapToolCallId(sessionKey: string): string {
  return `worktree-bootstrap:${sessionKey}`;
}

export function buildWorktreeBootstrapToolSnapshot(
  phase: WorktreeBootstrapPhase,
): ToolBlockSnapshot {
  const toolPhase: ToolBlockSnapshot['phase'] =
    phase === 'running' ? 'running' : phase === 'succeeded' ? 'succeeded' : 'failed';
  const verbContext = phaseToVerbContext(toolPhase);
  return {
    toolCallId: undefined,
    toolName: WORKTREE_BOOTSTRAP_TOOL_NAME,
    phase: toolPhase,
    headline: i18n.t('tool.create', verbContext ? { context: verbContext } : {}),
    headlineDetail: i18n.t('composer.workLocationWorktree'),
    detailLines: [],
  };
}

export function isWorktreeBootstrapInFlight(
  pending: PendingWorktreeBootstrap | undefined,
): boolean {
  return pending?.phase === 'running';
}

export function upsertWorktreeBootstrapCardInTimeline(
  timeline: DesktopMessageTimeline,
  sessionKey: string,
  phase: WorktreeBootstrapPhase,
): void {
  const toolCallId = worktreeBootstrapToolCallId(sessionKey);
  const snapshot = buildWorktreeBootstrapToolSnapshot(phase);
  snapshot.toolCallId = toolCallId;
  timeline.upsertToolMessage(toolCallId, snapshot);
}

export function resolveWorktreeBootstrapCardPhaseFromSubagentStatus(
  status: 'bootstrapping' | 'running' | 'completed' | 'failed' | 'blocked',
): WorktreeBootstrapPhase | undefined {
  if (status === 'bootstrapping') {
    return 'running';
  }
  if (status === 'failed') {
    return 'failed';
  }
  if (status === 'running' || status === 'blocked' || status === 'completed') {
    return 'succeeded';
  }
  return undefined;
}
