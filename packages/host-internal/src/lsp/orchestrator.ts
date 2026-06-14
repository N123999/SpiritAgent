import path from 'node:path';

import { DEFAULT_LSP_TIMING, type LspTimingConfig } from './config.js';
import { LspDisabledError, LspPathError } from './errors.js';
import { formatDiagnosticsForLlm } from '@spirit-agent/core';
import type { LspDiagnostic, LspFileChangeNotification } from '@spirit-agent/core';
import {
  isLspSupportedPath,
  parseLspFileChangeNotification,
  relativePathFromWorkspace,
  resolveWorkspaceFilePath,
} from './paths.js';
import { LspProviderSession } from './provider-session.js';
import { buildJdtlsServerCommand } from './resolve-server-jdtls.js';
import {
  discoverLspProvider,
  LSP_PROVIDERS,
  routeLspProviderForPath,
  type LspProviderId,
} from './providers.js';

export interface LspOrchestratorUserConfig {
  enabled: boolean;
}

const DEFAULT_USER_CONFIG: LspOrchestratorUserConfig = {
  enabled: true,
};

export class LspOrchestrator {
  private readonly sessions = new Map<LspProviderId, LspProviderSession>();
  private probed = false;
  private userConfig: LspOrchestratorUserConfig;

  get workspaceRoot(): string {
    return this.workspaceRootStore;
  }

  constructor(
    private readonly workspaceRootStore: string,
    private readonly timing: LspTimingConfig = DEFAULT_LSP_TIMING,
    userConfig: LspOrchestratorUserConfig = DEFAULT_USER_CONFIG,
  ) {
    this.userConfig = userConfig;
  }

  setUserConfig(userConfig: LspOrchestratorUserConfig): void {
    this.userConfig = userConfig;
  }

  getUserConfig(): LspOrchestratorUserConfig {
    return this.userConfig;
  }

  get enabled(): boolean {
    for (const session of this.sessions.values()) {
      if (session.enabled) {
        return true;
      }
    }
    return false;
  }

  async probe(): Promise<boolean> {
    if (this.probed) {
      return this.enabled;
    }
    this.probed = true;

    if (!this.userConfig.enabled) {
      return false;
    }

    await Promise.all(
      LSP_PROVIDERS.map(async (provider) => {
        const session = this.sessionForProvider(provider.id);
        const ready = await session.probe(async () => {
          if (provider.id === 'jdtls') {
            return buildJdtlsServerCommand(this.workspaceRootStore);
          }
          const discovery = await discoverLspProvider(provider.id);
          if (discovery.status !== 'ready' || !discovery.command) {
            return undefined;
          }
          return { command: discovery.command, args: discovery.args ?? [] };
        });
        if (!ready && provider.id === 'typescript-language-server') {
          console.error('[lsp] typescript-language-server not found on PATH; TypeScript diagnostics disabled');
        }
        if (!ready && provider.id === 'rust-analyzer') {
          console.error(
            '[lsp] rust-analyzer is unavailable; run `rustup component add rust-analyzer` or install from settings',
          );
        }
      }),
    );

    return this.enabled;
  }

  resetProbe(): void {
    this.probed = false;
    for (const session of this.sessions.values()) {
      session.resetProbe();
    }
  }

  getResolvedServer(): { command: string; args: string[] } | undefined {
    return this.sessions.get('typescript-language-server')?.getResolvedServer();
  }

  async syncFromRecordedChange(change: unknown): Promise<void> {
    if (!this.enabled) {
      return;
    }
    const notification = parseLspFileChangeNotification(change);
    if (!notification) {
      return;
    }
    await this.syncFileChange(notification);
  }

  async syncFileChange(notification: LspFileChangeNotification): Promise<void> {
    const session = this.sessionForPath(notification.resolvedPath);
    if (!session?.enabled) {
      return;
    }
    await session.syncFileChange(notification);
  }

  async getDiagnosticsForPath(
    inputPath: string,
    waitMs: number = this.timing.diagnosticsWaitMs,
  ): Promise<{ relativePath: string; diagnostics: LspDiagnostic[]; formatted: string }> {
    if (!this.enabled) {
      throw new LspDisabledError();
    }
    const resolvedPath = resolveWorkspaceFilePath(this.workspaceRootStore, inputPath);
    if (!isLspSupportedPath(resolvedPath)) {
      throw new LspPathError(`path is not supported by any language server: ${inputPath}`);
    }
    const session = this.sessionForPath(resolvedPath);
    if (!session?.enabled) {
      throw new LspDisabledError(
        `no language server is available for ${path.extname(resolvedPath)} files`,
      );
    }
    const relativePath = relativePathFromWorkspace(this.workspaceRootStore, resolvedPath);
    const diagnostics = await session.getDiagnosticsForPath(resolvedPath, waitMs);
    return {
      relativePath,
      diagnostics,
      formatted: formatDiagnosticsForLlm(relativePath, diagnostics),
    };
  }

  getCachedDiagnosticsForResolvedPath(resolvedPath: string): LspDiagnostic[] {
    const session = this.sessionForPath(resolvedPath);
    return session?.getCachedDiagnosticsForResolvedPath(resolvedPath) ?? [];
  }

  /** True when a probed-ready language server handles this workspace file path. */
  hasReadyProviderForPath(resolvedPath: string): boolean {
    const session = this.sessionForPath(resolvedPath);
    return session?.enabled ?? false;
  }

  async dispose(): Promise<void> {
    for (const session of this.sessions.values()) {
      await session.dispose();
    }
    this.sessions.clear();
    this.probed = false;
  }

  registerProviderSession(providerId: LspProviderId, session: LspProviderSession): void {
    this.sessions.set(providerId, session);
  }

  getSession(providerId: LspProviderId): LspProviderSession | undefined {
    return this.sessions.get(providerId);
  }

  private sessionForPath(resolvedPath: string): LspProviderSession | undefined {
    const providerId = routeLspProviderForPath(resolvedPath);
    if (!providerId) {
      return undefined;
    }
    return this.sessionForProvider(providerId);
  }

  private sessionForProvider(providerId: LspProviderId): LspProviderSession {
    let session = this.sessions.get(providerId);
    if (!session) {
      session = new LspProviderSession(
        {
          providerId,
          workspaceRoot: this.workspaceRootStore,
          supportsPath: (resolvedPath) => routeLspProviderForPath(resolvedPath) === providerId,
        },
        this.timing,
      );
      this.sessions.set(providerId, session);
    }
    return session;
  }
}
