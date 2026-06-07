import assert from 'node:assert/strict';
import test from 'node:test';
import type { TextStreamPart } from 'ai';

import type { JsonValue, ToolAgentRoundCompletion } from '../ports.js';
import { extractLastAssistantText, isJsonObject, type ToolAgentState } from '../tool-agent.js';
import {
  parseResponsesBuiltInToolUiFromArgumentsJson,
  resolveResponsesBuiltInToolStreamPhaseFromArgumentsJson,
} from './responses-built-in-tools.js';
import { createDeferred, responsesEventStreamToRuntimeEvents } from './streaming.js';
import type { OpenResponsesTransportConfig } from './responses-compat.js';

const gatewayConfig: OpenResponsesTransportConfig = {
  transportKind: 'open-responses',
  apiKey: 'test',
  model: 'deepseek/deepseek-v4-pro',
  llmVendor: 'vercel-ai-gateway',
};

async function collectGatewayToolRound(
  stream: AsyncIterable<TextStreamPart<any>>,
): Promise<Extract<ToolAgentRoundCompletion<ToolAgentState>, { kind: 'success' }>> {
  const state: ToolAgentState = { messages: [], steps: 0 };
  const completion = createDeferred<ToolAgentRoundCompletion<ToolAgentState>>();

  for await (const _event of responsesEventStreamToRuntimeEvents(
    gatewayConfig,
    stream,
    {},
    state,
    [],
    completion,
  )) {
    // drain
  }

  const result = await completion.promise;
  assert.equal(result.kind, 'success');
  if (result.kind !== 'success') {
    throw new Error('expected success completion');
  }
  return result;
}

test('gateway sdk stream skips resume when single-step metadata already has full answer', async () => {
  async function* stream(): AsyncGenerator<TextStreamPart<any>> {
    yield { type: 'text-delta', id: 'text-0', text: 'Searching now.' };
    yield { type: 'tool-call', toolCallId: 'call_search', toolName: 'web_search', input: { query: 'latest models' } };
    yield {
      type: 'tool-result',
      toolCallId: 'call_search',
      toolName: 'web_search',
      input: { query: 'latest models' },
      output: { results: [{ title: 'Example', url: 'https://example.com', snippet: 'hello' }], id: 'search-1' },
    };
  }

  const state: ToolAgentState = { messages: [], steps: 0 };
  const completion = createDeferred<ToolAgentRoundCompletion<ToolAgentState>>();
  const usageSource = {
    text: Promise.resolve('Searching now.\n\nLatest models include Example.'),
    steps: Promise.resolve([
      { text: 'Searching now.\n\nLatest models include Example.' },
    ]),
  } as Parameters<typeof responsesEventStreamToRuntimeEvents>[2];

  for await (const _event of responsesEventStreamToRuntimeEvents(
    gatewayConfig,
    stream(),
    usageSource,
    state,
    [],
    completion,
  )) {
    // drain
  }

  const result = await completion.promise;
  assert.equal(result.kind, 'success');
  if (result.kind !== 'success') {
    throw new Error('expected success completion');
  }
  assert.equal(result.result.resumeStreamingAfterProviderSearch, undefined);
  assert.equal(
    extractLastAssistantText(result.result.state),
    'Searching now.\n\nLatest models include Example.',
  );
});

