import type * as acp from '@agentclientprotocol/sdk';
import type * as schema from '@agentclientprotocol/sdk';
import type { JsonValue, RuntimeEvent } from '@spirit-agent/core';
import { AVAILABLE_MODES } from './types.js';
import type { AcpServerConfig } from './types.js';
import { SessionManager } from './session-manager.js';
import { mapRuntimeEventToUpdate, createEventMapperState, type EventMapperState } from './event-mapper.js';
import { handleApprovalRequest, handleQuestionsRequest } from './permission-bridge.js';

/**
 * Spirit Agent implementation of the ACP Agent interface.
 *
 * Bridges ACP JSON-RPC messages to AgentRuntime calls.
 */
export class SpiritAcpAgent implements acp.Agent {
  private readonly connection: acp.AgentSideConnection;
  private readonly config: AcpServerConfig;
  private readonly sessionManager: SessionManager;
  /** Per-session event mapper state for tracking streaming deltas */
  private readonly mapperStates = new Map<string, EventMapperState>();

  constructor(connection: acp.AgentSideConnection, config: AcpServerConfig) {
    this.connection = connection;
    this.config = config;
    this.sessionManager = new SessionManager(config);
  }

  async initialize(
    _params: schema.InitializeRequest,
  ): Promise<schema.InitializeResponse> {
    return {
      protocolVersion: 1, // PROTOCOL_VERSION
      agentCapabilities: {
        loadSession: false,
        promptCapabilities: {
          image: true,
        },
        sessionCapabilities: {
          close: {},
        },
      },
      agentInfo: {
        name: 'spirit-agent',
        title: 'Spirit Agent',
        version: '0.1.0',
      },
      authMethods: [],
    };
  }

  async newSession(
    params: schema.NewSessionRequest,
  ): Promise<schema.NewSessionResponse> {
    const workspaceRoot = params.cwd;

    const result = await this.sessionManager.createSession(
      workspaceRoot,
      (sessionId, event) => this.handleRuntimeEvent(sessionId, event),
    );

    // Create fresh mapper state for this session
    this.mapperStates.set(result.sessionId, createEventMapperState());

    return {
      sessionId: result.sessionId,
      modes: {
        currentModeId: 'agent',
        availableModes: AVAILABLE_MODES.map((m) => ({
          id: m.id,
          name: m.name,
          description: m.description,
        })),
      },
    };
  }

  async authenticate(
    _params: schema.AuthenticateRequest,
  ): Promise<schema.AuthenticateResponse | void> {
    // Authentication is handled via environment variables (SPIRIT_ACP_API_KEY)
    return {};
  }

  async setSessionMode(
    params: schema.SetSessionModeRequest,
  ): Promise<schema.SetSessionModeResponse | void> {
    const mode = this.sessionManager.setSessionMode(params.sessionId, params.modeId);

    // Notify client of mode change
    await this.connection.sessionUpdate({
      sessionId: params.sessionId,
      update: {
        sessionUpdate: 'current_mode_update',
        currentModeId: mode,
      },
    } as unknown as schema.SessionNotification);

    return {};
  }

  async prompt(params: schema.PromptRequest): Promise<schema.PromptResponse> {
    const session = this.sessionManager.requireSession(params.sessionId);

    // Abort any previous pending prompt
    session.pendingPrompt?.abort();
    session.pendingPrompt = new AbortController();

    // Extract text from prompt content blocks
    const userInput = extractPromptText(params.prompt);

    // Reset thinking delta tracker for the new prompt turn
    this.mapperStates.set(params.sessionId, createEventMapperState());

    try {
      // Use streaming start so onEvent fires real-time chunks
      await session.runtime.startUserTurnStreaming(userInput);
      const result = await session.runtime.waitForCompletedTurnResult();

      session.pendingPrompt = null;

      // Map turn result to stop reason
      if (result.kind === 'failed') {
        return { stopReason: 'refusal' };
      }

      return { stopReason: 'end_turn' };
    } catch (err) {
      const aborted = session.pendingPrompt?.signal.aborted ?? false;
      session.pendingPrompt = null;

      if (aborted) {
        return { stopReason: 'cancelled' };
      }

      // Re-throw unexpected errors
      throw err;
    }
  }

  async cancel(params: schema.CancelNotification): Promise<void> {
    const session = this.sessionManager.getSession(params.sessionId);
    if (!session) {
      return;
    }

    // Abort the pending prompt
    session.pendingPrompt?.abort();

    // Abort the runtime
    session.runtime.abort();
  }

  async closeSession(
    params: schema.CloseSessionRequest,
  ): Promise<schema.CloseSessionResponse | void> {
    await this.sessionManager.closeSession(params.sessionId);
    this.mapperStates.delete(params.sessionId);
    return {};
  }

  /**
   * Handles runtime events by forwarding them to the ACP client.
   * For approval-requested events, triggers the permission bridge.
   */
  private handleRuntimeEvent(sessionId: string, event: RuntimeEvent<JsonValue>): void {
    // Handle approval requests asynchronously
    if (event.kind === 'approval-requested') {
      const session = this.sessionManager.getSession(sessionId);
      if (session) {
        // Fire-and-forget: request permission, then continue approval
        handleApprovalRequest(
          this.connection,
          sessionId,
          event.approval as any,
        ).then((decision) => {
          session.runtime.continuePendingApproval(decision);
        }).catch((err) => {
          console.error('Permission request failed:', err);
          session.runtime.continuePendingApproval({
            kind: 'deny',
            resultText: 'Permission request failed.',
          });
        });
      }
      return;
    }

    // Handle questions-requested by degrading to permission prompt (MVP)
    if (event.kind === 'questions-requested') {
      const session = this.sessionManager.getSession(sessionId);
      if (session) {
        const questions = event.questions as unknown as { prompt?: string; questions?: unknown[] };
        handleQuestionsRequest(
          this.connection,
          sessionId,
          questions,
        ).then((allowed) => {
          if (allowed) {
            session.runtime.resumePendingQuestions({
              kind: 'answered',
              answers: {},
            } as any).catch((err) => {
              console.error('Failed to resume questions:', err);
            });
          } else {
            session.runtime.resumePendingQuestions({
              kind: 'cancelled',
            } as any).catch((err) => {
              console.error('Failed to cancel questions:', err);
            });
          }
        }).catch((err) => {
          console.error('Questions request failed:', err);
        });
      }
      return;
    }

    // Forward other events to ACP client
    let mapperState = this.mapperStates.get(sessionId);
    if (!mapperState) {
      mapperState = createEventMapperState();
      this.mapperStates.set(sessionId, mapperState);
    }
    const update = mapRuntimeEventToUpdate(event, sessionId, mapperState);
    if (update) {
      this.connection.sessionUpdate(update).catch((err) => {
        console.error('Failed to send session update:', err);
      });
    }
  }
}

/**
 * Extracts text content from ACP prompt content blocks.
 */
function extractPromptText(prompt: schema.ContentBlock[]): string {
  const parts: string[] = [];

  for (const block of prompt) {
    if (block.type === 'text') {
      parts.push(block.text);
    } else if (block.type === 'resource' && 'text' in block.resource) {
      const resource = block.resource as { uri?: string; text?: string };
      parts.push(`[File: ${resource.uri ?? 'unknown'}]\n${resource.text ?? ''}`);
    } else if (block.type === 'resource_link') {
      const link = block as { uri?: string; name?: string };
      parts.push(`[Link: ${link.name ?? link.uri ?? 'unknown'}]`);
    }
  }

  return parts.join('\n\n');
}
