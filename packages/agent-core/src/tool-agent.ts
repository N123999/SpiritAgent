import {
  cloneLlmProviderState,
  cloneLlmMessageContent,
  createLlmMessageContentFromText,
  llmMessageHasImages,
  llmMessageHasVideos,
  llmMessageTextContent,
  type JsonObject,
  type JsonValue,
  type LlmMessage,
  type SpiritAgentMode,
  type ToolCallRequest,
  normalizeSpiritAgentMode,
} from './ports.js';
import type { ToolAgentMcpToolCatalogSnapshot } from './mcp/types.js';

const TOOL_OUTPUT_RETRY_MAX_CHARS = 12_000;
const TOOL_TRUNCATION_HEAD_RATIO_NUM = 2;
const TOOL_TRUNCATION_HEAD_RATIO_DEN = 3;
const RULES_SECTION_PREFIX = '[SPIRIT_RULES]';
const SKILLS_CATALOG_SECTION_PREFIX = '[SPIRIT_SKILLS_CATALOG]';
const MCP_CATALOG_SECTION_PREFIX = '[SPIRIT_MCP_CATALOG]';
const AGENT_MODE_SECTION_PREFIX = '[SPIRIT_AGENT_MODE]';
const LOOP_MODE_SECTION_PREFIX = '[SPIRIT_LOOP_MODE]';
const EXTENSIONS_SECTION_PREFIX = '[SPIRIT_EXTENSIONS]';
const DREAMS_SECTION_PREFIX = '[SPIRIT_DREAMS]';
const BASIC_INFO_SECTION_PREFIX = '[SPIRIT_BASIC_INFO]';

export const COMPACT_SUMMARY_PREFIX = '[SPIRIT_COMPACT_SUMMARY]';

export const PRE_COMPACTION_ARCHIVE_READ_FILE_GUIDANCE =
  'Important details may be recovered by reading this file with read_file.';

export const TOOL_OUTPUT_ARCHIVE_READ_FILE_GUIDANCE =
  'Use read_file on that path only when you need omitted details.';

export const TOOL_OUTPUT_TRUNCATION_LABEL = '[tool output truncated for context retry]';

const PRE_COMPACTION_ARCHIVE_EXAMPLE_PATH =
  '/path/to/compaction-archives/pre-compact-session-1234567890.json';

const COMPACT_HISTORY_OUTPUT_TEMPLATE_WITHOUT_ARCHIVE = `[Session Overview]
<Summarize the current task and overall progress in 1–2 sentences>

[User Messages]
<Full verbatim text of user message 1, one message per line>
<Full verbatim text of user message 2, one message per line>
<Full verbatim text of user message 3, one message per line>
(List every user message from the input conversation, one per line, in chronological order)

[Goals and Constraints]
- <User goals or priorities>
- <Hard constraints: tech stack, paths, style, etc.>
- <Explicit prohibitions or must-follow rules>

[Confirmed Facts]
- <Conclusions verified by tools or mutually confirmed>
- <Key files, configs, command output highlights>

[Failed Attempts]
- <Approaches tried but proven infeasible or incorrect, and why>

[Open Items]
- <Remaining work, questions awaiting user confirmation, blockers>`;

const COMPACT_HISTORY_ARCHIVE_OUTPUT_SECTION = `[Pre-compaction Archive]
<the archive absolute path on this line>
Important details may be recovered by reading this file with read_file.`;

const COMPACT_HISTORY_OUTPUT_TEMPLATE = `${COMPACT_HISTORY_OUTPUT_TEMPLATE_WITHOUT_ARCHIVE}

${COMPACT_HISTORY_ARCHIVE_OUTPUT_SECTION}`;

const PRE_COMPACTION_ARCHIVE_HARD_REQUIREMENT = `6. The [Pre-compaction Archive] section must contain exactly three lines: the section title, then the archive absolute path alone on the next line, then this exact guidance sentence on the following line: ${PRE_COMPACTION_ARCHIVE_READ_FILE_GUIDANCE} Do not output only the path.`;

function buildCompactHistorySystemPromptCore(includeArchiveSection: boolean): string {
  const hardRequirements = [
    '1. Output must strictly follow the section titles, order, and hierarchy in the output template; do not add, remove, or rename sections.',
    '2. The [User Messages] section must include every user message from the input conversation: one message per line, in order of appearance, preserving original wording; do not omit, merge, paraphrase, or rewrite. You may append [images attached] / [videos attached] annotations only when a message is extremely long.',
    '3. For sections other than [User Messages], summarize in concise bullet points, preserving decision rationale and verifiable details; avoid vague repetition.',
    '4. Omit small talk, thanks, repeated explanations, and low-information back-and-forth confirmations.',
    '5. Output only the summary body; do not wrap it in markdown code fences; do not add explanations, preambles, or closings.',
    ...(includeArchiveSection ? [PRE_COMPACTION_ARCHIVE_HARD_REQUIREMENT] : []),
  ];

  return [
    'Compress the following conversation into a reusable system summary for later turns.',
    '',
    'Hard requirements:',
    ...hardRequirements,
    '',
    'When summarizing, preserve: user goals, key constraints, verified conclusions, failed attempts, and open items.',
    '',
    'Output template:',
    '',
    includeArchiveSection
      ? COMPACT_HISTORY_OUTPUT_TEMPLATE
      : COMPACT_HISTORY_OUTPUT_TEMPLATE_WITHOUT_ARCHIVE,
  ].join('\n');
}

