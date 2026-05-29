import assert from 'node:assert/strict';
import test from 'node:test';

import { AgentRuntime } from '../runtime.js';
import { assistantToolCallMessageFromState } from '../tool-agent.js';
import { createTurnContext } from './helpers.js';
import {
  processToolCalls,
  runTurnLoop,
  shouldSkipPersistAssistantToolCalls,
  type TurnMachineRuntime,
} from './turn-machine.js';

test('shouldSkipPersistAssistantToolCalls skips subset re-persist after partial completion', () => {
  const history = [{
    role: 'assistant' as const,
    content: [],
    toolCalls: [
      { id: 'call_00', name: 'glob', argumentsJson: '{}' },
      { id: 'call_01', name: 'grep', argumentsJson: '{}' },
    ],
  }];
  const remaining = [{ id: 'call_01', name: 'grep', argumentsJson: '{}' }];

  assert.equal(shouldSkipPersistAssistantToolCalls(history, remaining), true);
  assert.equal(
    shouldSkipPersistAssistantToolCalls(history, [{ id: 'call_02', name: 'read_file', argumentsJson: '{}' }]),
    false,
  );
});

test('processToolCalls does not re-persist assistant tool calls when continuing remaining calls', async () => {
  const state = { messages: [] as Array<{ role: string; content: string }>, steps: 0 };
  const calls = [
    { id: 'call_00', name: 'glob', argumentsJson: '{}' },
    { id: 'call_01', name: 'grep', argumentsJson: '{}' },
  ];
  let performExecutionCount = 0;
  const runtime = {
    options: {
      config: {},
      llmTransport: {
        startToolAgentRound: async () => ({
          kind: 'success',
          result: {
            state,
            step: { kind: 'final-response-ready' },
            requestTrace: [],
          },
        }),
      },
      toolExecutor: {
        toolDefinitionsJson: () => [],
        requestFromFunctionCall: async (name: string) => ({ name }),
        authorize: async () => ({ kind: 'allowed' }),
        execute: async (request: { name: string }) => ({
          content: [],
          summaryText: `ok:${request.name}`,
        }),
      },
      createToolAgentState: () => state,
      appendToolResultMessage: (
        currentState: typeof state,
        toolCallId: string,
        content: string,
      ) => ({
        messages: [...currentState.messages, { role: 'tool', content, toolCallId }],
        steps: currentState.steps,
      }),
      extractAssistantText: () => 'done',
    },
    historyStore: [],
    requestTraceStore: [],
    pendingUserTurnStore: undefined,
    pendingApproval: undefined,
    pendingQuestions: undefined,
    pendingToolAgentRound: undefined,
    appendTrace: () => {},
    clearStreamingUiState: () => {},
    completeTurn: () => {},
    emitEvent: () => {},
    performToolExecution: async (_request: { name: string }, toolName: string) => {
      performExecutionCount += 1;
      return {
        output: { content: [], summaryText: `ok:${toolName}` },
        failed: false,
        backgroundExecution: false,
      };
    },
    startBackgroundToolExecutionAsync: () => {
      throw new Error('unused');
    },
    startHistoryCompactionAsync: () => {},
    loopEnabled: () => false,
  } as unknown as TurnMachineRuntime<{}, typeof state, { name: string }>;

  const result = await processToolCalls(runtime, state, 'run tools', calls, createTurnContext());

  assert.equal(result.kind, 'completed');
  assert.equal(performExecutionCount, 2);
  assert.equal(
    runtime.historyStore.filter((message) => message.role === 'assistant' && message.toolCalls?.length).length,
    1,
  );
  assert.deepEqual(
    runtime.historyStore
      .filter((message) => message.role === 'assistant' && message.toolCalls?.length)
      .flatMap((message) => message.toolCalls?.map((toolCall) => toolCall.id) ?? []),
    ['call_00', 'call_01'],
  );
});

