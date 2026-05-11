import {
  cloneLlmMessageContent,
  createLlmMessageContentFromText,
  llmMessageTextContent,
  type JsonObject,
  type JsonValue,
  type LlmMessage,
} from './ports.js';

const TOOL_OUTPUT_RETRY_MAX_CHARS = 12_000;
const TOOL_MEMORY_RETRY_MAX_CHARS = 4_000;
const TOOL_TRUNCATION_HEAD_RATIO_NUM = 2;
const TOOL_TRUNCATION_HEAD_RATIO_DEN = 3;
const RULES_SECTION_PREFIX = '[SPIRIT_RULES]';
const SKILLS_CATALOG_SECTION_PREFIX = '[SPIRIT_SKILLS_CATALOG]';
const PLAN_SECTION_PREFIX = '[SPIRIT_PLAN]';
const ACTIVE_SKILLS_SECTION_PREFIX = '[SPIRIT_ACTIVE_SKILLS]';
const EXTENSIONS_SECTION_PREFIX = '[SPIRIT_EXTENSIONS]';
const BASIC_INFO_SECTION_PREFIX = '[SPIRIT_BASIC_INFO]';
const TOOL_MEMORY_PREFIX = '[TOOL_MEMORY]';

export const COMPACT_SUMMARY_PREFIX = '[SPIRIT_COMPACT_SUMMARY]';

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
  planMode?: boolean;
  planModeHostInstructions?: string;
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
}

export interface ToolAgentState {
  messages: JsonValue[];
  steps: number;
}

export interface ToolAgentToolResult {
  toolCallId: string;
  content: string;
}

