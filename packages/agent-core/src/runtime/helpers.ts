import { readFile, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';

import {
  cloneLlmMessageContent,
  createLlmMessageContentFromText,
  createLlmMessageContentFromTextAndImages,
  llmMessageHasImages,
  llmMessageImagePaths,
  llmMessageTextContent,
  normalizeStoredLlmMessage,
  type JsonValue,
  type LlmMessage,
  type LlmMessageContent,
  type ToolExecutionOutput,
} from '../ports.js';

import {
  PENDING_WORKSPACE_FILE_MAX_CHARS,
  TOOL_MEMORY_PREFIX,
  TOOL_MEMORY_RESULT_MAX_CHARS,
} from './constants.js';
import { formatUserMessageContentForLlm } from './user-turn-timestamp.js';
import type {
  AgentRuntimeOptions,
  PendingMcpResource,
  PendingWorkspaceFile,
  PendingWorkspaceTextFile,
  RuntimeTurnContext,
} from './types.js';

export function createTurnContext<ToolRequest>(): RuntimeTurnContext<ToolRequest> {
  return {
    requestTrace: [],
    toolExecutions: [],
    compactions: [],
    autoCompactAttempts: 0,
    deferredUserGuidances: [],
  };
}

interface DeferredUserGuidanceRuntime<State, ToolRequest, TrustTarget = string> {
  options: Pick<
    AgentRuntimeOptions<unknown, State, ToolRequest, TrustTarget>,
    'appendUserLlmMessage' | 'appendUserMessage' | 'createToolAgentState'
  >;
  historyStore: LlmMessage[];
  pendingUserTurnStore: string | undefined;
}

export function enqueueDeferredUserGuidance<ToolRequest>(
  turn: RuntimeTurnContext<ToolRequest>,
  userMessage: string,
  historyContent?: LlmMessageContent,
): void {
  const trimmed = userMessage.trim();
  if (!trimmed) {
    return;
  }

  turn.deferredUserGuidances.push({
    userMessage: trimmed,
    contentForLlm: formatUserMessageContentForLlm(trimmed),
    ...(historyContent ? { historyContent: cloneLlmMessageContent(historyContent) } : {}),
  });
}

export function enqueueDeferredToolOutputGuidance<ToolRequest>(
  turn: RuntimeTurnContext<ToolRequest>,
  toolName: string,
  output: ToolExecutionOutput,
): void {
  const imagePaths = llmMessageImagePaths(output.content);
  if (imagePaths.length === 0) {
    return;
  }

  const guidanceMessage = output.summaryText.trim() || `[tool output] ${toolName} returned images.`;
  enqueueDeferredUserGuidance(
    turn,
    guidanceMessage,
    createLlmMessageContentFromTextAndImages(formatUserMessageContentForLlm(guidanceMessage), imagePaths),
  );
}

export function applyDeferredUserGuidance<State, ToolRequest, TrustTarget = string>(
  runtime: DeferredUserGuidanceRuntime<State, ToolRequest, TrustTarget>,
  state: State,
  pendingUserInput: string,
  turn: RuntimeTurnContext<ToolRequest>,
): { state: State; pendingUserInput: string } {
  if (turn.deferredUserGuidances.length === 0) {
    return { state, pendingUserInput };
  }

  const deferred = [...turn.deferredUserGuidances];
  turn.deferredUserGuidances = [];

  let nextState = state;
  let nextPendingUserInput = pendingUserInput;
  let requiresStateRebuild = !runtime.options.appendUserMessage;
  for (const item of deferred) {
    const historyContent = item.historyContent
      ? cloneLlmMessageContent(item.historyContent)
      : createLlmMessageContentFromText(item.contentForLlm);
    const historyMessage: LlmMessage = {
      role: 'user',
      content: historyContent,
    };

    runtime.historyStore.push(historyMessage);
    nextPendingUserInput = item.userMessage;

    if (item.historyContent) {
      if (runtime.options.appendUserLlmMessage) {
        nextState = runtime.options.appendUserLlmMessage(nextState, historyMessage);
        continue;
      }

      requiresStateRebuild = true;
      continue;
    }

    if (!runtime.options.appendUserMessage) {
      requiresStateRebuild = true;
      continue;
    }

    if (runtime.options.appendUserMessage) {
      nextState = runtime.options.appendUserMessage(nextState, item.contentForLlm);
    }
  }

  runtime.pendingUserTurnStore = nextPendingUserInput;
  if (requiresStateRebuild) {
    nextState = runtime.options.createToolAgentState(runtime.historyStore, nextPendingUserInput);
  }

  return {
    state: nextState,
    pendingUserInput: nextPendingUserInput,
  };
}

export function cloneHistory(history: LlmMessage[]): LlmMessage[] {
  return history.map((message) => ({
    role: message.role,
    content: cloneLlmMessageContent(message.content),
  }));
}

export function pruneToolMemories(history: LlmMessage[], maxEntries: number): void {
  let seen = 0;
  const total = history.filter(
    (message) =>
      message.role === 'system' && llmMessageTextContent(message.content).startsWith(TOOL_MEMORY_PREFIX),
  ).length;

  if (total <= maxEntries) {
    return;
  }

  const removeCount = total - maxEntries;
  const pruned = history.filter((message) => {
    if (
      message.role === 'system' &&
      llmMessageTextContent(message.content).startsWith(TOOL_MEMORY_PREFIX)
    ) {
      seen += 1;
      return seen > removeCount;
    }

    return true;
  });

  history.splice(0, history.length, ...pruned);
}

export function defaultToolMemoryFormatter<ToolRequest>(
  request: ToolRequest,
  output: string,
): string {
  return [
    TOOL_MEMORY_PREFIX,
    `request: ${truncateForPreview(safeStringify(request), 600)}`,
    'result_snippet:',
    truncateForPreview(output, TOOL_MEMORY_RESULT_MAX_CHARS),
  ].join('\n');
}

export function renderError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export function referencedPathsFromInput(input: string): string[] {
  const seen = new Set<string>();
  const paths: string[] = [];

  for (const token of input.split(/\s+/u)) {
    const path = token.startsWith('@') ? token.slice(1) : undefined;
    if (!path) {
      continue;
    }

    const normalized = path.replace(/\\/gu, '/');
    if (seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    paths.push(normalized);
  }

  return paths;
}

export async function pendingWorkspaceFilesFromInput(
  workspaceRoot: string,
  text: string,
): Promise<PendingWorkspaceFile[]> {
  const files: PendingWorkspaceFile[] = [];

  for (const path of referencedPathsFromInput(text)) {
    try {
      files.push(await pendingWorkspaceFileFromPath(workspaceRoot, path));
    } catch {
      // 与 Rust 保持一致：忽略不存在、不可读或不支持的引用。
    }
  }

  return files;
}

export function formatPendingWorkspaceFileContext(file: PendingWorkspaceTextFile): string {
  return [
    '[WORKSPACE_FILE]',
    `path: ${file.path}`,
    `attached_at_unix_ms: ${file.attachedAtUnixMs}`,
    `chars: ${file.totalChars}`,
    `truncated: ${file.truncated}`,
    '',
    file.content,
  ].join('\n');
}

export function pendingMcpResourceFromReadResult(
  server: string,
  displayName: string,
  requestedUri: string,
  value: JsonValue,
): PendingMcpResource {
  const contents = isJsonObject(value) && Array.isArray(value.contents) ? value.contents : undefined;
  if (!contents || contents.length === 0) {
    throw new Error(`MCP resource 返回为空: ${requestedUri}`);
  }

  const renderedSections: string[] = [];
  let mimeType: string | undefined;
  let finalUri = requestedUri;

  for (const content of contents) {
    if (!isJsonObject(content)) {
      renderedSections.push(safePrettyJson(content));
      continue;
    }

    if (typeof content.uri === 'string') {
      finalUri = content.uri;
    }
    if (mimeType === undefined && typeof content.mimeType === 'string') {
      mimeType = content.mimeType;
    }

    if (typeof content.text === 'string') {
      renderedSections.push(content.text);
      continue;
    }

    if (typeof content.blob === 'string') {
      renderedSections.push(`[blob base64 omitted, ${Array.from(content.blob).length} chars]`);
      continue;
    }

    renderedSections.push(safePrettyJson(content));
  }

  return {
    server,
    displayName,
    uri: finalUri,
    ...(mimeType !== undefined ? { mimeType } : {}),
    readAtUnixMs: Date.now(),
    content: renderedSections.join('\n\n---\n\n'),
  };
}

export function shortLabelForPendingMcpResource(resource: PendingMcpResource): string {
  return `${resource.server} -> ${resource.uri}`;
}

export function formatPendingMcpResourceContext(resource: PendingMcpResource): string {
  return [
    '[MCP_RESOURCE]',
    `server: ${resource.server}`,
    `display_name: ${resource.displayName}`,
    `uri: ${resource.uri}`,
    `mime_type: ${resource.mimeType ?? 'application/octet-stream'}`,
    `read_at_unix_ms: ${resource.readAtUnixMs}`,
    '',
    resource.content,
  ].join('\n');
}

export function promptMessagesFromValue(value: JsonValue): LlmMessage[] {
  const messages = isJsonObject(value) && Array.isArray(value.messages) ? value.messages : undefined;
  if (!messages) {
    throw new Error('MCP prompt 返回格式异常：缺少 messages');
  }

  return messages.map((message) => {
    if (!isJsonObject(message)) {
      throw new Error('MCP prompt message 格式异常');
    }

    return normalizeStoredLlmMessage({
      role: normalizePromptRole(typeof message.role === 'string' ? message.role : 'user'),
      content: promptContentToText(message.content),
    });
  });
}

export function toolNameFromRequest(request: unknown): string {
  if (typeof request === 'object' && request !== null && 'name' in request) {
    const name = (request as { name?: unknown }).name;
    if (typeof name === 'string' && name.trim()) {
      return name;
    }
  }

  return 'manual';
}

export function isCompatibleContinuedToolRequest(
  original: unknown,
  continued: unknown,
): boolean {
  if (toolNameFromRequest(original) !== toolNameFromRequest(continued)) {
    return false;
  }

  return (
    compareOptionalStringField(original, continued, 'extension_id') &&
    compareOptionalStringField(original, continued, 'tool_name')
  );
}

function compareOptionalStringField(
  left: unknown,
  right: unknown,
  field: string,
): boolean {
  const leftValue = readOptionalStringField(left, field);
  const rightValue = readOptionalStringField(right, field);

  if (leftValue === undefined && rightValue === undefined) {
    return true;
  }

  return leftValue !== undefined && leftValue === rightValue;
}

function readOptionalStringField(value: unknown, field: string): string | undefined {
  if (typeof value !== 'object' || value === null || !(field in value)) {
    return undefined;
  }

  const candidate = (value as Record<string, unknown>)[field];
  return typeof candidate === 'string' ? candidate : undefined;
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function truncateForPreview(text: string, maxChars: number): string {
  const chars = Array.from(text);
  if (chars.length <= maxChars) {
    return text;
  }
  return `${chars.slice(0, maxChars).join('')}...<truncated>`;
}

async function pendingWorkspaceFileFromPath(
  workspaceRoot: string,
  referencePath: string,
): Promise<PendingWorkspaceFile> {
  const normalizedReference = referencePath.replace(/\\/gu, '/');
  if (
    isAbsolute(referencePath) ||
    normalizedReference.startsWith('/') ||
    normalizedReference.split('/').some((segment) => segment === '..')
  ) {
    throw new Error(`不支持引用工作区外文件: ${referencePath}`);
  }

  const workspaceRootResolved = resolve(workspaceRoot);
  const target = resolve(workspaceRootResolved, referencePath);
  const relativeTarget = relative(workspaceRootResolved, target);
  if (relativeTarget.startsWith('..') || isAbsolute(relativeTarget)) {
    throw new Error(`不支持引用工作区外文件: ${referencePath}`);
  }

  const metadata = await stat(target);
  if (!metadata.isFile()) {
    throw new Error(`不是可引用的文件: ${target}`);
  }

  const bytes = await readFile(target);
  if (detectPendingWorkspaceImageFile(target, bytes)) {
    return {
      kind: 'image',
      path: relativeTarget.replace(/\\/gu, '/'),
      attachedAtUnixMs: Date.now(),
    };
  }

  if (hasPendingWorkspaceImageExtension(target)) {
    throw new Error(`图片文件校验失败: ${referencePath}`);
  }

  if (bytes.includes(0)) {
    throw new Error(`暂不支持引用二进制文件: ${referencePath}`);
  }

  const text = bytes.toString('utf8');
  const chars = Array.from(text);
  const truncated = chars.length > PENDING_WORKSPACE_FILE_MAX_CHARS;
  const content = truncated
    ? `${chars.slice(0, PENDING_WORKSPACE_FILE_MAX_CHARS).join('')}\n\n...<文件内容已截断>`
    : text;

  return {
    kind: 'text',
    path: relativeTarget.replace(/\\/gu, '/'),
    totalChars: chars.length,
    truncated,
    attachedAtUnixMs: Date.now(),
    content,
  };
}

function hasPendingWorkspaceImageExtension(filePath: string): boolean {
  const extension = filePath.toLowerCase();
  return (
    extension.endsWith('.bmp') ||
    extension.endsWith('.png') ||
    extension.endsWith('.jpg') ||
    extension.endsWith('.jpeg') ||
    extension.endsWith('.gif') ||
    extension.endsWith('.webp')
  );
}

function detectPendingWorkspaceImageFile(filePath: string, bytes: Uint8Array): boolean {
  if (!hasPendingWorkspaceImageExtension(filePath)) {
    return false;
  }

  const lower = filePath.toLowerCase();
  if (lower.endsWith('.bmp')) {
    return hasAsciiBytePrefix(bytes, 'BM');
  }
  if (lower.endsWith('.png')) {
    return hasBytePrefix(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  }
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) {
    return hasBytePrefix(bytes, [0xff, 0xd8, 0xff]);
  }
  if (lower.endsWith('.gif')) {
    return hasAsciiBytePrefix(bytes, 'GIF87a') || hasAsciiBytePrefix(bytes, 'GIF89a');
  }
  if (lower.endsWith('.webp')) {
    return hasAsciiBytePrefix(bytes, 'RIFF') && hasAsciiBytePrefix(bytes.slice(8), 'WEBP');
  }

  return false;
}

function hasBytePrefix(bytes: Uint8Array, prefix: readonly number[]): boolean {
  if (bytes.length < prefix.length) {
    return false;
  }

  return prefix.every((value, index) => bytes[index] === value);
}

function hasAsciiBytePrefix(bytes: Uint8Array, prefix: string): boolean {
  const expected = Array.from(prefix, (char) => char.charCodeAt(0));
  return hasBytePrefix(bytes, expected);
}

function normalizePromptRole(role: string): 'system' | 'user' | 'assistant' {
  if (role === 'assistant') {
    return 'assistant';
  }
  if (role === 'system') {
    return 'system';
  }
  return 'user';
}

function promptContentToText(content: JsonValue | undefined): string {
  if (typeof content === 'string') {
    return content;
  }

  if (isJsonObject(content) && content.type === 'text') {
    return typeof content.text === 'string' ? content.text : '';
  }

  return safePrettyJson(content);
}

function safePrettyJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function isJsonObject(value: JsonValue | undefined): value is Record<string, JsonValue> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}