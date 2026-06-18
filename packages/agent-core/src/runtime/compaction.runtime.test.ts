import assert from 'node:assert/strict';
import test from 'node:test';

import { COMPACT_SUMMARY_PREFIX } from '../tool-agent.js';
import { truncateLlmHistoryForCompaction } from '../llm-tool-agent.js';
import {
  createLlmMessageContentFromText,
  llmMessageTextContent,
  type LlmMessage,
  type LlmTransport,
} from '../ports.js';
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

test('compactHistoryImmediate emits event when pre-compaction archive persist fails', async () => {
  const history: LlmMessage[] = [
    { role: 'user', content: createLlmMessageContentFromText('hello') },
  ];

  const llmTransport: LlmTransport<undefined, TestState> = {
    startToolAgentRound: async () => {
      throw new Error('not used');
    },
    async compactHistoryManual(_config, targetHistory) {
      targetHistory.splice(0, targetHistory.length, {
        role: 'system',
        content: createLlmMessageContentFromText(`${COMPACT_SUMMARY_PREFIX}\nsummary`),
      });
      return { droppedMessages: 0, beforeLength: 1, afterLength: 1 };
    },
    compactSummaryText: () => 'summary',
    isContextOverflowError: () => false,
    llmHistoryAsApiMessages: () => [],
    llmSystemPromptsForExport: () => ({}),
  };

  const events: Array<{ kind: string; error?: string }> = [];
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
    persistPreCompactionHistory: async () => {
      throw new Error('disk full');
    },
  };

  const runtime: CompactionRuntime<undefined, TestState, never> = {
    options,
    historyStore: history,
    compactionTextStore: '',
    pendingHistoryCompaction: undefined,
    completedManualHistoryCompactionResultStore: undefined,
    emitEvent: (event) => {
      events.push(event);
    },
    completeTurn: () => {},
    startToolAgentRoundAsync: () => {},
    startStreamingRound: async () => {},
    takeCompletedManualHistoryCompactionResult: () => undefined,
    isBusy: () => false,
    poll: async () => {},
  };

  const result = await compactHistoryImmediate(runtime);

  assert.equal(result.preCompactionArchivePath, undefined);
  assert.equal(events.length, 1);
  assert.equal(events[0]?.kind, 'pre-compaction-archive-persist-failed');
  assert.match(events[0]?.error ?? '', /disk full/);
});

