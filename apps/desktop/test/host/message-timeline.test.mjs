import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DesktopMessageTimeline } from '../../dist-electron/src/host/message-timeline.js';
import { buildVisibleMessageSnapshots } from '../../dist-electron/src/host/message-snapshots.js';
import { createDesktopRewindMetadata } from '../../dist-electron/src/host/rewind.js';

function createTimeline() {
  let nextMessageId = 1;
  return new DesktopMessageTimeline({
    allocateMessageId: () => nextMessageId++,
  });
}

function toolBlock(toolCallId, phase = 'running') {
  return {
    toolCallId,
    toolName: 'read_file',
    phase,
    headline: phase === 'succeeded' ? 'Read file' : 'Reading file',
    detailLines: [],
    argsExcerpt: '{}',
  };
}

function rowToken(message) {
  if (message.role === 'user') return `user:${message.content}`;
  if (message.tool) return `tool:${message.tool.toolCallId}:${message.tool.phase}`;
  if (message.aux?.thinking) return `thinking:${message.aux.thinking}`;
  if (message.aux?.compaction) return `compaction:${message.aux.compaction}`;
  if (message.aux?.finishTaskNotice) return `finish:${message.aux.finishTaskNotice}`;
  return `${message.pending ? 'pending' : 'assistant'}:${message.content}`;
}

function visibleRowTokens(messages) {
  return buildVisibleMessageSnapshots({
    messages,
    rewind: createDesktopRewindMetadata(),
  }).map(rowToken);
}

test('continuation segments derive rows after previous segment rows', () => {
  const timeline = createTimeline();
  timeline.beginUserTurn('inspect this file');

  timeline.beginAssistantSegment('initial');
  timeline.finalizeThinkingSegment('first reasoning');
  timeline.upsertToolMessage('call-1', toolBlock('call-1', 'succeeded'));
  timeline.removePendingAssistantText();

  timeline.beginAssistantSegment('continuation');
  timeline.upsertToolMessage('call-2', toolBlock('call-2'));
  timeline.finalizeThinkingSegment('second reasoning');
  timeline.removePendingAssistantText();

  assert.deepEqual(timeline.toMessages().map(rowToken), [
    'user:inspect this file',
    'thinking:first reasoning',
    'tool:call-1:succeeded',
    'thinking:second reasoning',
    'tool:call-2:running',
  ]);
});

test('post-tool thinking in the same segment stays below provider tool rows', () => {
  const timeline = createTimeline();
  timeline.beginUserTurn('search DeepSeek generation');
  timeline.beginAssistantSegment('initial');
  timeline.finalizeThinkingSegment('Need web search for current DeepSeek versions.');
  timeline.upsertToolMessage('web-1', {
    toolCallId: 'web-1',
    toolName: 'web_search',
    phase: 'preview',
    headline: 'Web search',
    detailLines: [],
    argsExcerpt: '{}',
  });
  timeline.updatePendingAssistantAux('thinking', 'Based on search results, DeepSeek is at V4.');
  timeline.finalizeThinkingSegment('Based on search results, DeepSeek is at V4.', 'after-stream');
  timeline.appendAssistantTextChunk('DeepSeek 目前出到第 4 代。');
  timeline.completeActiveAssistantSegment();

  assert.deepEqual(visibleRowTokens(timeline.toMessages()), [
    'user:search DeepSeek generation',
    'thinking:Need web search for current DeepSeek versions.',
    'tool:web-1:preview',
    'thinking:Based on search results, DeepSeek is at V4.',
    'assistant:DeepSeek 目前出到第 4 代。',
  ]);
});

