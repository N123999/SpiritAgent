import {
  buildActiveSkillPayload,
  buildActivateSkillUserTurn,
  buildCreateSkillUserTurn,
  createSkillFile,
  deleteSkillDir,
  desktopInstructionPaths,
  parseCreateSkillSlashPrompt,
} from './skills.js';
import {
  addDesktopMcpServer,
  deleteDesktopMcpServer,
  inspectDesktopMcpServer,
} from './service-mcp.js';
import {
  toDesktopMarketplaceCatalogItem,
  toDesktopMarketplaceDetail,
  toDesktopMarketplacePreparedInstall,
} from './extensions.js';
import { invalidateSharedUserMcpToolingCache } from '@spirit-agent/core';
import i18n from '../lib/i18n-host.js';
import type {
  AddMcpServerRequest,
  CreateSkillRequest,
  DeleteExtensionRequest,
  DeleteMcpServerRequest,
  DeleteSkillRequest,
  DesktopMarketplaceCatalogItem,
  DesktopMarketplaceDetail,
  DesktopMarketplacePreparedInstall,
  DesktopMcpServerInspection,
  DesktopSnapshot,
  ImportExtensionRequest,
  InstallMarketplaceExtensionRequest,
  PrepareMarketplaceExtensionInstallRequest,
  RunExtensionRequest,
  SubmitCreateSkillSlashRequest,
  SubmitSkillSlashRequest,
  UpdateExtensionSecretRequest,
  UpdateExtensionSettingsRequest,
} from '../types.js';
import type {
  HostExtensionEvent,
  HostExtensionMarketplaceManager,
} from '@spirit-agent/host-internal';
import type { LlmActiveSkill } from '@spirit-agent/core';
import type { DesktopExtensionHostAdapter } from './extension-host-adapter.js';
import type { DesktopConfigFile, DesktopWorkspaceBinding, HostMetadataSummary } from './storage.js';
import type { DesktopGitSnapshot } from '../types.js';

interface HostExtensionState {
  workspaceRoot: string;
  workspaceBinding: DesktopWorkspaceBinding;
  config: DesktopConfigFile;
  git: DesktopGitSnapshot;
  metadata: HostMetadataSummary;
}

type HostExtensionManager = {
  importArchive(input: { archiveBase64: string; fileName?: string }): Promise<{
    id: string;
    manifest: { name: string; version: string };
  }>;
  remove(id: string): Promise<void>;
  run(input: { id: string; host: DesktopExtensionHostAdapter; logger: Console }): Promise<void>;
  setSettingsValues(input: { id: string; values: UpdateExtensionSettingsRequest['values'] }): Promise<unknown>;
  setSecretValue(input: { id: string; key: string; value?: string }): Promise<unknown>;
};

type McpRefreshable = {
  startBackgroundRefreshInBackground(force: boolean): void;
};

type McpInspectable = {
  inspectMcpServer(name: string): Promise<unknown>;
};

type McpBackgroundRefreshable = {
  startMcpBackgroundRefresh(): void;
};

export interface HostExtensionCommandContext {
  runSerialized<T>(work: () => Promise<T>): Promise<T>;
  ensureInitialized(workspaceRootOverride?: string, options?: { fastPath?: boolean }): Promise<void>;
  isInitialized(): boolean;
  requireState(): HostExtensionState;
  isRuntimeBusy(): boolean;
  requireRuntime(): { isBusy(): boolean };
  requireToolExecutor(): McpInspectable;
  toolExecutor(): McpBackgroundRefreshable | undefined;
  sharedMcpServiceForWorkspace(workspaceRoot: string, workspaceBinding: DesktopWorkspaceBinding): McpRefreshable;
  extensionManager(): HostExtensionManager;
  marketplace(): HostExtensionMarketplaceManager;
  requireExtensionHostAdapter(): DesktopExtensionHostAdapter;
  refreshExtensionsList(): Promise<void>;
  refreshRuntime(): Promise<void>;
  refreshRuntimeAfterExtensionMutation(): Promise<void>;
  persistCurrentSessionIfNeeded(): Promise<void>;
  dispatchExtensionEvent(event: HostExtensionEvent, options?: { targetExtensionIds?: readonly string[] }): Promise<void>;
  requireEnabledSkillEntry(skillName: string): HostMetadataSummary['skills']['entries'][number];
  submitUserTurnAfterInitialized(
    text: string,
    options?: {
      displayText?: string;
      turnSkills?: LlmActiveSkill[];
    },
  ): Promise<DesktopSnapshot>;
  appendInlineAssistantReply(displayText: string, assistantText: string): Promise<DesktopSnapshot>;
  setLastRuntimeError(error: string): void;
  buildSnapshot(): DesktopSnapshot;
}

