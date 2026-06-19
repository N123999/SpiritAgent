import assert from 'node:assert/strict';
import test from 'node:test';

import type { JsonValue } from './ports.js';
import {
  buildTodoHostToolDefinitions,
  type TodoHostToolName,
} from './host-tools.js';
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

function toolNames(definitions: ReturnType<typeof buildTodoHostToolDefinitions>): string[] {
  return definitions.map((definition) => readToolName(definition));
}

test('buildTodoHostToolDefinitions exposes todo_list and todo_write', () => {
  const names = toolNames(buildTodoHostToolDefinitions());
  const expected: TodoHostToolName[] = ['todo_list', 'todo_write'];
  assert.deepEqual(names, expected);
});

test('todo_write schema requires todos with title and status', () => {
  const write = buildTodoHostToolDefinitions().find(
    (definition) => readToolName(definition) === 'todo_write',
  );
  assert.ok(write && isJsonObject(write));
  const fn = write.function;
  assert.ok(isJsonObject(fn));
  const parameters = fn.parameters;
  assert.ok(isJsonObject(parameters));
  assert.deepEqual(parameters.required, ['todos']);
  const properties = parameters.properties;
  assert.ok(isJsonObject(properties));
  const todos = properties.todos;
  assert.ok(isJsonObject(todos));
  const items = todos.items;
  assert.ok(isJsonObject(items));
  assert.deepEqual(items.required, ['title', 'status']);
  const itemProperties = items.properties;
  assert.ok(isJsonObject(itemProperties));
  const status = itemProperties.status;
  assert.ok(isJsonObject(status));
  assert.deepEqual(status.enum, ['pending', 'in_progress', 'completed']);
});