export function buildCompactHistorySystemPrompt(preCompactionArchivePath?: string): string {
  const normalizedPath = preCompactionArchivePath?.trim();
  if (!normalizedPath) {
    return buildCompactHistorySystemPromptCore(false);
  }

  return [
    buildCompactHistorySystemPromptCore(true),
    '',
    'Example [Pre-compaction Archive] section shape (use the real archive path from below, not this placeholder path):',
    '',
    '[Pre-compaction Archive]',
    PRE_COMPACTION_ARCHIVE_EXAMPLE_PATH,
    PRE_COMPACTION_ARCHIVE_READ_FILE_GUIDANCE,
    '',
    `Archive path for this compression (use this exact path on the archive line): ${normalizedPath}`,
  ].join('\n');
}

export const COMPACT_HISTORY_SYSTEM_PROMPT = buildCompactHistorySystemPrompt();

export function buildCompactHistoryUserPrompt(history: LlmMessage[]): string {
  return history
    .map((message) => {
      const text = llmMessageTextContent(message.content);
      const mediaNote = llmMessageHasImages(message.content)
        ? '\n[images attached]'
        : llmMessageHasVideos(message.content)
          ? '\n[videos attached]'
          : '';
      return `${message.role.toUpperCase()}: ${text}${mediaNote}`;
    })
    .join('\n\n');
}

export interface BuildCompactHistoryPromptMessagesOptions {
  preCompactionArchivePath?: string;
}

export function buildCompactHistoryPromptMessages(
  history: LlmMessage[],
  options: BuildCompactHistoryPromptMessagesOptions = {},
): Array<{ role: 'system' | 'user'; content: string }> {
  return [
    {
      role: 'system',
      content: buildCompactHistorySystemPrompt(options.preCompactionArchivePath),
    },
    { role: 'user', content: buildCompactHistoryUserPrompt(history) },
  ];
}

export interface ToolAgentEnabledRule {
  id: string;
  scope: 'workspace' | 'user';
  title: string;
  path: string;
  content: string;
}

export interface ToolAgentEnabledSkillCatalogEntry {
  id: string;
  scope: 'workspace' | 'user';
  name: string;
  description: string;
  path: string;
}

export type {
  ToolAgentMcpToolCatalogServerEntry,
  ToolAgentMcpToolCatalogSnapshot,
  ToolAgentMcpToolCatalogToolEntry,
} from './mcp/types.js';

export interface ToolAgentActiveSkillResourceEntry {
  kind: string;
  path: string;
}

export interface ToolAgentActiveSkill {
  id: string;
  scope: 'workspace' | 'user';
  name: string;
  description: string;
  path: string;
  content: string;
  truncated: boolean;
  resources: ToolAgentActiveSkillResourceEntry[];
  resourcesTruncated: boolean;
}

export interface ToolAgentPlanMetadata {
  path: string;
  exists: boolean;
  agentMode?: SpiritAgentMode;
  /** @deprecated Use agentMode. Still accepted from older hosts. */
  planMode?: boolean;
}

export interface ToolAgentExtensionSystemPrompt {
  extensionId: string;
  extensionName: string;
  content: string;
}

export interface ToolAgentSystemInfo {
  name: string;
  version: string;
}

export interface ToolAgentBasicInfo {
  workspaceRoot?: string;
  terminal?: string;
  system?: ToolAgentSystemInfo;
  gitBranch?: string;
}

export interface ToolAgentState {
  messages: JsonValue[];
  steps: number;
}

export interface ToolAgentToolResult {
  toolCallId: string;
  content: string;
  providerState?: JsonObject;
}

export function buildSpiritAgentCoreHostPrompt(model: string): string {
  const trimmed = model.trim();
  const modelLabel = trimmed.length > 0 ? trimmed : '(not configured)';
  return [
    'You are Spirit Agent.',
    `The user\'s model is: ${modelLabel}.`,
    'Keep a neutral, matter-of-fact tone unless the user\'s enabled rules explicitly ask for a different style.',
    '',
    'When composing replies, follow conventional typography and editorial norms for each language you use (spacing, punctuation, and mixed-script text such as Latin alongside CJK or other scripts).',
    'For CJK text mixed with Latin letters or Arabic numerals, a common readable habit is to insert a single ASCII space at each script boundary where it helps legibility—for example write 「使用 API 调用」 rather than 「使用API调用」; apply the same idea to English names or technical terms embedded in Chinese sentences.',
    '',
  ].join('\n');
}

