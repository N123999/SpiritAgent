import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DesktopAssistantMessageStateMachine } from '../../dist-electron/src/host/assistant-message-state.js';
import { DesktopConversationSnapshotView } from '../../dist-electron/src/host/conversation-snapshot.js';
import { DesktopMessageTimeline } from '../../dist-electron/src/host/message-timeline.js';
import { DesktopRuntimeEventOrchestrator } from '../../dist-electron/src/host/runtime-event-orchestrator.js';

function createHarness() {
  let messages = [];
  let nextMessageId = 1;
  let nextTimelineMessageId = 1;
  let nextSegmentKind = 'initial';
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
    runtime: () => undefined,
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