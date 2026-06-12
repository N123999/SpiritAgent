import type { TFunction } from 'i18next';

import {
  PROCESS_TOOL_CATEGORY_ORDER,
  type ProcessToolCategory,
  type ProcessToolCounts,
} from '@/lib/process-tool-category';
import type { ConversationMessageSnapshot } from '@/types';

export const PROCESS_SUMMARY_MAX_VISIBLE_CATEGORIES = 3;

const CATEGORY_I18N_KEY: Record<ProcessToolCategory, string> = {
  read: 'process.read',
  view: 'process.viewed',
  create: 'process.created',
  edit: 'process.edited',
  delete: 'process.deleted',
  ask: 'process.asked',
  diagnose: 'process.diagnosed',
  generate: 'process.generated',
  run: 'process.ran',
  other: 'process.other',
};

export function formatProcessCategoryLabel(
  t: TFunction,
  category: ProcessToolCategory,
  count: number,
): string {
  return t(CATEGORY_I18N_KEY[category], { count });
}

export function formatProcessSummary(
  t: TFunction,
  counts: ProcessToolCounts,
  maxVisibleCategories = PROCESS_SUMMARY_MAX_VISIBLE_CATEGORIES,
): string {
  const activeCategories = PROCESS_TOOL_CATEGORY_ORDER.filter((category) => counts[category] > 0);
  if (activeCategories.length === 0) {
    return '';
  }

  const visibleCategories = activeCategories.slice(0, maxVisibleCategories);
  const labels = visibleCategories.map((category) =>
    formatProcessCategoryLabel(t, category, counts[category]),
  );
  const summary = labels.join(t('process.separator'));

  if (activeCategories.length > maxVisibleCategories) {
    return `${summary}${t('process.separator')}${t('process.andMore')}`;
  }

  return summary;
}

export function countProcessAuxMessages(
  messages: readonly ConversationMessageSnapshot[],
  messageIndices: readonly number[],
): { thoughtCount: number; compactCount: number } {
  let thoughtCount = 0;
  let compactCount = 0;
  for (const index of messageIndices) {
    const message = messages[index];
    if (message?.aux?.thinking?.trim()) {
      thoughtCount += 1;
    }
    if (message?.aux?.compaction?.trim()) {
      compactCount += 1;
    }
  }
  return { thoughtCount, compactCount };
}

/** Tool counts first; otherwise summarize sealed thinking/compaction rows in the group. */
export function formatProcessGroupSummary(
  t: TFunction,
  counts: ProcessToolCounts,
  messages: readonly ConversationMessageSnapshot[],
  messageIndices: readonly number[],
): string {
  const toolSummary = formatProcessSummary(t, counts);
  if (toolSummary) {
    return toolSummary;
  }

  const { thoughtCount, compactCount } = countProcessAuxMessages(messages, messageIndices);
  const parts: string[] = [];
  if (thoughtCount > 0) {
    parts.push(t('process.thought', { count: thoughtCount }));
  }
  if (compactCount > 0) {
    parts.push(t('process.compacted', { count: compactCount }));
  }
  return parts.join(t('process.separator'));
}