export function buildToolAgentHostPrompt(model: string): string {
  return [
    buildSpiritAgentCoreHostPrompt(model),
    'Available tools are defined only by the tools field in this request.',
    'Only call declared functions.',
    'Do not invent tools or capabilities that are not present in the request.',
    'When multiple tool calls are independent, invoke them in parallel in the same turn instead of serially. Only wait for one tool before calling another when the later call depends on the earlier result.',
    '',
    'Security — tool use (mandatory):',
    'Treat this as a safety and privacy requirement, not a suggestion.',
    'Call tools only when the user has explicitly asked you to perform a specific action that genuinely requires those tools (for example: read a named path, run a named check, or use a named capability they requested).',
    'High-risk tools (anything that could expose private data, credentials, secrets, personal information, or broadly traverse or modify the user\'s machine or repository) must not be used unless the user has given explicit, specific consent in the same turn or conversation for that exact class of action. If risk is unclear, do not call the tool; ask a short clarifying question instead.',
    'If you are unsure whether tool use is warranted, default to not calling tools and answer from information already in the conversation.',
  ].join('\n');
}

export function buildToolAgentSystemMessage(
  model: string,
  ...sections: Array<string | undefined>
): string {
  return [buildToolAgentHostPrompt(model), ...sections]
    .filter((section): section is string => typeof section === 'string' && section.trim().length > 0)
    .map((section) => section.trim())
    .join('\n\n');
}

export function buildToolAgentMessages(input: {
  historyMessages: JsonValue[];
  enabledRules?: ToolAgentEnabledRule[];
  enabledSkillCatalog?: ToolAgentEnabledSkillCatalogEntry[];
  mcpToolCatalog?: ToolAgentMcpToolCatalogSnapshot;
  model: string;
  planMetadata?: ToolAgentPlanMetadata;
  extensionSystemPrompts?: ToolAgentExtensionSystemPrompt[];
  dreamsContextText?: string;
  basicInfo?: ToolAgentBasicInfo;
  applyPatchFileToolsPromptSection?: string;
  providerWebSearchPromptSection?: string;
  loopEnabled?: boolean;
}): JsonValue[] {
  const rulesSystemMessage = buildRulesSystemMessage(input.enabledRules ?? []);
  const skillsCatalogSystemMessage = buildSkillsCatalogSystemMessage(input.enabledSkillCatalog ?? []);
  const mcpCatalogSystemMessage = buildMcpCatalogSystemMessage(input.mcpToolCatalog);
  const agentModeSystemMessage = buildAgentModeSystemMessage(input.planMetadata);
  const loopModeSystemMessage = buildLoopModeSystemMessage(input.loopEnabled);
  const extensionsSystemMessage = buildExtensionsSystemMessage(input.extensionSystemPrompts ?? []);
  const dreamsSystemMessage = buildDreamsSystemMessage(input.dreamsContextText);
  const basicInfoSystemMessage = buildBasicInfoSystemMessage(input.basicInfo);

  return [
    {
      role: 'system',
      content: buildToolAgentSystemMessage(
        input.model,
        rulesSystemMessage,
        skillsCatalogSystemMessage,
        mcpCatalogSystemMessage,
        agentModeSystemMessage,
        loopModeSystemMessage,
        extensionsSystemMessage,
        dreamsSystemMessage,
        basicInfoSystemMessage,
        input.applyPatchFileToolsPromptSection,
        input.providerWebSearchPromptSection,
      ),
    },
    ...input.historyMessages.map((message) => cloneJsonValue(message)),
  ];
}

export function startToolAgentState(
  messages: JsonValue[],
  userInput: string,
): ToolAgentState {
  const nextMessages = messages.map((message) => cloneJsonValue(message));
  const lastRole = nextMessages.at(-1);
  const needAppendUser = !isJsonObject(lastRole) || lastRole.role !== 'user';
  if (needAppendUser) {
    nextMessages.push({ role: 'user', content: userInput });
  }

  return {
    messages: nextMessages,
    steps: 0,
  };
}

export function continueToolAgentState(messages: JsonValue[]): ToolAgentState {
  return {
    messages: messages.map((message) => cloneJsonValue(message)),
    steps: 0,
  };
}