test('first answer text chunk settles in-flight post-tool thinking without duplicate rows', () => {
  const timeline = createTimeline();
  timeline.beginUserTurn('search DeepSeek');
  timeline.beginAssistantSegment('initial');
  timeline.finalizeThinkingSegment('Need web search first.');
  timeline.upsertToolMessage('web-1', {
    toolCallId: 'web-1',
    toolName: 'web_search',
    phase: 'succeeded',
    headline: 'Web search',
    detailLines: [],
    argsExcerpt: '{}',
  });
  timeline.upsertToolMessage('fetch-1', {
    toolCallId: 'fetch-1',
    toolName: 'web_fetch',
    phase: 'succeeded',
    headline: 'Fetch',
    detailLines: [],
    argsExcerpt: '{}',
  });
  timeline.updatePendingAssistantAux('thinking', 'Fetched page content; can summarize now.');
  timeline.appendAssistantTextChunk('DeepSeek is at V4.');
  timeline.finalizeThinkingSegment('Fetched page content; can summarize now.', 'after-stream');
  timeline.completeActiveAssistantSegment();

  const tokens = visibleRowTokens(timeline.toMessages());
  const thinkingCount = tokens.filter((token) =>
    token.startsWith('thinking:Fetched page content'),
  ).length;
  assert.equal(thinkingCount, 1);
  assert.deepEqual(tokens, [
    'user:search DeepSeek',
    'thinking:Need web search first.',
    'tool:web-1:succeeded',
    'tool:fetch-1:succeeded',
    'thinking:Fetched page content; can summarize now.',
    'assistant:DeepSeek is at V4.',
  ]);
});

test('inter-tool thinking stays between provider builtin tool cards', () => {
  const timeline = createTimeline();
  timeline.beginUserTurn('search DeepSeek');
  timeline.beginAssistantSegment('initial');
  timeline.finalizeThinkingSegment('Need web search first.');
  timeline.upsertToolMessage('web-1', {
    toolCallId: 'web-1',
    toolName: 'web_search',
    phase: 'succeeded',
    headline: 'Web search',
    detailLines: [],
    argsExcerpt: '{}',
  });
  timeline.updatePendingAssistantAux('thinking', 'Search results mention versions; need a page fetch.');
  timeline.finalizeThinkingSegment(
    'Search results mention versions; need a page fetch.',
    'before-next-tool',
  );
  timeline.upsertToolMessage('fetch-1', {
    toolCallId: 'fetch-1',
    toolName: 'web_fetch',
    phase: 'succeeded',
    headline: 'Fetch',
    detailLines: [],
    argsExcerpt: '{}',
  });
  timeline.updatePendingAssistantAux('thinking', 'Fetched page content; can summarize now.');
  timeline.finalizeThinkingSegment('Fetched page content; can summarize now.', 'after-stream');
  timeline.appendAssistantTextChunk('DeepSeek is at V4.');
  timeline.completeActiveAssistantSegment();

  assert.deepEqual(visibleRowTokens(timeline.toMessages()), [
    'user:search DeepSeek',
    'thinking:Need web search first.',
    'tool:web-1:succeeded',
    'thinking:Search results mention versions; need a page fetch.',
    'tool:fetch-1:succeeded',
    'thinking:Fetched page content; can summarize now.',
    'assistant:DeepSeek is at V4.',
  ]);
});

test('fallback tool keys are scoped to the active segment', () => {
  const timeline = createTimeline();
  timeline.beginUserTurn('first turn');
  timeline.beginAssistantSegment('initial');
  timeline.upsertToolMessage('pending:read_file', toolBlock('pending:read_file'));
  timeline.removePendingAssistantText();

  timeline.beginUserTurn('second turn');
  timeline.beginAssistantSegment('initial');
  timeline.upsertToolMessage('pending:read_file', toolBlock('pending:read_file', 'succeeded'));
  timeline.removePendingAssistantText();

  assert.deepEqual(timeline.toMessages().map(rowToken), [
    'user:first turn',
    'tool:pending:read_file:running',
    'user:second turn',
    'tool:pending:read_file:succeeded',
  ]);
});