/** Marketplace catalog/detail/readme 为只读网络 I/O，不得占用 runSerialized 以免阻塞会话导航。 */
async function ensureInitializedForReadOnlyMarketplace(
  ctx: HostExtensionCommandContext,
): Promise<void> {
  if (ctx.isInitialized()) {
    await ctx.ensureInitialized(undefined, { fastPath: true });
    return;
  }
  await ctx.runSerialized(() => ctx.ensureInitialized());
}

export async function createSkillCommand(
  ctx: HostExtensionCommandContext,
  request: CreateSkillRequest,
): Promise<DesktopSnapshot> {
  return ctx.runSerialized(async () => {
    await ctx.ensureInitialized();
    if (ctx.isRuntimeBusy()) {
      throw new Error(i18n.t('error.runtimeBusySkill'));
    }
    const state = ctx.requireState();
    const rootKind = request.rootKind ?? 'workspaceSpirit';
    if (
      state.workspaceBinding === 'none'
      && (rootKind === 'workspaceSpirit' || rootKind === 'workspaceAgents')
    ) {
      throw new Error(
        'Workspace-scoped skills are unavailable when workspace binding is disabled.',
      );
    }
    await createSkillFile(state.workspaceRoot, request);

    await ctx.refreshRuntime();
    ctx.setLastRuntimeError('');
    await ctx.persistCurrentSessionIfNeeded();
    return ctx.buildSnapshot();
  });
}

export async function addMcpServerCommand(
  ctx: HostExtensionCommandContext,
  request: AddMcpServerRequest,
): Promise<DesktopSnapshot> {
  return ctx.runSerialized(async () => {
    await ctx.ensureInitialized();
    const state = ctx.requireState();

    const { scope } = await addDesktopMcpServer({
      request,
      workspaceRoot: state.workspaceRoot,
      workspaceBinding: state.workspaceBinding,
    });
    if (scope === 'user') {
      invalidateSharedUserMcpToolingCache();
    }
    ctx.sharedMcpServiceForWorkspace(state.workspaceRoot, state.workspaceBinding)
      .startBackgroundRefreshInBackground(true);
    ctx.toolExecutor()?.startMcpBackgroundRefresh();
    return ctx.buildSnapshot();
  });
}

export async function deleteMcpServerCommand(
  ctx: HostExtensionCommandContext,
  request: DeleteMcpServerRequest,
): Promise<DesktopSnapshot> {
  return ctx.runSerialized(async () => {
    await ctx.ensureInitialized();
    const state = ctx.requireState();

    const { scope } = await deleteDesktopMcpServer({
      request,
      workspaceRoot: state.workspaceRoot,
    });
    if (scope === 'user') {
      invalidateSharedUserMcpToolingCache();
    }
    ctx.sharedMcpServiceForWorkspace(state.workspaceRoot, state.workspaceBinding)
      .startBackgroundRefreshInBackground(true);
    ctx.toolExecutor()?.startMcpBackgroundRefresh();
    return ctx.buildSnapshot();
  });
}

export async function inspectMcpServerCommand(
  ctx: HostExtensionCommandContext,
  name: string,
): Promise<DesktopMcpServerInspection> {
  return ctx.runSerialized(async () => {
    await ctx.ensureInitialized();
    return inspectDesktopMcpServer({
      name,
      inspect: (serverName) => ctx.requireToolExecutor().inspectMcpServer(serverName),
    });
  });
}

export async function importExtensionCommand(
  ctx: HostExtensionCommandContext,
  request: ImportExtensionRequest,
): Promise<DesktopSnapshot> {
  return ctx.runSerialized(async () => {
    await ctx.ensureInitialized();
    const archiveBase64 = request.archiveBase64.trim();
    if (!archiveBase64) {
      throw new Error(i18n.t('error.extensionZipRequired'));
    }

    const installed = await ctx.extensionManager().importArchive({
      archiveBase64,
      ...(request.fileName?.trim() ? { fileName: request.fileName.trim() } : {}),
    });
    await ctx.refreshExtensionsList();
    await ctx.refreshRuntimeAfterExtensionMutation();
    await ctx.dispatchExtensionEvent(
      {
        type: 'onExtensionInstalled',
        detail: {
          extensionId: installed.id,
          name: installed.manifest.name,
          version: installed.manifest.version,
        },
      },
      { targetExtensionIds: [installed.id] },
    );
    return ctx.buildSnapshot();
  });
}