export function appendToolResultMessages(
  state: ToolAgentState,
  results: ToolAgentToolResult[],
): ToolAgentState {
  if (results.length === 0) {
    return {
      messages: state.messages.map((message) => cloneJsonValue(message)),
      steps: state.steps,
    };
  }

  return {
    messages: [
      ...state.messages.map((message) => cloneJsonValue(message)),
      ...results.map((result) => ({
        role: 'tool',
        tool_call_id: result.toolCallId,
        content: result.content,
        ...(result.providerState !== undefined
          ? { providerState: cloneLlmProviderState(result.providerState) }
          : {}),
      })),
    ],
    steps: state.steps,
  };
}

export function appendToolResultMessage(
  state: ToolAgentState,
  toolCallId: string,
  content: string,
): ToolAgentState {
  return appendToolResultMessages(state, [{ toolCallId, content }]);
}

export function appendUserMessage(
  state: ToolAgentState,
  content: string,
): ToolAgentState {
  return {
    messages: [...state.messages.map((message) => cloneJsonValue(message)), { role: 'user', content }],
    steps: state.steps,
  };
}

export function extractLastAssistantText(
  state: ToolAgentState,
): string | undefined {
  for (let index = state.messages.length - 1; index >= 0; index -= 1) {
    const message = state.messages[index];
    if (!isJsonObject(message) || message.role !== 'assistant') {
      continue;
    }
    if (typeof message.content === 'string' && message.content.trim()) {
      return message.content;
    }

    if (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
      continue;
    }

    const reasoningText = extractStoredAssistantReasoningText(message);
    if (reasoningText) {
      return reasoningText;
    }
  }

  return undefined;
}

export function assistantToolCallMessageFromState(
  state: ToolAgentState,
  calls: ToolCallRequest[],
): LlmMessage | undefined {
  if (calls.length === 0) {
    return undefined;
  }

  for (let index = state.messages.length - 1; index >= 0; index -= 1) {
    const message = state.messages[index];
    if (!isJsonObject(message) || message.role !== 'assistant') {
      continue;
    }

    const toolCalls = extractAssistantToolCalls(message);
    if (toolCalls === undefined || !assistantToolCallsMatchRequests(toolCalls, calls)) {
      continue;
    }

    const providerState = extractAssistantProviderState(message);
    return {
      role: 'assistant',
      content: createLlmMessageContentFromText(
        typeof message.content === 'string' ? message.content : '',
      ),
      toolCalls,
      ...(providerState !== undefined ? { providerState } : {}),
    };
  }

  return undefined;
}

export function truncateToolAgentStateForContextRetry(
  state: ToolAgentState,
): { state: ToolAgentState; changed: boolean } {
  let changed = false;
  const messages = state.messages.map((message) => {
    if (!isJsonObject(message) || typeof message.content !== 'string') {
      return cloneJsonValue(message);
    }

    const replacement = truncateMessageContentForRetry(message.role, message.content);
    if (replacement === undefined) {
      return { ...message };
    }

    changed = true;
    return {
      ...message,
      content: replacement,
    };
  });

  return {
    state: {
      messages,
      steps: state.steps,
    },
    changed,
  };
}

export function truncateHistoryForCompaction(
  history: LlmMessage[],
): { history: LlmMessage[]; changed: boolean } {
  let changed = false;
  const nextHistory = history.map((message) => {
    const contentText = llmMessageTextContent(message.content);
    if (message.role !== 'tool') {
      return {
        role: message.role,
        content: cloneLlmMessageContent(message.content),
        ...(message.toolCallId !== undefined ? { toolCallId: message.toolCallId } : {}),
        ...(message.toolCalls !== undefined
          ? {
              toolCalls: message.toolCalls.map((toolCall) => ({
                id: toolCall.id,
                name: toolCall.name,
                argumentsJson: toolCall.argumentsJson,
              })),
            }
          : {}),
        ...(message.providerState !== undefined
          ? { providerState: cloneLlmProviderState(message.providerState) }
          : {}),
      };
    }

    const replacement = buildContextRetryExcerpt(contentText);
    if (replacement === undefined) {
      return {
        role: message.role,
        content: cloneLlmMessageContent(message.content),
        ...(message.toolCallId !== undefined ? { toolCallId: message.toolCallId } : {}),
        ...(message.toolCalls !== undefined
          ? {
              toolCalls: message.toolCalls.map((toolCall) => ({
                id: toolCall.id,
                name: toolCall.name,
                argumentsJson: toolCall.argumentsJson,
              })),
            }
          : {}),
      };
    }

    changed = true;
    return {
      role: message.role,
      content: createLlmMessageContentFromText(replacement),
      ...(message.toolCallId !== undefined ? { toolCallId: message.toolCallId } : {}),
      ...(message.toolCalls !== undefined
        ? {
            toolCalls: message.toolCalls.map((toolCall) => ({
              id: toolCall.id,
              name: toolCall.name,
              argumentsJson: toolCall.argumentsJson,
            })),
          }
        : {}),
      ...(message.providerState !== undefined
        ? { providerState: cloneLlmProviderState(message.providerState) }
        : {}),
    };
  });

  return {
    history: nextHistory,
    changed,
  };
}

