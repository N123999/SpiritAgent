import path from 'node:path';

import i18n from '../lib/i18n-host.js';
import type { DesktopSnapshot } from '../types.js';
import {
  finishSessionActivationCommand,
  type SessionActivationContext,
} from './session-activation.js';
import {
  isEphemeralDebugSessionPath,
  removeEphemeralSessionRecord,
} from './sessions.js';
import { deleteStoredSession } from './storage.js';

function sameSessionPath(left: string, right: string): boolean {
  return path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase();
}

export interface SessionDeleteContext extends SessionActivationContext {
  removeEphemeralSession(filePath: string): void;
  bundleRuntimeIsBusy(sessionPath: string): boolean;
}

export async function deleteSessionCommand(
  ctx: SessionDeleteContext,
  filePath: string,
): Promise<DesktopSnapshot> {
  return ctx.runSerialized(async () => {
    await ctx.ensureInitialized(undefined, { fastPath: true });

    const trimmed = filePath.trim();
    if (!trimmed) {
      throw new Error(i18n.t('error.invalidSessionPath'));
    }

    const resolvedPath = path.resolve(trimmed);
    if (ctx.bundleRuntimeIsBusy(resolvedPath)) {
      throw new Error(i18n.t('error.cannotDeleteBusySession'));
    }

    const state = ctx.requireState();
    const registry = ctx.sessionRegistry();
    const activeId = registry.activeSessionId();
    const wasActive = activeId !== undefined && sameSessionPath(activeId, resolvedPath);
    const closingBundle = wasActive ? registry.getActive() : undefined;

    if (closingBundle) {
      await ctx.runSessionEndForBundle?.(closingBundle, 'close');
    }

    registry.removeBySessionPath(resolvedPath);

    if (isEphemeralDebugSessionPath(resolvedPath)) {
      ctx.removeEphemeralSession(resolvedPath);
    } else {
      await deleteStoredSession(resolvedPath);
    }

    if (wasActive) {
      ctx.clearSubagentViewerTarget();
      const bundle = registry.beginNewActive(state.workspaceRoot);
      await ctx.finalizeTodoScopeForNewActiveBundle(bundle, state.workspaceRoot);
      ctx.resetStreamingPlacementState(true, bundle);
      await finishSessionActivationCommand(ctx, bundle);
      ctx.setLastRuntimeError('');
      return ctx.buildSnapshot();
    }

    ctx.setLastRuntimeError('');
    return ctx.buildSnapshot();
  });
}
