import assert from 'node:assert/strict';
import test from 'node:test';

import { McpConfigError } from '../mcp/errors.js';
import { parseLazyToolGatewayArguments } from './parse.js';
import { TOOL_CALL_TOOL_NAME, TOOL_DESCRIBE_TOOL_NAME } from './definitions.js';

test('parseLazyToolGatewayArguments parses describe requests', () => {
  const parsed = parseLazyToolGatewayArguments(
    TOOL_DESCRIBE_TOOL_NAME,
    JSON.stringify({ provider: 'mcp', server: 'github', tool: 'create_issue' }),
  );
  assert.deepEqual(parsed, {
    provider: 'mcp',
    server: 'github',
    tool: 'create_issue',
  });
});

test('parseLazyToolGatewayArguments parses call requests', () => {
  const parsed = parseLazyToolGatewayArguments(
    TOOL_CALL_TOOL_NAME,
    JSON.stringify({
      provider: 'mcp',
      server: 'github',
      tool: 'create_issue',
      arguments: { title: 'Bug' },
    }),
  );
  assert.deepEqual(parsed, {
    provider: 'mcp',
    server: 'github',
    tool: 'create_issue',
    arguments: { title: 'Bug' },
  });
});

test('parseLazyToolGatewayArguments rejects unsupported providers', () => {
  assert.throws(
    () =>
      parseLazyToolGatewayArguments(
        TOOL_CALL_TOOL_NAME,
        JSON.stringify({ provider: 'other', server: 'x', tool: 'y' }),
      ),
    McpConfigError,
  );
});
