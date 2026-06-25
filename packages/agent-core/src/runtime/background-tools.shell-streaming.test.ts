import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createToolExecutionTextOutput,
  type AuthorizationDecision,
  type JsonValue,
  type ToolExecutionOutput,
  type ToolExecutor,
  type ToolRequestExecutionMetadata,
} from '../ports.js';
import { startBackgroundToolExecutionAsync, type BackgroundToolsRuntime } from './background-tools.js';
import type { RuntimeEvent, RuntimeTurnContext } from './types.js';

interface ShellToolRequest {
  name: 'shell';
  command: string;
}

class StreamingShellExecutor implements ToolExecutor<ShellToolRequest> {
  toolDefinitionsJson(): JsonValue {
    return [];
  }

  async parseCommand(): Promise<ShellToolRequest> {
    throw new Error('not implemented');
  }

  async requestFromFunctionCall(): Promise<ShellToolRequest> {
    throw new Error('not implemented');
  }

  async authorize(): Promise<AuthorizationDecision> {
    return { kind: 'allowed' };
  }

  async trust(): Promise<void> {}

  attachRequestMetadata(
    request: ShellToolRequest,
    metadata: ToolRequestExecutionMetadata,
  ): ShellToolRequest {
    this.lastMetadata = metadata;
    return request;
  }

  lastMetadata: ToolRequestExecutionMetadata | undefined;

  async execute(request: ShellToolRequest): Promise<ToolExecutionOutput> {
    this.lastMetadata?.onOutputChunk?.('line1\n');
    this.lastMetadata?.onOutputChunk?.('line2\n');
    return createToolExecutionTextOutput(`shell done: ${request.command}`);
  }

  shouldExecuteInBackground(request: ShellToolRequest): boolean {
    return request.name === 'shell';
  }

  backgroundStatusText(request: ShellToolRequest): string | undefined {
    return `Shell: ${request.command}`;
  }

  startMcpBackgroundRefresh(): void {}

  mcpStatusSnapshot() {
    return {
      revision: 0,
      state: 'idle' as const,
      configuredServers: 0,
      loadedServers: 0,
      cachedTools: 0,
    };
  }

  async addMcpServer(): Promise<string> {
    throw new Error('not implemented');
  }

  async listMcpServers(): Promise<never[]> {
    return [];
  }

  async inspectMcpServer(): Promise<never> {
    throw new Error('not implemented');
  }

  async listMcpTools(): Promise<never[]> {
    return [];
  }

  async listMcpResources(): Promise<never[]> {
    return [];
  }

  async readMcpResource(): Promise<JsonValue> {
    throw new Error('not implemented');
  }

  async listCachedMcpPrompts(): Promise<never[]> {
    return [];
  }

  async listMcpPrompts(): Promise<never[]> {
    return [];
  }

  async getMcpPrompt(): Promise<JsonValue> {
    throw new Error('not implemented');
  }
}

test('startBackgroundToolExecutionAsync emits tool-execution-output-chunk for shell', async () => {
  const executor = new StreamingShellExecutor();
  const events: RuntimeEvent<ShellToolRequest>[] = [];
  const request: ShellToolRequest = {
    name: 'shell',
    command: 'echo hello',
  };
  const turn: RuntimeTurnContext<ShellToolRequest> = {
    requestTrace: [],
    toolExecutions: [],
    compactions: [],
    autoCompactAttempts: 0,
    deferredUserGuidances: [],
  };

  type TestState = { messages: string[] };
  const runtime = {
    options: {
      toolExecutor: executor,
      appendToolResultMessage: (state: TestState) => state,
    },
    pendingBackgroundToolStatusStore: undefined as string | undefined,
    pendingBackgroundToolExecution: undefined,
    completedManualToolCommandResultStore: undefined,
    emitEvent: (event: RuntimeEvent<ShellToolRequest>) => {
      events.push(event);
    },
    persistToolExecutionResult: () => {},
    startToolAgentRoundAsync: () => {},
    startStreamingRound: async () => {},
    queuePendingToolCallContinuation: () => {},
    processToolCallsAsync: async () => {},
  } as unknown as BackgroundToolsRuntime<unknown, TestState, ShellToolRequest>;

  startBackgroundToolExecutionAsync(
    runtime,
    'run shell',
    { messages: [] },
    request,
    'call_shell_1',
    'shell',
    '{"command":"echo hello"}',
    [],
    turn,
  );

  await new Promise((resolve) => {
    setTimeout(resolve, 0);
  });

  const chunkEvents = events.filter(
    (event): event is Extract<RuntimeEvent<ShellToolRequest>, { kind: 'tool-execution-output-chunk' }> =>
      event.kind === 'tool-execution-output-chunk',
  );
  assert.equal(chunkEvents.length, 2);
  assert.equal(chunkEvents[0]?.chunk, 'line1\n');
  assert.equal(chunkEvents[1]?.chunk, 'line2\n');
  assert.ok(events.some((event) => event.kind === 'background-tool-status' && event.phase === 'started'));
  const pending = runtime.pendingBackgroundToolExecution;
  assert.ok(pending && pending.kind === 'tool-call');
  assert.equal(pending.output?.summaryText, 'shell done: echo hello');
});
