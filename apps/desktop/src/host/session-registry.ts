import type { ConversationMessageSnapshot } from '../types.js';
import type { DesktopTimelineTurnSnapshot, DesktopMessageTimeline } from './message-timeline.js';
import {
  createEmptySessionBundle,
  resetSessionBundleInPlace,
  sessionBundleFromRestored,
  type SessionBundle,
} from './session-bundle.js';
import type { RestoredSessionState } from './sessions.js';

const MAX_LOADED_BUNDLES = 8;

export class SessionRegistry {
  private readonly bundles = new Map<string, SessionBundle>();
  private activeId: string | undefined;

  hasActive(): boolean {
    return this.activeId !== undefined && this.bundles.has(this.activeId);
  }

  getActive(): SessionBundle | undefined {
    if (!this.activeId) {
      return undefined;
    }
    return this.bundles.get(this.activeId);
  }

  requireActive(): SessionBundle {
    const bundle = this.getActive();
    if (!bundle) {
      throw new Error('当前没有活跃会话。');
    }
    return bundle;
  }

  get(id: string): SessionBundle | undefined {
    return this.bundles.get(id);
  }

  activeSessionId(): string | undefined {
    return this.activeId;
  }

  all(): Iterable<SessionBundle> {
    return this.bundles.values();
  }

  allBusy(isBusy: (bundle: SessionBundle) => boolean): SessionBundle[] {
    return [...this.bundles.values()].filter((bundle) => isBusy(bundle));
  }

  ensureDraft(workspaceRoot: string): SessionBundle {
    const existing = this.getActive();
    if (existing) {
      existing.workspaceRoot = workspaceRoot;
      return existing;
    }
    const bundle = createEmptySessionBundle(workspaceRoot);
    this.bundles.set(bundle.id, bundle);
    this.activeId = bundle.id;
    return bundle;
  }

  setActive(id: string): SessionBundle {
    const bundle = this.bundles.get(id);
    if (!bundle) {
      throw new Error('会话不存在或已卸载。');
    }
    this.activeId = id;
    return bundle;
  }

  upsertFromRestored(
    workspaceRoot: string,
    restored: RestoredSessionState,
    createTimeline: (
      messages: ConversationMessageSnapshot[],
      timelineSnapshot?: DesktopTimelineTurnSnapshot[],
    ) => DesktopMessageTimeline,
  ): SessionBundle {
    const id = restored.activeSession.filePath;
    const existing = this.bundles.get(id);
    if (existing) {
      this.applyRestoredToBundle(existing, workspaceRoot, restored, createTimeline);
      this.activeId = id;
      return existing;
    }
    this.evictIfNeeded();
    const bundle = sessionBundleFromRestored(workspaceRoot, restored, createTimeline);
    this.bundles.set(id, bundle);
    this.activeId = id;
    return bundle;
  }

  replaceActiveWithRestored(
    workspaceRoot: string,
    restored: RestoredSessionState,
    createTimeline: (
      messages: ConversationMessageSnapshot[],
      timelineSnapshot?: DesktopTimelineTurnSnapshot[],
    ) => DesktopMessageTimeline,
  ): SessionBundle {
    const id = restored.activeSession.filePath;
    const bundle = sessionBundleFromRestored(workspaceRoot, restored, createTimeline);
    this.bundles.set(id, bundle);
    this.activeId = id;
    return bundle;
  }

  resetActive(workspaceRoot: string): SessionBundle {
    const bundle = this.ensureDraft(workspaceRoot);
    resetSessionBundleInPlace(bundle);
    bundle.workspaceRoot = workspaceRoot;
    return bundle;
  }

  /** New empty foreground session; prior bundles (including busy runs) stay loaded. */
  beginNewActive(workspaceRoot: string): SessionBundle {
    const id = `__draft__${Date.now()}`;
    const bundle = createEmptySessionBundle(workspaceRoot, id);
    this.evictIfNeeded();
    this.bundles.set(id, bundle);
    this.activeId = id;
    return bundle;
  }

  isBundleBusy(bundle: SessionBundle): boolean {
    return bundle.runtime?.isBusy() === true;
  }

  clear(): void {
    this.bundles.clear();
    this.activeId = undefined;
  }

  clearForWorkspaceSwitch(workspaceRoot: string): SessionBundle {
    this.clear();
    return this.ensureDraft(workspaceRoot);
  }

  private applyRestoredToBundle(
    bundle: SessionBundle,
    workspaceRoot: string,
    restored: RestoredSessionState,
    createTimeline: (
      messages: ConversationMessageSnapshot[],
      timelineSnapshot?: DesktopTimelineTurnSnapshot[],
    ) => DesktopMessageTimeline,
  ): void {
    bundle.id = restored.activeSession.filePath;
    bundle.workspaceRoot = workspaceRoot;
    bundle.activeSession = restored.activeSession;
    bundle.messages = restored.messages;
    bundle.messageTimeline = createTimeline(
      restored.messages,
      restored.desktopMessageTimeline,
    );
    bundle.archiveHistory = restored.archiveHistory;
    bundle.archiveSubagentSessions = restored.archiveSubagentSessions;
    bundle.loopEnabled = restored.loopEnabled;
    bundle.rewind = restored.rewind;
    bundle.rewindWarnings = [];
    bundle.messageIdCounter = restored.messages.length > 0
      ? Math.max(0, ...restored.messages.map((message) => message.id)) + 1
      : 1;
    bundle.currentTurnSkills = [];
    bundle.pendingUnboundFileChangeIds = [];
    bundle.nextTimelineAssistantSegmentKind = 'initial';
    bundle.deferredRuntimeRefreshWhileBusy = false;
  }

  private evictIfNeeded(): void {
    if (this.bundles.size < MAX_LOADED_BUNDLES) {
      return;
    }
    for (const [id] of this.bundles) {
      if (id !== this.activeId) {
        this.bundles.delete(id);
        if (this.bundles.size < MAX_LOADED_BUNDLES) {
          return;
        }
      }
    }
  }
}
