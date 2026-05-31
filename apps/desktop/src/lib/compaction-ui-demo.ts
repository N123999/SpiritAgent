import i18n from '@/lib/i18n';
import type { ConversationMessageSnapshot, PendingAssistantAux } from '../types.js';

/** Negative ids — UI-only demo, never persisted. */
export const COMPACTION_UI_DEMO_MESSAGE_IDS = {
  user: -9100,
  compaction: -9101,
  reply: -9102,
} as const;

const DEMO_USER_TEXT = i18n.t('demo.compactionUserText');

const DEMO_COMPACTION_SUMMARY = i18n.t('demo.compactionSummary');

const DEMO_ASSISTANT_REPLY = i18n.t('demo.compactionAssistantReply');

const SPINNER_FRAMES = ['|', '/', '-', '\\'] as const;

export type CompactionUiDemoPhase =
  | 'idle'
  | 'spinner'
  | 'streaming'
  | 'finalized'
  | 'complete';

export function compactionDemoSpinnerFrame(tick: number): string {
  return SPINNER_FRAMES[tick % SPINNER_FRAMES.length] ?? '|';
}

export function buildCompactionDemoPendingAux(
  tick: number,
  detailText?: string,
): PendingAssistantAux {
  const frame = compactionDemoSpinnerFrame(tick);
  return {
    kind: 'compressing',
    statusText: `${frame} Compressing...`,
    ...(detailText ? { detailText } : {}),
  };
}

function streamingCompactionPrefix(progress: number): string {
  const length = Math.max(1, Math.floor(DEMO_COMPACTION_SUMMARY.length * progress));
  return DEMO_COMPACTION_SUMMARY.slice(0, length);
}

export function buildCompactionDemoMessages(input: {
  phase: CompactionUiDemoPhase;
  tick: number;
  streamProgress: number;
}): ConversationMessageSnapshot[] {
  const user: ConversationMessageSnapshot = {
    id: COMPACTION_UI_DEMO_MESSAGE_IDS.user,
    role: 'user',
    content: DEMO_USER_TEXT,
    pending: false,
  };

  if (input.phase === 'idle') {
    return [];
  }

  if (input.phase === 'spinner') {
    return [
      user,
      {
        id: COMPACTION_UI_DEMO_MESSAGE_IDS.compaction,
        role: 'assistant',
        content: '',
        pending: true,
        aux: { compaction: `${compactionDemoSpinnerFrame(input.tick)} Compressing...` },
      },
    ];
  }

  if (input.phase === 'streaming') {
    const partial = streamingCompactionPrefix(input.streamProgress);
    return [
      user,
      {
        id: COMPACTION_UI_DEMO_MESSAGE_IDS.compaction,
        role: 'assistant',
        content: '',
        pending: true,
        aux: { compaction: partial },
      },
    ];
  }

  const compactionMessage: ConversationMessageSnapshot = {
    id: COMPACTION_UI_DEMO_MESSAGE_IDS.compaction,
    role: 'assistant',
    content: '',
    pending: false,
    aux: { compaction: DEMO_COMPACTION_SUMMARY },
  };

  if (input.phase === 'finalized') {
    return [user, compactionMessage];
  }

  return [
    user,
    compactionMessage,
    {
      id: COMPACTION_UI_DEMO_MESSAGE_IDS.reply,
      role: 'assistant',
      content: DEMO_ASSISTANT_REPLY,
      pending: false,
    },
  ];
}
