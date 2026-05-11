import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DesktopAssistantMessageStateMachine } from '../../dist-electron/src/host/assistant-message-state.js';
import { DesktopConversationSnapshotView } from '../../dist-electron/src/host/conversation-snapshot.js';
import { DesktopMessageTimeline } from '../../dist-electron/src/host/message-timeline.js';
import { buildVisibleMessageSnapshots } from '../../dist-electron/src/host/message-snapshots.js';
import { createDesktopRewindMetadata } from '../../dist-electron/src/host/rewind.js';
import { DesktopRuntimeEventOrchestrator } from '../../dist-electron/src/host/runtime-event-orchestrator.js';

function createHarness() {
  let messages = [];
  let nextMessageId = 1;
  let nextTimelineMessageId = 1;
  let nextSegmentKind = 'initial';
  let completedTurnResult = undefined;
  const allocateMessageId = () => nextMessageId++;
  const timeline = new DesktopMessageTimeline({
    allocateMessageId: () => nextTimelineMessageId++,
    reserveMessageId: (messageId) => {
      if (messageId >= nextTimelineMessageId) {
        nextTimelineMessageId = messageId + 1;
      }
    },
  });
  const assistantMessages = new DesktopAssistantMessageStateMachine({
    messages: () => messages,
    setMessages: (nextMessages) => {
      messages = nextMessages;
    },
    allocateMessageId,
    isRuntimeBusy: () => true,
  });
  const conversationSnapshotView = new DesktopConversationSnapshotView(allocateMessageId);
  const orchestrator = new DesktopRuntimeEventOrchestrator({
    runtime: () => ({
      takeCompletedTurnResult: () => {
        const next = completedTurnResult;
        completedTurnResult = undefined;
        return next;
      },
    }),
    messages: () => messages,
    allocateMessageId,
    assistantMessages,
    messageTimeline: () => timeline,
    takeNextAssistantSegmentKind: () => {
      const kind = nextSegmentKind;
      nextSegmentKind = 'initial';
      return kind;
    },
    conversationSnapshotView,
    clearCurrentTurnSkills: () => {},
    setLastRuntimeError: () => {},
    refreshArchiveFromRuntime: () => {},
    dispatchExtensionEvent: () => {},
    bindFileChangesToToolMessage: () => {},
  });

  return {
    assistantMessages,
    messages: () => messages,
    orchestrator,
    setNextSegmentKind(kind) {
      nextSegmentKind = kind;
    },
    setCompletedTurnResult(result) {
      completedTurnResult = result;
    },
    timeline,
    pushUser(content) {
      const message = {
        id: allocateMessageId(),
        role: 'user',
        content,
        pending: false,
      };
      messages.push(message);
      timeline.beginUserTurn(content, { messageId: message.id });
    },
  };
}

function rowToken(message) {
  if (message.role === 'user') return 'user';
  if (message.tool) return `tool:${message.tool.toolCallId}`;
  if (message.aux?.thinking) return `thinking:${message.aux.thinking}`;
  if (message.pending) return 'pending-assistant';
  return `assistant:${message.content}`;
}

function visibleRowTokens(messages) {
  return buildVisibleMessageSnapshots({
    messages,
    rewind: createDesktopRewindMetadata(),
  }).map(rowToken);
}

test('runtime events are mirrored into continuation timeline segments', () => {
  const harness = createHarness();
  harness.pushUser('inspect this file');

  harness.orchestrator.applyRuntimeHostEvents([
    { kind: 'begin-assistant-response' },
    { kind: 'assistant-thinking-segment-finalized', text: 'first reasoning' },
    {
      kind: 'streaming-tool-preview',
      toolCallId: 'call-1',
      toolName: 'read_file',
      argumentsJson: '{}',
    },
    { kind: 'remove-pending-assistant' },
  ]);

  harness.assistantMessages.resetStreamingPlacementState(false);
  harness.setNextSegmentKind('continuation');
  harness.orchestrator.applyRuntimeHostEvents([
    { kind: 'begin-assistant-response' },
    {
      kind: 'streaming-tool-preview',
      toolCallId: 'call-2',
      toolName: 'read_file',
      argumentsJson: '{}',
    },
    { kind: 'assistant-thinking-segment-finalized', text: 'second reasoning' },
    { kind: 'remove-pending-assistant' },
  ]);

  assert.deepEqual(harness.timeline.toMessages().map(rowToken), [
    'user',
    'thinking:first reasoning',
    'tool:call-1',
    'thinking:second reasoning',
    'tool:call-2',
  ]);
});

test('completed turn result reuses the finalized assistant text row instead of duplicating it', () => {
  const harness = createHarness();
  harness.pushUser('Hi DeepSeek');

  harness.orchestrator.applyRuntimeHostEvents([
    { kind: 'begin-assistant-response' },
    { kind: 'assistant-chunk', text: "Hi! I'm the Spirit Agent." },
    { kind: 'assistant-thinking-segment-finalized', text: 'The user greeted me.' },
    { kind: 'assistant-response-completed' },
  ]);

  harness.setCompletedTurnResult({
    kind: 'completed',
    assistantText: "Hi! I'm the Spirit Agent.",
    toolExecutions: [],
  });
  harness.orchestrator.consumeCompletedTurnResult();

  assert.deepEqual(harness.timeline.toMessages().map(rowToken), [
    'user',
    'thinking:The user greeted me.',
    "assistant:Hi! I'm the Spirit Agent.",
  ]);
});

test('completed Chinese greeting keeps finalized thinking above the final assistant text', () => {
  const harness = createHarness();
  harness.pushUser('你好啊');

  harness.orchestrator.applyRuntimeHostEvents([
    { kind: 'begin-assistant-response' },
    { kind: 'assistant-chunk', text: '你好！有什么可以帮你的吗？' },
    {
      kind: 'assistant-thinking-segment-finalized',
      text: 'The user is just greeting me with "你好啊" (Hello).',
    },
    { kind: 'assistant-response-completed' },
  ]);

  harness.setCompletedTurnResult({
    kind: 'completed',
    assistantText: '你好！有什么可以帮你的吗？',
    toolExecutions: [],
  });
  harness.orchestrator.consumeCompletedTurnResult();

  assert.deepEqual(harness.timeline.toMessages().map(rowToken), [
    'user',
    'thinking:The user is just greeting me with "你好啊" (Hello).',
    'assistant:你好！有什么可以帮你的吗？',
  ]);
});

test('tool previews keep live and finalized thinking above the tool card without duplicates', () => {
  const harness = createHarness();
  harness.pushUser('read README.md');

  harness.orchestrator.applyRuntimeHostEvents([
    { kind: 'begin-assistant-response' },
    {
      kind: 'streaming-tool-preview',
      toolCallId: 'call-1',
      toolName: 'read_file',
      argumentsJson: '{"filePath":"README.md"}',
    },
    { kind: 'update-pending-assistant-thinking', text: 'Need to inspect README.md first.' },
  ]);

  assert.deepEqual(visibleRowTokens(harness.timeline.toMessages()), [
    'user',
    'thinking:Need to inspect README.md first.',
    'tool:call-1',
  ]);

  harness.orchestrator.applyRuntimeHostEvents([
    { kind: 'assistant-thinking-segment-finalized', text: 'Need to inspect README.md first.' },
  ]);

  assert.deepEqual(visibleRowTokens(harness.timeline.toMessages()), [
    'user',
    'thinking:Need to inspect README.md first.',
    'tool:call-1',
  ]);
});