test('compactHistoryImmediate archives pre-truncation history and compacts post-truncation history', async () => {
  const longToolOutput = 'x'.repeat(20_000);
  const history: LlmMessage[] = [
    { role: 'user', content: createLlmMessageContentFromText('investigate') },
    {
      role: 'assistant',
      content: [],
      toolCalls: [{ id: 'call-1', name: 'read_file', argumentsJson: '{}' }],
    },
    {
      role: 'tool',
      toolCallId: 'call-1',
      content: createLlmMessageContentFromText(longToolOutput),
    },
  ];

  let compactionToolText = '';

  const llmTransport: LlmTransport<undefined, TestState> = {
    startToolAgentRound: async () => {
      throw new Error('not used');
    },
    async compactHistoryManual(_config, targetHistory) {
      const toolMessage = targetHistory.find((entry) => entry.role === 'tool');
      compactionToolText = llmMessageTextContent(toolMessage?.content ?? []);
      targetHistory.splice(0, targetHistory.length, {
        role: 'system',
        content: createLlmMessageContentFromText(`${COMPACT_SUMMARY_PREFIX}\nsummary`),
      });
      return { droppedMessages: 2, beforeLength: 3, afterLength: 1 };
    },
    compactSummaryText: () => 'summary',
    isContextOverflowError: () => false,
    llmHistoryAsApiMessages: () => [],
    llmSystemPromptsForExport: () => ({}),
  };

  const options: AgentRuntimeOptions<undefined, TestState, never> = {
    config: undefined,
    llmTransport,
    truncateHistoryForCompaction: truncateLlmHistoryForCompaction,
    toolExecutor: {
      execute: async () => {
        throw new Error('not used');
      },
    } as unknown as AgentRuntimeOptions<undefined, TestState, never>['toolExecutor'],
    createToolAgentState: () => ({ messages: [] }),
    appendToolResultMessage: (state) => state,
    extractAssistantText: () => undefined,
    persistPreCompactionHistory: async ({ archive }) => {
      assert.equal(archive.message_count, 2);
      assert.equal(archive.messages[0]?.role, 'user');
      assert.equal(archive.messages[1]?.toolCalls?.[0]?.name, 'read_file');
      return '/tmp/archive.json';
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

  await compactHistoryImmediate(runtime);

  assert.match(compactionToolText, /\[tool output truncated for context retry\]/);
  assert.ok(compactionToolText.length < longToolOutput.length);
});

test('compactHistoryImmediate persists tool output archive path in truncated excerpt', async () => {
  const longToolOutput = 'y'.repeat(20_000);
  const archivePath = '/SpiritAgent/tool-output-archives/smoke-sess/call-1.txt';
  const history: LlmMessage[] = [
    { role: 'user', content: createLlmMessageContentFromText('investigate') },
    {
      role: 'tool',
      toolCallId: 'call-1',
      content: createLlmMessageContentFromText(longToolOutput),
    },
  ];

  let persistedContent = '';
  let compactionToolText = '';

  const llmTransport: LlmTransport<undefined, TestState> = {
    startToolAgentRound: async () => {
      throw new Error('not used');
    },
    async compactHistoryManual(_config, targetHistory) {
      const toolMessage = targetHistory.find((entry) => entry.role === 'tool');
      compactionToolText = llmMessageTextContent(toolMessage?.content ?? []);
      targetHistory.splice(0, targetHistory.length, {
        role: 'system',
        content: createLlmMessageContentFromText(`${COMPACT_SUMMARY_PREFIX}\nsummary`),
      });
      return { droppedMessages: 1, beforeLength: 2, afterLength: 1 };
    },
    compactSummaryText: () => 'summary',
    isContextOverflowError: () => false,
    llmHistoryAsApiMessages: () => [],
    llmSystemPromptsForExport: () => ({}),
  };

  const options: AgentRuntimeOptions<undefined, TestState, never> = {
    config: undefined,
    llmTransport,
    truncateHistoryForCompaction: truncateLlmHistoryForCompaction,
    toolExecutor: {
      execute: async () => {
        throw new Error('not used');
      },
    } as unknown as AgentRuntimeOptions<undefined, TestState, never>['toolExecutor'],
    createToolAgentState: () => ({ messages: [] }),
    appendToolResultMessage: (state) => state,
    extractAssistantText: () => undefined,
    persistToolOutputArchive: async ({ content }) => {
      persistedContent = content;
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

  await compactHistoryImmediate(runtime);

  assert.equal(persistedContent, longToolOutput);
  assert.match(compactionToolText, /Full output archived at: \/SpiritAgent\/tool-output-archives\/smoke-sess\/call-1\.txt/u);
  assert.match(compactionToolText, /Use read_file on that path only when you need omitted details\./u);
});

test('compactHistoryImmediate removes orphan archive when compaction fails after persist', async () => {
  const archivePath = '/tmp/spirit/compaction-archives/pre-compact-orphan.json';
  const history: LlmMessage[] = [
    { role: 'user', content: createLlmMessageContentFromText('hello') },
  ];

  const llmTransport: LlmTransport<undefined, TestState> = {
    startToolAgentRound: async () => {
      throw new Error('not used');
    },
    compactHistoryManual: async () => {
      throw new Error('llm unavailable');
    },
    compactSummaryText: () => undefined,
    isContextOverflowError: () => false,
    llmHistoryAsApiMessages: () => [],
    llmSystemPromptsForExport: () => ({}),
  };

  const removedPaths: string[] = [];
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
    persistPreCompactionHistory: async () => archivePath,
    removePreCompactionHistoryArchive: async (path) => {
      removedPaths.push(path);
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

  await assert.rejects(() => compactHistoryImmediate(runtime), /llm unavailable/);
  assert.deepEqual(removedPaths, [archivePath]);
});
