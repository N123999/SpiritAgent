import assert from 'node:assert/strict';

import { parseOpenAiModelsPayload } from '../openai-models.js';

function run(): void {
  assert.deepEqual(parseOpenAiModelsPayload(undefined), []);
  assert.deepEqual(parseOpenAiModelsPayload(null), []);
  assert.deepEqual(parseOpenAiModelsPayload({}), []);
  assert.deepEqual(parseOpenAiModelsPayload({ data: null }), []);
  assert.deepEqual(parseOpenAiModelsPayload({ data: 'x' }), []);

  assert.deepEqual(
    parseOpenAiModelsPayload({
      object: 'list',
      data: [
        { id: 'gpt-4o', object: 'model' },
        { id: '  ', object: 'model' },
        { object: 'model' },
        { id: 'gpt-4o-mini', object: 'model' },
      ],
    }),
    ['gpt-4o', 'gpt-4o-mini'],
  );

  console.log('openai-models parse smoke: ok');
}

run();
