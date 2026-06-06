import type { JsonValue, LspDiagnostic, LspReadyProviderSummary } from '@spirit-agent/core';

import { DEFAULT_LSP_TIMING, type LspTimingConfig } from './config.js';
import { LspOrchestrator } from './orchestrator.js';
import { readyProvidersForToolDefinitions } from './ready-providers.js';

export interface LspUserConfig {
  enabled: boolean;
}

const DEFAULT_LSP_USER_CONFIG: LspUserConfig = {
  enabled: true,
};

/** Facade over {@link LspOrchestrator} for workspace-level LSP access. */
export class LspService {
  private readonly orchestrator: LspOrchestrator;

  constructor(
    workspaceRoot: string,
    timing: LspTimingConfig = DEFAULT_LSP_TIMING,
    userConfig: LspUserConfig = DEFAULT_LSP_USER_CONFIG,
  ) {
    this.orchestrator = new LspOrchestrator(workspaceRoot, timing, userConfig);
  }

  setUserConfig(userConfig: LspUserConfig): void {
    this.orchestrator.setUserConfig(userConfig);
  }

  getUserConfig(): LspUserConfig {
    return this.orchestrator.getUserConfig();
  }

  get workspaceRoot(): string {
    return this.orchestrator.workspaceRoot;
  }

  get enabled(): boolean {
    return this.orchestrator.enabled;
  }

  async probe(): Promise<boolean> {
    return this.orchestrator.probe();
  }

  getResolvedServer(): { command: string; args: string[] } | undefined {
    return this.orchestrator.getResolvedServer();
  }

  resetProbe(): void {
    this.orchestrator.resetProbe();
  }

  toolDefinitionsJson(): JsonValue[] {
    return [];
  }

  readyProvidersForToolDefinitions(): LspReadyProviderSummary[] {
    return readyProvidersForToolDefinitions(this.orchestrator);
  }

  async syncFromRecordedChange(change: unknown): Promise<void> {
    return this.orchestrator.syncFromRecordedChange(change);
  }

  async syncFileChange(notification: Parameters<LspOrchestrator['syncFileChange']>[0]): Promise<void> {
    return this.orchestrator.syncFileChange(notification);
  }

  async getDiagnosticsForPath(
    inputPath: string,
    waitMs?: number,
  ): Promise<{ relativePath: string; diagnostics: LspDiagnostic[]; formatted: string }> {
    return this.orchestrator.getDiagnosticsForPath(inputPath, waitMs);
  }

  getCachedDiagnosticsForResolvedPath(resolvedPath: string): LspDiagnostic[] {
    return this.orchestrator.getCachedDiagnosticsForResolvedPath(resolvedPath);
  }

  hasReadyProviderForPath(resolvedPath: string): boolean {
    return this.orchestrator.hasReadyProviderForPath(resolvedPath);
  }

  async dispose(): Promise<void> {
    return this.orchestrator.dispose();
  }

  /** @internal Exposed for orchestrator-level tests and future multi-provider wiring. */
  getOrchestrator(): LspOrchestrator {
    return this.orchestrator;
  }
}
