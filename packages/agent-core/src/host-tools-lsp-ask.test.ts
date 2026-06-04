import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildBuiltinHostToolDefinitions,
  filterHostToolDefinitionsForAgentMode,
  readHostFunctionToolName,
} from './host-tools.js';
import { buildLspHostToolDefinitions } from './lsp/tool-definitions.js';

function toolNames(definitions: unknown[]): string[] {
  return definitions
    .map((definition) => readHostFunctionToolName(definition as never))
    .filter((name): name is string => Boolean(name));
}

test('get_diagnostics remains available in Ask mode when merged', () => {
  const builtins = buildBuiltinHostToolDefinitions({
    shellDisplayName: 'cmd',
    shellCommandParameterDescription: 'command',
  });
  const merged = filterHostToolDefinitionsForAgentMode(
    [...builtins, ...buildLspHostToolDefinitions()],
    'ask',
  ) as unknown[];
  const names = toolNames(merged);
  assert.ok(names.includes('get_diagnostics'));
  assert.ok(!names.includes('edit_file'));
});
