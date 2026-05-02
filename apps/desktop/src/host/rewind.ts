import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { ChatArchive } from '@spirit-agent/agent-core';
import type { HostRecordedFileChange } from '@spirit-agent/host-internal';

import type { ConversationMessageSnapshot } from '../types.js';

const REWIND_DIR_NAME = 'rewind';

export interface StoredDesktopRewindMetadata {
  sessionId: string;
  nextSequence: number;
  checkpoints: DesktopRewindCheckpointMetadata[];
  fileChanges: DesktopRewindFileChangeMetadata[];
}

export interface DesktopRewindCheckpointMetadata {
  id: string;
  messageId: number;
  messageIndex: number;
  sequence: number;
  createdAtUnixMs: number;
}

export interface DesktopRewindFileChangeMetadata {
  id: string;
  kind: HostRecordedFileChange['kind'];
  path: string;
  resolvedPath: string;
  toolName: string;
  toolCallId?: string;
  messageId?: number;
  sequence: number;
  createdAtUnixMs: number;
}

export interface DesktopStoredFileChange extends HostRecordedFileChange {
  id: string;
  sequence: number;
  messageId?: number;
}

export interface DesktopRewindCheckpointSnapshot {
  archive: ChatArchive;
  desktopMessages: ConversationMessageSnapshot[];
  beforeArchive?: ChatArchive;
  beforeDesktopMessages?: ConversationMessageSnapshot[];
}

export function createDesktopRewindMetadata(): StoredDesktopRewindMetadata {
  return {
    sessionId: randomUUID(),
    nextSequence: 1,
    checkpoints: [],
    fileChanges: [],
  };
}

export function normalizeDesktopRewindMetadata(
  value: unknown,
): StoredDesktopRewindMetadata {
  if (!isRecord(value)) {
    return createDesktopRewindMetadata();
  }

  const checkpoints = Array.isArray(value.checkpoints)
    ? value.checkpoints.flatMap(normalizeCheckpoint)
    : [];
  const fileChanges = Array.isArray(value.fileChanges)
    ? value.fileChanges.flatMap(normalizeFileChange)
    : [];
  const largestSequence = Math.max(
    0,
    ...checkpoints.map((entry) => entry.sequence),
    ...fileChanges.map((entry) => entry.sequence),
  );
  const nextSequence =
    typeof value.nextSequence === 'number' && value.nextSequence > largestSequence
      ? Math.floor(value.nextSequence)
      : largestSequence + 1;

  return {
    sessionId:
      typeof value.sessionId === 'string' && value.sessionId.trim()
        ? value.sessionId.trim()
        : randomUUID(),
    nextSequence,
    checkpoints,
    fileChanges,
  };
}

export function nextDesktopRewindSequence(metadata: StoredDesktopRewindMetadata): number {
  const next = metadata.nextSequence;
  metadata.nextSequence += 1;
  return next;
}

export function createRewindCheckpointMetadata(
  messageId: number,
  messageIndex: number,
  sequence: number,
): DesktopRewindCheckpointMetadata {
  return {
    id: randomUUID(),
    messageId,
    messageIndex,
    sequence,
    createdAtUnixMs: Date.now(),
  };
}

export function upsertRewindCheckpointMetadata(
  metadata: StoredDesktopRewindMetadata,
  checkpoint: DesktopRewindCheckpointMetadata,
): void {
  const existing = metadata.checkpoints.findIndex(
    (candidate) => candidate.messageId === checkpoint.messageId,
  );
  if (existing >= 0) {
    metadata.checkpoints.splice(existing, 1, checkpoint);
  } else {
    metadata.checkpoints.push(checkpoint);
  }
  metadata.checkpoints.sort((left, right) => left.sequence - right.sequence);
}

export function pruneRewindMetadataAfterCheckpoint(
  metadata: StoredDesktopRewindMetadata,
  checkpointSequence: number,
): void {
  metadata.checkpoints = metadata.checkpoints.filter(
    (checkpoint) => checkpoint.sequence < checkpointSequence,
  );
  metadata.fileChanges = metadata.fileChanges.filter(
    (change) => change.sequence <= checkpointSequence,
  );
}

export function canRewindMessage(
  metadata: StoredDesktopRewindMetadata,
  message: ConversationMessageSnapshot,
): boolean {
  if (message.pending || message.role !== 'user') {
    return false;
  }
  return metadata.checkpoints.some((checkpoint) => checkpoint.messageId === message.id);
}

export function bindRewindFileChangesToToolMessage(
  metadata: StoredDesktopRewindMetadata,
  pendingUnboundFileChangeIds: string[],
  execution: { toolCallId?: string; toolName: string },
  messageId: number,
): string[] {
  const targetIds = new Set<string>();
  const toolCallId = execution.toolCallId || `tool:${execution.toolName}`;
  for (const change of metadata.fileChanges) {
    if (change.messageId !== undefined) {
      continue;
    }
    if (change.toolCallId === toolCallId) {
      targetIds.add(change.id);
    }
  }
  if (targetIds.size === 0) {
    for (const id of pendingUnboundFileChangeIds) {
      targetIds.add(id);
    }
  }
  if (targetIds.size === 0) {
    return pendingUnboundFileChangeIds;
  }

  for (const change of metadata.fileChanges) {
    if (targetIds.has(change.id)) {
      change.messageId = messageId;
    }
  }
  return pendingUnboundFileChangeIds.filter((id) => !targetIds.has(id));
}