export function buildRulesSystemMessage(
  enabledRules: ToolAgentEnabledRule[],
): string | undefined {
  if (enabledRules.length === 0) {
    return undefined;
  }

  const lines = [
    RULES_SECTION_PREFIX,
    'Apply the following enabled rules as additive constraints from their source files.',
    'These rules do not replace the main system prompt; they extend it.',
    '',
  ];

  for (const rule of enabledRules) {
    lines.push(
      `<rule id="${escapeRuleAttribute(rule.id)}" scope="${escapeRuleAttribute(rule.scope)}" title="${escapeRuleAttribute(rule.title)}" path="${escapeRuleAttribute(rule.path)}">`,
    );
    lines.push(rule.content.trimEnd());
    lines.push('</rule>');
    lines.push('');
  }

  return lines.join('\n').trimEnd();
}

export function buildSkillsCatalogSystemMessage(
  enabledSkillCatalog: ToolAgentEnabledSkillCatalogEntry[],
): string | undefined {
  if (enabledSkillCatalog.length === 0) {
    return undefined;
  }

  const lines = [
    SKILLS_CATALOG_SECTION_PREFIX,
    'The host exposes the following enabled skills as metadata only.',
    'Do not assume a skill\'s full instructions unless the user message includes an <active_skill> block for it.',
    'If a listed skill seems relevant, you may read it proactively or ask the user to activate it explicitly with its top-level slash command, e.g. /llm-debug.',
    '',
  ];

  for (const skill of enabledSkillCatalog) {
    lines.push(
      `<skill id="${escapeRuleAttribute(skill.id)}" scope="${escapeRuleAttribute(skill.scope)}" name="${escapeRuleAttribute(skill.name)}" path="${escapeRuleAttribute(skill.path)}">`,
    );
    lines.push(skill.description.trimEnd());
    lines.push('</skill>');
    lines.push('');
  }

  return lines.join('\n').trimEnd();
}

export function buildMcpCatalogSystemMessage(
  catalog?: ToolAgentMcpToolCatalogSnapshot,
): string | undefined {
  if (!catalog || catalog.servers.length === 0) {
    return undefined;
  }

  const lines = [
    MCP_CATALOG_SECTION_PREFIX,
    'The host lists enabled MCP tools as metadata only.',
    'Use tool_describe to fetch a tool input schema before tool_call.',
    '',
  ];

  if (catalog.truncated) {
    lines.push(
      `<catalog truncated="true" totalTools="${catalog.totalToolCount}">`,
      'Some tools were omitted from this catalog. Use tool_describe with the server and tool name to fetch schemas for tools not listed here.',
      '</catalog>',
      '',
    );
  }

  for (const server of catalog.servers) {
    const lastErrorAttribute =
      server.lastError === undefined
        ? ''
        : ` lastError="${escapeRuleAttribute(server.lastError)}"`;
    lines.push(
      `<mcp-server name="${escapeRuleAttribute(server.name)}" displayName="${escapeRuleAttribute(server.displayName)}" state="${escapeRuleAttribute(server.state)}"${lastErrorAttribute}>`,
    );
    for (const tool of server.tools) {
      lines.push(`<tool name="${escapeRuleAttribute(tool.name)}">`);
      lines.push(tool.description.trimEnd());
      lines.push('</tool>');
    }
    lines.push('</mcp-server>');
    lines.push('');
  }

  return lines.join('\n').trimEnd();
}

export function buildAgentModeSystemMessage(
  planMetadata?: ToolAgentPlanMetadata,
): string {
  const agentMode = normalizeSpiritAgentMode(planMetadata);
  const lines = [AGENT_MODE_SECTION_PREFIX, `You are in ${agentModeLabel(agentMode)} mode.`, ''];

  if (agentMode === 'plan') {
    lines.push(
      'If the goal or scope is unclear, use ask_questions to clarify before you draft a plan. Draft implementation plans when appropriate (for example with create_plan). When a plan is ready, tell the user to click Start implementing beside the Plan control, or switch to Agent mode and ask you to implement it.',
    );
  } else if (agentMode === 'ask') {
    lines.push(
      'Help read-only. Only call tools that are available in this request. If the user wants edits or execution, ask them to switch to Agent mode.',
    );
  } else if (agentMode === 'debug') {
    lines.push(
      'When the user reports a bug, do not attempt a fix immediately. Instead:',
      '',
      '1. Propose hypotheses about the root cause, ranked by likelihood.',
      '2. Insert structured log points in the relevant source code to test each hypothesis.',
      '',
      'Each log point should append one NDJSON line to a file under .spirit/logs/ at runtime:',
      '- Directory: .spirit/logs/ under the workspace root',
      '- Filename: kebab-case (e.g. auth-retry-failure.json)',
      '- Format: NDJSON (one JSON object per line)',
      '- Required fields:',
      '  - "hypotheses": array of hypotheses being tested',
      '  - "message": short header describing what this log captures',
      '  - "data": evidence source (stack traces, variable snapshots, timing, etc.)',
      '',
      'Wrap every debug log insertion in a collapsible region named "agent log"',
      '(e.g. // #region agent log … // #endregion in JS/TS; use the language\'s',
      'equivalent elsewhere). Remove entire regions after the bug is verified fixed.',
      '',
      '3. After inserting log points, tell the user the reproduction steps and ask them to reply "resolved" or "still reproducing".',
      '   - If resolved: remove the log points and confirm.',
      '   - If still reproducing: read the log files, analyze evidence, refine hypotheses, and continue.',
    );
  } else {
    lines.push(
      'Handle the user\'s requests efficiently, professionally, and carefully—including analysis, edits, shell commands, and verification when appropriate.',
    );
  }

  return lines.join('\n').trimEnd();
}

