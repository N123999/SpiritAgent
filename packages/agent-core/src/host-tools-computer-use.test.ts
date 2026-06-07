import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ASK_MODE_EXCLUDED_HOST_TOOL_NAMES,
  buildComputerUseHostToolDefinitions,
  COMPUTER_USE_ACTION_TOOL_NAME,
  COMPUTER_USE_SNAPSHOT_TOOL_NAME,
  filterHostToolDefinitionsForAgentMode,
  readHostFunctionToolName,
} from './host-tools.js';

test('buildComputerUseHostToolDefinitions exposes snapshot and action tools', () => {
  const definitions = buildComputerUseHostToolDefinitions();
  const names = definitions
    .map((definition) => readHostFunctionToolName(definition))
    .filter((name): name is string => Boolean(name));

  assert.deepEqual(names, [COMPUTER_USE_SNAPSHOT_TOOL_NAME, COMPUTER_USE_ACTION_TOOL_NAME]);
});

test('computer_use_snapshot schema includes optional debug_port', () => {
  const definitions = buildComputerUseHostToolDefinitions();
  const snapshot = definitions[0] as {
    function?: { parameters?: { properties?: Record<string, unknown> } };
  };
  const properties = snapshot.function?.parameters?.properties ?? {};
  assert.ok(properties.debug_port);
});

test('computer_use_snapshot schema includes taskbar surface', () => {
  const definitions = buildComputerUseHostToolDefinitions();
  const snapshot = definitions[0] as {
    function?: { parameters?: { properties?: Record<string, { enum?: string[] }> } };
  };
  const surface = snapshot.function?.parameters?.properties?.surface;
  assert.ok(surface);
  assert.deepEqual(surface?.enum, ['taskbar', 'secondary_taskbar']);
});

test('computer_use_action schema includes optional debug_port', () => {
  const definitions = buildComputerUseHostToolDefinitions();
  const action = definitions[1] as {
    function?: { parameters?: { properties?: Record<string, unknown> } };
  };
  const properties = action.function?.parameters?.properties ?? {};
  assert.ok(properties.debug_port);
});

test('Ask mode excludes computer_use_action but keeps snapshot', () => {
  const definitions = buildComputerUseHostToolDefinitions();
  const filtered = filterHostToolDefinitionsForAgentMode(definitions, 'ask');
  assert.ok(Array.isArray(filtered));
  const names = (filtered as typeof definitions)
    .map((definition) => readHostFunctionToolName(definition))
    .filter((name): name is string => Boolean(name));

  assert.ok(names.includes(COMPUTER_USE_SNAPSHOT_TOOL_NAME));
  assert.ok(!names.includes(COMPUTER_USE_ACTION_TOOL_NAME));
  assert.ok(ASK_MODE_EXCLUDED_HOST_TOOL_NAMES.has(COMPUTER_USE_ACTION_TOOL_NAME));
});
