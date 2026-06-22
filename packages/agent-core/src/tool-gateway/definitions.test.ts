import assert from 'node:assert/strict';
import test from 'node:test';

import {
  TOOL_CALL_TOOL_NAME,
  TOOL_DESCRIBE_TOOL_NAME,
  buildLazyToolGatewayDefinitions,
  isLazyToolGatewayToolName,
} from './definitions.js';

test('buildLazyToolGatewayDefinitions exposes tool_describe and tool_call', () => {
  const definitions = buildLazyToolGatewayDefinitions();
  assert.equal(definitions.length, 2);
  const names = definitions.map((entry) => {
    assert.ok(typeof entry === 'object' && entry !== null && !Array.isArray(entry));
    const fn = (entry as { function?: { name?: string } }).function;
    return fn?.name;
  });
  assert.deepEqual(names, [TOOL_DESCRIBE_TOOL_NAME, TOOL_CALL_TOOL_NAME]);
});

test('isLazyToolGatewayToolName recognizes gateway tools only', () => {
  assert.equal(isLazyToolGatewayToolName(TOOL_DESCRIBE_TOOL_NAME), true);
  assert.equal(isLazyToolGatewayToolName(TOOL_CALL_TOOL_NAME), true);
  assert.equal(isLazyToolGatewayToolName('read_file'), false);
});
