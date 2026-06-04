import path from 'node:path';

import type { HostTodoRecord } from '@spirit-agent/host-internal';

import type { ConversationTodoSnapshot } from '../types.js';
import type { SessionBundle } from './session-bundle.js';
import {
  cloneHostTodoRecords,
  createTodoSessionScopeKey,
  listSessionTodos,
  mapHostTodoToDesktopItem,
  migrateSessionTodos,
  normalizeTodoSessionStorageKey,
  purgeSessionTodos,
  resolveTodoSessionKey,
} from './todos.js';
import { provisionalNewSessionPath } from './storage.js';

export interface PendingTodoClearing {
  untilUnixMs: number;
  items: HostTodoRecord[];
  timer: ReturnType<typeof setTimeout>;
}

export interface SessionTodosHostContext {
  todoClearingBySession(): Map<string, PendingTodoClearing>;
  runSerialized<T>(work: () => Promise<T>): Promise<T>;
  getActiveBundle(): SessionBundle | undefined;
  ensureToolExecutor(bundle: SessionBundle): Promise<unknown>;
  refreshRuntimeForBundle(bundle: SessionBundle): Promise<void>;
  syncActiveRuntimePointer(): void;
  activeSessionId(): string | undefined;
  emitLiveSnapshotUpdate(): void;
}

export function resolveTodoSessionKeyForBundle(bundle: SessionBundle): string {
  return resolveTodoSessionKey({
    sessionFilePath: bundle.activeSession?.filePath,
    bundleId: bundle.id,
    todoSessionScopeKey: bundle.todoSessionScopeKey,
  });
}

export async function maybeRefreshRuntimeAfterTodoScopeChange(
  ctx: SessionTodosHostContext,
  bundle: SessionBundle,
  previousSessionKey: string,
): Promise<void> {
  const nextSessionKey = resolveTodoSessionKeyForBundle(bundle);
  if (
    normalizeTodoSessionStorageKey(previousSessionKey)
    === normalizeTodoSessionStorageKey(nextSessionKey)
  ) {
    return;
  }
  if (!bundle.runtime) {
    return;
  }
  await ctx.refreshRuntimeForBundle(bundle);
  if (bundle.id === ctx.activeSessionId()) {
    ctx.syncActiveRuntimePointer();
  }
}

export async function finalizeTodoScopeForNewActiveBundle(
  ctx: SessionTodosHostContext,
  bundle: SessionBundle,
  workspaceRoot: string,
): Promise<void> {
  if (!bundle.todoSessionScopeKey) {
    bundle.todoSessionScopeKey = createTodoSessionScopeKey();
  }
  bundle.cachedTodoSnapshot = undefined;
  const legacyProvisionalKey = path.resolve(provisionalNewSessionPath(workspaceRoot));
  cancelTodoClearing(ctx, legacyProvisionalKey);
  await purgeSessionTodos(legacyProvisionalKey);
  await ctx.ensureToolExecutor(bundle);
  await refreshTodoSnapshotForBundle(ctx, bundle);
}

export async function reconcileTodoScopeAfterSessionPathChange(
  ctx: SessionTodosHostContext,
  bundle: SessionBundle,
  previousSessionKey: string,
): Promise<void> {
  const nextSessionKey = resolveTodoSessionKeyForBundle(bundle);
  if (
    normalizeTodoSessionStorageKey(previousSessionKey)
    === normalizeTodoSessionStorageKey(nextSessionKey)
  ) {
    return;
  }

  cancelTodoClearing(ctx, previousSessionKey);
  cancelTodoClearing(ctx, nextSessionKey);
  await migrateSessionTodos(previousSessionKey, nextSessionKey);
  await ctx.ensureToolExecutor(bundle);
  await refreshTodoSnapshotForBundle(ctx, bundle);
}

export function cancelTodoClearing(ctx: SessionTodosHostContext, sessionKey: string): void {
  const pending = ctx.todoClearingBySession().get(sessionKey);
  if (!pending) {
    return;
  }
  clearTimeout(pending.timer);
  ctx.todoClearingBySession().delete(sessionKey);
}

export function scheduleTodoClearing(
  ctx: SessionTodosHostContext,
  sessionKey: string,
  items: HostTodoRecord[],
): void {
  cancelTodoClearing(ctx, sessionKey);
  const untilUnixMs = Date.now() + 1000;
  const timer = setTimeout(() => {
    void ctx.runSerialized(async () => {
      const pending = ctx.todoClearingBySession().get(sessionKey);
      if (!pending || pending.timer !== timer) {
        return;
      }
      ctx.todoClearingBySession().delete(sessionKey);
      await purgeSessionTodos(sessionKey);
      const active = ctx.getActiveBundle();
      if (active) {
        await refreshTodoSnapshotForBundle(ctx, active);
      }
      ctx.emitLiveSnapshotUpdate();
    });
  }, 1000);
  ctx.todoClearingBySession().set(sessionKey, { untilUnixMs, items: cloneHostTodoRecords(items), timer });
}

export async function refreshTodoSnapshotForBundle(
  ctx: SessionTodosHostContext,
  bundle: SessionBundle,
): Promise<void> {
  bundle.cachedTodoSnapshot = await buildConversationTodoSnapshot(ctx, bundle);
}

export async function buildConversationTodoSnapshot(
  ctx: SessionTodosHostContext,
  bundle: SessionBundle,
): Promise<ConversationTodoSnapshot | undefined> {
  const sessionKey = resolveTodoSessionKeyForBundle(bundle);
  const pendingClearing = ctx.todoClearingBySession().get(sessionKey);
  if (pendingClearing) {
    return {
      items: pendingClearing.items.map(mapHostTodoToDesktopItem),
      clearingUntilUnixMs: pendingClearing.untilUnixMs,
    };
  }

  const records = await listSessionTodos(sessionKey);
  if (records.length === 0) {
    return undefined;
  }

  const allCompleted = records.every((record) => record.status === 'completed');
  if (allCompleted) {
    scheduleTodoClearing(ctx, sessionKey, records);
    return {
      items: records.map(mapHostTodoToDesktopItem),
      clearingUntilUnixMs: Date.now() + 1000,
    };
  }

  return {
    items: records.map(mapHostTodoToDesktopItem),
  };
}
