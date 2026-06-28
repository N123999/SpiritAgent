import path from 'node:path';

import {
  createHostDreamStore,
  getWorkspaceFileReferenceIndexSnapshot,
  listWorkspaceFileReferenceSuggestions as listWorkspaceFileReferenceSuggestionsFromHostInternal,
  primeWorkspaceFileReferenceIndexCache,
  runRipgrepSearch,
  WORKSPACE_CONTENT_SEARCH_MAX_MATCHES,
  type WorkLocationKind,
  type WorkspaceFileReferenceIndexSnapshot,
} from '@spirit-agent/host-internal';

import i18n from '../lib/i18n-host.js';
import { clearCodeCompletionStateForWorkspace } from './code-completion-commands.js';
import type {
  CheckoutGitBranchRequest,
  CommitChangesRequest,
  DesktopDreamOverviewItem,
  DesktopGitSnapshot,
  DesktopSnapshot,
  GitHistorySnapshot,
  GitCommitMessageSnapshot,
  GitWorkingTreeSnapshot,
  HostTextFileStatResult,
  QueryWorkspaceFileReferenceSuggestionsRequest,
  ReadGitHistoryRequest,
  ReadGitCommitMessageRequest,
  RememberWorkspaceRequest,
  ForgetWorkspaceRequest,
  SessionListItem,
  WorkspaceExplorerListResult,
  WorkspaceFileReferenceSuggestionsResponse,
  WorkspaceReadTextFileResult,
  WriteHostTextFileRequest,
  WriteWorkspaceTextFileRequest,
  WorkspaceContentSearchRequest,
  WorkspaceContentSearchResult,
} from '../types.js';
import {
  applyGitRevision,
  checkoutWorkspaceGitBranch,
  commitWorkspaceChanges,
  mergeWorktreeBranchToMain,
  pushWorkspaceGitBranch,
  readWorkspaceGitHistory,
  readWorkspaceGitCommitMessage,
  readWorkspaceGitWorkingTree,
} from './git.js';
import { ephemeralSessionsToListItems, sessionListActivityFromBundle } from './sessions.js';
import type { SessionBundle } from './session-bundle.js';
import {
  listWorkspaceExplorerChildren as listWorkspaceExplorerChildrenFromDisk,
  readWorkspaceTextFile as readWorkspaceTextFileFromDisk,
  writeWorkspaceTextFile as writeWorkspaceTextFileToDisk,
} from './workspace-files.js';
import {
  createWorkspaceEntry as createWorkspaceEntryOnDisk,
  forceDeleteWorkspaceEntry as forceDeleteWorkspaceEntryOnDisk,
  moveWorkspaceEntry as moveWorkspaceEntryOnDisk,
  renameWorkspaceEntry as renameWorkspaceEntryOnDisk,
  revealWorkspaceEntry as revealWorkspaceEntryOnDisk,
  trashWorkspaceEntry as trashWorkspaceEntryOnDisk,
  type WorkspaceEntryKind,
} from './workspace-file-operations.js';
import {
  listStoredSessions,
  mergeRecentWorkspaceRoots,
  removeRecentWorkspaceRoot,
  normalizeWebHostConfig,
  saveConfig,
  spiritAgentDataDir,
  type DesktopConfigFile,
} from './storage.js';
import type { EphemeralSessionRecord } from './sessions.js';

interface HostWorkspaceGitState {
  workspaceRoot: string;
  config: DesktopConfigFile;
  git: DesktopGitSnapshot;
  ephemeralSessions: EphemeralSessionRecord[];
}

interface HostWorkspaceGitBundle {
  pendingGitBranch?: string;
  workLocation: WorkLocationKind;
}

export interface HostWorkspaceGitCommandContext {
  runSerialized<T>(work: () => Promise<T>): Promise<T>;
  ensureInitialized(workspaceRootOverride?: string, options?: { fastPath?: boolean }): Promise<void>;
  requireState(): HostWorkspaceGitState;
  isRuntimeBusy(): boolean;
  activeBundle(): HostWorkspaceGitBundle;
  activeSessionId(): string | undefined;
  bundleRuntimeIsBusy(sessionPath: string): boolean;
  bundleForSessionPath(sessionPath: string): SessionBundle | undefined;
  refreshGitState(): Promise<void>;
  refreshRuntimeForActiveBundle(): Promise<void>;
  syncActiveRuntimePointer(): void;
  startDreamCollectorIfNeeded(): void;
  runCoalescedGitRefresh(): Promise<void>;
  hasState(): boolean;
  buildSnapshot(): DesktopSnapshot;
}