function agentModeLabel(agentMode: SpiritAgentMode): string {
  switch (agentMode) {
    case 'plan':
      return 'Plan';
    case 'ask':
      return 'Ask';
    case 'debug':
      return 'Debug';
    default:
      return 'Agent';
  }
}

export function hasAgentModeSystemMessage(content: string): boolean {
  return content.includes(AGENT_MODE_SECTION_PREFIX);
}

export function buildLoopModeSystemMessage(loopEnabled?: boolean): string | undefined {
  if (loopEnabled !== true) {
    return undefined;
  }

  return [
    LOOP_MODE_SECTION_PREFIX,
    'Loop mode is enabled.',
    'Do not end the conversation until you are confident that the user\'s task is fully complete.',
    'Ordinary assistant replies do not stop the loop; keep working, calling tools, and verifying results until the task is done.',
    'Call `finish_task` only when no further work is needed.',
  ].join('\n');
}

export function hasLoopModeSystemMessage(content: string): boolean {
  return content.includes(LOOP_MODE_SECTION_PREFIX);
}

export function buildActiveSkillsBlockContent(
  activeSkills: ToolAgentActiveSkill[],
): string | undefined {
  if (activeSkills.length === 0) {
    return undefined;
  }

  const lines = [
    'The following skills were explicitly activated by the user.',
    'Treat them as additive host-provided instructions for subsequent turns.',
    'Do not claim you discovered or read these files yourself; this content was provided by the host after explicit activation.',
    '',
  ];

  for (const skill of activeSkills) {
    lines.push(
      `<skill id="${escapeRuleAttribute(skill.id)}" scope="${escapeRuleAttribute(skill.scope)}" name="${escapeRuleAttribute(skill.name)}" path="${escapeRuleAttribute(skill.path)}" truncated="${skill.truncated ? 'true' : 'false'}" resourcesTruncated="${skill.resourcesTruncated ? 'true' : 'false'}">`,
    );
    lines.push(`description: ${skill.description}`);
    if (skill.resources.length > 0) {
      lines.push('<resources>');
      for (const resource of skill.resources) {
        lines.push(
          `<resource kind="${escapeRuleAttribute(resource.kind)}" path="${escapeRuleAttribute(resource.path)}" />`,
        );
      }
      lines.push('</resources>');
    }
    lines.push('<content>');
    lines.push(skill.content.trimEnd());
    lines.push('</content>');
    lines.push('</skill>');
    lines.push('');
  }

  return lines.join('\n').trimEnd();
}

export function buildExtensionsSystemMessage(
  extensionSystemPrompts: ToolAgentExtensionSystemPrompt[],
): string | undefined {
  const normalized = extensionSystemPrompts
    .map((entry) => ({
      extensionId: entry.extensionId.trim(),
      extensionName: entry.extensionName.trim(),
      content: entry.content.trim(),
    }))
    .filter((entry) => entry.extensionId && entry.extensionName && entry.content);

  if (normalized.length === 0) {
    return undefined;
  }

  return [
    EXTENSIONS_SECTION_PREFIX,
    'The following block contains additive host-provided instructions contributed by installed extensions.',
    'Treat them as additional system-level context; do not interpret them as tool definitions or permission grants.',
    ...normalized.map((entry) => [
      `<extension id="${escapeRuleAttribute(entry.extensionId)}" name="${escapeRuleAttribute(entry.extensionName)}">`,
      entry.content,
      '</extension>',
    ].join('\n')),
  ].join('\n');
}