test('assistant text splits around tool rows inside a segment', () => {
  const timeline = createTimeline();
  timeline.beginUserTurn('check status');
  timeline.beginAssistantSegment('initial');
  timeline.appendAssistantTextChunk('I will inspect it.');
  timeline.upsertToolMessage('call-1', toolBlock('call-1', 'succeeded'));
  timeline.appendAssistantTextChunk('Done.');
  timeline.completeActiveAssistantSegment();

  assert.deepEqual(timeline.toMessages().map(rowToken), [
    'user:check status',
    'assistant:I will inspect it.',
    'tool:call-1:succeeded',
    'assistant:Done.',
  ]);
});

test('finish_task notice clears duplicate completion text instead of adding a second row', () => {
  const timeline = createTimeline();
  timeline.beginUserTurn('你好啊');
  timeline.beginAssistantSegment('initial');
  timeline.appendAssistantTextChunk('你好！我是 Spirit Agent，有什么可以帮你的吗？');
  timeline.completeActiveAssistantSegment();

  timeline.beginAssistantSegment('continuation');
  timeline.appendAssistantTextChunk('用户打招呼，已问候回复，无后续任务。');
  timeline.completeActiveAssistantSegment();
  timeline.materializeFinishTaskNotice(
    '任务以 用户打招呼，已问候回复，无后续任务。 完成。',
    '用户打招呼，已问候回复，无后续任务。',
  );

  assert.deepEqual(timeline.toMessages().map(rowToken), [
    'user:你好啊',
    'assistant:你好！我是 Spirit Agent，有什么可以帮你的吗？',
    'finish:任务以 用户打招呼，已问候回复，无后续任务。 完成。',
  ]);
});

test('finish_task notice preview updates the active assistant text row', () => {
  const timeline = createTimeline();
  timeline.beginUserTurn('loop');
  timeline.beginAssistantSegment('initial');
  timeline.appendAssistantTextChunk('明白，我会在每条回复末尾调用 finish_task。');

  timeline.updateFinishTaskNoticePreview('任务以 确认每条');
  assert.equal(
    timeline.toMessages().find((message) => message.role === 'assistant' && !message.tool)?.aux
      ?.finishTaskNotice,
    '任务以 确认每条',
  );

  timeline.updateFinishTaskNoticePreview('任务以 确认每条消息输出完毕后调用 finish_task。 完成。');
  assert.equal(
    timeline.toMessages().find((message) => message.role === 'assistant' && !message.tool)?.aux
      ?.finishTaskNotice,
    '任务以 确认每条消息输出完毕后调用 finish_task。 完成。',
  );
});

test('updatePendingAssistantAux preserves finish_task notice preview on assistant text row', () => {
  const timeline = createTimeline();
  timeline.beginUserTurn('loop');
  timeline.beginAssistantSegment('initial');
  timeline.appendAssistantTextChunk('正文内容。');
  timeline.updateFinishTaskNoticePreview('任务以 确认每条');

  timeline.updatePendingAssistantAux('thinking', 'Still reasoning about the reply.');

  assert.equal(
    timeline.toMessages().find((message) => message.content.includes('正文内容'))?.aux
      ?.finishTaskNotice,
    '任务以 确认每条',
  );
});

test('finalized thinking stays above completed assistant text in the same segment', () => {
  const timeline = createTimeline();
  timeline.beginUserTurn('你好啊');
  timeline.beginAssistantSegment('initial');
  timeline.appendAssistantTextChunk('你好！有什么可以帮你的吗？');
  timeline.finalizeThinkingSegment('The user is greeting me.');
  timeline.completeActiveAssistantSegment();
  timeline.materializeCompletedAssistantText('你好！有什么可以帮你的吗？');

  assert.deepEqual(timeline.toMessages().map(rowToken), [
    'user:你好啊',
    'thinking:The user is greeting me.',
    'assistant:你好！有什么可以帮你的吗？',
  ]);
});

