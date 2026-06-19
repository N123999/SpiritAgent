import { randomUUID } from 'node:crypto';
import path from 'node:path';

import {
  createHostTodoStore,
  type HostTodoRecord,
  type HostTodoScope,
} from '@spirit-agent/host-internal';

import type { DesktopTodoItem } from '../types.js';
import { isProvisionalSessionPath, spiritAgentDataDir } from './storage.js';

/** Per-bundle TODO scope while the chat file is still the shared provisional slot. */
export function createTodoSessionScopeKey(): string {
  return `todo-scope:${randomUUID()}`;
}

export function resolveTodoSessionKey(input: {
  sessionFilePath?: string;
  bundleId: string;
  todoSessionScopeKey?: string;
}): string {
  if (input.sessionFilePath) {
    const resolved = path.resolve(input.sessionFilePath);
    if (!isProvisionalSessionPath(resolved)) {
      return resolved;
    }
  }
  if (input.todoSessionScopeKey) {
    return input.todoSessionScopeKey;
  }
  return path.resolve(input.bundleId);
}

export function normalizeTodoSessionStorageKey(sessionKey: string): string {
  const trimmed = sessionKey.trim();
  if (trimmed.startsWith('todo-scope:')) {
    return trimmed;
  }
  return path.resolve(trimmed);
}

export function createTodoScope(sessionKey: string): HostTodoScope {
  return { sessionKey };
}

export async function listSessionTodos(sessionKey: string): Promise<HostTodoRecord[]> {
  const store = createHostTodoStore({
    spiritDataDir: spiritAgentDataDir(),
    scope: createTodoScope(sessionKey),
  });
  return store.list({ includeCompleted: true });
}

export async function replaceSessionTodos(
  sessionKey: string,
  records: HostTodoRecord[],
): Promise<void> {
  const store = createHostTodoStore({
    spiritDataDir: spiritAgentDataDir(),
    scope: createTodoScope(sessionKey),
  });
  await store.replaceAll(records);
}

export async function purgeSessionTodos(sessionKey: string): Promise<void> {
  const store = createHostTodoStore({
    spiritDataDir: spiritAgentDataDir(),
    scope: createTodoScope(sessionKey),
  });
  await store.purge();
}

export async function migrateSessionTodos(
  fromSessionKey: string,
  toSessionKey: string,
): Promise<void> {
  const fromKey = normalizeTodoSessionStorageKey(fromSessionKey);
  const toKey = normalizeTodoSessionStorageKey(toSessionKey);
  if (fromKey === toKey) {
    return;
  }

  const records = await listSessionTodos(fromKey);
  if (records.length === 0) {
    await purgeSessionTodos(fromKey);
    return;
  }

  const existing = await listSessionTodos(toKey);
  if (existing.length === 0) {
    await replaceSessionTodos(toKey, records);
  }
  await purgeSessionTodos(fromKey);
}

export function mapHostTodoToDesktopItem(record: HostTodoRecord): DesktopTodoItem {
  return {
    id: record.id,
    title: record.title,
    status: record.status,
    createdAtUnixMs: record.createdAtUnixMs,
    updatedAtUnixMs: record.updatedAtUnixMs,
    ...(record.completedAtUnixMs !== undefined
      ? { completedAtUnixMs: record.completedAtUnixMs }
      : {}),
  };
}

export function cloneHostTodoRecords(records: HostTodoRecord[]): HostTodoRecord[] {
  return records.map((record) => ({
    id: record.id,
    title: record.title,
    status: record.status,
    createdAtUnixMs: record.createdAtUnixMs,
    updatedAtUnixMs: record.updatedAtUnixMs,
    ...(record.completedAtUnixMs !== undefined
      ? { completedAtUnixMs: record.completedAtUnixMs }
      : {}),
  }));
}
