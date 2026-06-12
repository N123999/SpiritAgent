import assert from 'node:assert/strict';
import test from 'node:test';

import { COMPACT_SUMMARY_PREFIX } from '../tool-agent.js';
import { createLlmMessageContentFromText, type LlmMessage, type LlmTransport } from '../ports.js';
import { compactHistoryImmediate, type CompactionRuntime } from './compaction.js';
import type { AgentRuntimeOptions } from './types.js';

type TestState = { messages: LlmMessage[] };

test('compactHistoryImmediate persists archive without post-processing compact summary', async () => {
  const archivePath = '/tmp/spirit/compaction-archives/pre-compact-s1.json';
  const history: LlmMessage[] = [
    { role: 'user', content: createLlmMessageContentFromText('hello') },
    {
      role: 'assistant',
      content: [],
      toolCalls: [{ id: 'call-1', name: 'read_file', argumentsJson: '{}' }],
    },
    {
      role: 'tool',
      toolCallId: 'call-1',
      content: createLlmMessageContentFromText('noise'),
    },
  ];

  const llmTransport: LlmTransport<undefined, TestState> = {
    startToolAgentRound: async () => {
      throw new Error('not used');
    },
    async compactHistoryManual(_config, targetHistory) {
      targetHistory.splice(0, targetHistory.length, {
        role: 'system',
        content: createLlmMessageContentFromText(`${COMPACT_SUMMARY_PREFIX}\ncompact summary`),
      });
      return {
        droppedMessages: targetHistory.length > 0 ? 2 : 0,
        beforeLength: 3,
        afterLength: 1,
      };
    },
    compactSummaryText(targetHistory) {
      const message = targetHistory.find((entry) => entry.role === 'system');
      if (!message) {
        return undefined;
      }
      const text = message.content
        .filter((part) => part.type === 'text')
        .map((part) => part.text)
        .join('');
      return text.slice(COMPACT_SUMMARY_PREFIX.length).trim();
    },
    isContextOverflowError: () => false,
    llmHistoryAsApiMessages: () => [],
    llmSystemPromptsForExport: () => ({}),
  };

  let persisted = false;
  const options: AgentRuntimeOptions<undefined, TestState, never> = {
    config: undefined,
    llmTransport,
    toolExecutor: {
      execute: async () => {
        throw new Error('not used');
      },
    } as unknown as AgentRuntimeOptions<undefined, TestState, never>['toolExecutor'],
    createToolAgentState: () => ({ messages: [] }),
    appendToolResultMessage: (state) => state,
    extractAssistantText: () => undefined,
    persistPreCompactionHistory: async ({ archive }) => {
      persisted = true;
      assert.equal(archive.message_count, 2);
      assert.equal(archive.messages[1]?.toolCalls?.[0]?.name, 'read_file');
      return archivePath;
    },
  };

  const runtime: CompactionRuntime<undefined, TestState, never> = {
    options,
    historyStore: history,
    compactionTextStore: '',
    pendingHistoryCompaction: undefined,
    completedManualHistoryCompactionResultStore: undefined,
    emitEvent: () => {},
    completeTurn: () => {},
    startToolAgentRoundAsync: () => {},
    startStreamingRound: async () => {},
    takeCompletedManualHistoryCompactionResult: () => undefined,
    isBusy: () => false,
    poll: async () => {},
  };

  const result = await compactHistoryImmediate(runtime);

  assert.equal(persisted, true);
  assert.equal(result.preCompactionArchivePath, archivePath);
  assert.equal(runtime.historyStore.length, 1);
  const compactText = runtime.historyStore[0]?.content
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('');
  assert.equal(compactText, `${COMPACT_SUMMARY_PREFIX}\ncompact summary`);
});
