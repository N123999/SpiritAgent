import type { JsonObject, JsonValue } from '../ports.js';

export const HOOK_CONFIG_VERSION = 1 as const;
export const HOOKS_CONFIG_FILE_NAME = 'hooks.json';
export const DEFAULT_HOOK_TIMEOUT_SECONDS = 30;

export const HOOK_EVENT_NAMES = [
  'sessionStart',
  'sessionEnd',
  'submitPrompt',
  'preToolUse',
  'postToolUse',
  'subagentStart',
  'subagentEnd',
] as const;

export type HookEventName = (typeof HOOK_EVENT_NAMES)[number];
export type HookPermission = 'allow' | 'deny';
export type HookConfigScope = 'user' | 'workspace';

export interface HookDefinition {
  command: string;
  timeout?: number;
  failClosed?: boolean;
  matcher?: string;
}

export interface HooksConfigFile {
  version: typeof HOOK_CONFIG_VERSION;
  hooks: Partial<Record<HookEventName, HookDefinition[]>>;
}

export interface ResolvedHookDefinition extends HookDefinition {
  scope: HookConfigScope;
  configDir: string;
}

export interface HookCommonInput {
  hookEventName: HookEventName;
  sessionId: string | undefined;
  conversationPath: string | null | undefined;
  workspaceRoot: string | undefined;
  model: string | undefined;
  timestamp: string;
}

export interface SessionStartHookInput extends HookCommonInput {
  hookEventName: 'sessionStart';
  source: 'startup' | 'resume' | 'open';
}

export interface SessionEndHookInput extends HookCommonInput {
  hookEventName: 'sessionEnd';
  reason: 'abort' | 'close' | 'switch';
}

export interface SubmitPromptHookInput extends HookCommonInput {
  hookEventName: 'submitPrompt';
  prompt: string;
  messageId: string | undefined;
}

export interface PreToolUseHookInput extends HookCommonInput {
  hookEventName: 'preToolUse';
  toolName: string;
  toolCallId: string;
  toolInput: JsonObject;
}

export interface PostToolUseHookInput extends HookCommonInput {
  hookEventName: 'postToolUse';
  toolName: string;
  toolCallId: string;
  toolInput: JsonObject;
  toolOutput: string;
  durationMs: number;
  failed: boolean | undefined;
}

export interface SubagentStartHookInput extends HookCommonInput {
  hookEventName: 'subagentStart';
  subagentSessionId: string;
  subagentType: string;
  task: string;
}

export interface SubagentEndHookInput extends HookCommonInput {
  hookEventName: 'subagentEnd';
  subagentSessionId: string;
  subagentType: string;
  status: 'completed' | 'error' | 'aborted';
  task: string;
  summary: string | undefined;
  modifiedFiles: string[] | undefined;
}

export type HookInput =
  | SessionStartHookInput
  | SessionEndHookInput
  | SubmitPromptHookInput
  | PreToolUseHookInput
  | PostToolUseHookInput
  | SubagentStartHookInput
  | SubagentEndHookInput;

export interface HookCommandOutput {
  permission?: HookPermission;
  userMessage?: string;
  agentMessage?: string;
  updatedInput?: JsonObject;
  additionalContext?: string;
  followupMessage?: string;
}

export interface HookExecutionRecord {
  definition: ResolvedHookDefinition;
  exitCode: number | null;
  stdout: HookCommandOutput | null;
  stderr: string;
  timedOut: boolean;
  failed: boolean;
}

export interface HookRunResult {
  records: HookExecutionRecord[];
  denied: boolean;
  userMessage: string | undefined;
  agentMessage: string | undefined;
  updatedInput: JsonObject | undefined;
  additionalContexts: string[];
  followupMessage: string | undefined;
}

export interface HookRunnerContext {
  spiritDataDir: string;
  workspaceRoot: string | undefined;
}

export interface HookSessionContext {
  sessionId: string | undefined;
  conversationPath: string | null | undefined;
  workspaceRoot: string | undefined;
  model: string | undefined;
}

export interface HookRunner {
  runSessionStart(input: Omit<SessionStartHookInput, 'hookEventName' | 'timestamp'>): Promise<HookRunResult>;
  runSessionEnd(input: Omit<SessionEndHookInput, 'hookEventName' | 'timestamp'>): Promise<HookRunResult>;
  runSubmitPrompt(input: Omit<SubmitPromptHookInput, 'hookEventName' | 'timestamp'>): Promise<HookRunResult>;
  runPreToolUse(input: Omit<PreToolUseHookInput, 'hookEventName' | 'timestamp'>): Promise<HookRunResult>;
  runPostToolUse(input: Omit<PostToolUseHookInput, 'hookEventName' | 'timestamp'>): Promise<HookRunResult>;
  runSubagentStart(input: Omit<SubagentStartHookInput, 'hookEventName' | 'timestamp'>): Promise<HookRunResult>;
  runSubagentEnd(input: Omit<SubagentEndHookInput, 'hookEventName' | 'timestamp'>): Promise<HookRunResult>;
}

export function emptyHookRunResult(): HookRunResult {
  return {
    records: [],
    denied: false,
    userMessage: undefined,
    agentMessage: undefined,
    updatedInput: undefined,
    additionalContexts: [],
    followupMessage: undefined,
  };
}

export function isPreHookEvent(event: HookEventName): boolean {
  return (
    event === 'submitPrompt'
    || event === 'preToolUse'
    || event === 'subagentStart'
  );
}

export function hookMatcherTarget(input: HookInput): string | undefined {
  switch (input.hookEventName) {
    case 'preToolUse':
    case 'postToolUse':
      return input.toolName;
    case 'subagentStart':
    case 'subagentEnd':
      return input.subagentType;
    default:
      return undefined;
  }
}

export function serializeHookInput(input: HookInput): JsonValue {
  return input as unknown as JsonValue;
}
