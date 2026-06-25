import assert from 'node:assert/strict';
import test from 'node:test';

import type { JsonValue } from './ports.js';
import {
  assertFinishTaskToolAllowed,
  buildBuiltinHostToolDefinitions,
  buildFinishTaskHostToolDefinitions,
} from './host-tools.js';
import { toolNamesFromDefinitions, unknownToolErrorMessage } from './unknown-tool-error.js';
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

const environment = {
  shellDisplayName: 'PowerShell',
  commandParameterDescription: 'Command to run.',
};

test('buildBuiltinHostToolDefinitions omits finish_task', () => {
  const names = buildBuiltinHostToolDefinitions(environment).map((definition) => readToolName(definition));
  assert.equal(names.includes('finish_task'), false);
});

test('buildFinishTaskHostToolDefinitions exposes finish_task only when Loop tools are merged', () => {
  const names = buildFinishTaskHostToolDefinitions().map((definition) => readToolName(definition));
  assert.deepEqual(names, ['finish_task']);
});

test('assertFinishTaskToolAllowed rejects finish_task when Loop is off', () => {
  const definitions = buildBuiltinHostToolDefinitions({
    shellDisplayName: 'test shell',
    commandParameterDescription: 'cmd',
  });
  const available = toolNamesFromDefinitions(definitions);
  assert.throws(
    () => assertFinishTaskToolAllowed('finish_task', false, definitions),
    (error: unknown) =>
      error instanceof Error
      && error.message === unknownToolErrorMessage('finish_task', available),
  );
  assert.doesNotThrow(() => assertFinishTaskToolAllowed('finish_task', true, definitions));
  assert.doesNotThrow(() => assertFinishTaskToolAllowed('read_file', false, definitions));
});