test('processToolCalls persists the full assistant tool-call message from state', async () => {
  const state = {
    messages: [{
      role: 'assistant',
      content: 'calling weather',
      reasoning_parts: [{
        type: 'reasoning',
        text: 'Need weather first.',
        providerOptions: {
          anthropic: {
            signature: 'sig_turn_machine',
          },
        },
      }],
      tool_calls: [{
        id: 'call_weather',
        type: 'function',
        function: {
          name: 'get_weather',
          arguments: '{"city":"Paris"}',
        },
      }],
    }],
    steps: 1,
  };
  const calls = [{
    id: 'call_weather',
    name: 'get_weather',
    argumentsJson: '{"city":"Paris"}',
  }];

  const runtime = {
    options: {
      config: {},
      llmTransport: {
        startToolAgentRound: async () => ({ kind: 'failure', error: 'unused', requestTrace: [] }),
      },
      toolExecutor: {
        toolDefinitionsJson: () => [],
        requestFromFunctionCall: async (_name: string, argumentsJson: string) => ({ argumentsJson }),
        authorize: async () => ({ kind: 'need-approval', prompt: 'approve?' }),
        execute: async () => ({ content: [], summaryText: '' }),
      },
      createToolAgentState: () => state,
      appendToolResultMessage: (currentState: typeof state) => currentState,
      assistantToolCallMessageFromState,
      extractAssistantText: () => undefined,
    },
    historyStore: [],
    requestTraceStore: [],
    pendingUserTurnStore: undefined,
    pendingApproval: undefined,
    pendingQuestions: undefined,
    pendingToolAgentRound: undefined,
    appendTrace: () => {},
    clearStreamingUiState: () => {},
    completeTurn: () => {},
    emitEvent: () => {},
    performToolExecution: async () => {
      throw new Error('unused');
    },
    startBackgroundToolExecutionAsync: () => {
      throw new Error('unused');
    },
    startHistoryCompactionAsync: () => {},
  } as unknown as TurnMachineRuntime<{}, typeof state, { argumentsJson: string }>;

  const result = await processToolCalls(runtime, state, 'weather?', calls, createTurnContext());

  assert.equal(result.kind, 'requires-approval');
  assert.equal(runtime.historyStore.length, 1);
  assert.deepEqual(runtime.historyStore[0], {
    role: 'assistant',
    content: [{
      type: 'text',
      text: 'calling weather',
    }],
    toolCalls: [{
      id: 'call_weather',
      name: 'get_weather',
      argumentsJson: '{"city":"Paris"}',
    }],
    providerState: {
      reasoning_parts: [{
        type: 'reasoning',
        text: 'Need weather first.',
        providerOptions: {
          anthropic: {
            signature: 'sig_turn_machine',
          },
        },
      }],
    },
  });
});

test('runTurnLoop completes ordinary final response when Loop is disabled', async () => {
  const state = { messages: [] as Array<{ role: string; content: string }>, steps: 0 };
  const runtime = buildLoopTestRuntime({
    loopEnabled: false,
    rounds: [{ kind: 'final', text: 'done' }],
  });

  const result = await runTurnLoop(runtime, state, 'work', createTurnContext());

  assert.equal(result.kind, 'completed');
  assert.equal(result.kind === 'completed' ? result.assistantText : '', 'done');
  assert.deepEqual(runtime.historyStore.map((message) => message.role), ['assistant']);
});

test('runTurnLoop continues ordinary final response when Loop is enabled', async () => {
  const state = { messages: [] as Array<{ role: string; content: string }>, steps: 0 };
  const runtime = buildLoopTestRuntime({
    loopEnabled: true,
    rounds: [
      { kind: 'final', text: 'step one' },
      { kind: 'failure', error: 'stop after loop continuation' },
    ],
  });

  const result = await runTurnLoop(runtime, state, 'work', createTurnContext());

  assert.equal(result.kind, 'failed');
  assert.equal(runtime.roundsStarted, 2);
  assert.deepEqual(runtime.historyStore.map((message) => message.role), ['assistant', 'user']);
  assert.match(runtime.historyStore[1]?.content[0]?.type === 'text' ? runtime.historyStore[1].content[0].text : '', /finish_task/);
  assert.match(runtime.historyStore[1]?.content[0]?.type === 'text' ? runtime.historyStore[1].content[0].text : '', /Original user request:\nwork/);
  assert.equal(runtime.pendingUserTurnStore, 'work');
});

test('AgentRuntime completes Loop when finish_task is called', async () => {
  const runtime = new AgentRuntime(
    buildAgentRuntimeOptions([
      { kind: 'final', text: 'step one' },
      { kind: 'tool', id: 'call_finish', name: 'finish_task', argumentsJson: '{"summary":"all done"}' },
    ]),
  );
  runtime.setLoopEnabled(true);

  const result = await runtime.submitUserTurn('work');

  assert.equal(result.kind, 'completed');
  assert.equal(result.kind === 'completed' ? result.assistantText : '', 'all done');
  assert.equal(runtime.loopEnabled(), true);
  assert.deepEqual(runtime.history().map((message) => message.role), ['user', 'assistant', 'user', 'assistant', 'tool']);
});