export async function listMarketplaceExtensionsCommand(
  ctx: HostExtensionCommandContext,
): Promise<DesktopMarketplaceCatalogItem[]> {
  await ensureInitializedForReadOnlyMarketplace(ctx);
  const items = await ctx.marketplace().listCatalog();
  return items.map((item) => toDesktopMarketplaceCatalogItem(item));
}

export async function getMarketplaceExtensionDetailCommand(
  ctx: HostExtensionCommandContext,
  extensionId: string,
): Promise<DesktopMarketplaceDetail> {
  await ensureInitializedForReadOnlyMarketplace(ctx);
  const trimmedId = extensionId.trim();
  if (!trimmedId) {
    throw new Error(i18n.t('error.extensionIdRequired'));
  }

  const detail = await ctx.marketplace().getDetail(trimmedId);
  return toDesktopMarketplaceDetail(detail);
}

export async function getMarketplaceExtensionReadmeCommand(
  ctx: HostExtensionCommandContext,
  extensionId: string,
): Promise<string> {
  await ensureInitializedForReadOnlyMarketplace(ctx);
  const trimmedId = extensionId.trim();
  if (!trimmedId) {
    throw new Error(i18n.t('error.extensionIdRequired'));
  }

  return ctx.marketplace().getReadme(trimmedId);
}

export async function prepareMarketplaceExtensionInstallCommand(
  ctx: HostExtensionCommandContext,
  request: PrepareMarketplaceExtensionInstallRequest,
): Promise<DesktopMarketplacePreparedInstall> {
  await ensureInitializedForReadOnlyMarketplace(ctx);
  const extensionId = request.extensionId.trim();
  if (!extensionId) {
    throw new Error(i18n.t('error.extensionIdRequired'));
  }

  const prepared = await ctx.marketplace().prepareInstall({
    extensionId,
    ...(request.version?.trim() ? { version: request.version.trim() } : {}),
  });
  return toDesktopMarketplacePreparedInstall(prepared);
}

export async function installMarketplaceExtensionCommand(
  ctx: HostExtensionCommandContext,
  request: InstallMarketplaceExtensionRequest,
): Promise<DesktopSnapshot> {
  return ctx.runSerialized(async () => {
    await ctx.ensureInitialized();
    const extensionId = request.extensionId.trim();
    if (!extensionId) {
      throw new Error(i18n.t('error.extensionIdRequired'));
    }

    const installed = await ctx.marketplace().install({
      extensionId,
      ...(request.version?.trim() ? { version: request.version.trim() } : {}),
      ...(request.reviewAcknowledged === true ? { reviewAcknowledged: true } : {}),
    });
    await ctx.refreshExtensionsList();
    await ctx.refreshRuntimeAfterExtensionMutation();
    await ctx.dispatchExtensionEvent(
      {
        type: 'onExtensionInstalled',
        detail: {
          extensionId: installed.id,
          name: installed.manifest.name,
          version: installed.manifest.version,
        },
      },
      { targetExtensionIds: [installed.id] },
    );
    return ctx.buildSnapshot();
  });
}

export async function deleteExtensionCommand(
  ctx: HostExtensionCommandContext,
  request: DeleteExtensionRequest,
): Promise<DesktopSnapshot> {
  return ctx.runSerialized(async () => {
    await ctx.ensureInitialized();
    const id = request.id.trim();
    if (!id) {
      throw new Error(i18n.t('error.extensionIdRequired'));
    }

    await ctx.extensionManager().remove(id);
    await ctx.refreshExtensionsList();
    await ctx.refreshRuntimeAfterExtensionMutation();
    return ctx.buildSnapshot();
  });
}

export async function runExtensionCommand(
  ctx: HostExtensionCommandContext,
  request: RunExtensionRequest,
): Promise<DesktopSnapshot> {
  return ctx.runSerialized(async () => {
    await ctx.ensureInitialized();
    const id = request.id.trim();
    if (!id) {
      throw new Error(i18n.t('error.extensionIdRequired'));
    }

    await ctx.extensionManager().run({
      id,
      host: ctx.requireExtensionHostAdapter(),
      logger: console,
    });
    return ctx.buildSnapshot();
  });
}