export function toDesktopFileChange(
  change: HostRecordedFileChange,
  sequence: number,
): DesktopStoredFileChange {
  return {
    ...change,
    id: randomUUID(),
    sequence,
  };
}

export function fileChangeMetadata(
  change: DesktopStoredFileChange,
): DesktopRewindFileChangeMetadata {
  return {
    id: change.id,
    kind: change.kind,
    path: change.path,
    resolvedPath: change.resolvedPath,
    toolName: change.toolName,
    ...(change.toolCallId ? { toolCallId: change.toolCallId } : {}),
    ...(change.messageId !== undefined ? { messageId: change.messageId } : {}),
    sequence: change.sequence,
    createdAtUnixMs: change.createdAtUnixMs,
  };
}

export async function saveRewindCheckpointSnapshot(
  spiritDataDir: string,
  sessionId: string,
  checkpointId: string,
  snapshot: DesktopRewindCheckpointSnapshot,
): Promise<void> {
  await writeSidecarJson(
    checkpointPath(spiritDataDir, sessionId, checkpointId),
    snapshot,
  );
}

export async function loadRewindCheckpointSnapshot(
  spiritDataDir: string,
  sessionId: string,
  checkpointId: string,
): Promise<DesktopRewindCheckpointSnapshot | undefined> {
  const filePath = checkpointPath(spiritDataDir, sessionId, checkpointId);
  if (!existsSync(filePath)) {
    return undefined;
  }
  const raw = await readFile(filePath, 'utf8');
  return JSON.parse(raw) as DesktopRewindCheckpointSnapshot;
}

export async function saveRewindFileChange(
  spiritDataDir: string,
  sessionId: string,
  change: DesktopStoredFileChange,
): Promise<void> {
  await writeSidecarJson(fileChangePath(spiritDataDir, sessionId, change.id), change);
}

export async function loadRewindFileChange(
  spiritDataDir: string,
  sessionId: string,
  changeId: string,
): Promise<DesktopStoredFileChange | undefined> {
  const filePath = fileChangePath(spiritDataDir, sessionId, changeId);
  if (!existsSync(filePath)) {
    return undefined;
  }
  const raw = await readFile(filePath, 'utf8');
  return JSON.parse(raw) as DesktopStoredFileChange;
}

function checkpointPath(spiritDataDir: string, sessionId: string, checkpointId: string): string {
  return path.join(sessionRewindDir(spiritDataDir, sessionId), 'checkpoints', `${safeName(checkpointId)}.json`);
}

function fileChangePath(spiritDataDir: string, sessionId: string, changeId: string): string {
  return path.join(sessionRewindDir(spiritDataDir, sessionId), 'file-changes', `${safeName(changeId)}.json`);
}

function sessionRewindDir(spiritDataDir: string, sessionId: string): string {
  return path.join(spiritDataDir, REWIND_DIR_NAME, safeName(sessionId));
}

async function writeSidecarJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function normalizeCheckpoint(value: unknown): DesktopRewindCheckpointMetadata[] {
  if (!isRecord(value)) {
    return [];
  }
  if (
    typeof value.id !== 'string' ||
    typeof value.messageId !== 'number' ||
    typeof value.messageIndex !== 'number' ||
    typeof value.sequence !== 'number' ||
    typeof value.createdAtUnixMs !== 'number'
  ) {
    return [];
  }
  return [{
    id: value.id,
    messageId: Math.floor(value.messageId),
    messageIndex: Math.floor(value.messageIndex),
    sequence: Math.floor(value.sequence),
    createdAtUnixMs: value.createdAtUnixMs,
  }];
}

function normalizeFileChange(value: unknown): DesktopRewindFileChangeMetadata[] {
  if (!isRecord(value)) {
    return [];
  }
  if (
    typeof value.id !== 'string' ||
    !isFileChangeKind(value.kind) ||
    typeof value.path !== 'string' ||
    typeof value.resolvedPath !== 'string' ||
    typeof value.toolName !== 'string' ||
    typeof value.sequence !== 'number' ||
    typeof value.createdAtUnixMs !== 'number'
  ) {
    return [];
  }
  return [{
    id: value.id,
    kind: value.kind,
    path: value.path,
    resolvedPath: value.resolvedPath,
    toolName: value.toolName,
    ...(typeof value.toolCallId === 'string' ? { toolCallId: value.toolCallId } : {}),
    ...(typeof value.messageId === 'number' ? { messageId: Math.floor(value.messageId) } : {}),
    sequence: Math.floor(value.sequence),
    createdAtUnixMs: value.createdAtUnixMs,
  }];
}

function isFileChangeKind(value: unknown): value is HostRecordedFileChange['kind'] {
  return value === 'create_file' || value === 'edit_file' || value === 'delete_file';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function safeName(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.-]/gu, '_');
}