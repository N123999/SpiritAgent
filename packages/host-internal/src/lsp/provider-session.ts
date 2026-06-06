import { readFile } from 'node:fs/promises';

import { DEFAULT_LSP_TIMING, type LspTimingConfig } from './config.js';
import { LspConnection } from './connection.js';
import { LspDocumentStore } from './document-store.js';
import { LspDisabledError, LspTimeoutError } from './errors.js';
import type { LspDiagnostic, LspFileChangeNotification } from '@spirit-agent/core';
import {
  fileUriForResolvedPath,
  normalizeLspFileUri,
  relativePathFromWorkspace,
} from './paths.js';
import type { LspProviderId } from './providers.js';
import type { ResolvedLanguageServerCommand } from './resolve-server.js';

export interface LspProviderSessionOptions {
  providerId: LspProviderId;
  workspaceRoot: string;
  timing?: LspTimingConfig;
  supportsPath: (resolvedPath: string) => boolean;
}

export class LspProviderSession {
  private readonly documentStore = new LspDocumentStore();
  private readonly diagnosticsByUri = new Map<string, LspDiagnostic[]>();
  private readonly diagnosticWaiters = new Map<string, Set<(diagnostics: LspDiagnostic[]) => void>>();
  private readonly debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly pendingSync = new Map<string, LspFileChangeNotification>();

  private enabledStore = false;
  private serverCommand: ResolvedLanguageServerCommand | undefined;
  private connection: LspConnection | undefined;
  private startPromise: Promise<void> | undefined;

  constructor(
    private readonly options: LspProviderSessionOptions,
    private readonly timing: LspTimingConfig = DEFAULT_LSP_TIMING,
  ) {}

  get providerId(): LspProviderId {
    return this.options.providerId;
  }

  get enabled(): boolean {
    return this.enabledStore;
  }

  async probe(resolve: () => Promise<ResolvedLanguageServerCommand | undefined>): Promise<boolean> {
    const resolved = await resolve();
    if (!resolved) {
      this.enabledStore = false;
      this.serverCommand = undefined;
      return false;
    }
    this.serverCommand = resolved;
    this.enabledStore = true;
    return true;
  }

  resetProbe(): void {
    this.enabledStore = false;
    this.serverCommand = undefined;
  }

  getResolvedServer(): ResolvedLanguageServerCommand | undefined {
    return this.serverCommand ? { ...this.serverCommand } : undefined;
  }

  supportsPath(resolvedPath: string): boolean {
    return this.options.supportsPath(resolvedPath);
  }

  async syncFileChange(notification: LspFileChangeNotification): Promise<void> {
    if (!this.enabledStore || !this.supportsPath(notification.resolvedPath)) {
      return;
    }

    const uri = fileUriForResolvedPath(notification.resolvedPath);
    if (notification.kind === 'delete_file' || !notification.after.exists) {
      this.clearDebounce(uri);
      this.pendingSync.delete(uri);
      await this.ensureStarted();
      await this.closeDocument(uri);
      return;
    }

    const text = notification.after.content ?? '';
    this.pendingSync.set(uri, {
      ...notification,
      after: { exists: true, content: text },
    });
    this.scheduleDebouncedSync(uri);
  }

  async getDiagnosticsForPath(
    resolvedPath: string,
    waitMs: number = this.timing.diagnosticsWaitMs,
  ): Promise<LspDiagnostic[]> {
    if (!this.enabledStore) {
      throw new LspDisabledError();
    }
    const uri = fileUriForResolvedPath(resolvedPath);
    this.diagnosticsByUri.delete(uri);
    await this.flushDebounce(uri);
    await this.openOrSyncDocument(resolvedPath);
    return this.waitForDiagnostics(uri, waitMs, {
      settleQuietMs: this.timing.syncDebounceMs,
    });
  }

  getCachedDiagnosticsForResolvedPath(resolvedPath: string): LspDiagnostic[] {
    const uri = fileUriForResolvedPath(resolvedPath);
    return [...(this.diagnosticsByUri.get(uri) ?? [])];
  }

  async dispose(): Promise<void> {
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
    this.pendingSync.clear();
    this.diagnosticWaiters.clear();
    this.diagnosticsByUri.clear();
    await this.connection?.shutdown();
    this.connection = undefined;
    this.startPromise = undefined;
    this.enabledStore = false;
    this.serverCommand = undefined;
  }

  private scheduleDebouncedSync(uri: string): void {
    const existing = this.debounceTimers.get(uri);
    if (existing) {
      clearTimeout(existing);
    }
    const timer = setTimeout(() => {
      this.debounceTimers.delete(uri);
      void this.flushDebouncedSync(uri);
    }, this.timing.syncDebounceMs);
    this.debounceTimers.set(uri, timer);
  }

  private async flushDebouncedSync(uri: string): Promise<void> {
    const notification = this.pendingSync.get(uri);
    if (!notification) {
      return;
    }
    this.pendingSync.delete(uri);
    const text = notification.after.content ?? '';
    await this.ensureStarted();
    const connection = this.connection?.connection;
    if (!connection) {
      return;
    }

    const existing = this.documentStore.get(uri);
    if (!existing) {
      const opened = this.documentStore.open({
        workspaceRoot: this.options.workspaceRoot,
        resolvedPath: notification.resolvedPath,
        text,
      });
      connection.sendNotification('textDocument/didOpen', {
        textDocument: {
          uri: opened.uri,
          languageId: opened.languageId,
          version: opened.version,
          text: opened.text,
        },
      });
      return;
    }

    const updated = this.documentStore.replaceText(uri, text);
    if (!updated) {
      return;
    }
    connection.sendNotification('textDocument/didChange', {
      textDocument: { uri, version: updated.version },
      contentChanges: [{ text }],
    });
  }

