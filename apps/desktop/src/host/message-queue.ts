import { randomUUID } from 'node:crypto';
import path from 'node:path';

import type { PendingWorkspaceFile, LlmActiveSkill } from '@spirit-agent/core';

import i18n from '../lib/i18n-host.js';
import type { ConversationMessageSnapshot, DesktopSnapshot } from '../types.js';
import { isSessionBundleBusy } from './direct-media-turn.js';
import type { SessionBundle } from './session-bundle.js';
import type { SessionTurnOrchestratorContext } from './session-turn-orchestrator.js';

export interface QueuedUserTurn {
  queueId: string;
  messageId: number;
  text: string;
  displayText: string;
  explicitWorkspaceFiles?: PendingWorkspaceFile[];
  turnSkills?: LlmActiveSkill[];
  localFileAttachments?: ConversationMessageSnapshot['localFileAttachments'];
  enqueuedAtUnixMs: number;
}

export function isSessionBundleQueueBlocked(bundle: SessionBundle): boolean {
  const runtime = bundle.runtime;
  if (!runtime) {
    return false;
  }
  return (
    runtime.currentPendingApproval() !== undefined ||
    runtime.currentPendingQuestions() !== undefined
  );
}

export function canEnqueueUserTurn(bundle: SessionBundle): boolean {
  if (bundle.activeSession?.readOnly === true) {
    return false;
  }
  if (!isSessionBundleBusy(bundle)) {
    return false;
  }
  if (isSessionBundleQueueBlocked(bundle)) {
    return false;
  }
  return true;
}

export function projectQueuedUserTurnSnapshots(
  queued: readonly QueuedUserTurn[],
): ConversationMessageSnapshot[] {
  return queued.map((item) => ({
    id: item.messageId,
    role: 'user',
    content: item.displayText,
    pending: false,
    queued: true,
    queueId: item.queueId,
    ...(item.localFileAttachments?.length ? { localFileAttachments: item.localFileAttachments } : {}),
  }));
}

export function appendQueuedUserTurnSnapshots(
  messages: ConversationMessageSnapshot[],
  queued: readonly QueuedUserTurn[],
): ConversationMessageSnapshot[] {
  if (queued.length === 0) {
    return messages;
  }
  return [...messages, ...projectQueuedUserTurnSnapshots(queued)];
}

function defaultDisplayTextForQueuedTurn(
  text: string,
  explicitWorkspaceFiles: readonly PendingWorkspaceFile[],
): string {
  const trimmed = text.trim();
  if (trimmed) {
    return trimmed;
  }
  if (explicitWorkspaceFiles.length === 0) {
    return '';
  }
  return i18n.t('error.attachedFiles', {
    files: explicitWorkspaceFiles.map((file) => path.basename(file.path)).join(', '),
  });
}

function pendingWorkspaceFilesToAttachmentSnapshots(
  files: readonly PendingWorkspaceFile[],
): ConversationMessageSnapshot['localFileAttachments'] {
  return files.map((file) => ({
    path: file.path,
    name: path.basename(file.path),
    isImage: file.kind === 'image',
  }));
}

export interface EnqueueUserTurnInput {
  text: string;
  explicitWorkspaceFiles?: PendingWorkspaceFile[];
  turnSkills?: LlmActiveSkill[];
  displayText?: string;
}