export async function rememberWorkspaceRootCommand(
  ctx: HostWorkspaceGitCommandContext,
  request: RememberWorkspaceRequest,
): Promise<DesktopSnapshot> {
  return ctx.runSerialized(async () => {
    await ctx.ensureInitialized();
    const workspaceRoot = request.workspaceRoot?.trim()
      ? path.resolve(request.workspaceRoot.trim())
      : '';
    if (!workspaceRoot) {
      throw new Error(i18n.t('error.workspacePathRequired'));
    }

    const state = ctx.requireState();
    state.config = {
      ...state.config,
      recentWorkspaces: mergeRecentWorkspaceRoots(state.config.recentWorkspaces, workspaceRoot),
    };
    await saveConfig(state.config);
    return ctx.buildSnapshot();
  });
}

export async function forgetWorkspaceRootCommand(
  ctx: HostWorkspaceGitCommandContext,
  request: ForgetWorkspaceRequest,
): Promise<DesktopSnapshot> {
  return ctx.runSerialized(async () => {
    await ctx.ensureInitialized();
    const workspaceRoot = request.workspaceRoot?.trim()
      ? path.resolve(request.workspaceRoot.trim())
      : '';
    if (!workspaceRoot) {
      throw new Error(i18n.t('error.workspacePathRequired'));
    }

    const state = ctx.requireState();
    clearCodeCompletionStateForWorkspace(workspaceRoot);
    state.config = {
      ...state.config,
      recentWorkspaces: removeRecentWorkspaceRoot(state.config.recentWorkspaces, workspaceRoot),
    };
    await saveConfig(state.config);
    return ctx.buildSnapshot();
  });
}

export async function commitChangesCommand(
  ctx: HostWorkspaceGitCommandContext,
  request: CommitChangesRequest,
): Promise<DesktopSnapshot> {
  return ctx.runSerialized(async () => {
    await ctx.ensureInitialized();
    if (ctx.isRuntimeBusy()) {
      throw new Error(i18n.t('error.runtimeBusy'));
    }

    const state = ctx.requireState();
    if (!state.git.isRepository) {
      throw new Error(i18n.t('error.notGitRepo'));
    }
    if (!state.git.hasChanges) {
      throw new Error(i18n.t('error.noChangesToCommit'));
    }

    const commitMessage = request.message?.trim();
    if (!commitMessage) {
      throw new Error(i18n.t('error.commitMessageRequired'));
    }

    await commitWorkspaceChanges(state.workspaceRoot, commitMessage);
    await ctx.refreshGitState();
    return ctx.buildSnapshot();
  });
}

export async function setWebHostAuthTokenHashCommand(
  ctx: HostWorkspaceGitCommandContext,
  authTokenHash: string,
): Promise<DesktopSnapshot> {
  return ctx.runSerialized(async () => {
    await ctx.ensureInitialized();
    const state = ctx.requireState();
    state.config.webHost = normalizeWebHostConfig({
      ...state.config.webHost,
      authTokenHash,
    });
    await saveConfig(state.config);
    return ctx.buildSnapshot();
  });
}

export async function checkoutGitBranchCommand(
  ctx: HostWorkspaceGitCommandContext,
  request: CheckoutGitBranchRequest,
): Promise<DesktopSnapshot> {
  return ctx.runSerialized(async () => {
    await ctx.ensureInitialized(undefined, { fastPath: true });
    if (ctx.isRuntimeBusy()) {
      throw new Error(i18n.t('error.runtimeBusy'));
    }

    const state = ctx.requireState();
    const normalized = request.branch.trim();
    if (!state.git.isRepository) {
      throw new Error(i18n.t('error.notGitRepo'));
    }
    if (!normalized) {
      throw new Error(i18n.t('error.branchNameRequired'));
    }
    if (!state.git.branches.includes(normalized)) {
      throw new Error(i18n.t('error.branchNotFound', { branch: normalized }));
    }

    state.git = applyGitRevision(
      await checkoutWorkspaceGitBranch(state.workspaceRoot, normalized, {
        discardLocalChanges: request.discardLocalChanges === true,
      }),
      state.git.revision ?? 0,
    );
    ctx.activeBundle().pendingGitBranch = undefined;
    await ctx.refreshRuntimeForActiveBundle();
    ctx.syncActiveRuntimePointer();
    ctx.startDreamCollectorIfNeeded();
    return ctx.buildSnapshot();
  });
}

