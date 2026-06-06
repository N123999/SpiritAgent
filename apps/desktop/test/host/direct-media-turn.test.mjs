import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DesktopAssistantMessageStateMachine } from '../../dist-electron/src/host/assistant-message-state.js';
import { DesktopMessageTimeline } from '../../dist-electron/src/host/message-timeline.js';
import { DesktopRuntimeEventOrchestrator } from '../../dist-electron/src/host/runtime-event-orchestrator.js';
import {
  executeDirectMediaTurn,
  shouldUseComposerDirectMediaTurn,
} from '../../dist-electron/src/host/direct-media-turn.js';

const imageModel = {
  name: 'dall-e-3',
  apiBase: 'https://api.openai.com/v1',
  capabilities: ['imageGeneration'],
};

const config = {
  activeModel: 'dall-e-3',
  models: [imageModel],
  imageGenerationModel: 'dall-e-3',
};

test('shouldUseComposerDirectMediaTurn returns null when attachments are present', () => {
  assert.equal(shouldUseComposerDirectMediaTurn(config, 'dall-e-3', 1), null);
});

function createDirectMediaHarness() {
  let messages = [];
  let nextMessageId = 1;
  let nextTimelineMessageId = 1;
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
    allocateMessageId: () => nextMessageId++,
    isRuntimeBusy: () => false,
  });
  const orchestrator = new DesktopRuntimeEventOrchestrator({
    runtime: () => ({
      takeCompletedTurnResult: () => undefined,
    }),
    messages: () => messages,
    allocateMessageId: () => nextMessageId++,
    assistantMessages,
    messageTimeline: () => timeline,
    takeNextAssistantSegmentKind: () => 'initial',
    conversationSnapshotView: {
      snapshotFromMessages: () => ({ messages: [] }),
    },
    clearCurrentTurnSkills: () => {},
    setLastRuntimeError: () => {},
    refreshArchiveFromRuntime: () => {},
    dispatchExtensionEvent: () => {},
    bindFileChangesToToolMessage: () => {},
  });

  const bundle = {
    archiveHistory: [],
    messages: [],
    messageTimeline: timeline,
    runtimeTransport: {
      async generateImage(_config, request, saveGenerated) {
        await saveGenerated({
          data: new Uint8Array([1, 2, 3]),
          mediaType: 'image/png',
          prompt: request.prompt,
          model: 'dall-e-3',
        });
        return {
          content: [
            { type: 'text', text: '[generated image]' },
            { type: 'image', path: 'generated/direct-test.png' },
          ],
          summaryText: [
            '[generated image]',
            'image_ref: spirit-agent://generated/image/direct-test.png',
          ].join('\n'),
        };
      },
    },
  };

  timeline.beginUserTurn('draw a square poster', { messageId: 1 });
  bundle.messages = timeline.toMessages();

  const ctx = {
    requireConfig: () => config,
    resolveApiKeyForConfigModel: async () => 'test-key',
    ensureToolExecutor: async () => ({
      async saveGeneratedImage(request) {
        return {
          path: 'generated/direct-test.png',
          mimeType: request.mediaType,
          markdownRef: 'spirit-agent://generated/image/direct-test.png',
        };
      },
    }),
    orchestrationFor: () => ({
      runtimeEvents: orchestrator,
    }),
    emitLiveSnapshotUpdate: () => {},
    recordRewindCheckpoint: async () => {},
    persistSessionBundle: async () => {},
  };

  return { bundle, ctx, messages: () => messages };
}

test('executeDirectMediaTurn emits succeeded generate_image tool card and archive rows', async () => {
  const harness = createDirectMediaHarness();

  await executeDirectMediaTurn(harness.ctx, {
    bundle: harness.bundle,
    toolName: 'generate_image',
    prompt: 'draw a square poster',
    userMessageId: 1,
    beforeUserCheckpoint: undefined,
  });

  const toolMessage = harness.messages().find((message) => message.tool?.toolName === 'generate_image');
  assert.ok(toolMessage);
  assert.equal(toolMessage.tool.phase, 'succeeded');
  assert.deepEqual(toolMessage.tool.imagePaths, ['generated/direct-test.png']);
  assert.equal(harness.bundle.archiveHistory.length, 3);
  assert.match(harness.bundle.archiveHistory[2].content[0].text, /spirit-agent:\/\/generated\/image/);
});