test('AgentRuntime omits sync assistant UI events when finish_task completes', async () => {
  const runtime = new AgentRuntime(
    buildAgentRuntimeOptions([
      { kind: 'tool', id: 'call_finish', name: 'finish_task', argumentsJson: '{"summary":"all done"}' },
    ]),
  );

  await runtime.submitUserTurn('work');
  const events = runtime.drainEvents();

  assert.equal(events.some((event) => event.kind === 'begin-assistant-response'), false);
  assert.equal(events.some((event) => event.kind === 'assistant-chunk'), false);
  assert.equal(events.some((event) => event.kind === 'assistant-response-completed'), false);
});

test('AgentRuntime accepts finish_task when Loop is disabled', async () => {
  const runtime = new AgentRuntime(
    buildAgentRuntimeOptions([
      { kind: 'tool', id: 'call_finish', name: 'finish_task', argumentsJson: '{}' },
    ]),
  );

  const result = await runtime.submitUserTurn('work');

  assert.equal(result.kind, 'completed');
  assert.equal(result.kind === 'completed' ? result.assistantText : '', 'Task marked complete.');
  assert.equal(runtime.loopEnabled(), false);
});

type LoopTestRound =
  | { kind: 'final'; text: string }
  | { kind: 'tool'; id: string; name: string; argumentsJson: string }
  | { kind: 'failure'; error: string };

function buildLoopTestRuntime(options: {
  loopEnabled: boolean;
  rounds: LoopTestRound[];
}): TurnMachineRuntime<{}, { messages: Array<{ role: string; content?: string }>; steps: number }, { name: string; summary?: string }> & {
  roundsStarted: number;
} {
  let index = 0;
  const runtime = {
    roundsStarted: 0,
    options: {
      config: {},
      llmTransport: {
        startToolAgentRound: async () => {
          runtime.roundsStarted += 1;
          const round = options.rounds[index++];
          if (!round || round.kind === 'failure') {
            return {
              kind: 'failure' as const,
              error: round?.kind === 'failure' ? round.error : 'missing round',
              requestTrace: [],
            };
          }
          if (round.kind === 'tool') {
            return {
              kind: 'success' as const,
              result: {
                state: { messages: [], steps: 0 },
                step: {
                  kind: 'tool-calls' as const,
                  calls: [{ id: round.id, name: round.name, argumentsJson: round.argumentsJson }],
                },
                requestTrace: [],
              },
            };
          }
          return {
            kind: 'success' as const,
            result: {
              state: { messages: [{ role: 'assistant', content: round.text }], steps: 0 },
              step: { kind: 'final-response-ready' as const },
              requestTrace: [],
            },
          };
        },
        isContextOverflowError: () => false,
      },
      toolExecutor: {
        toolDefinitionsJson: () => [],
        requestFromFunctionCall: async (name: string, argumentsJson: string) => ({
          name,
          ...(JSON.parse(argumentsJson) as { summary?: string }),
        }),
        authorize: async () => ({ kind: 'allowed' as const }),
        execute: async () => ({ content: [], summaryText: '' }),
      },
      createToolAgentState: () => ({ messages: [], steps: 0 }),
      appendUserMessage: (currentState: { messages: Array<{ role: string; content?: string }>; steps: number }, content: string) => ({
        messages: [...currentState.messages, { role: 'user', content }],
        steps: currentState.steps,
      }),
      appendToolResultMessage: (currentState: { messages: Array<{ role: string; content?: string }>; steps: number }) => currentState,
      extractAssistantText: (currentState: { messages: Array<{ role: string; content?: string }> }) =>
        latestAssistantContent(currentState.messages),
    },
    historyStore: [],
    requestTraceStore: [],
    pendingUserTurnStore: undefined,
    pendingApproval: undefined,
    pendingQuestions: undefined,
    pendingToolAgentRound: undefined,
    appendTrace: () => {},
    clearStreamingUiState: () => {},
    completeTurn: () => {},
    emitEvent: () => {},
    performToolExecution: async () => ({ output: { content: [], summaryText: '' }, failed: false, backgroundExecution: false }),
    startBackgroundToolExecutionAsync: () => {},
    startHistoryCompactionAsync: () => {},
    startStreamingRound: async () => {},
    queuePendingToolCallContinuation: () => {},
    takeCompletedTurnResult: () => undefined,
    tryFallbackToTextOnlyAndBuildRetryState: () => undefined,
    compactHistoryImmediate: async () => ({ droppedMessages: 0, beforeLength: 0, afterLength: 0 }),
    loopEnabled: () => options.loopEnabled,
    isBusy: () => false,
    poll: async () => {},
  } as unknown as TurnMachineRuntime<{}, { messages: Array<{ role: string; content?: string }>; steps: number }, { name: string; summary?: string }> & {
    roundsStarted: number;
  };
  return runtime;
}