export async function mergeWorktreeToMainCommand(
  ctx: HostWorkspaceGitCommandContext,
): Promise<DesktopSnapshot> {
  return ctx.runSerialized(async () => {
    await ctx.ensureInitialized(undefined, { fastPath: true });
    if (ctx.isRuntimeBusy()) {
      throw new Error(i18n.t('error.runtimeBusy'));
    }

    const state = ctx.requireState();
    const git = state.git;
    if (!git.isWorktreeSession || !git.primaryRepoRoot || !git.worktreeBranch) {
      throw new Error(i18n.t('error.notInWorktree'));
    }

    await mergeWorktreeBranchToMain(git.primaryRepoRoot, git.worktreeBranch);
    await ctx.refreshGitState();
    return ctx.buildSnapshot();
  });
}

export async function pushGitBranchCommand(
  ctx: HostWorkspaceGitCommandContext,
): Promise<DesktopSnapshot> {
  return ctx.runSerialized(async () => {
    await ctx.ensureInitialized(undefined, { fastPath: true });
    if (ctx.isRuntimeBusy()) {
      throw new Error(i18n.t('error.runtimeBusy'));
    }

    const state = ctx.requireState();
    if (!state.git.isRepository) {
      throw new Error(i18n.t('error.notGitRepo'));
    }
    if (!state.git.needsPush) {
      throw new Error(i18n.t('error.nothingToPush'));
    }

    await pushWorkspaceGitBranch(state.workspaceRoot);
    await ctx.refreshGitState();
    return ctx.buildSnapshot();
  });
}

export async function listSessionsCommand(ctx: HostWorkspaceGitCommandContext): Promise<SessionListItem[]> {
  return ctx.runSerialized(async () => {
    await ctx.ensureInitialized(undefined, { fastPath: true });
    const state = ctx.requireState();
    const activeId = ctx.activeSessionId();
    const stored = await listStoredSessions();
    const ephemeral: SessionListItem[] = ephemeralSessionsToListItems(state.ephemeralSessions);
    const merged = [...stored, ...ephemeral].sort((left, right) => right.modifiedAtUnixMs - left.modifiedAtUnixMs);
    return merged.map((item) => ({
      ...item,
      ...sessionListActivityFromBundle(ctx.bundleForSessionPath(item.path)),
      ...(item.path === activeId ? { isActive: true } : {}),
    }));
  });
}

export async function listDreamsOverviewCommand(
  ctx: HostWorkspaceGitCommandContext,
): Promise<DesktopDreamOverviewItem[]> {
  return ctx.runSerialized(async () => {
    await ctx.ensureInitialized(undefined, { fastPath: true });
    const state = ctx.requireState();
    const gitBranch = state.git.branch?.trim();
    if (!state.git.isRepository || !gitBranch) {
      return [];
    }

    const dreamStore = createHostDreamStore({
      spiritDataDir: spiritAgentDataDir(),
      scope: {
        workspaceRoot: state.workspaceRoot,
        gitBranch,
      },
    });
    await dreamStore.pruneExpired();
    const dreams = await dreamStore.list({ includeDeleted: false, includeExpired: false });
    return dreams.map((dream) => ({
      id: dream.id,
      title: dream.title,
      summary: dream.summary,
      ...(dream.details ? { details: dream.details } : {}),
      tags: dream.tags ?? [],
      workspaceRoot: dream.scope.workspaceRoot,
      gitBranch: dream.scope.gitBranch,
      updatedAtUnixMs: dream.updatedAtUnixMs,
    }));
  });
}

