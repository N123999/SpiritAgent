import type {
  AuthorizationDecision,
  JsonValue,
  McpStatusSnapshot,
  ToolExecutionOutput,
  ToolExecutor,
} from '../../ports.js';
import { createToolExecutionTextOutput } from '../../ports.js';

export interface DemoToolRequest {
  name: string;
  argumentsJson: string;
  parsedArguments: JsonValue;
}

export function demoLookupToolDefinition(): JsonValue[] {
  return [
    {
      type: 'function',
      function: {
        name: 'demo_lookup',
        description: 'Demo tool used to verify OpenAI-compatible tool-calling integration.',
        parameters: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Lookup query.',
            },
          },
          required: ['query'],
          additionalProperties: false,
        },
      },
    },
  ];
}

export class DemoToolExecutor implements ToolExecutor<DemoToolRequest> {
  toolDefinitionsJson(): JsonValue {
    return demoLookupToolDefinition();
  }

  async parseCommand(_message: string): Promise<DemoToolRequest> {
    throw new Error('DemoToolExecutor.parseCommand 未实现。');
  }

  async requestFromFunctionCall(
    name: string,
    argumentsJson: string,
  ): Promise<DemoToolRequest> {
    return {
      name,
      argumentsJson,
      parsedArguments: JSON.parse(argumentsJson) as JsonValue,
    };
  }

  async authorize(
    _request: DemoToolRequest,
  ): Promise<AuthorizationDecision> {
    return { kind: 'allowed' };
  }

  async trust(_target: string): Promise<void> {}

  async execute(request: DemoToolRequest): Promise<ToolExecutionOutput> {
    if (request.name !== 'demo_lookup') {
      throw new Error(`未知 demo 工具: ${request.name}`);
    }

    const query =
      isJsonObject(request.parsedArguments) && typeof request.parsedArguments.query === 'string'
        ? request.parsedArguments.query
        : 'unknown';

    return createToolExecutionTextOutput(JSON.stringify({
      query,
      result: 'transport bridge ok',
    }));
  }

  startMcpBackgroundRefresh(): void {}

  mcpStatusSnapshot(): McpStatusSnapshot {
    return {
      revision: 0,
      state: 'idle',
      configuredServers: 0,
      loadedServers: 0,
      cachedTools: 0,
    };
  }

  async addMcpServer(_name: string, _config: JsonValue): Promise<string> {
    throw new Error('DemoToolExecutor.addMcpServer 未实现。');
  }

  async listMcpServers(): Promise<never[]> {
    return [];
  }

  async inspectMcpServer(_name: string): Promise<never> {
    throw new Error('DemoToolExecutor.inspectMcpServer 未实现。');
  }

  async listMcpTools(_name: string): Promise<never[]> {
    return [];
  }

  async listMcpResources(_name: string): Promise<never[]> {
    return [];
  }

  async readMcpResource(_name: string, _uri: string): Promise<JsonValue> {
    throw new Error('DemoToolExecutor.readMcpResource 未实现。');
  }

  async listCachedMcpPrompts(_name: string): Promise<never[]> {
    return [];
  }

  async listMcpPrompts(_name: string): Promise<never[]> {
    return [];
  }

  async getMcpPrompt(
    _name: string,
    _prompt: string,
    _argsJson?: string,
  ): Promise<JsonValue> {
    throw new Error('DemoToolExecutor.getMcpPrompt 未实现。');
  }
}

function isJsonObject(value: JsonValue): value is Record<string, JsonValue> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}