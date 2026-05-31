import type { ConversationMessageSnapshot, PendingAssistantAux } from '../types.js';

/** Negative ids — UI-only demo, never persisted. */
export const COMPACTION_UI_DEMO_MESSAGE_IDS = {
  user: -9100,
  compaction: -9101,
  reply: -9102,
} as const;

const DEMO_USER_TEXT =
  '请继续实现 Desktop 连接向导：在上下文接近上限时自动压缩历史，并保留最近一轮工具结果。';

const DEMO_COMPACTION_SUMMARY = `## Context compressed

- 用户要求实现连接向导与上下文压缩相关 UI。
- 已讨论 OpenAI Responses API、transportKind 与 provider 预设。
- 丢弃较早的 8 条工具输出与 3 轮闲聊（约 42k tokens），保留当前任务与最近 read_file 结果。`;

const DEMO_ASSISTANT_REPLY =
  '已根据压缩后的上下文继续：我会在设置里补「上下文压缩」样式演示入口，并核对 Compaction 区块与后续助手回复的间距。';

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