test('gateway sdk stream merges final step text after executed web_search', async () => {
  async function* stream(): AsyncGenerator<TextStreamPart<any>> {
    yield { type: 'text-delta', id: 'text-0', text: 'Searching now.' };
    yield { type: 'tool-call', toolCallId: 'call_search', toolName: 'web_search', input: { query: 'latest models' } };
    yield {
      type: 'tool-result',
      toolCallId: 'call_search',
      toolName: 'web_search',
      input: { query: 'latest models' },
      output: { results: [{ title: 'Example', url: 'https://example.com', snippet: 'hello' }], id: 'search-1' },
    };
  }

  const state: ToolAgentState = { messages: [], steps: 0 };
  const completion = createDeferred<ToolAgentRoundCompletion<ToolAgentState>>();
  const usageSource = {
    text: Promise.resolve('Latest models include Example.'),
    steps: Promise.resolve([
      { text: 'Searching now.' },
      { text: 'Latest models include Example.' },
    ]),
  } as Parameters<typeof responsesEventStreamToRuntimeEvents>[2];

  for await (const _event of responsesEventStreamToRuntimeEvents(
    gatewayConfig,
    stream(),
    usageSource,
    state,
    [],
    completion,
  )) {
    // drain
  }

  const result = await completion.promise;
  assert.equal(result.kind, 'success');
  if (result.kind !== 'success') {
    throw new Error('expected success completion');
  }
  assert.equal(result.result.resumeStreamingAfterProviderSearch, undefined);
  assert.equal(extractLastAssistantText(result.result.state), 'Searching now.\n\nLatest models include Example.');
});

test('gateway sdk stream persists provider search results before synthesis follow-up', async () => {
  async function* stream(): AsyncGenerator<TextStreamPart<any>> {
    yield { type: 'text-delta', id: 'text-0', text: '好的，让我搜一下。' };
    yield { type: 'tool-call', toolCallId: 'call_search', toolName: 'web_search', input: { query: 'latest models' } };
    yield {
      type: 'tool-result',
      toolCallId: 'call_search',
      toolName: 'web_search',
      input: { query: 'latest models' },
      output: {
        results: [{ title: 'Example', url: 'https://example.com', snippet: 'hello' }],
        id: 'search-1',
      },
    };
  }

  const state: ToolAgentState = { messages: [{ role: 'user', content: 'search' }], steps: 0 };
  const completion = createDeferred<ToolAgentRoundCompletion<ToolAgentState>>();
  const usageSource = {
    text: Promise.resolve('好的，让我搜一下。'),
    steps: Promise.resolve([{ text: '好的，让我搜一下。' }]),
  } as Parameters<typeof responsesEventStreamToRuntimeEvents>[2];

  for await (const _event of responsesEventStreamToRuntimeEvents(
    gatewayConfig,
    stream(),
    usageSource,
    state,
    [],
    completion,
  )) {
    // drain
  }

  const result = await completion.promise;
  assert.equal(result.kind, 'success');
  if (result.kind !== 'success') {
    throw new Error('expected success completion');
  }
  assert.equal(result.result.resumeStreamingAfterProviderSearch, true);
  assert.equal(result.result.state.messages.length, 3);
  const assistantMessage = result.result.state.messages.at(1);
  assert.ok(isJsonObject(assistantMessage));
  assert.equal(assistantMessage.content, '好的，让我搜一下。');
  const toolMessage = result.result.state.messages.at(-1);
  assert.ok(isJsonObject(toolMessage));
  assert.equal(toolMessage.role, 'tool');
  assert.match(String(toolMessage.content), /Example/);
});

test('gateway sdk stream omits executed web_search from host tool-calls step', async () => {
  async function* stream(): AsyncGenerator<TextStreamPart<any>> {
    yield { type: 'tool-call', toolCallId: 'call_search', toolName: 'web_search', input: { query: 'latest models' } };
    yield {
      type: 'tool-result',
      toolCallId: 'call_search',
      toolName: 'web_search',
      input: { query: 'latest models' },
      output: { results: [{ title: 'Example', url: 'https://example.com', snippet: 'hello' }], id: 'search-1' },
    };
    yield { type: 'text-delta', id: 'text-0', text: 'Latest models include Example.' };
  }

  const state: ToolAgentState = { messages: [], steps: 0 };
  const completion = createDeferred<ToolAgentRoundCompletion<ToolAgentState>>();
  const usageSource = {
    text: Promise.resolve('Latest models include Example.'),
    steps: Promise.resolve([
      { text: '' },
      { text: 'Latest models include Example.' },
    ]),
  } as Parameters<typeof responsesEventStreamToRuntimeEvents>[2];

  for await (const _event of responsesEventStreamToRuntimeEvents(
    gatewayConfig,
    stream(),
    usageSource,
    state,
    [],
    completion,
  )) {
    // drain
  }

  const result = await completion.promise;
  assert.equal(result.kind, 'success');
  if (result.kind !== 'success') {
    throw new Error('expected success completion');
  }
  const round = result.result;
  assert.equal(round.step.kind, 'final-response-ready');
  assert.equal(extractLastAssistantText(round.state), 'Latest models include Example.');
  const lastMessage = round.state.messages.at(-1);
  assert.ok(lastMessage && typeof lastMessage === 'object' && !Array.isArray(lastMessage));
  assert.equal('tool_calls' in lastMessage, false);
});