test('live thinking stays above tool rows while the tool is running', () => {
  const timeline = createTimeline();
  timeline.beginUserTurn('read README.md');
  timeline.beginAssistantSegment('initial');
  timeline.upsertToolMessage('call-1', toolBlock('call-1'));
  timeline.updatePendingAssistantAux('thinking', 'Need to inspect README.md first.');

  assert.deepEqual(visibleRowTokens(timeline.toMessages()), [
    'user:read README.md',
    'thinking:Need to inspect README.md first.',
    'tool:call-1:running',
  ]);
});

test('tool previews do not duplicate a thinking row after assistant prefix text appears', () => {
  const timeline = createTimeline();
  timeline.beginUserTurn('parallel tools');
  timeline.beginAssistantSegment('initial');
  timeline.replaceAssistantText('好的，我先并发调用两个工具，然后执行 echo。');
  timeline.updatePendingAssistantAux('thinking', 'The user is asking me to call a few tools.');
  timeline.upsertToolMessage('call-1', toolBlock('call-1'));
  timeline.updatePendingAssistantAux(
    'thinking',
    'The user is asking me to call a few tools (preferably concurrently).',
  );
  timeline.upsertToolMessage('call-2', toolBlock('call-2'));

  const messages = timeline.toMessages();
  const assistantRows = messages.filter((message) => message.role === 'assistant' && !message.tool);

  assert.equal(assistantRows.length, 1);
  assert.equal(assistantRows[0].content, '好的，我先并发调用两个工具，然后执行 echo。');
  assert.equal(
    assistantRows[0].aux?.thinking,
    'The user is asking me to call a few tools (preferably concurrently).',
  );
  assert.deepEqual(
    messages.filter((message) => message.tool).map((message) => message.tool.toolCallId),
    ['call-1', 'call-2'],
  );
});

test('finalized thinking does not remain duplicated below tool rows', () => {
  const timeline = createTimeline();
  timeline.beginUserTurn('read README.md');
  timeline.beginAssistantSegment('initial');
  timeline.upsertToolMessage('call-1', toolBlock('call-1', 'succeeded'));
  timeline.updatePendingAssistantAux('thinking', 'Need to inspect README.md first.');
  timeline.finalizeThinkingSegment('Need to inspect README.md first.');
  timeline.appendAssistantTextChunk('I checked README.md.');
  timeline.completeActiveAssistantSegment();

  assert.deepEqual(visibleRowTokens(timeline.toMessages()), [
    'user:read README.md',
    'thinking:Need to inspect README.md first.',
    'tool:call-1:succeeded',
    'assistant:I checked README.md.',
  ]);
});

test('hydrating flat messages preserves a later thinking segment after a tool row', () => {
  let nextMessageId = 7;
  const timeline = DesktopMessageTimeline.fromMessages([
    {
      id: 1,
      role: 'user',
      content: 'read README.md',
      pending: false,
    },
    {
      id: 4,
      role: 'assistant',
      content: '',
      aux: { thinking: 'Need to inspect README.md first.' },
      pending: false,
    },
    {
      id: 3,
      role: 'assistant',
      content: '',
      tool: toolBlock('call-1', 'succeeded'),
      pending: false,
    },
    {
      id: 6,
      role: 'assistant',
      content: '',
      aux: { thinking: 'I have read README.md and can summarize it.' },
      pending: false,
    },
    {
      id: 5,
      role: 'assistant',
      content: 'README.md 内容（第 1-11 行）：Spirit Agent 是一个开源 AI Agent。',
      pending: false,
    },
  ], {
    allocateMessageId: () => nextMessageId++,
    reserveMessageId: (messageId) => {
      if (messageId >= nextMessageId) {
        nextMessageId = messageId + 1;
      }
    },
  });

  assert.deepEqual(timeline.toMessages().map(rowToken), [
    'user:read README.md',
    'thinking:Need to inspect README.md first.',
    'tool:call-1:succeeded',
    'thinking:I have read README.md and can summarize it.',
    'assistant:README.md 内容（第 1-11 行）：Spirit Agent 是一个开源 AI Agent。',
  ]);
});

