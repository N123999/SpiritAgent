import assert from 'node:assert/strict';
import test from 'node:test';

import type { JsonValue } from './ports.js';
import { buildPlanModeHostToolDefinitions } from './host-tools.js';
import { isJsonObject } from './tool-agent.js';

function readToolName(definition: JsonValue): string {
  if (!isJsonObject(definition)) {
    return '';
  }
  const fn = definition.function;
  if (!isJsonObject(fn)) {
    return '';
  }
  return typeof fn.name === 'string' ? fn.name : '';
}

test('buildPlanModeHostToolDefinitions exposes create_plan only', () => {
  const names = buildPlanModeHostToolDefinitions().map((definition) => readToolName(definition));
  assert.deepEqual(names, ['create_plan']);
});

test('create_plan content description documents execution-ready plan shape', () => {
  const [definition] = buildPlanModeHostToolDefinitions();
  assert.ok(isJsonObject(definition));
  const fn = definition.function;
  assert.ok(isJsonObject(fn));
  const parameters = fn.parameters;
  assert.ok(isJsonObject(parameters));
  const properties = parameters.properties;
  assert.ok(isJsonObject(properties));
  const content = properties.content;
  assert.ok(isJsonObject(content));
  assert.match(String(content.description), /Phase 1/);
  assert.match(String(content.description), /edit_file/);
});