function buildAgentRuntimeOptions(rounds: LoopTestRound[]): any {
  let index = 0;
  return {
    config: {},
    llmTransport: {
      startToolAgentRound: async () => {
        const round = rounds[index++];
        if (!round || round.kind === 'failure') {
          return {
            kind: 'failure' as const,
            error: round?.kind === 'failure' ? round.error : 'missing round',
            requestTrace: [],
          };
        }
        if (round.kind === 'tool') {
          return {
            kind: 'success' as const,
            result: {
              state: {
                messages: [{
                  role: 'assistant',
                  content: '',
                  tool_calls: [{
                    id: round.id,
                    type: 'function',
                    function: {
                      name: round.name,
                      arguments: round.argumentsJson,
                    },
                  }],
                }],
                steps: 0,
              },
              step: {
                kind: 'tool-calls' as const,
                calls: [{ id: round.id, name: round.name, argumentsJson: round.argumentsJson }],
              },
              requestTrace: [],
            },
          };
        }
        return {
          kind: 'success' as const,
          result: {
            state: { messages: [{ role: 'assistant', content: round.text }], steps: 0 },
            step: { kind: 'final-response-ready' as const },
            requestTrace: [],
          },
        };
      },
      compactHistoryManual: async () => ({ droppedMessages: 0, beforeLength: 0, afterLength: 0 }),
      compactSummaryText: () => undefined,
      isContextOverflowError: () => false,
      llmHistoryAsApiMessages: () => [],
      llmSystemPromptsForExport: () => ({}),
    },
    toolExecutor: {
      toolDefinitionsJson: () => [],
      parseCommand: async () => ({ name: 'finish_task' }),
      requestFromFunctionCall: async (name: string, argumentsJson: string) => ({
        name,
        ...(JSON.parse(argumentsJson || '{}') as { summary?: string }),
      }),
      authorize: async () => ({ kind: 'allowed' as const }),
      trust: async () => {},
      execute: async () => ({ content: [], summaryText: '' }),
      startMcpBackgroundRefresh: () => {},
      mcpStatusSnapshot: () => ({
        revision: 0,
        state: 'idle' as const,
        configuredServers: 0,
        loadedServers: 0,
        cachedTools: 0,
      }),
      addMcpServer: async () => '',
      listMcpServers: async () => [],
      inspectMcpServer: async () => ({}),
      listMcpTools: async () => [],
      listMcpResources: async () => [],
      readMcpResource: async () => ({}),
      listCachedMcpPrompts: async () => [],
      listMcpPrompts: async () => [],
      getMcpPrompt: async () => ({}),
    },
    createToolAgentState: (_history: unknown[], userInput: string) => ({
      messages: [{ role: 'user', content: userInput }],
      steps: 0,
    }),
    appendUserMessage: (state: { messages: unknown[]; steps: number }, content: string) => ({
      messages: [...state.messages, { role: 'user', content }],
      steps: state.steps,
    }),
    createContinuationState: () => ({ messages: [], steps: 0 }),
    appendToolResultMessage: (state: { messages: unknown[]; steps: number }, toolCallId: string, content: string) => ({
      messages: [...state.messages, { role: 'tool', tool_call_id: toolCallId, content }],
      steps: state.steps,
    }),
    assistantToolCallMessageFromState: (state: unknown, calls: Parameters<typeof assistantToolCallMessageFromState>[1]) =>
      assistantToolCallMessageFromState(state as Parameters<typeof assistantToolCallMessageFromState>[0], calls),
    extractAssistantText: (state: { messages: Array<{ role: string; content?: string }> }) =>
      latestAssistantContent(state.messages),
  };
}

function latestAssistantContent(messages: Array<{ role: string; content?: string }>): string | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === 'assistant') {
      return message.content;
    }
  }
  return undefined;
}
