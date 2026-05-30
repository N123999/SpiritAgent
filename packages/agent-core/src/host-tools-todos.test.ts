import assert from 'node:assert/strict';
import test from 'node:test';

import type { JsonValue } from './ports.js';
import {
  buildTodoHostToolDefinitions,
  type TodoHostToolName,
} from './host-tools.js';
import { isJsonObject } from './tool-agent.js';
import { buildTodosSystemMessage, hasTodosSystemMessage } from './tool-agent.js';

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

function toolNames(definitions: ReturnType<typeof buildTodoHostToolDefinitions>): string[] {
  return definitions.map((definition) => readToolName(definition));
}

test('buildTodoHostToolDefinitions exposes four session todo tools', () => {
  const names = toolNames(buildTodoHostToolDefinitions());
  const expected: TodoHostToolName[] = [
    'todo_list',
    'todo_create',
    'todo_update',
    'todo_complete',
  ];
  assert.deepEqual(names, expected);
});

test('todo_create schema requires items with title', () => {
  const create = buildTodoHostToolDefinitions().find(
    (definition) => readToolName(definition) === 'todo_create',
  );
  assert.ok(create && isJsonObject(create));
  const fn = create.function;
  assert.ok(isJsonObject(fn));
  const parameters = fn.parameters;
  assert.ok(isJsonObject(parameters));
  assert.deepEqual(parameters.required, ['items']);
});

test('buildTodosSystemMessage returns undefined for empty catalog', () => {
  assert.equal(buildTodosSystemMessage(undefined), undefined);
  assert.equal(buildTodosSystemMessage('   '), undefined);
});

test('buildTodosSystemMessage embeds catalog with SPIRIT_TODOS prefix', () => {
  const message = buildTodosSystemMessage('- id: abc | pending | Fix tests');
  assert.ok(message?.includes('[SPIRIT_TODOS]'));
  assert.ok(message?.includes('todo_list'));
  assert.ok(hasTodosSystemMessage(message ?? ''));
});