export function buildDreamsSystemMessage(
  dreamsContextText?: string,
): string | undefined {
  const trimmed = dreamsContextText?.trim();
  if (!trimmed) {
    return undefined;
  }

  return [
    DREAMS_SECTION_PREFIX,
    'Dream catalog',
    '',
    'These are short-lived host-provided summaries of recent work movement for the current workspace and Git branch.',
    'Treat them as background continuity, not as authoritative current state.',
    'Prefer the current user request, visible conversation, and tool results when they conflict with these summaries.',
    'Only summary-level dream catalog entries are embedded here; full dream details are not included in this system message.',
    'Use `dream_list` to refresh the current dream catalog and `dream_read` with a relevant dream id when you need more detail.',
    'Do not assume details that are not present in the catalog or returned by the dream tools.',
    '',
    trimmed,
  ].join('\n');
}

export function buildBasicInfoSystemMessage(
  basicInfo?: ToolAgentBasicInfo,
): string | undefined {
  const workspaceRoot = basicInfo?.workspaceRoot?.trim();
  const terminal = basicInfo?.terminal?.trim();
  const gitBranch = basicInfo?.gitBranch?.trim();
  const systemName = basicInfo?.system?.name.trim();
  const systemVersion = basicInfo?.system?.version.trim();
  const hasSystem = Boolean(systemName || systemVersion);

  if (!workspaceRoot && !terminal && !gitBranch && !hasSystem) {
    return undefined;
  }

  const lines = [BASIC_INFO_SECTION_PREFIX, 'Basic information', ''];
  if (workspaceRoot) {
    lines.push('Current workspace:', `- ${workspaceRoot}`, '');
  }
  if (gitBranch) {
    lines.push('Current Git branch:', `- ${gitBranch}`, '');
  }
  if (terminal) {
    lines.push('Current terminal:', `- ${terminal}`, '');
  }
  if (hasSystem) {
    lines.push('Operating system:');
    if (systemName) {
      lines.push(`- Name: ${systemName}`);
    }
    if (systemVersion) {
      lines.push(`- Version: ${systemVersion}`);
    }
  }

  return lines.join('\n').trimEnd();
}

export function patchBasicInfoWorkspaceRootInMessages(
  messages: JsonValue[],
  workspaceRoot: string,
): JsonValue[] {
  const normalized = workspaceRoot.trim();
  if (!normalized) {
    return messages;
  }

  let changed = false;
  const next = messages.map((message) => {
    if (!isJsonObject(message) || message.role !== 'system' || typeof message.content !== 'string') {
      return message;
    }
    if (!message.content.includes(BASIC_INFO_SECTION_PREFIX)) {
      return message;
    }
    const nextContent = patchBasicInfoWorkspaceRootInSystemText(message.content, normalized);
    if (nextContent === message.content) {
      return message;
    }
    changed = true;
    return { ...message, content: nextContent };
  });
  return changed ? next : messages;
}

/** Matches the Current workspace block emitted by buildBasicInfoSystemMessage. */
export function patchBasicInfoWorkspaceRootInSystemText(
  content: string,
  workspaceRoot: string,
): string {
  const normalized = workspaceRoot.trim();
  if (!normalized || !content.includes(BASIC_INFO_SECTION_PREFIX)) {
    return content;
  }

  const workspaceBlock = /Current workspace:\r?\n- [^\r\n]*/;
  if (!workspaceBlock.test(content)) {
    return content;
  }
  return content.replace(workspaceBlock, `Current workspace:\n- ${normalized}`);
}

export function patchBasicInfoWorkspaceRootInToolAgentState(
  state: ToolAgentState,
  workspaceRoot: string,
): ToolAgentState {
  const normalized = workspaceRoot.trim();
  if (!normalized) {
    return state;
  }
  const messages = patchBasicInfoWorkspaceRootInMessages(state.messages, normalized);
  if (messages === state.messages) {
    return state;
  }
  return { ...state, messages };
}

export function hasDreamsSystemMessage(content: string): boolean {
  return content.includes(DREAMS_SECTION_PREFIX);
}

export function hasBasicInfoSystemMessage(content: string): boolean {
  return content.includes(BASIC_INFO_SECTION_PREFIX);
}

export function findSpiritSystemMessageContent(messages: JsonValue[]): string | undefined {
  for (const message of messages) {
    if (!isJsonObject(message) || message.role !== 'system') {
      continue;
    }
    if (typeof message.content === 'string') {
      const content = message.content;
      const sectionStart = [
        RULES_SECTION_PREFIX,
        SKILLS_CATALOG_SECTION_PREFIX,
        MCP_CATALOG_SECTION_PREFIX,
        AGENT_MODE_SECTION_PREFIX,
        LOOP_MODE_SECTION_PREFIX,
        EXTENSIONS_SECTION_PREFIX,
        DREAMS_SECTION_PREFIX,
        BASIC_INFO_SECTION_PREFIX,
      ]
        .map((prefix) => content.indexOf(prefix))
        .filter((index) => index >= 0)
        .sort((left, right) => left - right)
        .at(0);
      if (sectionStart !== undefined) {
        return content.slice(sectionStart).trim();
      }
    }
  }

  return undefined;
}

