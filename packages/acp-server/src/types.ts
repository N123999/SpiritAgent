import type { AgentRuntime, LlmActiveSkill, LlmEnabledSkillCatalogEntry, LlmTransportConfig, SpiritAgentMode } from '@spirit-agent/core';
import type { HostToolExecutorProxy } from '@spirit-agent/core/host-bridge';
import type { JsonValue } from '@spirit-agent/core';

/**
 * ACP Server runtime paths. LLM transport is resolved from shared Spirit config + keyring.
 */
export interface AcpServerConfig {
  /** Workspace root path (default: process.cwd()) */
  workspaceRoot: string;
  /** Spirit data directory (default: APPDATA/SpiritAgent or ~/.spirit-agent) */
  spiritDataDir: string;
}

/**
 * Per-session state for an ACP session.
 */
export interface AcpSessionState {
  readonly sessionId: string;
  readonly runtime: AgentRuntime<LlmTransportConfig, unknown, JsonValue, JsonValue>;
  readonly toolExecutor: HostToolExecutorProxy;
  readonly workspaceRoot: string;
  currentMode: SpiritAgentMode;
  /** AbortController for the currently running prompt turn (null if idle) */
  pendingPrompt: AbortController | null;
  /** Mutable active skills array — shared with runtime factory closures */
  readonly activeSkills: LlmActiveSkill[];
  /** Skill catalog entries discovered at session creation */
  readonly enabledSkillCatalog: LlmEnabledSkillCatalogEntry[];
  /** Switch agent mode: updates tool exposure + system prompt planMetadata */
  readonly setAgentMode: (mode: SpiritAgentMode) => Promise<void>;
}

/**
 * Available ACP session modes advertised by Spirit Agent.
 */
export const AVAILABLE_MODES = [
  { id: 'agent' as const, name: 'Agent', description: 'Full tool access, autonomous coding' },
  { id: 'plan' as const, name: 'Plan', description: 'Design and plan without making changes' },
  { id: 'ask' as const, name: 'Ask', description: 'Ask permission before every change' },
  { id: 'debug' as const, name: 'Debug', description: 'Systematic bug investigation' },
] as const;

/**
 * Maps an ACP mode ID string to a SpiritAgentMode, with fallback to 'agent'.
 */
export function normalizeModeId(modeId: string): SpiritAgentMode {
  switch (modeId) {
    case 'agent':
    case 'plan':
    case 'ask':
    case 'debug':
      return modeId;
    default:
      return 'agent';
  }
}
