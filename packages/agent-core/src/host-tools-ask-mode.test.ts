import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ASK_MODE_EXCLUDED_HOST_TOOL_NAMES,
  buildBuiltinHostToolDefinitions,
  filterHostToolDefinitionsForAgentMode,
  readHostFunctionToolName,
} from './host-tools.js';
import { shouldUseApplyPatchFileTools } from './open-responses/apply-patch-eligibility.js';
import { isJsonObject } from './tool-agent.js';

function toolNames(definitions: ReturnType<typeof buildBuiltinHostToolDefinitions>): string[] {
  return definitions
    .map((definition) => readHostFunctionToolName(definition))
    .filter((name): name is string => Boolean(name));
}

function filterSubagentToolDefinitions(value: unknown): unknown {
  if (!Array.isArray(value)) {
    return value;
  }
  return value.filter((entry) => {
    if (!isJsonObject(entry)) {
      return true;
    }
    const fn = entry.function;
    return !isJsonObject(fn) || fn.name !== 'run_subagent';
  });
}

test('filterHostToolDefinitionsForAgentMode removes edit tools in Ask mode', () => {
  const builtins = buildBuiltinHostToolDefinitions({
    shellDisplayName: 'cmd',
    commandParameterDescription: 'command',
  });
  const filtered = filterHostToolDefinitionsForAgentMode(builtins, 'ask');
  const names = toolNames(filtered as ReturnType<typeof buildBuiltinHostToolDefinitions>);

  assert.ok(names.includes('read_file'));
  assert.ok(names.includes('run_subagent'));
  assert.ok(!names.includes('edit_file'));
  assert.ok(!names.includes('shell'));
  for (const excluded of ASK_MODE_EXCLUDED_HOST_TOOL_NAMES) {
    if (excluded === 'create_plan') {
      continue;
    }
    assert.ok(!names.includes(excluded), `expected ${excluded} to be filtered`);
  }
});

test('filterHostToolDefinitionsForAgentMode leaves Agent mode builtins unchanged', () => {
  const builtins = buildBuiltinHostToolDefinitions({
    shellDisplayName: 'cmd',
    commandParameterDescription: 'command',
  });
  const names = toolNames(builtins);
  assert.ok(names.includes('edit_file'));
  assert.deepEqual(toolNames(filterHostToolDefinitionsForAgentMode(builtins, 'agent') as typeof builtins), names);
});

test('subagent inherits Ask-filtered tools without nested run_subagent', () => {
  const parentDefinitions = filterHostToolDefinitionsForAgentMode(
    buildBuiltinHostToolDefinitions({
      shellDisplayName: 'cmd',
      commandParameterDescription: 'command',
    }),
    'ask',
  );
  const childDefinitions = filterSubagentToolDefinitions(parentDefinitions) as ReturnType<
    typeof buildBuiltinHostToolDefinitions
  >;
  const names = toolNames(childDefinitions);
  assert.ok(names.includes('read_file'));
  assert.ok(!names.includes('run_subagent'));
  assert.ok(!names.includes('edit_file'));
});

test('shouldUseApplyPatchFileTools returns false in Ask mode', () => {
  assert.equal(
    shouldUseApplyPatchFileTools(
      {
        transportKind: 'open-responses',
        model: 'gpt-5.2',
        llmVendor: 'openai',
      },
      { agentMode: 'ask' },
    ),
    false,
  );
});