export async function listWorkspaceExplorerChildrenCommand(
  ctx: HostWorkspaceGitCommandContext,
  relativePath: string,
): Promise<WorkspaceExplorerListResult> {
  await ctx.ensureInitialized(undefined, { fastPath: true });
  const state = ctx.requireState();
  return listWorkspaceExplorerChildrenFromDisk(state.workspaceRoot, relativePath);
}

export async function readGitWorkingTreeCommand(
  ctx: HostWorkspaceGitCommandContext,
): Promise<GitWorkingTreeSnapshot> {
  return ctx.runSerialized(async () => {
    await ctx.ensureInitialized();
    const state = ctx.requireState();
    return readWorkspaceGitWorkingTree(state.workspaceRoot);
  });
}

export async function readGitHistoryCommand(
  ctx: HostWorkspaceGitCommandContext,
  request: ReadGitHistoryRequest = {},
): Promise<GitHistorySnapshot> {
  return ctx.runSerialized(async () => {
    await ctx.ensureInitialized();
    const state = ctx.requireState();
    return readWorkspaceGitHistory(state.workspaceRoot, request);
  });
}

export async function readGitCommitMessageCommand(
  ctx: HostWorkspaceGitCommandContext,
  request: ReadGitCommitMessageRequest,
): Promise<GitCommitMessageSnapshot> {
  return ctx.runSerialized(async () => {
    await ctx.ensureInitialized();
    const state = ctx.requireState();
    return readWorkspaceGitCommitMessage(state.workspaceRoot, request);
  });
}

export async function listWorkspaceFileReferenceSuggestionsCommand(
  ctx: HostWorkspaceGitCommandContext,
  request: QueryWorkspaceFileReferenceSuggestionsRequest,
): Promise<WorkspaceFileReferenceSuggestionsResponse> {
  await ctx.ensureInitialized(undefined, { fastPath: true });
  const state = ctx.requireState();
  return (
    (await listWorkspaceFileReferenceSuggestionsFromHostInternal(
      state.workspaceRoot,
      request.input,
      request.cursorChars,
    )) ?? null
  );
}

export async function primeWorkspaceFileReferenceIndexCommand(
  ctx: HostWorkspaceGitCommandContext,
): Promise<void> {
  await ctx.ensureInitialized(undefined, { fastPath: true });
  const state = ctx.requireState();
  await primeWorkspaceFileReferenceIndexCache(state.workspaceRoot);
}

export async function getWorkspaceFileReferenceIndexCommand(
  ctx: HostWorkspaceGitCommandContext,
): Promise<WorkspaceFileReferenceIndexSnapshot> {
  await ctx.ensureInitialized(undefined, { fastPath: true });
  const state = ctx.requireState();
  return getWorkspaceFileReferenceIndexSnapshot(state.workspaceRoot);
}

export async function readWorkspaceTextFileCommand(
  ctx: HostWorkspaceGitCommandContext,
  relativePath: string,
  options?: import('../types.js').ReadWorkspaceTextFileOptions,
): Promise<WorkspaceReadTextFileResult> {
  await ctx.ensureInitialized(undefined, { fastPath: true });
  const state = ctx.requireState();
  return readWorkspaceTextFileFromDisk(state.workspaceRoot, relativePath, options);
}

export async function writeWorkspaceTextFileCommand(
  ctx: HostWorkspaceGitCommandContext,
  request: WriteWorkspaceTextFileRequest,
): Promise<void> {
  return ctx.runSerialized(async () => {
    await ctx.ensureInitialized();
    const state = ctx.requireState();
    await writeWorkspaceTextFileToDisk(state.workspaceRoot, request);
  });
}

export async function revealWorkspaceEntryCommand(
  ctx: HostWorkspaceGitCommandContext,
  relativePath: string,
  workspaceRoot?: string,
): Promise<void> {
  await ctx.ensureInitialized(undefined, { fastPath: true });
  const state = ctx.requireState();
  const root = workspaceRoot?.trim() || state.workspaceRoot;
  await revealWorkspaceEntryOnDisk(root, relativePath);
}

