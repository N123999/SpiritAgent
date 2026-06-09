import assert from 'node:assert/strict';
import test from 'node:test';

import {
  type ContributedHostToolDefinition,
  assertContributedHostToolAllowed,
  buildContributedHostToolDefinitions,
  filterContributedToolDefinitionsForAgentMode,
} from './host-tools.js';

const sampleTool = (overrides: Partial<ContributedHostToolDefinition> = {}): ContributedHostToolDefinition => ({
  name: 'sample_tool',
  description: 'Sample contributed tool.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  ...overrides,
});

test('filterContributedToolDefinitionsForAgentMode hides agent-only tools in Plan and Ask but exposes in Debug', () => {
  const definitions = [sampleTool({ name: 'create_automation', agentModeExposure: 'agent' })];
  assert.deepEqual(
    filterContributedToolDefinitionsForAgentMode(definitions, 'agent').map((item) => item.name),
    ['create_automation'],
  );
  assert.deepEqual(
    filterContributedToolDefinitionsForAgentMode(definitions, 'debug').map((item) => item.name),
    ['create_automation'],
  );
  assert.deepEqual(filterContributedToolDefinitionsForAgentMode(definitions, 'plan'), []);
  assert.deepEqual(filterContributedToolDefinitionsForAgentMode(definitions, 'ask'), []);
});

test('filterContributedToolDefinitionsForAgentMode hides excludeFromAskMode in Ask only', () => {
  const definitions = [sampleTool({ excludeFromAskMode: true })];
  assert.equal(filterContributedToolDefinitionsForAgentMode(definitions, 'agent').length, 1);
  assert.equal(filterContributedToolDefinitionsForAgentMode(definitions, 'plan').length, 1);
  assert.equal(filterContributedToolDefinitionsForAgentMode(definitions, 'ask').length, 0);
});

test('buildContributedHostToolDefinitions ignores gating metadata', () => {
  const [definition] = buildContributedHostToolDefinitions([
    sampleTool({ excludeFromAskMode: true, agentModeExposure: 'agent' }),
  ]);
  const fn = definition as { function?: { name?: string } };
  assert.equal(fn.function?.name, 'sample_tool');
});

test('assertContributedHostToolAllowed rejects hidden contributed tools', () => {
  const definitions = [sampleTool({ name: 'create_automation', agentModeExposure: 'agent' })];
  const available = buildContributedHostToolDefinitions(definitions);
  assert.doesNotThrow(() =>
    assertContributedHostToolAllowed('create_automation', 'agent', definitions, available),
  );
  assert.throws(
    () => assertContributedHostToolAllowed('create_automation', 'ask', definitions, available),
    /未知工具: create_automation/,
  );
});
