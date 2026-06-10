import type { JsonValue, RuntimeEvent, SpiritAgentMode } from '@spirit-agent/core';
import type { HostToolExecutorProxy } from '@spirit-agent/core/host-bridge';
import type { AcpServerConfig, AcpSessionState } from './types.js';
import { AVAILABLE_MODES, normalizeModeId } from './types.js';
import { createAcpRuntime, type AcpHostRuntime, type AcpRuntimeResult } from './runtime-factory.js';

/**
 * Manages ACP sessions, each backed by an independent AgentRuntime instance.
 */
export class SessionManager {
  private readonly sessions = new Map<string, AcpSessionState>();
  private readonly globalConfig: AcpServerConfig;

  constructor(config: AcpServerConfig) {
    this.globalConfig = config;
  }

  /**
   * Creates a new session with its own AgentRuntime.
   */
  async createSession(
    workspaceRoot: string,
    onEvent: (sessionId: string, event: RuntimeEvent<JsonValue>) => void,
    initialMode: SpiritAgentMode = 'agent',
  ): Promise<{ sessionId: string; modes: typeof AVAILABLE_MODES }> {
    const sessionId = generateSessionId();

    const sessionConfig: AcpServerConfig = {
      ...this.globalConfig,
      workspaceRoot,
    };

    const result: AcpRuntimeResult = await createAcpRuntime(
      sessionConfig,
      (event) => onEvent(sessionId, event),
      initialMode,
    );

    this.sessions.set(sessionId, {
      sessionId,
      runtime: result.runtime,
      toolExecutor: result.toolExecutor,
      workspaceRoot,
      currentMode: initialMode,
      pendingPrompt: null,
    });

    return {
      sessionId,
      modes: AVAILABLE_MODES,
    };
  }

  /**
   * Retrieves an existing session by ID.
   */
  getSession(sessionId: string): AcpSessionState | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Requires a session to exist, throws otherwise.
   */
  requireSession(sessionId: string): AcpSessionState {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }
    return session;
  }

  /**
   * Closes a session, aborting any pending work and freeing resources.
   */
  async closeSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }

    // Abort any pending prompt turn
    if (session.pendingPrompt) {
      session.pendingPrompt.abort();
      session.pendingPrompt = null;
    }

    // Abort the runtime
    session.runtime.abort();

    this.sessions.delete(sessionId);
  }

  /**
   * Switches the mode for a session.
   */
  setSessionMode(sessionId: string, modeId: string): SpiritAgentMode {
    const session = this.requireSession(sessionId);
    const mode = normalizeModeId(modeId);
    session.toolExecutor.setAgentModeToolExposure(mode);
    session.currentMode = mode;
    return mode;
  }
}

/**
 * Generates a unique session ID.
 */
function generateSessionId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return 'sess_' + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