export async function renameWorkspaceEntryCommand(
  ctx: HostWorkspaceGitCommandContext,
  relativePath: string,
  newName: string,
): Promise<{ relativePath: string }> {
  return ctx.runSerialized(async () => {
    await ctx.ensureInitialized();
    const state = ctx.requireState();
    return renameWorkspaceEntryOnDisk(state.workspaceRoot, relativePath, newName);
  });
}

export async function createWorkspaceEntryCommand(
  ctx: HostWorkspaceGitCommandContext,
  parentDirectoryRel: string,
  name: string,
  kind: WorkspaceEntryKind,
): Promise<{ relativePath: string }> {
  return ctx.runSerialized(async () => {
    await ctx.ensureInitialized();
    const state = ctx.requireState();
    return createWorkspaceEntryOnDisk(state.workspaceRoot, parentDirectoryRel, name, kind);
  });
}

export async function moveWorkspaceEntryCommand(
  ctx: HostWorkspaceGitCommandContext,
  relativePath: string,
  targetDirectoryRel: string,
): Promise<{ relativePath: string }> {
  return ctx.runSerialized(async () => {
    await ctx.ensureInitialized();
    const state = ctx.requireState();
    return moveWorkspaceEntryOnDisk(state.workspaceRoot, relativePath, targetDirectoryRel);
  });
}

export async function trashWorkspaceEntryCommand(
  ctx: HostWorkspaceGitCommandContext,
  relativePath: string,
): Promise<void> {
  return ctx.runSerialized(async () => {
    await ctx.ensureInitialized();
    const state = ctx.requireState();
    await trashWorkspaceEntryOnDisk(state.workspaceRoot, relativePath);
  });
}

export async function forceDeleteWorkspaceEntryCommand(
  ctx: HostWorkspaceGitCommandContext,
  relativePath: string,
): Promise<void> {
  return ctx.runSerialized(async () => {
    await ctx.ensureInitialized();
    const state = ctx.requireState();
    await forceDeleteWorkspaceEntryOnDisk(state.workspaceRoot, relativePath);
  });
}

export async function readHostTextFileCommand(
  ctx: HostWorkspaceGitCommandContext,
  absolutePath: string,
): Promise<WorkspaceReadTextFileResult> {
  await ctx.ensureInitialized(undefined, { fastPath: true });
  const { readHostTextFile } = await import('./host-text-file.js');
  return readHostTextFile(absolutePath);
}

export async function writeHostTextFileCommand(
  ctx: HostWorkspaceGitCommandContext,
  request: WriteHostTextFileRequest,
): Promise<void> {
  return ctx.runSerialized(async () => {
    await ctx.ensureInitialized();
    const { writeHostTextFile } = await import('./host-text-file.js');
    await writeHostTextFile(request.absolutePath, request.text);
  });
}

export async function statHostTextFileCommand(
  ctx: HostWorkspaceGitCommandContext,
  absolutePath: string,
): Promise<HostTextFileStatResult> {
  await ctx.ensureInitialized(undefined, { fastPath: true });
  const { statHostTextFile } = await import('./host-text-file.js');
  return statHostTextFile(absolutePath);
}

export async function refreshGitSnapshotCommand(
  ctx: HostWorkspaceGitCommandContext,
): Promise<DesktopSnapshot> {
  await ctx.runCoalescedGitRefresh();
  if (!ctx.hasState()) {
    throw new Error(i18n.t('error.hostNotReady'));
  }
  return ctx.buildSnapshot();
}

export async function searchWorkspaceContentCommand(
  ctx: HostWorkspaceGitCommandContext,
  request: WorkspaceContentSearchRequest,
): Promise<WorkspaceContentSearchResult> {
  await ctx.ensureInitialized(undefined, { fastPath: true });
  const state = ctx.requireState();
  const query = request.query.trim();
  if (!query) {
    return { matches: [] };
  }

  const { matches, truncated } = await runRipgrepSearch({
    workspaceRoot: state.workspaceRoot,
    query,
    isRegexp: request.isRegexp === true,
    caseSensitive: request.caseSensitive === true,
    wholeWord: request.wholeWord === true,
    maxMatches: WORKSPACE_CONTENT_SEARCH_MAX_MATCHES,
  });

  return { matches, truncated };
}
