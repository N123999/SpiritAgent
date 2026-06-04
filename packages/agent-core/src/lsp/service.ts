import { readFile } from 'node:fs/promises';

import { DEFAULT_LSP_TIMING, type LspTimingConfig } from './config.js';
import { LspConnection } from './connection.js';
import { LspDocumentStore } from './document-store.js';
import { LspDisabledError, LspPathError, LspTimeoutError } from './errors.js';
import { formatDiagnosticsForLlm } from './format-diagnostics.js';
import {
  fileUriForResolvedPath,
  normalizeLspFileUri,
  isTypescriptJavascriptPath,
  parseLspFileChangeNotification,
  relativePathFromWorkspace,
  resolveWorkspaceFilePath,
} from './paths.js';
import { resolveTypescriptLanguageServerOnPath } from './resolve-server.js';
import type { LspDiagnostic, LspFileChangeNotification } from './types.js';

export class LspService {
  private readonly documentStore = new LspDocumentStore();
  private readonly diagnosticsByUri = new Map<string, LspDiagnostic[]>();
  private readonly diagnosticWaiters = new Map<string, Set<(diagnostics: LspDiagnostic[]) => void>>();
  private readonly debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly pendingSync = new Map<string, LspFileChangeNotification>();

  private enabledStore = false;
  private probed = false;
  private serverCommand: { command: string; args: string[] } | undefined;
  private connection: LspConnection | undefined;
  private startPromise: Promise<void> | undefined;

  constructor(
    private readonly workspaceRootStore: string,
    private readonly timing: LspTimingConfig = DEFAULT_LSP_TIMING,
  ) {}

  get workspaceRoot(): string {
    return this.workspaceRootStore;
  }

  get enabled(): boolean {
    return this.enabledStore;
  }

  async probe(): Promise<boolean> {
    if (this.probed) {
      return this.enabledStore;
    }
    this.probed = true;
    const resolved = await resolveTypescriptLanguageServerOnPath();
    if (!resolved) {
      console.error('[lsp] typescript-language-server not found on PATH; diagnostics disabled');
      this.enabledStore = false;
      return false;
    }
    this.serverCommand = resolved;
    this.enabledStore = true;
    return true;
  }

  toolDefinitionsJson(): import('../ports.js').JsonValue[] {
    return [];
  }

  async syncFromRecordedChange(change: unknown): Promise<void> {
    if (!this.enabledStore) {
      return;
    }
    const notification = parseLspFileChangeNotification(change);
    if (!notification) {
      return;
    }
    await this.syncFileChange(notification);
  }

  async syncFileChange(notification: LspFileChangeNotification): Promise<void> {
    if (!this.enabledStore || !isTypescriptJavascriptPath(notification.resolvedPath)) {
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
    inputPath: string,
    waitMs: number = this.timing.diagnosticsWaitMs,
  ): Promise<{ relativePath: string; diagnostics: LspDiagnostic[]; formatted: string }> {
    if (!this.enabledStore) {
      throw new LspDisabledError();
    }
    const resolvedPath = resolveWorkspaceFilePath(this.workspaceRootStore, inputPath);
    if (!isTypescriptJavascriptPath(resolvedPath)) {
      throw new LspPathError(`path is not a TypeScript or JavaScript file: ${inputPath}`);
    }
    const relativePath = relativePathFromWorkspace(this.workspaceRootStore, resolvedPath);
    const uri = fileUriForResolvedPath(resolvedPath);
    this.diagnosticsByUri.delete(uri);
    await this.flushDebounce(uri);
    await this.openOrSyncDocument(resolvedPath);
    const diagnostics = await this.waitForDiagnostics(uri, waitMs);
    return {
      relativePath,
      diagnostics,
      formatted: formatDiagnosticsForLlm(relativePath, diagnostics),
    };
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
    this.probed = false;
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
        workspaceRoot: this.workspaceRootStore,
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
        cwd: this.workspaceRootStore,
        workspaceRoot: this.workspaceRootStore,
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
      path: relativePathFromWorkspace(this.workspaceRootStore, resolvedPath),
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
    for (const resolve of waiters) {
      resolve(diagnostics);
    }
    this.diagnosticWaiters.delete(canonicalUri);
  }

  private async waitForDiagnostics(uri: string, waitMs: number): Promise<LspDiagnostic[]> {
    const cached = this.diagnosticsByUri.get(uri);
    if (cached) {
      return [...cached];
    }

    return new Promise<LspDiagnostic[]>((resolve, reject) => {
      const timeout = setTimeout(() => {
        const waiters = this.diagnosticWaiters.get(uri);
        waiters?.delete(resolveWithDiagnostics);
        reject(new LspTimeoutError());
      }, waitMs);

      const resolveWithDiagnostics = (diagnostics: LspDiagnostic[]) => {
        clearTimeout(timeout);
        resolve([...diagnostics]);
      };

      const waiters = this.diagnosticWaiters.get(uri) ?? new Set();
      waiters.add(resolveWithDiagnostics);
      this.diagnosticWaiters.set(uri, waiters);
    }).catch((error) => {
      if (error instanceof LspTimeoutError) {
        return [...(this.diagnosticsByUri.get(uri) ?? [])];
      }
      throw error;
    });
  }
}
