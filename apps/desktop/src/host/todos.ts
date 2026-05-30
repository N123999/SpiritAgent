import path from 'node:path';

import {
  buildTodoContextText,
  createHostTodoStore,
  type HostTodoRecord,
  type HostTodoScope,
} from '@spirit-agent/host-internal';

import type { DesktopTodoItem } from '../types.js';
import { spiritAgentDataDir } from './storage.js';

export function resolveTodoSessionKey(input: {
  sessionFilePath?: string;
  bundleId: string;
}): string {
  return path.resolve(input.sessionFilePath ?? input.bundleId);
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

export async function buildSessionTodosContextText(sessionKey: string): Promise<string> {
  const records = await listSessionTodos(sessionKey);
  return buildTodoContextText(records) ?? '';
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