export async function enqueueUserTurnCommand(
  ctx: SessionTurnOrchestratorContext,
  input: EnqueueUserTurnInput,
): Promise<DesktopSnapshot> {
  const bundle = ctx.activeBundle();
  const explicitWorkspaceFiles = input.explicitWorkspaceFiles ?? [];
  const turnSkills = input.turnSkills ?? [];
  const trimmed = input.text.trim();
  if (!trimmed && explicitWorkspaceFiles.length === 0) {
    throw new Error(i18n.t('error.messageRequired'));
  }
  if (bundle.activeSession?.readOnly === true) {
    throw new Error(i18n.t('error.readonlySessionSend'));
  }
  if (!canEnqueueUserTurn(bundle)) {
    throw new Error(i18n.t('error.pendingApprovalSend'));
  }

  const displayText = (
    input.displayText ?? defaultDisplayTextForQueuedTurn(input.text, explicitWorkspaceFiles)
  ).trim();
  if (!displayText) {
    throw new Error(i18n.t('error.messageRequired'));
  }

  const localFileAttachments =
    explicitWorkspaceFiles.length > 0
      ? pendingWorkspaceFilesToAttachmentSnapshots(explicitWorkspaceFiles)
      : undefined;

  const queuedItem: QueuedUserTurn = {
    queueId: randomUUID(),
    messageId: ctx.allocateMessageId(),
    text: trimmed || input.text,
    displayText,
    ...(explicitWorkspaceFiles.length > 0
      ? { explicitWorkspaceFiles: [...explicitWorkspaceFiles], localFileAttachments }
      : {}),
    ...(turnSkills.length > 0 ? { turnSkills: cloneTurnSkills(turnSkills) } : {}),
    enqueuedAtUnixMs: Date.now(),
  };

  bundle.queuedUserTurns.push(queuedItem);
  await ctx.persistCurrentSessionIfNeeded();
  return ctx.buildSnapshot();
}

export function findQueuedUserTurnIndex(bundle: SessionBundle, queueId: string): number {
  return bundle.queuedUserTurns.findIndex((item) => item.queueId === queueId);
}

export function removeQueuedUserTurn(bundle: SessionBundle, queueId: string): QueuedUserTurn | undefined {
  const index = findQueuedUserTurnIndex(bundle, queueId);
  if (index < 0) {
    return undefined;
  }
  const [removed] = bundle.queuedUserTurns.splice(index, 1);
  return removed;
}

export async function reorderQueuedUserTurnCommand(
  ctx: SessionTurnOrchestratorContext,
  queueId: string,
): Promise<DesktopSnapshot> {
  const bundle = ctx.activeBundle();
  if (!moveQueuedUserTurnUp(bundle, queueId)) {
    throw new Error(i18n.t('error.queuedUserTurnNotFound'));
  }
  await ctx.persistCurrentSessionIfNeeded();
  return ctx.buildSnapshot();
}

export async function removeQueuedUserTurnCommand(
  ctx: SessionTurnOrchestratorContext,
  queueId: string,
): Promise<DesktopSnapshot> {
  const bundle = ctx.activeBundle();
  if (!removeQueuedUserTurn(bundle, queueId)) {
    throw new Error(i18n.t('error.queuedUserTurnNotFound'));
  }
  await ctx.persistCurrentSessionIfNeeded();
  return ctx.buildSnapshot();
}

export function moveQueuedUserTurnUp(bundle: SessionBundle, queueId: string): boolean {
  const index = findQueuedUserTurnIndex(bundle, queueId);
  if (index <= 0) {
    return false;
  }
  const queue = bundle.queuedUserTurns;
  const previous = queue[index - 1];
  queue[index - 1] = queue[index]!;
  queue[index] = previous!;
  return true;
}

export function explicitWorkspaceFilesFromQueuedItem(item: QueuedUserTurn): PendingWorkspaceFile[] {
  return item.explicitWorkspaceFiles ? [...item.explicitWorkspaceFiles] : [];
}

function cloneTurnSkills(skills: readonly LlmActiveSkill[]): LlmActiveSkill[] {
  return skills.map((skill) => ({
    ...skill,
    resources: skill.resources.map((resource) => ({ ...resource })),
  }));
}

export function turnSkillsFromQueuedItem(item: QueuedUserTurn): LlmActiveSkill[] {
  return item.turnSkills ? cloneTurnSkills(item.turnSkills) : [];
}

export function peekNextQueuedUserTurn(bundle: SessionBundle): QueuedUserTurn | undefined {
  return bundle.queuedUserTurns[0];
}

export function shiftNextQueuedUserTurn(bundle: SessionBundle): QueuedUserTurn | undefined {
  return bundle.queuedUserTurns.shift();
}

export function canDrainQueuedUserTurn(bundle: SessionBundle): boolean {
  return (
    bundle.queuedUserTurns.length > 0 &&
    !isSessionBundleBusy(bundle) &&
    !isSessionBundleQueueBlocked(bundle)
  );
}