test('verbose pending segment row logs are deduplicated and throttled', { concurrency: false }, () => {
  const originalDebug = process.env.SPIRIT_DESKTOP_MESSAGE_ORDER_DEBUG;
  const originalLog = console.log;
  const originalNow = Date.now;
  const logs = [];
  let now = 1_000;

  process.env.SPIRIT_DESKTOP_MESSAGE_ORDER_DEBUG = 'verbose';
  console.log = (message) => {
    logs.push(String(message));
  };
  Date.now = () => now;

  try {
    const timeline = createTimeline();
    timeline.beginUserTurn('Hi');
    timeline.beginAssistantSegment('initial');

    timeline.updatePendingAssistantAux('thinking', 'The user just said "Hi."');
    timeline.updatePendingAssistantAux('thinking', 'The user just said "Hi."');

    now += 200;
    timeline.updatePendingAssistantAux('thinking', 'The user just said "Hi." and I should reply warmly.');

    now += 1_300;
    timeline.updatePendingAssistantAux('thinking', 'I should greet the user warmly and offer help.');
  } finally {
    if (originalDebug === undefined) {
      delete process.env.SPIRIT_DESKTOP_MESSAGE_ORDER_DEBUG;
    } else {
      process.env.SPIRIT_DESKTOP_MESSAGE_ORDER_DEBUG = originalDebug;
    }
    console.log = originalLog;
    Date.now = originalNow;
  }

  const segmentLogs = logs.filter((line) => line.includes('[desktop-host][timeline] segment-rows'));
  assert.equal(segmentLogs.length, 2);
  assert.match(segmentLogs[0], /stage=update-pending-thinking/);
  assert.match(segmentLogs[0], /The user just said "Hi\./);
  assert.match(segmentLogs[1], /stage=update-pending-thinking/);
  assert.match(segmentLogs[1], /I should greet the user warmly/);
});

test('timeline snapshot round-trip preserves finishTaskNotice on assistant text rows', () => {
  const timeline = createTimeline();
  timeline.beginUserTurn('loop');
  timeline.beginAssistantSegment('initial');
  timeline.appendAssistantTextChunk('done for this turn');
  timeline.updateFinishTaskNoticePreview('任务以 确认每条 完成。');
  timeline.completeActiveAssistantSegment();

  const snapshot = timeline.snapshot();
  let nextMessageId = 4;
  const restored = DesktopMessageTimeline.fromSnapshot(snapshot, {
    allocateMessageId: () => nextMessageId++,
    reserveMessageId: (messageId) => {
      if (messageId >= nextMessageId) {
        nextMessageId = messageId + 1;
      }
    },
  });

  assert.equal(
    restored.toMessages().find((message) => message.role === 'assistant' && !message.tool)?.aux
      ?.finishTaskNotice,
    '任务以 确认每条 完成。',
  );
});

test('timeline snapshot round-trip preserves segment boundaries across restore', () => {
  const timeline = createTimeline();
  timeline.beginUserTurn('read README.md');
  timeline.beginAssistantSegment('initial');
  timeline.finalizeThinkingSegment('Need to inspect README.md first.');
  timeline.upsertToolMessage('call-1', toolBlock('call-1', 'succeeded'));
  timeline.removePendingAssistantText();
  timeline.beginAssistantSegment('continuation');
  timeline.finalizeThinkingSegment('I have read README.md and can summarize it.');
  timeline.materializeCompletedAssistantText('README.md 内容（第 1-11 行）：Spirit Agent 是一个开源 AI Agent。');

  const snapshot = timeline.snapshot();
  let nextMessageId = 7;
  const restored = DesktopMessageTimeline.fromSnapshot(snapshot, {
    allocateMessageId: () => nextMessageId++,
    reserveMessageId: (messageId) => {
      if (messageId >= nextMessageId) {
        nextMessageId = messageId + 1;
      }
    },
  });

  assert.deepEqual(restored.toMessages().map(rowToken), [
    'user:read README.md',
    'thinking:Need to inspect README.md first.',
    'tool:call-1:succeeded',
    'thinking:I have read README.md and can summarize it.',
    'assistant:README.md 内容（第 1-11 行）：Spirit Agent 是一个开源 AI Agent。',
  ]);
});

test('hydrated messages can open a continuation segment without reordering restored rows', () => {
  let nextMessageId = 4;
  const timeline = DesktopMessageTimeline.fromMessages([
    {
      id: 1,
      role: 'user',
      content: 'inspect this file',
      pending: false,
    },
    {
      id: 2,
      role: 'assistant',
      content: '',
      aux: { thinking: 'restored reasoning' },
      pending: false,
    },
    {
      id: 3,
      role: 'assistant',
      content: '',
      tool: toolBlock('call-1', 'succeeded'),
      pending: false,
      canContinue: true,
    },
  ], {
    allocateMessageId: () => nextMessageId++,
    reserveMessageId: (messageId) => {
      if (messageId >= nextMessageId) {
        nextMessageId = messageId + 1;
      }
    },
  });

  assert.equal(timeline.latestContinuableAssistantMessage()?.id, 3);

  timeline.beginAssistantSegment('continuation');
  timeline.finalizeThinkingSegment('continued reasoning');
  timeline.upsertToolMessage('call-2', toolBlock('call-2', 'running'));
  timeline.removePendingAssistantText();

  assert.deepEqual(timeline.toMessages().map(rowToken), [
    'user:inspect this file',
    'thinking:restored reasoning',
    'tool:call-1:succeeded',
    'thinking:continued reasoning',
    'tool:call-2:running',
  ]);
});

test('user local file attachments survive timeline round trip', () => {
  const timeline = createTimeline();
  timeline.beginUserTurn('how is this image?', {
    localFileAttachments: [{ path: '/tmp/photo.png', name: 'photo.png', isImage: true }],
  });
  timeline.beginAssistantSegment('initial');
  timeline.appendAssistantTextChunk('Looks good.');
  timeline.completeActiveAssistantSegment();

  const messages = timeline.toMessages();
  assert.equal(messages[0].localFileAttachments?.length, 1);
  assert.equal(messages[0].localFileAttachments?.[0]?.name, 'photo.png');

  let nextMessageId = 10;
  const rebuilt = DesktopMessageTimeline.fromMessages(messages, {
    allocateMessageId: () => nextMessageId++,
  });
  const roundTripped = rebuilt.toMessages();
  assert.deepEqual(roundTripped[0].localFileAttachments, messages[0].localFileAttachments);
});

test('user local file attachments survive timeline snapshot restore', () => {
  const timeline = createTimeline();
  timeline.beginUserTurn('哈哈哈', {
    localFileAttachments: [
      { path: 'D:\\project\\ReadmeHero_en.png', name: 'ReadmeHero_en.png', isImage: true },
    ],
  });
  timeline.beginAssistantSegment('initial');
  timeline.appendAssistantTextChunk('Looks good.');
  timeline.completeActiveAssistantSegment();

  const snapshot = timeline.snapshot();
  let nextMessageId = 10;
  const restored = DesktopMessageTimeline.fromSnapshot(snapshot, {
    allocateMessageId: () => nextMessageId++,
    reserveMessageId: (messageId) => {
      if (messageId >= nextMessageId) {
        nextMessageId = messageId + 1;
      }
    },
  });

  const messages = restored.toMessages();
  assert.equal(messages[0].localFileAttachments?.length, 1);
  assert.equal(messages[0].localFileAttachments?.[0]?.name, 'ReadmeHero_en.png');
});