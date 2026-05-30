import type { ConversationMessageSnapshot } from '../types.js';

/** Parent wrap-up after run_subagent — normal assistant body, not runtime status. */
function isParentSubagentCompletionSurfaceText(text: string): boolean {
  return /子智能体已完成|输出如下/u.test(text);
}

/** Colon is part of an emoticon (e.g. `:)`), not a `label: status` separator. */
function isEmoticonColon(text: string, colonIdx: number): boolean {
  const next = text[colonIdx + 1];
  return next !== undefined && /[)D(P/\\\]oO0-3]/.test(next);
}

function lastStatusColonIndex(text: string): number {
  let colonIdx = Math.max(text.lastIndexOf(':'), text.lastIndexOf('：'));
  while (colonIdx > 0 && isEmoticonColon(text, colonIdx)) {
    const prevAscii = text.lastIndexOf(':', colonIdx - 1);
    const prevFull = text.lastIndexOf('：', colonIdx - 1);
    const prev = Math.max(prevAscii, prevFull);
    if (prev <= 0) {
      return -1;
    }
    colonIdx = prev;
  }
  return colonIdx;
}

/**
 * Runtime status like `task: 运行中` or `task: The user wants…` — not child final output
 * or parent post-tool summary (Markdown).
 */
export function isSubagentStatusSurfaceText(text: string | undefined): boolean {
  const normalized = text?.trim();
  if (!normalized) {
    return false;
  }
  if (isParentSubagentCompletionSurfaceText(normalized)) {
    return false;
  }
  if (/\*\*[\s\S]+\*\*/u.test(normalized) || /^#{1,6}\s/m.test(normalized)) {
    return false;
  }
  if (normalized === 'Thinking...' || normalized === 'Compressing...') {
    return true;
  }
  if (/:\s*运行中\s*$/u.test(normalized)) {
    return true;
  }
  if (/:\s*等待/u.test(normalized)) {
    return true;
  }

  const colonIdx = lastStatusColonIndex(normalized);
  if (colonIdx <= 0) {
    return false;
  }

  const before = normalized.slice(0, colonIdx).trim();
  const after = normalized.slice(colonIdx + 1).trim();
  if (!after || before.length < 4 || after.includes('\n') || after.startsWith('```')) {
    return false;
  }

  if (isParentSubagentCompletionSurfaceText(before)) {
    return false;
  }

  if (after.length > 200) {
    return false;
  }

  if (
    /^(The|Sub|Sp|Thinking|Compressing|运行|等待)\b/u.test(after) ||
    /^The user wants\b/u.test(after) ||
    after.length <= 16
  ) {
    return true;
  }

  return false;
}

export function hasRunSubagentToolInCurrentTurn(
  messages: ReadonlyArray<ConversationMessageSnapshot>,
): boolean {
  let lastUserIndex = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === 'user') {
      lastUserIndex = index;
      break;
    }
  }
  for (let index = lastUserIndex + 1; index < messages.length; index += 1) {
    const message = messages[index];
    if (message?.role === 'assistant' && message.tool?.toolName === 'run_subagent') {
      return true;
    }
  }
  return false;
}

export function hasActiveRunSubagentToolInMessages(
  messages: ReadonlyArray<ConversationMessageSnapshot>,
): boolean {
  return messages.some(
    (message) =>
      message.role === 'assistant' &&
      message.tool?.toolName === 'run_subagent' &&
      (message.tool.phase === 'preview' || message.tool.phase === 'running'),
  );
}

export function isSubagentStatusSurfaceMessage(
  message: ConversationMessageSnapshot | undefined,
): boolean {
  return Boolean(
    message?.role === 'assistant' &&
      !message.tool &&
      isSubagentStatusSurfaceText(message.content),
  );
}
