import { readFileSync } from 'node:fs';
import { extname, isAbsolute, resolve } from 'node:path';

import type { JsonObject, JsonValue, LlmMessage } from '../ports.js';
import {
  appendToolResultMessage,
  appendToolResultMessages,
  appendUserMessage,
  buildToolAgentMessages,
  buildToolAgentSystemMessage,
  cloneJsonValue,
  continueToolAgentState,
  extractLastAssistantText,
  findLastMatchingIndex,
  findSpiritSystemMessageContent,
  isJsonObject,
  startToolAgentState,
  truncateHistoryForCompaction,
  truncateToolAgentStateForContextRetry,
  type ToolAgentActiveSkill,
  type ToolAgentEnabledRule,
  type ToolAgentEnabledSkillCatalogEntry,
  type ToolAgentExtensionSystemPrompt,
  type ToolAgentPlanMetadata,
  type ToolAgentState,
  type ToolAgentToolResult,
} from '../tool-agent.js';
import { userMessageContentMatchesInput } from '../runtime/user-turn-timestamp.js';

export {
  buildActiveSkillsSystemMessage,
  buildExtensionsSystemMessage,
  buildPlanSystemMessage,
  buildRulesSystemMessage,
  buildSkillsCatalogSystemMessage,
  buildToolAgentHostPrompt,
} from '../tool-agent.js';

export type OpenAiEnabledRule = ToolAgentEnabledRule;
export type OpenAiEnabledSkillCatalogEntry = ToolAgentEnabledSkillCatalogEntry;
export type OpenAiActiveSkillResourceEntry = ToolAgentActiveSkill['resources'][number];
export type OpenAiActiveSkill = ToolAgentActiveSkill;
export type OpenAiPlanMetadata = ToolAgentPlanMetadata;
export type OpenAiExtensionSystemPrompt = ToolAgentExtensionSystemPrompt;
export type OpenAiToolAgentState = ToolAgentState;
export type OpenAiToolResult = ToolAgentToolResult;

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
  return startToolAgentState(
    buildOpenAiToolAgentMessages(
      history,
      assetRoot,
      enabledRules,
      enabledSkillCatalog,
      activeSkills,
      model,
      planMetadata,
      extensionSystemPrompts,
    ),
    userInput,
  );
}

export function continueOpenAiToolAgentState(
  history: LlmMessage[],
  assetRoot = process.cwd(),
  enabledRules: OpenAiEnabledRule[] = [],
  enabledSkillCatalog: OpenAiEnabledSkillCatalogEntry[] = [],
  activeSkills: OpenAiActiveSkill[] = [],
  model: string,
  planMetadata?: OpenAiPlanMetadata,
  extensionSystemPrompts: OpenAiExtensionSystemPrompt[] = [],
): OpenAiToolAgentState {
  return continueToolAgentState(
    buildOpenAiToolAgentMessages(
      history,
      assetRoot,
      enabledRules,
      enabledSkillCatalog,
      activeSkills,
      model,
      planMetadata,
      extensionSystemPrompts,
    ),
  );
}

function buildOpenAiToolAgentMessages(
  history: LlmMessage[],
  assetRoot: string,
  enabledRules: OpenAiEnabledRule[],
  enabledSkillCatalog: OpenAiEnabledSkillCatalogEntry[],
  activeSkills: OpenAiActiveSkill[],
  model: string,
  planMetadata: OpenAiPlanMetadata | undefined,
  extensionSystemPrompts: OpenAiExtensionSystemPrompt[],
): JsonValue[] {
  return buildToolAgentMessages({
    historyMessages: llmHistoryToOpenAiMessages(history, assetRoot),
    enabledRules,
    enabledSkillCatalog,
    activeSkills,
    model,
    ...(planMetadata === undefined ? {} : { planMetadata }),
    extensionSystemPrompts,
  });
}

export function appendOpenAiToolResultMessages(
  state: OpenAiToolAgentState,
  results: OpenAiToolResult[],
): OpenAiToolAgentState {
  return appendToolResultMessages(state, results);
}

export function appendOpenAiToolResultMessage(
  state: OpenAiToolAgentState,
  toolCallId: string,
  content: string,
): OpenAiToolAgentState {
  return appendToolResultMessage(state, toolCallId, content);
}

export function appendOpenAiUserMessage(
  state: OpenAiToolAgentState,
  content: string,
): OpenAiToolAgentState {
  return appendUserMessage(state, content);
}

export function extractLastOpenAiAssistantText(
  state: OpenAiToolAgentState,
): string | undefined {
  return extractLastAssistantText(state);
}

export function truncateOpenAiToolAgentStateForContextRetry(
  state: OpenAiToolAgentState,
): { state: OpenAiToolAgentState; changed: boolean } {
  return truncateToolAgentStateForContextRetry(state);
}

export function truncateOpenAiHistoryForCompaction(
  history: LlmMessage[],
): { history: LlmMessage[]; changed: boolean } {
  return truncateHistoryForCompaction(history);
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
      content: buildToolAgentSystemMessage(model, preservedSpiritSystemMessage),
    };
  }
  rebuilt.steps = retryState.steps;

  const userIndex = findLastMatchingIndex(
    retryState.messages,
    (message) => isOpenAiUserMessageForInput(message, userInput),
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

function isOpenAiUserMessageForInput(message: JsonValue, userInput: string): boolean {
  if (!isJsonObject(message) || message.role !== 'user') {
    return false;
  }

  if (typeof message.content === 'string') {
    return userMessageContentMatchesInput(message.content, userInput);
  }

  if (!Array.isArray(message.content)) {
    return false;
  }

  return message.content.some(
    (part) =>
      isJsonObject(part) &&
      part.type === 'text' &&
      typeof part.text === 'string' &&
      userMessageContentMatchesInput(part.text, userInput),
  );
}

export function llmHistoryToOpenAiMessages(
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