  private async flushDebounce(uri: string): Promise<void> {
    const timer = this.debounceTimers.get(uri);
    if (timer) {
      clearTimeout(timer);
      this.debounceTimers.delete(uri);
    }
    await this.flushDebouncedSync(uri);
  }

  private clearDebounce(uri: string): void {
    const timer = this.debounceTimers.get(uri);
    if (timer) {
      clearTimeout(timer);
      this.debounceTimers.delete(uri);
    }
  }

  private async ensureStarted(): Promise<void> {
    if (!this.enabledStore || !this.serverCommand) {
      throw new LspDisabledError();
    }
    if (this.startPromise) {
      return this.startPromise;
    }
    const command = this.serverCommand;
    const connection = new LspConnection();
    this.connection = connection;
    this.startPromise = connection
      .start({
        command: command.command,
        args: command.args,
        cwd: this.options.workspaceRoot,
        workspaceRoot: this.options.workspaceRoot,
        onDiagnostics: (uri, diagnostics) => {
          this.handlePublishedDiagnostics(uri, diagnostics);
        },
      })
      .catch((error) => {
        this.startPromise = undefined;
        this.connection = undefined;
        throw error;
      });
    return this.startPromise;
  }

  private async openOrSyncDocument(resolvedPath: string): Promise<void> {
    const text = await readFile(resolvedPath, 'utf8');
    await this.syncFileChange({
      kind: 'edit_file',
      path: relativePathFromWorkspace(this.options.workspaceRoot, resolvedPath),
      resolvedPath,
      before: { exists: true, content: text },
      after: { exists: true, content: text },
    });
    await this.flushDebounce(fileUriForResolvedPath(resolvedPath));
  }

  private async closeDocument(uri: string): Promise<void> {
    const connection = this.connection?.connection;
    if (connection && this.documentStore.has(uri)) {
      connection.sendNotification('textDocument/didClose', {
        textDocument: { uri },
      });
    }
    this.documentStore.close(uri);
    this.diagnosticsByUri.delete(uri);
    this.diagnosticWaiters.delete(uri);
  }

  private handlePublishedDiagnostics(uri: string, diagnostics: LspDiagnostic[]): void {
    const canonicalUri = normalizeLspFileUri(uri);
    this.diagnosticsByUri.set(canonicalUri, diagnostics);
    const waiters = this.diagnosticWaiters.get(canonicalUri);
    if (!waiters) {
      return;
    }
    for (const notify of waiters) {
      notify(diagnostics);
    }
  }

  private async waitForDiagnostics(
    uri: string,
    waitMs: number,
    options?: { settleQuietMs?: number },
  ): Promise<LspDiagnostic[]> {
    const settleQuietMs = options?.settleQuietMs ?? 0;
    const canonicalUri = normalizeLspFileUri(uri);

    if (settleQuietMs <= 0) {
      const cached = this.diagnosticsByUri.get(canonicalUri);
      if (cached) {
        return [...cached];
      }

      return new Promise<LspDiagnostic[]>((resolve, reject) => {
        const timeout = setTimeout(() => {
          const waiters = this.diagnosticWaiters.get(canonicalUri);
          waiters?.delete(resolveWithDiagnostics);
          reject(new LspTimeoutError());
        }, waitMs);

        const resolveWithDiagnostics = (diagnostics: LspDiagnostic[]) => {
          clearTimeout(timeout);
          const waiters = this.diagnosticWaiters.get(canonicalUri);
          waiters?.delete(resolveWithDiagnostics);
          if (waiters?.size === 0) {
            this.diagnosticWaiters.delete(canonicalUri);
          }
          resolve([...diagnostics]);
        };

        const waiters = this.diagnosticWaiters.get(canonicalUri) ?? new Set();
        waiters.add(resolveWithDiagnostics);
        this.diagnosticWaiters.set(canonicalUri, waiters);
      }).catch((error) => {
        if (error instanceof LspTimeoutError) {
          return [...(this.diagnosticsByUri.get(canonicalUri) ?? [])];
        }
        throw error;
      });
    }

    return new Promise<LspDiagnostic[]>((resolve) => {
      let settleTimer: ReturnType<typeof setTimeout> | undefined;
      const overallTimer = setTimeout(() => {
        cleanup();
        resolve([...(this.diagnosticsByUri.get(canonicalUri) ?? [])]);
      }, waitMs);

      const cleanup = () => {
        clearTimeout(overallTimer);
        if (settleTimer) {
          clearTimeout(settleTimer);
        }
        const waiters = this.diagnosticWaiters.get(canonicalUri);
        waiters?.delete(onPublish);
        if (waiters?.size === 0) {
          this.diagnosticWaiters.delete(canonicalUri);
        }
      };

      const finish = () => {
        cleanup();
        resolve([...(this.diagnosticsByUri.get(canonicalUri) ?? [])]);
      };

      const onPublish = (_diagnostics: LspDiagnostic[]) => {
        if (settleTimer) {
          clearTimeout(settleTimer);
        }
        settleTimer = setTimeout(finish, settleQuietMs);
      };

      const waiters = this.diagnosticWaiters.get(canonicalUri) ?? new Set();
      waiters.add(onPublish);
      this.diagnosticWaiters.set(canonicalUri, waiters);

      const cached = this.diagnosticsByUri.get(canonicalUri);
      if (cached) {
        onPublish(cached);
      }
    });
  }
}