test('gateway sdk stream emits succeeded web_search preview on tool-result', async () => {
  async function* stream(): AsyncGenerator<TextStreamPart<any>> {
    yield { type: 'tool-call', toolCallId: 'call_search', toolName: 'web_search', input: { query: 'latest models' } };
    yield {
      type: 'tool-result',
      toolCallId: 'call_search',
      toolName: 'web_search',
      input: { query: 'latest models' },
      output: {
        results: [{ title: 'Example', url: 'https://example.com', snippet: 'hello' }],
        id: 'search-1',
      },
    };
    yield { type: 'text-delta', id: 'text-0', text: 'Latest models include Example.' };
  }

  const state: ToolAgentState = { messages: [], steps: 0 };
  const completion = createDeferred<ToolAgentRoundCompletion<ToolAgentState>>();
  const usageSource = {
    text: Promise.resolve('Latest models include Example.'),
    steps: Promise.resolve([
      { text: '' },
      { text: 'Latest models include Example.' },
    ]),
  } as Parameters<typeof responsesEventStreamToRuntimeEvents>[2];

  const previewEvents: Array<{
    toolCallId: string;
    argumentsJson: string;
  }> = [];

  for await (const event of responsesEventStreamToRuntimeEvents(
    gatewayConfig,
    stream(),
    usageSource,
    state,
    [],
    completion,
  )) {
    if (event.kind === 'streaming-tool-preview' && event.toolName === 'web_search') {
      previewEvents.push({
        toolCallId: event.toolCallId,
        argumentsJson: event.argumentsJson,
      });
    }
  }

  assert.ok(previewEvents.length >= 2);
  const succeededPreview = previewEvents.find(
    (preview) =>
      resolveResponsesBuiltInToolStreamPhaseFromArgumentsJson(preview.argumentsJson) === 'succeeded',
  );
  assert.ok(succeededPreview);
  const ui = parseResponsesBuiltInToolUiFromArgumentsJson(succeededPreview!.argumentsJson);
  assert.match(ui?.outputExcerpt ?? '', /example\.com/);
});

test('gateway sdk stream aggregates tool-input/tool-call without Open Responses raw items', async () => {
  async function* stream(): AsyncGenerator<TextStreamPart<any>> {
    yield { type: 'reasoning-delta', id: 'reasoning-0', text: 'Plan to run shell.' };
    yield { type: 'tool-input-start', id: 'call_gateway_shell', toolName: 'run_shell_command' };
    yield { type: 'tool-input-delta', id: 'call_gateway_shell', delta: '{"reason":"Echo","command":"echo nb"}' };
    yield { type: 'tool-input-end', id: 'call_gateway_shell' };
    yield {
      type: 'tool-call',
      toolCallId: 'call_gateway_shell',
      toolName: 'run_shell_command',
      input: { reason: 'Echo', command: 'echo nb' },
    };
  }

  const completion = await collectGatewayToolRound(stream());
  const round = completion.result;
  assert.equal(round.step.kind, 'tool-calls');
  if (round.step.kind !== 'tool-calls') {
    throw new Error('expected tool-calls step');
  }

  assert.equal(round.step.calls.length, 1);
  assert.equal(round.step.calls[0]?.id, 'call_gateway_shell');
  assert.equal(round.step.calls[0]?.name, 'run_shell_command');
  assert.equal(extractLastAssistantText(round.state), undefined);
});
