import type { LlmExtensionSystemPrompt } from '@spirit-agent/agent-core';
import type { HostExtensionEvent } from '@spirit-agent/host-internal';

export type ExtensionWarmupTrigger =
  | { type: 'startup'; workspaceRoot: string }
  | { type: 'session'; event: HostExtensionEvent };

export interface ExtensionWarmupCallbacks {
  collectSystemPrompts(): Promise<LlmExtensionSystemPrompt[]>;
  refreshExtensionsListFull(): Promise<void>;
  dispatchEvent(event: HostExtensionEvent): Promise<void>;
  applyWarmupToRuntime(): Promise<void>;
  emitSnapshotUpdate(): void;
}

export class ExtensionWarmupCoordinator {
  private generation = 0;
  private loadingCount = 0;

  systemPromptsCache: LlmExtensionSystemPrompt[] = [];
  warmupReady = false;

  invalidate(): void {
    this.generation += 1;
    this.systemPromptsCache = [];
    this.warmupReady = false;
  }

  get extensionsLoading(): boolean {
    return this.loadingCount > 0;
  }

  schedule(trigger: ExtensionWarmupTrigger, callbacks: ExtensionWarmupCallbacks): void {
    const generation = ++this.generation;
    void this.runWarmup(generation, trigger, callbacks);
  }

  async refreshSystemPromptsCache(
    callbacks: Pick<ExtensionWarmupCallbacks, 'collectSystemPrompts'>,
  ): Promise<void> {
    this.systemPromptsCache = await callbacks.collectSystemPrompts();
    this.warmupReady = true;
  }

  private async runWarmup(
    generation: number,
    trigger: ExtensionWarmupTrigger,
    callbacks: ExtensionWarmupCallbacks,
  ): Promise<void> {
    this.loadingCount += 1;
    try {
      const prompts = await callbacks.collectSystemPrompts();
      if (generation !== this.generation) {
        return;
      }
      this.systemPromptsCache = prompts;
      this.warmupReady = true;

      await callbacks.refreshExtensionsListFull();
      if (generation !== this.generation) {
        return;
      }

      if (trigger.type === 'startup') {
        await callbacks.dispatchEvent({
          type: 'onStartup',
          detail: { workspaceRoot: trigger.workspaceRoot },
        });
      } else {
        await callbacks.dispatchEvent(trigger.event);
      }
      if (generation !== this.generation) {
        return;
      }

      await callbacks.applyWarmupToRuntime();
    } finally {
      this.loadingCount -= 1;
      callbacks.emitSnapshotUpdate();
    }
  }
}
