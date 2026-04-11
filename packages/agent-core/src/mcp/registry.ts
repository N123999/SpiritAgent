import {
  normalizeMcpConfigFile,
  summarizeCapabilities,
  summarizeTransport,
} from './config.js';
import type {
  McpConfigFile,
  McpRegistryRuntimeState,
  McpRegistrySnapshot,
  McpServerRuntimeState,
  McpServerStatus,
} from './types.js';

export class McpRegistry {
  private readonly serverStore = new Map<string, McpServerStatus>();
  private revisionStore = 0;
  private stateStore: McpRegistryRuntimeState = 'idle';
  private lastErrorStore: string | undefined;

  replaceConfig(config: McpConfigFile): void {
    const normalized = normalizeMcpConfigFile(config);
    this.serverStore.clear();

    for (const server of Object.values(normalized)) {
      this.serverStore.set(server.name, {
        name: server.name,
        displayName: server.displayName,
        enabled: server.enabled,
        state: server.enabled ? 'idle' : 'disabled',
        transportSummary: summarizeTransport(server.transport),
        capabilitySummary: summarizeCapabilities(server.capabilities),
        cachedTools: 0,
      });
    }

    this.revisionStore += 1;
    this.lastErrorStore = undefined;
    this.stateStore = this.computeState();
  }

  servers(): readonly McpServerStatus[] {
    return [...this.serverStore.values()].sort((left, right) => left.name.localeCompare(right.name));
  }

  get(name: string): McpServerStatus | undefined {
    return this.serverStore.get(name);
  }

  setServerState(
    name: string,
    state: McpServerRuntimeState,
    options?: { cachedTools?: number; lastError?: string },
  ): void {
    const current = this.serverStore.get(name);
    if (!current) {
      return;
    }

    this.serverStore.set(name, {
      ...current,
      state,
      cachedTools: options?.cachedTools ?? current.cachedTools,
      ...(options?.lastError === undefined ? {} : { lastError: options.lastError }),
    });

    this.revisionStore += 1;
    this.lastErrorStore = options?.lastError ?? this.lastErrorStore;
    this.stateStore = this.computeState();
  }

  clearServerError(name: string): void {
    const current = this.serverStore.get(name);
    if (!current || current.lastError === undefined) {
      return;
    }

    const { lastError: _lastError, ...next } = current;
    this.serverStore.set(name, next);
    this.revisionStore += 1;
    this.stateStore = this.computeState();
    this.lastErrorStore = this.firstServerError();
  }

  snapshot(): McpRegistrySnapshot {
    const configuredServers = [...this.serverStore.values()].filter((server) => server.enabled).length;
    const loadedServers = [...this.serverStore.values()].filter((server) => server.state === 'ready').length;
    const cachedTools = [...this.serverStore.values()].reduce(
      (total, server) => total + server.cachedTools,
      0,
    );

    return {
      revision: this.revisionStore,
      state: this.stateStore,
      configuredServers,
      loadedServers,
      cachedTools,
      ...(this.lastErrorStore === undefined ? {} : { lastError: this.lastErrorStore }),
    };
  }

  private computeState(): McpRegistryRuntimeState {
    const enabledServers = [...this.serverStore.values()].filter((server) => server.enabled);
    if (enabledServers.length === 0) {
      return 'idle';
    }

    if (enabledServers.some((server) => server.state === 'loading' || server.state === 'idle')) {
      return 'loading';
    }

    if (enabledServers.some((server) => server.state === 'error')) {
      return 'error';
    }

    return 'ready';
  }

  private firstServerError(): string | undefined {
    for (const server of this.serverStore.values()) {
      if (server.lastError) {
        return server.lastError;
      }
    }

    return undefined;
  }
}