export function buildToolAgentHostPrompt(model: string): string {
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
    'Available tools are defined only by the tools field in this request.',
    'Only call declared functions.',
    'Do not invent tools or capabilities that are not present in the request.',
    '',
    'Security — tool use (mandatory):',
    'Treat this as a safety and privacy requirement, not a suggestion.',
    'Call tools only when the user has explicitly asked you to perform a specific action that genuinely requires those tools (for example: read a named path, run a named check, or use a named capability they requested).',
    'Do not call tools on your own initiative to explore the workspace, browse the project, or gather context "just in case". Acknowledge the user in plain language without probing files, commands, or environment unless the user separately and clearly requests that inspection.',
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
  activeSkills?: ToolAgentActiveSkill[];
  model: string;
  planMetadata?: ToolAgentPlanMetadata;
  extensionSystemPrompts?: ToolAgentExtensionSystemPrompt[];
  basicInfo?: ToolAgentBasicInfo;
}): JsonValue[] {
  const rulesSystemMessage = buildRulesSystemMessage(input.enabledRules ?? []);
  const skillsCatalogSystemMessage = buildSkillsCatalogSystemMessage(input.enabledSkillCatalog ?? []);
  const planSystemMessage = buildPlanSystemMessage(input.planMetadata);
  const activeSkillsSystemMessage = buildActiveSkillsSystemMessage(input.activeSkills ?? []);
  const extensionsSystemMessage = buildExtensionsSystemMessage(input.extensionSystemPrompts ?? []);
  const basicInfoSystemMessage = buildBasicInfoSystemMessage(input.basicInfo);

  return [
    {
      role: 'system',
      content: buildToolAgentSystemMessage(
        input.model,
        rulesSystemMessage,
        skillsCatalogSystemMessage,
        planSystemMessage,
        activeSkillsSystemMessage,
        extensionsSystemMessage,
        basicInfoSystemMessage,
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

    const reasoningText = extractStoredAssistantReasoningText(message);
    if (reasoningText) {
      return reasoningText;
    }
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
    if (message.role !== 'system' || !contentText.startsWith(TOOL_MEMORY_PREFIX)) {
      return {
        role: message.role,
        content: cloneLlmMessageContent(message.content),
      };
    }

    const replacement = buildContextRetryExcerpt(
      contentText,
      TOOL_MEMORY_RETRY_MAX_CHARS,
      '[tool memory truncated for context retry]',
    );
    if (replacement === undefined) {
      return {
        role: message.role,
        content: cloneLlmMessageContent(message.content),
      };
    }

    changed = true;
    return {
      role: message.role,
      content: createLlmMessageContentFromText(replacement),
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
    'Do not assume a skill\'s full instructions unless it appears in the active skills section.',
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

export function buildPlanSystemMessage(
  planMetadata?: ToolAgentPlanMetadata,
): string | undefined {
  if (!planMetadata) {
    return undefined;
  }

  const planMode = planMetadata.planMode === true;
  const hostZh = planMetadata.planModeHostInstructions?.trim() ?? '';
  if (!planMetadata.exists && !planMode) {
    return undefined;
  }

  const lines: string[] = [PLAN_SECTION_PREFIX];

  if (planMode) {
    if (hostZh.length > 0) {
      lines.push(hostZh, '');
    }
    lines.push(
      'When the user\'s request is vague, ambiguous, or leaves important choices unresolved, you may use the `ask_questions` tool to ask clarifying questions.',
      'When a concept image would materially clarify the plan, UX, layout, or visual direction, consider using the `generate_image` tool and then referencing the generated image in the plan document so the user can inspect it.',
      '',
    );
  }

  if (planMetadata.exists) {
    lines.push(
      'The host exposes a shared implementation plan file as metadata only.',
      'Do not assume its contents unless you read the file.',
      'Produce or rewrite this plan document only when the user clearly asks for planning, a design, or an implementation plan for a concrete task. Do not spontaneously draft a full “project plan” document or roadmap unless the user explicitly requests that kind of deliverable.',
      'When the user asks to continue, resume, or start implementing an existing plan, read this file before acting.',
      'While the user is still planning, you may update this file through the normal file-approval flow.',
      'If an existing plan on disk is clearly about a different topic or intent than the user\'s current request, delete it (via approved delete_file) and create a new plan from scratch; do not stack unrelated plans in the same file.',
      '',
      `<plan path="${escapeRuleAttribute(planMetadata.path)}" />`,
    );
  }

  return lines.join('\n').trimEnd();
}

export function buildActiveSkillsSystemMessage(
  activeSkills: ToolAgentActiveSkill[],
): string | undefined {
  if (activeSkills.length === 0) {
    return undefined;
  }

  const lines = [
    ACTIVE_SKILLS_SECTION_PREFIX,
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

export function buildBasicInfoSystemMessage(
  basicInfo?: ToolAgentBasicInfo,
): string | undefined {
  const workspaceRoot = basicInfo?.workspaceRoot?.trim();
  const terminal = basicInfo?.terminal?.trim();
  const systemName = basicInfo?.system?.name.trim();
  const systemVersion = basicInfo?.system?.version.trim();
  const hasSystem = Boolean(systemName || systemVersion);

  if (!workspaceRoot && !terminal && !hasSystem) {
    return undefined;
  }

  const lines = [BASIC_INFO_SECTION_PREFIX, 'Basic information', ''];
  if (workspaceRoot) {
    lines.push('Current workspace:', `- ${workspaceRoot}`, '');
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
        PLAN_SECTION_PREFIX,
        ACTIVE_SKILLS_SECTION_PREFIX,
        EXTENSIONS_SECTION_PREFIX,
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

function truncateMessageContentForRetry(
  role: JsonValue | undefined,
  content: string,
): string | undefined {
  if (role === 'tool') {
    return buildContextRetryExcerpt(
      content,
      TOOL_OUTPUT_RETRY_MAX_CHARS,
      '[tool output truncated for context retry]',
    );
  }

  if (role === 'system' && content.startsWith(TOOL_MEMORY_PREFIX)) {
    return buildContextRetryExcerpt(
      content,
      TOOL_MEMORY_RETRY_MAX_CHARS,
      '[tool memory truncated for context retry]',
    );
  }

  return undefined;
}

function buildContextRetryExcerpt(
  text: string,
  maxChars: number,
  label: string,
): string | undefined {
  const chars = Array.from(text);
  if (chars.length <= maxChars) {
    return undefined;
  }

  const totalLines = text.split(/\r?\n/).length;
  const overhead = Array.from(label).length + 160;
  const usable = Math.max(maxChars - overhead, 256);
  const headChars = Math.floor((usable * TOOL_TRUNCATION_HEAD_RATIO_NUM) / TOOL_TRUNCATION_HEAD_RATIO_DEN);
  const tailChars = Math.max(usable - headChars, 0);
  const head = takeFirstChars(text, headChars);
  const tail = takeLastChars(text, tailChars);
  const omittedChars = Math.max(chars.length - Array.from(head).length - Array.from(tail).length, 0);
  const omittedLines = Math.max(totalLines - head.split(/\r?\n/).length - tail.split(/\r?\n/).length, 0);

  return [
    head,
    `${label} omitted_chars=${omittedChars} omitted_lines≈${omittedLines}`,
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