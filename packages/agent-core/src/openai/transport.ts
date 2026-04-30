import { readFileSync } from 'node:fs';
import { extname, isAbsolute, resolve } from 'node:path';

import OpenAI from 'openai';
import type {
  ChatCompletionChunk,
  ChatCompletionMessage,
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionCreateParamsStreaming,
  ChatCompletionMessageParam,
  ChatCompletionMessageToolCall,
  ChatCompletionTool,
} from 'openai/resources/chat/completions';

import type {
  JsonObject,
  JsonValue,
  LlmStreamEvent,
  LlmMessage,
  LlmTransport,
  StartedToolAgentRound,
  ToolAgentRoundCompletion,
  ToolCallRequest,
} from '../ports.js';

/** Builds the full system prompt with identity and model name. */
export function buildToolAgentHostPrompt(model: string): string {
  const trimmed = model.trim();
  const modelLabel = trimmed.length > 0 ? trimmed : '(not configured)';
  return [
    'You are Spirit Agent.',
    `The user's model is: ${modelLabel}.`,
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

const COMPACT_SUMMARY_PREFIX = '[SPIRIT_COMPACT_SUMMARY]';
const TOOL_MEMORY_PREFIX = '[TOOL_MEMORY]';
const TOOL_OUTPUT_RETRY_MAX_CHARS = 12_000;
const TOOL_MEMORY_RETRY_MAX_CHARS = 4_000;
const TOOL_TRUNCATION_HEAD_RATIO_NUM = 2;
const TOOL_TRUNCATION_HEAD_RATIO_DEN = 3;
const RULES_SECTION_PREFIX = '[SPIRIT_RULES]';
const SKILLS_CATALOG_SECTION_PREFIX = '[SPIRIT_SKILLS_CATALOG]';
const PLAN_SECTION_PREFIX = '[SPIRIT_PLAN]';
const ACTIVE_SKILLS_SECTION_PREFIX = '[SPIRIT_ACTIVE_SKILLS]';
const EXTENSIONS_SECTION_PREFIX = '[SPIRIT_EXTENSIONS]';

/** 与宿主 `ModelProfile.provider` 对齐；用于在 OpenAI 形态 API 上附加厂商扩展字段。 */
export type OpenAiLlmVendor = 'deepseek' | 'kimi' | 'minimax' | 'custom';

export interface OpenAiTransportConfig {
  apiKey: string;
  model: string;
  baseUrl?: string;
  organization?: string;
  project?: string;
  compactModel?: string;
  workspaceRoot?: string;
  /**
   * 当前模型在配置中的提供方（小写）。缺省时不附加任何厂商专有请求体字段。
   */
  llmVendor?: OpenAiLlmVendor;
  /**
   * 仅对 `deepseek` / `kimi`：是否在所有经本 transport 的 chat.completions 请求体中加入
   * `thinking: { type: 'enabled' | 'disabled' }`（含主对话、工具轮与历史压缩）。
   * 缺省为 `true`（enabled）；设为 `false` 时发送 `disabled`。
   */
  vendorExtendedThinking?: boolean;
}

/**
 * DeepSeek / Kimi 等网关常在 OpenAI 兼容路径上接受顶层 `thinking` 字段以开关思考链输出。
 * 凡走 `OpenAiTransport` 的 chat.completions（含压缩）均合并，避免同一连接上部分请求缺字段导致网关行为不一致。
 */
function openAiVendorChatCompletionBodyExtras(
  config: Pick<OpenAiTransportConfig, 'llmVendor' | 'vendorExtendedThinking'>,
): Record<string, unknown> {
  const vendor = config.llmVendor;
  if (vendor !== 'deepseek' && vendor !== 'kimi') {
    return {};
  }
  const enabled = config.vendorExtendedThinking !== false;
  return { thinking: { type: enabled ? 'enabled' : 'disabled' } };
}

export interface OpenAiEnabledRule {
  id: string;
  scope: 'workspace' | 'user';
  title: string;
  path: string;
  content: string;
}

export interface OpenAiEnabledSkillCatalogEntry {
  id: string;
  scope: 'workspace' | 'user';
  name: string;
  description: string;
  path: string;
}

export interface OpenAiActiveSkillResourceEntry {
  kind: string;
  path: string;
}

export interface OpenAiActiveSkill {
  id: string;
  scope: 'workspace' | 'user';
  name: string;
  description: string;
  path: string;
  content: string;
  truncated: boolean;
  resources: OpenAiActiveSkillResourceEntry[];
  resourcesTruncated: boolean;
}

export interface OpenAiPlanMetadata {
  path: string;
  exists: boolean;
  /** True when the CLI input mode is Plan (vs Agent). */
  planMode?: boolean;
  /** Plan-mode host instructions (Chinese); injected into system prompt only. */
  planModeHostInstructions?: string;
}

export interface OpenAiExtensionSystemPrompt {
  extensionId: string;
  extensionName: string;
  content: string;
}

export interface OpenAiToolAgentState {
  messages: JsonValue[];
  steps: number;
}

export interface OpenAiToolResult {
  toolCallId: string;
  content: string;
}

export interface OpenAiJsonSchemaCompletionRequest {
  userPrompt: string;
  schemaName: string;
  schema: JsonObject;
  systemSections?: Array<string | undefined>;
}

export interface OpenAiJsonSchemaCompletionResult<T extends JsonValue = JsonValue> {
  output: T;
  rawText: string;
  requestTrace: JsonValue[];
}

export interface OpenAiRequestTrace extends JsonObject {
  kind: 'openai_sdk_chat_completions';
  stepIndex: number;
  model: string;
  stream: boolean;
  toolChoice?: 'auto';
  messages: JsonValue[];
  tools?: JsonValue[];
  /** 与 SDK 请求体一并发送的厂商扩展（若有）。 */
  vendorExtras?: JsonValue;
}

interface AggregatedStreamingToolCall {
  index: number;
  id: string;
  type: 'function';
  functionName: string;
  functionArguments: string;
  /** True once we emitted a "准备调用工具" line (args JSON is complete enough for host.parse). */
  readyPreviewEmitted: boolean;
}

export function startOpenAiToolAgentState(
  history: LlmMessage[],
  userInput: string,
  assetRoot = process.cwd(),
  enabledRules: OpenAiEnabledRule[] = [],
  enabledSkillCatalog: OpenAiEnabledSkillCatalogEntry[] = [],
  activeSkills: OpenAiActiveSkill[] = [],
  model: string,
  planMetadata?: OpenAiPlanMetadata,
  extensionSystemPrompts: OpenAiExtensionSystemPrompt[] = [],
): OpenAiToolAgentState {
  const rulesSystemMessage = buildRulesSystemMessage(enabledRules);
  const skillsCatalogSystemMessage = buildSkillsCatalogSystemMessage(enabledSkillCatalog);
  const planSystemMessage = buildPlanSystemMessage(planMetadata);
  const activeSkillsSystemMessage = buildActiveSkillsSystemMessage(activeSkills);
  const extensionsSystemMessage = buildExtensionsSystemMessage(extensionSystemPrompts);
  const messages: JsonValue[] = [
    {
      role: 'system',
      content: buildPrimarySystemMessage(
        model,
        rulesSystemMessage,
        skillsCatalogSystemMessage,
        planSystemMessage,
        activeSkillsSystemMessage,
        extensionsSystemMessage,
      ),
    },
    ...llmHistoryToOpenAiMessages(history, assetRoot),
  ];

  const lastRole = messages.at(-1);
  const needAppendUser = !isJsonObject(lastRole) || lastRole.role !== 'user';
  if (needAppendUser) {
    messages.push({ role: 'user', content: userInput });
  }

  return {
    messages,
    steps: 0,
  };
}

export function appendOpenAiToolResultMessages(
  state: OpenAiToolAgentState,
  results: OpenAiToolResult[],
): OpenAiToolAgentState {
  if (results.length === 0) {
    return {
      messages: [...state.messages],
      steps: state.steps,
    };
  }

  return {
    messages: [
      ...state.messages,
      ...results.map((result) => ({
        role: 'tool',
        tool_call_id: result.toolCallId,
        content: result.content,
      })),
    ],
    steps: state.steps,
  };
}

export function appendOpenAiToolResultMessage(
  state: OpenAiToolAgentState,
  toolCallId: string,
  content: string,
): OpenAiToolAgentState {
  return appendOpenAiToolResultMessages(state, [{ toolCallId, content }]);
}

export function appendOpenAiUserMessage(
  state: OpenAiToolAgentState,
  content: string,
): OpenAiToolAgentState {
  return {
    messages: [...state.messages, { role: 'user', content }],
    steps: state.steps,
  };
}

export function extractLastOpenAiAssistantText(
  state: OpenAiToolAgentState,
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

function extractStoredAssistantReasoningText(message: JsonObject): string | undefined {
  const pieces = [
    message.reasoning_content,
    message.reasoningContent,
    message.reasoning,
    message.thinking,
  ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0);

  return pieces.length > 0 ? pieces.join('') : undefined;
}

export function truncateOpenAiToolAgentStateForContextRetry(
  state: OpenAiToolAgentState,
): { state: OpenAiToolAgentState; changed: boolean } {
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

export function truncateOpenAiHistoryForCompaction(
  history: LlmMessage[],
): { history: LlmMessage[]; changed: boolean } {
  let changed = false;
  const nextHistory = history.map((message) => {
    if (message.role !== 'system' || !message.content.startsWith(TOOL_MEMORY_PREFIX)) {
      return {
        role: message.role,
        content: message.content,
        imagePaths: [...(message.imagePaths ?? [])],
      };
    }

    const replacement = buildContextRetryExcerpt(
      message.content,
      TOOL_MEMORY_RETRY_MAX_CHARS,
      '[tool memory truncated for context retry]',
    );
    if (replacement === undefined) {
      return {
        role: message.role,
        content: message.content,
        imagePaths: [...(message.imagePaths ?? [])],
      };
    }

    changed = true;
    return {
      role: message.role,
      content: replacement,
      imagePaths: [...(message.imagePaths ?? [])],
    };
  });

  return {
    history: nextHistory,
    changed,
  };
}

export function rebuildOpenAiToolAgentStateAfterCompaction(
  history: LlmMessage[],
  userInput: string,
  retryState: OpenAiToolAgentState,
  assetRoot = process.cwd(),
  enabledRules: OpenAiEnabledRule[] = [],
  enabledSkillCatalog: OpenAiEnabledSkillCatalogEntry[] = [],
  activeSkills: OpenAiActiveSkill[] = [],
  model: string,
  planMetadata?: OpenAiPlanMetadata,
  extensionSystemPrompts: OpenAiExtensionSystemPrompt[] = [],
): OpenAiToolAgentState {
  const preservedSpiritSystemMessage = findSpiritSystemMessageContent(retryState.messages);
  const rebuilt = startOpenAiToolAgentState(
    history,
    userInput,
    assetRoot,
    preservedSpiritSystemMessage === undefined ? enabledRules : [],
    preservedSpiritSystemMessage === undefined ? enabledSkillCatalog : [],
    preservedSpiritSystemMessage === undefined ? activeSkills : [],
    model,
    preservedSpiritSystemMessage === undefined ? planMetadata : undefined,
    preservedSpiritSystemMessage === undefined ? extensionSystemPrompts : [],
  );
  if (preservedSpiritSystemMessage !== undefined) {
    rebuilt.messages[0] = {
      role: 'system',
      content: buildPrimarySystemMessage(model, preservedSpiritSystemMessage),
    };
  }
  rebuilt.steps = retryState.steps;

  const userIndex = findLastMatchingIndex(
    retryState.messages,
    (message) =>
      isJsonObject(message) &&
      message.role === 'user' &&
      message.content === userInput,
  );

  if (userIndex < 0) {
    return {
      messages: retryState.messages.map((message) => cloneJsonValue(message)),
      steps: retryState.steps,
    };
  }

  rebuilt.messages.push(
    ...retryState.messages.slice(userIndex + 1).map((message) => cloneJsonValue(message)),
  );
  return rebuilt;
}

export class OpenAiTransport
  implements LlmTransport<OpenAiTransportConfig, OpenAiToolAgentState>
{
  async createJsonSchemaCompletion<T extends JsonValue = JsonValue>(
    config: OpenAiTransportConfig,
    request: OpenAiJsonSchemaCompletionRequest,
  ): Promise<OpenAiJsonSchemaCompletionResult<T>> {
    const client = createOpenAiClient(config);
    const structuredOutputSystemSection = buildStructuredOutputSystemSection(config, request);
    const messages = normalizeMessagesForRequest([
      {
        role: 'system',
        content: buildPrimarySystemMessage(
          config.model,
          ...(request.systemSections ?? []),
          structuredOutputSystemSection,
        ),
      },
      {
        role: 'user',
        content: request.userPrompt,
      },
    ]);
    const requestTrace = buildRequestTrace(config, 1, messages, []);
    const vendorExtras = openAiVendorChatCompletionBodyExtras(config);
    const response = await client.chat.completions.create({
      model: config.model,
      messages: messages as unknown as ChatCompletionMessageParam[],
      response_format: buildStructuredOutputResponseFormat(config, request),
      ...vendorExtras,
    } as ChatCompletionCreateParamsNonStreaming);
    const content = extractJsonSchemaCompletionContent(response);

    return {
      output: parseJsonSchemaCompletionOutput<T>(content),
      rawText: content,
      requestTrace,
    };
  }

  async startToolAgentRound(
    config: OpenAiTransportConfig,
    state: OpenAiToolAgentState,
    tools: JsonValue,
  ): Promise<ToolAgentRoundCompletion<OpenAiToolAgentState>> {
    const client = createOpenAiClient(config);
    const nextState: OpenAiToolAgentState = {
      messages: [...state.messages],
      steps: state.steps + 1,
    };

    const normalizedTools = normalizeTools(tools);
    const requestMessages = normalizeMessagesForRequest(nextState.messages);
    const requestTrace = buildRequestTrace(
      config,
      nextState.steps,
      requestMessages,
      normalizedTools,
    );

    const vendorExtras = openAiVendorChatCompletionBodyExtras(config);
    const payload = {
      model: config.model,
      messages: requestMessages as unknown as ChatCompletionMessageParam[],
      ...(normalizedTools.length > 0
        ? {
            tools: normalizedTools,
            tool_choice: 'auto' as const,
          }
        : {}),
      ...vendorExtras,
    } as ChatCompletionCreateParamsNonStreaming;

    try {
      const response = await client.chat.completions.create(payload);
      const choice = response.choices.at(0);
      const message = choice?.message;
      if (!message) {
        return {
          kind: 'failure',
          error: 'OpenAI SDK 返回了空 choices[0].message。',
          requestTrace,
        };
      }

      const assistantMessage = normalizeAssistantMessage(
        message,
        shouldInjectSyntheticToolReasoning(),
      );
      nextState.messages.push(assistantMessage);

      const calls = extractToolCalls(message.tool_calls);
      if (calls.length > 0) {
        return {
          kind: 'success',
          result: {
            state: nextState,
            step: {
              kind: 'tool-calls',
              calls,
            },
            requestTrace,
          },
        };
      }

      return {
        kind: 'success',
        result: {
          state: nextState,
          step: {
            kind: 'final-response-ready',
          },
          requestTrace,
        },
      };
    } catch (error) {
      return {
        kind: 'failure',
        error: renderOpenAiError(error),
        requestTrace,
      };
    }
  }

  async startToolAgentRoundStreaming(
    config: OpenAiTransportConfig,
    state: OpenAiToolAgentState,
    tools: JsonValue,
  ): Promise<StartedToolAgentRound<OpenAiToolAgentState>> {
    const client = createOpenAiClient(config);
    const nextState: OpenAiToolAgentState = {
      messages: [...state.messages],
      steps: state.steps + 1,
    };

    const normalizedTools = normalizeTools(tools);
    const requestMessages = normalizeMessagesForRequest(nextState.messages);
    const requestTrace = buildRequestTrace(
      config,
      nextState.steps,
      requestMessages,
      normalizedTools,
      true,
    );
    const vendorExtras = openAiVendorChatCompletionBodyExtras(config);
    const payload = {
      model: config.model,
      messages: requestMessages as unknown as ChatCompletionMessageParam[],
      stream: true,
      ...(normalizedTools.length > 0
        ? {
            tools: normalizedTools,
            tool_choice: 'auto' as const,
          }
        : {}),
      ...vendorExtras,
    } as ChatCompletionCreateParamsStreaming;

    const abortController = new AbortController();
    try {
      const stream = await client.chat.completions.create(payload, {
        signal: abortController.signal,
      });
      const completion = createDeferred<ToolAgentRoundCompletion<OpenAiToolAgentState>>();

      return {
        eventStream: openAiEventStreamToRuntimeEvents(
          stream,
          nextState,
          requestTrace,
          completion,
          shouldInjectSyntheticToolReasoning(),
        ),
        completion: completion.promise,
        cancel: () => abortController.abort(),
      };
    } catch (error) {
      return {
        eventStream: emptyOpenAiEventStream(),
        completion: Promise.resolve({
          kind: 'failure',
          error: renderOpenAiError(error),
          requestTrace,
        }),
        cancel: () => abortController.abort(),
      };
    }
  }

  async compactHistoryManual(
    config: OpenAiTransportConfig,
    history: LlmMessage[],
    onProgress?: (message: string) => void,
  ): Promise<{
    droppedMessages: number;
    beforeLength: number;
    afterLength: number;
  }> {
    const beforeLength = history.length;
    if (beforeLength === 0) {
      return {
        droppedMessages: 0,
        beforeLength,
        afterLength: 0,
      };
    }

    const client = createOpenAiClient(config);
    const compactionMessages: ChatCompletionMessageParam[] = [
      {
        role: 'system',
        content: [
          '请将以下对话压缩为后续推理可复用的系统摘要。',
          '保留：用户目标、关键约束、已验证结论、失败尝试、未完成事项。',
          '不要保留寒暄。',
          '输出纯文本摘要。',
        ].join('\n'),
      },
      {
        role: 'user',
        content: history
          .map((message) => `${message.role.toUpperCase()}: ${message.content}`)
          .join('\n\n'),
      },
    ];

    const compactionVendorExtras = openAiVendorChatCompletionBodyExtras(config);
    let summary = '';
    if (onProgress) {
      let emittedProgress = false;
      try {
        const stream = await client.chat.completions.create({
          model: config.compactModel ?? config.model,
          stream: true,
          messages: compactionMessages,
          ...compactionVendorExtras,
        } as ChatCompletionCreateParamsStreaming);

        for await (const chunk of stream) {
          for (const choice of chunk.choices) {
            for (const rawText of [choice.delta.content, choice.delta.refusal]) {
              if (typeof rawText !== 'string' || rawText.length === 0) {
                continue;
              }

              const normalizedText = trimLeadingStreamLineBreaks(summary, rawText);
              if (!normalizedText) {
                continue;
              }

              summary += normalizedText;
              emittedProgress = true;
              onProgress(normalizedText);
            }
          }
        }
      } catch (error) {
        if (emittedProgress) {
          throw error;
        }
      }
    }

    if (!summary.trim()) {
      const response = await client.chat.completions.create({
        model: config.compactModel ?? config.model,
        messages: compactionMessages,
        ...compactionVendorExtras,
      } as ChatCompletionCreateParamsNonStreaming);
      summary = response.choices.at(0)?.message?.content ?? '';
    }

    const normalizedSummary = summary.trim();
    if (!normalizedSummary) {
      throw new Error('OpenAI SDK 压缩返回为空，无法生成摘要。');
    }

    history.splice(0, history.length, {
      role: 'system',
      content: `${COMPACT_SUMMARY_PREFIX}\n${normalizedSummary}`,
      imagePaths: [],
    });

    return {
      droppedMessages: saturatingSub(beforeLength, 1),
      beforeLength,
      afterLength: history.length,
    };
  }

  compactSummaryText(history: LlmMessage[]): string | undefined {
    return history
      .find((message) => message.role === 'system' && message.content.startsWith(COMPACT_SUMMARY_PREFIX))
      ?.content.slice(COMPACT_SUMMARY_PREFIX.length)
      .trim() || undefined;
  }

  isContextOverflowError(error: string): boolean {
    const normalized = error.toLowerCase();
    return (
      normalized.includes('context length') ||
      normalized.includes('maximum context length') ||
      normalized.includes('too many tokens') ||
      normalized.includes('context_window_exceeded')
    );
  }

  isVisionUnsupportedError(error: string): boolean {
    return isOpenAiVisionUnsupportedError(error);
  }

  llmHistoryAsApiMessages(history: LlmMessage[]): JsonValue[] {
    return llmHistoryToOpenAiMessages(history);
  }

  llmSystemPromptsForExport(): JsonValue {
    return {
      tool_agent: buildToolAgentHostPrompt('—'),
    };
  }
}

export function buildRulesSystemMessage(
  enabledRules: OpenAiEnabledRule[],
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
  enabledSkillCatalog: OpenAiEnabledSkillCatalogEntry[],
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
  planMetadata?: OpenAiPlanMetadata,
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

  if (planMode && hostZh.length > 0) {
    lines.push(hostZh, '');
    lines.push(
      'When the user\'s request is vague, ambiguous, or leaves important choices unresolved, you may use the `ask_questions` tool to ask clarifying questions.',
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
  activeSkills: OpenAiActiveSkill[],
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
  extensionSystemPrompts: OpenAiExtensionSystemPrompt[],
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

function findSpiritSystemMessageContent(messages: JsonValue[]): string | undefined {
  for (const message of messages) {
    if (!isJsonObject(message) || message.role !== 'system') {
      continue;
    }
    if (typeof message.content === 'string') {
      const content = message.content;
      const sectionStart = [
        RULES_SECTION_PREFIX,
        SKILLS_CATALOG_SECTION_PREFIX,
        ACTIVE_SKILLS_SECTION_PREFIX,
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

function createOpenAiClient(config: OpenAiTransportConfig): OpenAI {
  return new OpenAI({
    apiKey: config.apiKey,
    ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
    ...(config.organization ? { organization: config.organization } : {}),
    ...(config.project ? { project: config.project } : {}),
  });
}

function buildRequestTrace(
  config: OpenAiTransportConfig,
  stepIndex: number,
  messages: JsonValue[],
  tools: ChatCompletionTool[],
  stream = false,
): JsonValue[] {
  const vendorExtras = openAiVendorChatCompletionBodyExtras(config);
  const trace: OpenAiRequestTrace = {
    kind: 'openai_sdk_chat_completions',
    stepIndex,
    model: config.model,
    stream,
    messages: messages.map((message) => cloneJsonValue(message)),
    ...(tools.length > 0
      ? {
          toolChoice: 'auto',
          tools: tools.map((tool) => cloneJsonValue(tool as unknown as JsonValue)),
        }
      : {}),
    ...(Object.keys(vendorExtras).length > 0
      ? { vendorExtras: vendorExtras as unknown as JsonValue }
      : {}),
  };

  return [trace];
}

async function* openAiEventStreamToRuntimeEvents(
  stream: AsyncIterable<ChatCompletionChunk>,
  nextState: OpenAiToolAgentState,
  requestTrace: JsonValue[],
  completion: Deferred<ToolAgentRoundCompletion<OpenAiToolAgentState>>,
  injectEmptyToolReasoningContent = true,
): AsyncGenerator<LlmStreamEvent, void, undefined> {
  const toolCalls = new Map<number, AggregatedStreamingToolCall>();
  let assistantContent = '';
  let reasoningContent = '';
  let sawAnswerOrToolOutput = false;
  const rawPreview: string[] = [];

  try {
    for await (const chunk of stream) {
      if (rawPreview.length < 8) {
        rawPreview.push(truncateChars(JSON.stringify(chunk), 320));
      }

      for (const choice of chunk.choices) {
        const delta = choice.delta;
        const thinkingText = extractStreamingThinkingText(delta);
        if (thinkingText) {
          reasoningContent += thinkingText;
          yield { kind: 'thinking-chunk', text: thinkingText };
        }

        if ((delta.tool_calls?.length ?? 0) > 0) {
          sawAnswerOrToolOutput = true;
        }

        for (const streamEvent of accumulateStreamingToolCallProgress(toolCalls, delta.tool_calls)) {
          yield streamEvent;
        }

        if (typeof delta.content === 'string' && delta.content.length > 0) {
          sawAnswerOrToolOutput = true;
          assistantContent += delta.content;
          yield { kind: 'assistant-chunk', text: delta.content };
        }

        if (typeof delta.refusal === 'string' && delta.refusal.length > 0) {
          sawAnswerOrToolOutput = true;
          assistantContent += delta.refusal;
          yield { kind: 'assistant-chunk', text: delta.refusal };
        }
      }
    }

    if (!sawAnswerOrToolOutput && !reasoningContent.trim()) {
      const preview = rawPreview.length === 0 ? '<empty stream body>' : rawPreview.join('\n');
      throw new Error(`流式响应无任何 delta（无 content / tool_calls）。预览:\n${truncateChars(preview, 600)}`);
    }

    nextState.messages.push(
      buildStreamingAssistantMessage(
        assistantContent,
        reasoningContent,
        toolCalls,
        injectEmptyToolReasoningContent,
      ),
    );
    const calls = extractToolCallsFromAggregatedMap(toolCalls);
    completion.resolve({
      kind: 'success',
      result: {
        state: nextState,
        step: calls.length > 0 ? { kind: 'tool-calls', calls } : { kind: 'final-response-ready' },
        requestTrace,
      },
    });
    yield { kind: 'done' };
  } catch (error) {
    const rendered = renderOpenAiError(error);
    completion.resolve({
      kind: 'failure',
      error: rendered,
      requestTrace,
    });
    yield {
      kind: 'error',
      error: rendered,
    };
  }
}

function llmHistoryToOpenAiMessages(
  history: LlmMessage[],
  assetRoot = process.cwd(),
): JsonValue[] {
  return history.map((message) => llmMessageToOpenAiMessage(message, assetRoot));
}

function llmMessageToOpenAiMessage(message: LlmMessage, assetRoot: string): JsonValue {
  if (message.role === 'user' && (message.imagePaths?.length ?? 0) > 0) {
    const parts: JsonValue[] = [];

    if (message.content.trim()) {
      parts.push({ type: 'text', text: message.content });
    }

    for (const imagePath of message.imagePaths ?? []) {
      parts.push({
        type: 'image_url',
        image_url: {
          url: pathToImageUrl(imagePath, assetRoot),
        },
      });
    }

    if (parts.length === 0) {
      return { role: message.role, content: '' };
    }

    return {
      role: message.role,
      content: parts,
    };
  }

  return {
    role: message.role,
    content: message.content,
  };
}

function normalizeTools(tools: JsonValue): ChatCompletionTool[] {
  if (!Array.isArray(tools)) {
    return [];
  }

  return tools
    .filter(isJsonObject)
    .filter((tool) => tool.type === 'function' && isJsonObject(tool.function))
    .map((tool) => tool as unknown as ChatCompletionTool);
}

function normalizeAssistantMessage(
  message: ChatCompletionMessage,
  injectEmptyToolReasoningContent = true,
): JsonValue {
  const functionToolCalls = extractFunctionToolCalls(message.tool_calls);
  const reasoningContent = extractAssistantReasoningContent(message);

  return withReasoningContentIfNeeded({
    role: 'assistant',
    content: message.content ?? null,
    ...(functionToolCalls.length > 0
      ? {
          tool_calls: functionToolCalls.map((call) => ({
            id: call.id,
            type: call.type,
            function: {
              name: call.function.name,
              arguments: call.function.arguments,
            },
          })),
        }
      : {}),
  }, reasoningContent, injectEmptyToolReasoningContent);
}

function extractToolCalls(
  toolCalls: ChatCompletionMessageToolCall[] | null | undefined,
): ToolCallRequest[] {
  return extractFunctionToolCalls(toolCalls).map((call) => ({
    id: call.id,
    name: call.function.name,
    argumentsJson: call.function.arguments,
  }));
}

function extractFunctionToolCalls(
  toolCalls: ChatCompletionMessageToolCall[] | null | undefined,
): Extract<ChatCompletionMessageToolCall, { type: 'function' }>[] {
  return (toolCalls ?? []).filter(
    (call): call is Extract<ChatCompletionMessageToolCall, { type: 'function' }> =>
      call.type === 'function',
  );
}

function extractAssistantReasoningContent(message: ChatCompletionMessage): string {
  const raw = message as unknown as Record<string, unknown>;
  const pieces = [
    raw.reasoning_content,
    raw.reasoningContent,
    raw.reasoning,
    raw.thinking,
  ].filter((value): value is string => typeof value === 'string' && value.length > 0);

  return pieces.join('');
}

function extractStreamingThinkingText(delta: ChatCompletionChunk.Choice.Delta): string | undefined {
  const raw = delta as unknown as Record<string, unknown>;
  const chunks = [
    raw.reasoning,
    raw.reasoning_content,
    raw.reasoningText,
    raw.reasoning_text,
    raw.thinking,
  ]
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .join('');

  return chunks || undefined;
}

function accumulateStreamingToolCallProgress(
  toolCalls: Map<number, AggregatedStreamingToolCall>,
  deltas: ChatCompletionChunk.Choice.Delta.ToolCall[] | undefined,
): LlmStreamEvent[] {
  if (!deltas || deltas.length === 0) {
    return [];
  }

  const updates: LlmStreamEvent[] = [];
  for (const delta of deltas) {
    const existing = toolCalls.get(delta.index);
    const current: AggregatedStreamingToolCall = existing ?? {
      index: delta.index,
      id: delta.id ?? `stream-tool-call-${delta.index}`,
      type: 'function',
      functionName: '',
      functionArguments: '',
      readyPreviewEmitted: false,
    };

    if (delta.id) {
      current.id = delta.id;
    }
    if (delta.function?.name) {
      current.functionName += delta.function.name;
    }
    if (delta.function?.arguments) {
      current.functionArguments += delta.function.arguments;
    }

    if (
      current.functionName &&
      !current.readyPreviewEmitted &&
      hostToolArgumentsReadyForPreview(current.functionName, current.functionArguments)
    ) {
      const previewLine = buildToolProgressPreview(current.functionName, current.functionArguments);
      updates.push({
        kind: 'streaming-tool-preview',
        toolCallId: current.id,
        toolName: current.functionName,
        argumentsJson: current.functionArguments,
        previewLine,
      });
      current.readyPreviewEmitted = true;
    }

    toolCalls.set(delta.index, current);
  }

  return updates;
}

function buildStreamingAssistantMessage(
  assistantContent: string,
  reasoningContent: string,
  toolCalls: Map<number, AggregatedStreamingToolCall>,
  injectEmptyToolReasoningContent = true,
): JsonValue {
  const functionToolCalls = [...toolCalls.values()]
    .sort((left, right) => left.index - right.index)
    .map((call) => ({
      index: call.index,
      id: call.id,
      type: call.type,
      function: {
        name: call.functionName,
        arguments: call.functionArguments,
      },
    }));

  return withReasoningContentIfNeeded({
    role: 'assistant',
    content: assistantContent || null,
    ...(functionToolCalls.length > 0 ? { tool_calls: functionToolCalls } : {}),
  }, reasoningContent, injectEmptyToolReasoningContent);
}

function extractToolCallsFromAggregatedMap(
  toolCalls: Map<number, AggregatedStreamingToolCall>,
): ToolCallRequest[] {
  return [...toolCalls.values()]
    .sort((left, right) => left.index - right.index)
    .filter((call) => call.functionName.trim().length > 0)
    .map((call) => ({
      id: call.id,
      name: call.functionName,
      argumentsJson: call.functionArguments,
    }));
}

function withReasoningContentIfNeeded(
  message: JsonObject,
  reasoningContent: string,
  injectEmptyToolReasoningContent = true,
): JsonValue {
  if (messageContentHasEmbeddedThinking(message)) {
    return message;
  }

  const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
  if ('reasoning_content' in message) {
    return message;
  }

  if (reasoningContent.length > 0) {
    return {
      ...message,
      reasoning_content: reasoningContent,
    };
  }

  if (toolCalls.length > 0 && injectEmptyToolReasoningContent) {
    return {
      ...message,
      reasoning_content: '',
    };
  }

  return message;
}

function messageContentHasEmbeddedThinking(message: JsonObject): boolean {
  if (typeof message.content !== 'string') {
    return false;
  }

  const trimmed = message.content.trimStart();
  return trimmed.startsWith('<think>') && trimmed.includes('</think>');
}

function buildToolProgressPreview(name: string, argumentsJson: string): string {
  const lineHint = tryCountContentLines(argumentsJson);
  if (lineHint !== undefined && lineHint > 0) {
    return `准备调用工具: ${name}（约 ${lineHint} 行内容）`;
  }

  return `准备调用工具: ${name}`;
}

/**
 * Matches host `request_from_function_call` / `required_string_arg` closely enough that we only
 * show "准备调用工具" once the streamed arguments can actually be parsed and approved — avoids
 * implying a full tool call when the model will hit `[tool schema error]` before `authorize`.
 */
function hostToolArgumentsReadyForPreview(name: string, argumentsJson: string): boolean {
  const trimmed = argumentsJson.trim();
  if (!trimmed) {
    return false;
  }

  let parsed: JsonValue;
  try {
    parsed = JSON.parse(trimmed) as JsonValue;
  } catch {
    return false;
  }

  if (!isJsonObject(parsed)) {
    return false;
  }

  const nonEmpty = (key: string): boolean => {
    const v = parsed[key];
    return typeof v === 'string' && v.trim().length > 0;
  };

  switch (name) {
    case 'run_shell_command':
      return nonEmpty('command');
    case 'web_fetch':
      return nonEmpty('url');
    case 'list_directory_files':
      return nonEmpty('path');
    case 'read_file':
      return nonEmpty('path');
    case 'search_files':
      return nonEmpty('query');
    case 'run_subagent':
      return nonEmpty('task');
    case 'create_file':
      return nonEmpty('path') && nonEmpty('content');
    case 'edit_file':
      return nonEmpty('path') && nonEmpty('old_text') && nonEmpty('new_text');
    case 'delete_file':
      return nonEmpty('path');
    case 'ask_questions':
      return Array.isArray(parsed.questions) && parsed.questions.length > 0;
    default:
      // Smoke demos, MCP tools, or future host tools: accept any object whose JSON is complete and
      // has at least one non-empty string field (streaming partial JSON still fails parse).
      return Object.values(parsed).some(
        (v) => typeof v === 'string' && (v as string).trim().length > 0,
      );
  }
}

function extractJsonSchemaCompletionContent(response: {
  choices?: Array<{ message?: { content?: string | null } }>;
}): string {
  const content = response.choices?.at(0)?.message?.content?.trim() ?? '';
  if (!content) {
    throw new Error('OpenAI SDK 结构化输出返回为空。');
  }

  return content;
}

function parseJsonSchemaCompletionOutput<T extends JsonValue = JsonValue>(content: string): T {
  const candidates = collectJsonParseCandidates(content);
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as T;
    } catch {
      // Continue trying progressively looser candidates.
    }
  }

  throw new Error('OpenAI SDK 结构化输出不是合法 JSON。');
}

function collectJsonParseCandidates(content: string): string[] {
  const trimmed = content.trim();
  const candidates: string[] = [];
  const seen = new Set<string>();
  const push = (value: string | undefined) => {
    const next = value?.trim();
    if (!next || seen.has(next)) {
      return;
    }
    seen.add(next);
    candidates.push(next);
  };

  push(trimmed);

  const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  push(fenceMatch?.[1]);

  const firstObjectStart = trimmed.indexOf('{');
  const lastObjectEnd = trimmed.lastIndexOf('}');
  if (firstObjectStart >= 0 && lastObjectEnd > firstObjectStart) {
    push(trimmed.slice(firstObjectStart, lastObjectEnd + 1));
  }

  const firstArrayStart = trimmed.indexOf('[');
  const lastArrayEnd = trimmed.lastIndexOf(']');
  if (firstArrayStart >= 0 && lastArrayEnd > firstArrayStart) {
    push(trimmed.slice(firstArrayStart, lastArrayEnd + 1));
  }

  return candidates;
}

function buildStructuredOutputSystemSection(
  config: Pick<OpenAiTransportConfig, 'llmVendor'>,
  request: OpenAiJsonSchemaCompletionRequest,
): string | undefined {
  if (config.llmVendor !== 'deepseek') {
    return undefined;
  }

  const example = buildJsonSchemaExample(request.schema);
  return [
    'Return only raw json that matches the requested schema.',
    'Do not add Markdown code fences, explanations, or any extra text.',
    `Schema name: ${request.schemaName}`,
    '[JSON_SCHEMA]',
    JSON.stringify(request.schema),
    ...(example === undefined
      ? []
      : ['[JSON_EXAMPLE]', JSON.stringify(example, null, 2)]),
  ].join('\n');
}

function buildStructuredOutputResponseFormat(
  config: Pick<OpenAiTransportConfig, 'llmVendor'>,
  request: OpenAiJsonSchemaCompletionRequest,
): ChatCompletionCreateParamsNonStreaming['response_format'] {
  if (config.llmVendor === 'deepseek') {
    return { type: 'json_object' };
  }

  return {
    type: 'json_schema',
    json_schema: {
      name: request.schemaName,
      strict: true,
      schema: request.schema,
    },
  };
}

function buildJsonSchemaExample(schema: JsonValue | undefined): JsonValue | undefined {
  if (!isJsonObject(schema)) {
    return undefined;
  }

  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    return cloneJsonValue(schema.enum[0] as JsonValue);
  }

  const type = typeof schema.type === 'string' ? schema.type : undefined;
  switch (type) {
    case 'object': {
      const properties = isJsonObject(schema.properties) ? schema.properties : undefined;
      if (!properties) {
        return {};
      }
      const example: JsonObject = {};
      for (const [key, value] of Object.entries(properties)) {
        example[key] = buildJsonSchemaExample(value as JsonValue) ?? '<value>';
      }
      return example;
    }
    case 'array': {
      const itemExample = buildJsonSchemaExample(schema.items as JsonValue | undefined);
      return itemExample === undefined ? [] : [itemExample];
    }
    case 'string':
      return '<string>';
    case 'integer':
    case 'number':
      return 0;
    case 'boolean':
      return true;
    case 'null':
      return null;
    default:
      return undefined;
  }
}

function tryCountContentLines(argumentsJson: string): number | undefined {
  try {
    const parsed = JSON.parse(argumentsJson) as JsonValue;
    if (!isJsonObject(parsed)) {
      return undefined;
    }

    const candidate = parsed.content ?? parsed.new_text;
    if (typeof candidate !== 'string') {
      return undefined;
    }

    return candidate.split(/\r?\n/).length;
  } catch {
    return undefined;
  }
}

function renderOpenAiError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

export function isOpenAiVisionUnsupportedError(error: string): boolean {
  const normalized = error.toLowerCase();
  return (
    ((normalized.includes('image') || normalized.includes('vision') || normalized.includes('multimodal')) &&
      (normalized.includes('unsupported') ||
        normalized.includes('not support') ||
        normalized.includes('does not support') ||
        normalized.includes('not supported'))) ||
    (normalized.includes('base64') &&
      (normalized.includes('failed to process') ||
        normalized.includes('cannot process') ||
        normalized.includes('decode') ||
        normalized.includes('20015')))
  );
}

function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function pathToImageUrl(path: string, assetRoot: string): string {
  const normalized = path.trim();
  if (
    normalized.startsWith('http://') ||
    normalized.startsWith('https://') ||
    normalized.startsWith('data:') ||
    normalized.startsWith('file://')
  ) {
    return normalized;
  }

  const absolutePath = isAbsolute(normalized) ? normalized : resolve(assetRoot, normalized);
  const mime = guessImageMimeFromPath(absolutePath);

  try {
    const bytes = readFileSync(absolutePath);
    return `data:${mime};base64,${bytes.toString('base64')}`;
  } catch {
    return toFileUrl(absolutePath);
  }
}

function toFileUrl(absolutePath: string): string {
  const normalized = absolutePath.replace(/\\/g, '/');
  return normalized.startsWith('/') ? `file://${normalized}` : `file:///${normalized}`;
}

function guessImageMimeFromPath(path: string): string {
  switch (extname(path).toLowerCase()) {
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.webp':
      return 'image/webp';
    case '.gif':
      return 'image/gif';
    case '.bmp':
      return 'image/bmp';
    default:
      return 'application/octet-stream';
  }
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

function cloneJsonValue(value: JsonValue): JsonValue {
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

function findLastMatchingIndex<T>(items: T[], predicate: (item: T) => boolean): number {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item !== undefined && predicate(item)) {
      return index;
    }
  }

  return -1;
}

function saturatingSub(value: number, delta: number): number {
  return Math.max(0, value - delta);
}

function truncateChars(text: string, maxChars: number): string {
  const chars = Array.from(text);
  if (chars.length <= maxChars) {
    return text;
  }

  return `${chars.slice(0, maxChars).join('')}...`;
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return {
    promise,
    resolve,
    reject,
  };
}

function trimLeadingStreamLineBreaks(existingText: string, nextText: string): string {
  if (existingText.length > 0) {
    return nextText;
  }

  return nextText.replace(/^[\r\n]+/u, '');
}

function escapeRuleAttribute(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function buildPrimarySystemMessage(
  model: string,
  ...sections: Array<string | undefined>
): string {
  return [buildToolAgentHostPrompt(model), ...sections]
    .filter((section): section is string => typeof section === 'string' && section.trim().length > 0)
    .map((section) => section.trim())
    .join('\n\n');
}

function normalizeMessagesForRequest(messages: JsonValue[]): JsonValue[] {
  return messages.map((message) => cloneJsonValue(message));
}

function shouldInjectSyntheticToolReasoning(): boolean {
  return true;
}

async function* emptyOpenAiEventStream(): AsyncGenerator<LlmStreamEvent, void, undefined> {}
