import type * as acp from '@agentclientprotocol/sdk';
import type * as schema from '@agentclientprotocol/sdk';
import type { JsonValue, RuntimeEvent } from '@spirit-agent/core';
import { AVAILABLE_MODES } from './types.js';
import type { AcpServerConfig } from './types.js';
import { SessionManager } from './session-manager.js';
import { mapRuntimeEventToUpdate, createEventMapperState, type EventMapperState } from './event-mapper.js';
import { handleApprovalRequest, handleQuestionsRequest } from './permission-bridge.js';
import { buildAvailableCommands, parseSlashCommand, buildActiveSkillPayload, upsertActiveSkill } from './skill-bridge.js';
import { extractPromptImages } from './prompt-images.js';

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
  /** Per-session prompt generation counter to prevent stale turn results */
  private readonly promptGenerations = new Map<string, number>();

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

    // Advertise available slash commands from skill catalog.
    // IMPORTANT: Defer to after the session/new response is sent.
    // If we await or even fire-and-forget the notification here, the SDK's
    // internal message queue may send it before the session/new response,
    // causing Zed to discard it (session ID not yet known to the client).
    const commands = buildAvailableCommands(result.enabledSkillCatalog);
    if (commands.length > 0) {
      const sessionId = result.sessionId;
      setTimeout(() => {
        this.connection.sessionUpdate({
          sessionId,
          update: {
            sessionUpdate: 'available_commands_update',
            availableCommands: commands,
          },
        } as unknown as schema.SessionNotification).catch((err) => {
          console.error('Failed to send available commands:', err);
        });
      }, 0);
    }

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
    const mode = await this.sessionManager.setSessionMode(params.sessionId, params.modeId);

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
    // Also abort the runtime to stop streaming/tool execution and release isBusy()
    if (session.runtime.isBusy()) {
      session.runtime.abort();
    }
    session.pendingPrompt = new AbortController();

    // Increment generation so stale prompt completions are discarded
    const generation = (this.promptGenerations.get(params.sessionId) ?? 0) + 1;
    this.promptGenerations.set(params.sessionId, generation);

    // Extract text from prompt content blocks
    let userInput = extractPromptText(params.prompt);

    // Detect slash command and activate skill if matched
    const parsed = parseSlashCommand(userInput);
    if (parsed) {
      const entry = session.enabledSkillCatalog.find((s) => s.name === parsed.skillName);
      if (entry) {
        try {
          const payload = await buildActiveSkillPayload(entry);
          upsertActiveSkill(session.activeSkills, payload);
          userInput = parsed.remainingText
            || `Please follow the activated skill "${parsed.skillName}" to handle the current task.`;
        } catch (err) {
          console.error(`Failed to activate skill "${parsed.skillName}":`, err);
        }
      }
    }

    // Reset thinking delta tracker for the new prompt turn
    this.mapperStates.set(params.sessionId, createEventMapperState());

    try {
      // Extract images from content blocks
      const { paths: explicitImages, cleanup: cleanupImages } = await extractPromptImages(params.prompt);

      try {
        // Use streaming start so onEvent fires real-time chunks
        await session.runtime.startUserTurnStreaming(userInput, explicitImages);
        const result = await session.runtime.waitForCompletedTurnResult();

        // Check if a newer prompt has superseded this one
        if (this.promptGenerations.get(params.sessionId) !== generation) {
          return { stopReason: 'cancelled' };
        }

        session.pendingPrompt = null;

        // Map turn result to stop reason
        if (result.kind === 'failed') {
          return { stopReason: 'refusal' };
        }

        return { stopReason: 'end_turn' };
      } finally {
        // Clean up temp files after the entire turn completes (LLM may still
        // read image files during processing between start and completion)
        cleanupImages().catch(() => {});
      }
    } catch (err) {
      // Stale generation — a newer prompt took over, treat as cancelled
      if (this.promptGenerations.get(params.sessionId) !== generation) {
        return { stopReason: 'cancelled' };
      }

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
          // The pending approval may have been cleared by cancel/abort
          // in the meantime. Catch the rejection to avoid unhandled errors.
          session.runtime.continuePendingApproval(decision).catch(() => {});
        }).catch((err) => {
          console.error('Permission request failed:', err);
          session.runtime.continuePendingApproval({
            kind: 'deny',
            resultText: 'Permission request failed.',
          }).catch(() => {});
        });
      }
      return;
    }

    // Handle questions-requested by degrading to permission prompt (MVP)
    if (event.kind === 'questions-requested') {
      const session = this.sessionManager.getSession(sessionId);
      if (session) {
        // RuntimePendingQuestions has nested .questions (AskQuestionsRequest) with .title
        const pending = event.questions as unknown as {
          questions?: { title?: string };
          toolName?: string;
        };
        const description = pending.questions?.title
          ?? pending.toolName
          ?? 'The agent needs additional input.';
        handleQuestionsRequest(
          this.connection,
          sessionId,
          { prompt: description },
        ).then((allowed) => {
          if (allowed) {
            session.runtime.resumePendingQuestions({
              status: 'answered',
              answers: [],
            }).catch((err) => {
              console.error('Failed to resume questions:', err);
            });
          } else {
            session.runtime.resumePendingQuestions({
              status: 'skipped',
            }).catch((err) => {
              console.error('Failed to skip questions:', err);
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
