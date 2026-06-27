export const LLM_CONTEXT_TAGS = {
  rules: 'rules',
  skills_catalog: 'skills_catalog',
  mcp_catalog: 'mcp_catalog',
  agent_mode: 'agent_mode',
  loop_mode: 'loop_mode',
  extensions: 'extensions',
  dreams: 'dreams',
  basic_info: 'basic_info',
  compact_summary: 'compact_summary',
  compact_progress: 'compact_progress',
  dream_collector: 'dream_collector',
} as const;

export type LlmContextTag = (typeof LLM_CONTEXT_TAGS)[keyof typeof LLM_CONTEXT_TAGS];

export function llmContextOpenTag(tag: string): string {
  return `<${tag}>`;
}

export function llmContextCloseTag(tag: string): string {
  return `</${tag}>`;
}

export function wrapLlmContextBlock(tag: string, body: string): string {
  return `${llmContextOpenTag(tag)}\n${body.trimEnd()}\n${llmContextCloseTag(tag)}`;
}

export function unwrapLlmContextBlock(tag: string, text: string): string | undefined {
  const open = llmContextOpenTag(tag);
  const close = llmContextCloseTag(tag);
  const start = text.indexOf(open);
  if (start < 0) {
    return undefined;
  }

  const bodyStart = start + open.length;
  const afterOpen = text[bodyStart] === '\n' ? bodyStart + 1 : bodyStart;
  const end = text.lastIndexOf(close);
  if (end < afterOpen) {
    return undefined;
  }

  const raw = text.slice(afterOpen, end);
  return raw.endsWith('\n') ? raw.slice(0, -1) : raw;
}

export function includesLlmContextBlock(content: string, tag: string): boolean {
  return content.includes(llmContextOpenTag(tag));
}

export function findEarliestContextBlockIndex(content: string, tags: readonly string[]): number {
  const indices = tags
    .map((tag) => content.indexOf(llmContextOpenTag(tag)))
    .filter((index) => index >= 0);
  if (indices.length === 0) {
    return -1;
  }
  return Math.min(...indices);
}

export function wrapCompactSummaryBlock(summary: string): string {
  return wrapLlmContextBlock(LLM_CONTEXT_TAGS.compact_summary, summary);
}

export function unwrapCompactSummaryBlock(text: string): string | undefined {
  return unwrapLlmContextBlock(LLM_CONTEXT_TAGS.compact_summary, text);
}

export function includesCompactSummaryBlock(text: string): boolean {
  return includesLlmContextBlock(text, LLM_CONTEXT_TAGS.compact_summary);
}

export const COMPACT_PROGRESS_TEXT = wrapLlmContextBlock(
  LLM_CONTEXT_TAGS.compact_progress,
  'compacting history',
);