export async function updateExtensionSettingsCommand(
  ctx: HostExtensionCommandContext,
  request: UpdateExtensionSettingsRequest,
): Promise<DesktopSnapshot> {
  return ctx.runSerialized(async () => {
    await ctx.ensureInitialized();
    const id = request.id.trim();
    if (!id) {
      throw new Error(i18n.t('error.extensionIdRequired'));
    }

    await ctx.extensionManager().setSettingsValues({
      id,
      values: request.values,
    });
    await ctx.refreshExtensionsList();
    await ctx.refreshRuntimeAfterExtensionMutation();
    return ctx.buildSnapshot();
  });
}

export async function updateExtensionSecretCommand(
  ctx: HostExtensionCommandContext,
  request: UpdateExtensionSecretRequest,
): Promise<DesktopSnapshot> {
  return ctx.runSerialized(async () => {
    await ctx.ensureInitialized();
    const id = request.id.trim();
    const key = request.key.trim();
    if (!id) {
      throw new Error(i18n.t('error.extensionIdRequired'));
    }
    if (!key) {
      throw new Error(i18n.t('error.secretKeyRequired'));
    }

    await ctx.extensionManager().setSecretValue({
      id,
      key,
      ...(request.value !== undefined ? { value: request.value } : {}),
    });
    await ctx.refreshExtensionsList();
    await ctx.refreshRuntimeAfterExtensionMutation();
    return ctx.buildSnapshot();
  });
}

export async function deleteSkillCommand(
  ctx: HostExtensionCommandContext,
  request: DeleteSkillRequest,
): Promise<DesktopSnapshot> {
  return ctx.runSerialized(async () => {
    await ctx.ensureInitialized();
    if (ctx.isRuntimeBusy()) {
      throw new Error(i18n.t('error.runtimeBusyDeleteSkill'));
    }
    const state = ctx.requireState();
    await deleteSkillDir(state.workspaceRoot, request);

    await ctx.refreshRuntime();
    ctx.setLastRuntimeError('');
    await ctx.persistCurrentSessionIfNeeded();
    return ctx.buildSnapshot();
  });
}

export async function submitSkillSlashCommand(
  ctx: HostExtensionCommandContext,
  request: SubmitSkillSlashRequest,
): Promise<DesktopSnapshot> {
  return ctx.runSerialized(async () => {
    await ctx.ensureInitialized(undefined, { fastPath: true });
    const runtime = ctx.requireRuntime();
    if (runtime.isBusy()) {
      throw new Error(i18n.t('error.runtimeBusy'));
    }

    const skillName = request.skillName.trim();
    if (!skillName) {
      throw new Error(i18n.t('error.skillNameRequired'));
    }

    const skill = ctx.requireEnabledSkillEntry(skillName);
    const payload = await buildActiveSkillPayload(skill);

    return ctx.submitUserTurnAfterInitialized(
      buildActivateSkillUserTurn(skillName, request.extraNote ?? ''),
      {
        displayText: request.rawText,
        turnSkills: [payload],
      },
    );
  });
}

export async function submitCreateSkillSlashCommand(
  ctx: HostExtensionCommandContext,
  request: SubmitCreateSkillSlashRequest,
): Promise<DesktopSnapshot> {
  return ctx.runSerialized(async () => {
    await ctx.ensureInitialized(undefined, { fastPath: true });
    const runtime = ctx.requireRuntime();
    if (runtime.isBusy()) {
      throw new Error(i18n.t('error.runtimeBusy'));
    }

    const rawText = request.rawText.trim();
    if (!rawText) {
      throw new Error(i18n.t('error.messageRequired'));
    }

    const prompt = parseCreateSkillSlashPrompt(rawText);
    if (prompt instanceof Error) {
      return ctx.appendInlineAssistantReply(rawText, prompt.message);
    }

    const state = ctx.requireState();
    return ctx.submitUserTurnAfterInitialized(
      buildCreateSkillUserTurn(
        state.workspaceRoot,
        desktopInstructionPaths(state.workspaceRoot),
        prompt,
      ),
      {
        displayText: rawText,
      },
    );
  });
}
