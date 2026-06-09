import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CREATE_AUTOMATION_CONTRIBUTED_TOOL,
  CREATE_AUTOMATION_TOOL_NAME,
  buildAutomationHostToolDefinitions,
  deriveAutomationTitle,
  parseCreateAutomationSchedule,
} from './automation-host-tool.js';

test('CREATE_AUTOMATION_CONTRIBUTED_TOOL exposes required overview and schedule', () => {
  assert.equal(CREATE_AUTOMATION_CONTRIBUTED_TOOL.name, CREATE_AUTOMATION_TOOL_NAME);
  const schema = CREATE_AUTOMATION_CONTRIBUTED_TOOL.inputSchema;
  assert.deepEqual(schema.required, ['overview', 'schedule']);
  const properties = schema.properties;
  assert.ok(properties && typeof properties === 'object' && !Array.isArray(properties));
  const schedule = properties.schedule;
  assert.equal(schedule && typeof schedule === 'object' && !Array.isArray(schedule) ? schedule.type : undefined, 'object');
});

test('buildAutomationHostToolDefinitions returns one function tool', () => {
  const definitions = buildAutomationHostToolDefinitions();
  assert.equal(definitions.length, 1);
  const fn = definitions[0] as { function?: { name?: string } };
  assert.equal(fn.function?.name, CREATE_AUTOMATION_TOOL_NAME);
});

test('deriveAutomationTitle uses explicit title or first overview line', () => {
  assert.equal(deriveAutomationTitle('line one\nline two', 'Custom'), 'Custom');
  assert.equal(deriveAutomationTitle('Check CI every morning'), 'Check CI every morning');
});

test('deriveAutomationTitle truncates long first lines', () => {
  const longLine = 'a'.repeat(100);
  assert.equal(deriveAutomationTitle(longLine).length, 80);
});

test('parseCreateAutomationSchedule accepts hourly daily weekly', () => {
  assert.deepEqual(parseCreateAutomationSchedule({ kind: 'hourly' }), { kind: 'hourly' });
  assert.deepEqual(parseCreateAutomationSchedule({ kind: 'daily', hour: 9, minute: 30 }), {
    kind: 'daily',
    hour: 9,
    minute: 30,
  });
  assert.deepEqual(
    parseCreateAutomationSchedule({ kind: 'weekly', weekday: 1, hour: 20, minute: 0 }),
    { kind: 'weekly', weekday: 1, hour: 20, minute: 0 },
  );
});

test('parseCreateAutomationSchedule rejects invalid input', () => {
  assert.throws(() => parseCreateAutomationSchedule({ kind: 'monthly' }), /Invalid automation schedule/);
});