export function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function cloneJsonValue(value: JsonValue): JsonValue {
  if (Array.isArray(value)) {
    return value.map((item) => cloneJsonValue(item));
  }

  if (!isJsonObject(value)) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, entryValue]) => [key, cloneJsonValue(entryValue)]),
  );
}

export function findLastMatchingIndex<T>(
  items: T[],
  predicate: (item: T) => boolean,
): number {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item !== undefined && predicate(item)) {
      return index;
    }
  }

  return -1;
}

function extractStoredAssistantReasoningText(message: JsonObject): string | undefined {
  const pieces = [
    message.reasoning_content,
    message.reasoningContent,
    message.reasoning,
    message.thinking,
  ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0);

  return pieces.length > 0 ? pieces.join('') : undefined;
}

function extractAssistantToolCalls(message: JsonObject): LlmMessage['toolCalls'] | undefined {
  if (!Array.isArray(message.tool_calls)) {
    return undefined;
  }

  const toolCalls = message.tool_calls.flatMap((entry) => {
    if (!isJsonObject(entry) || !isJsonObject(entry.function)) {
      return [];
    }
    if (typeof entry.id !== 'string' || typeof entry.function.name !== 'string') {
      return [];
    }

    return [{
      id: entry.id,
      name: entry.function.name,
      argumentsJson:
        typeof entry.function.arguments === 'string'
          ? entry.function.arguments
          : JSON.stringify(entry.function.arguments ?? {}),
    }];
  });

  return toolCalls.length > 0 ? toolCalls : undefined;
}

function assistantToolCallsMatchRequests(
  toolCalls: NonNullable<LlmMessage['toolCalls']>,
  calls: ToolCallRequest[],
): boolean {
  if (toolCalls.length !== calls.length) {
    return false;
  }

  return toolCalls.every((toolCall, index) => {
    const expected = calls[index];
    return expected !== undefined && toolCall.id === expected.id && toolCall.name === expected.name;
  });
}

function extractAssistantProviderState(message: JsonObject): JsonObject | undefined {
  const entries = Object.entries(message).filter(([key]) => (
    key !== 'role'
    && key !== 'content'
    && key !== 'tool_calls'
    && key !== 'toolCallId'
    && key !== 'tool_call_id'
    && key !== 'toolCalls'
  ));

  if (entries.length === 0) {
    return undefined;
  }

  return Object.fromEntries(entries.map(([key, value]) => [key, cloneJsonValue(value)]));
}

function truncateMessageContentForRetry(
  role: JsonValue | undefined,
  content: string,
): string | undefined {
  if (role === 'tool') {
    return buildContextRetryExcerpt(content);
  }

  return undefined;
}

export function buildContextRetryExcerpt(
  text: string,
  archivePath?: string,
): string | undefined {
  const chars = Array.from(text);
  if (chars.length <= TOOL_OUTPUT_RETRY_MAX_CHARS) {
    return undefined;
  }

  const totalLines = text.split(/\r?\n/).length;
  const label = TOOL_OUTPUT_TRUNCATION_LABEL;
  const archiveHint = archivePath?.trim()
    ? `\nFull output archived at: ${archivePath.trim()}\n${TOOL_OUTPUT_ARCHIVE_READ_FILE_GUIDANCE}`
    : '';
  const overhead = Array.from(label).length + Array.from(archiveHint).length + 160;
  const usable = Math.max(TOOL_OUTPUT_RETRY_MAX_CHARS - overhead, 256);
  const headChars = Math.floor((usable * TOOL_TRUNCATION_HEAD_RATIO_NUM) / TOOL_TRUNCATION_HEAD_RATIO_DEN);
  const tailChars = Math.max(usable - headChars, 0);
  const head = takeFirstChars(text, headChars);
  const tail = takeLastChars(text, tailChars);
  const omittedChars = Math.max(chars.length - Array.from(head).length - Array.from(tail).length, 0);
  const omittedLines = Math.max(totalLines - head.split(/\r?\n/).length - tail.split(/\r?\n/).length, 0);

  const middle = `${label} omitted_chars=${omittedChars} omitted_lines≈${omittedLines}${archiveHint}`;

  return [
    head,
    middle,
    tail,
  ]
    .filter((part) => part.trim().length > 0)
    .join('\n');
}

function takeFirstChars(text: string, count: number): string {
  return Array.from(text).slice(0, count).join('');
}

function takeLastChars(text: string, count: number): string {
  const chars = Array.from(text);
  return chars.slice(Math.max(chars.length - count, 0)).join('');
}

function escapeRuleAttribute(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}