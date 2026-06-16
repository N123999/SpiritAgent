import test from 'node:test';
import assert from 'node:assert/strict';

import { parseVertexModelEntriesPayload } from './google-vertex-models.js';

test('parseVertexModelEntriesPayload maps publisherModels', () => {
  const entries = parseVertexModelEntriesPayload({
    publisherModels: [
      {
        name: 'publishers/google/models/gemini-2.5-flash',
        displayName: 'Gemini 2.5 Flash',
        description: 'Fast model',
        inputTokenLimit: 1000,
        outputTokenLimit: 500,
      },
      {
        name: 'publishers/google/models/text-embedding-004',
        displayName: 'Embedding',
      },
    ],
  });

  assert.equal(entries.length, 2);
  assert.equal(entries[0]?.id, 'gemini-2.5-flash');
  assert.equal(entries[0]?.displayName, 'Gemini 2.5 Flash');
  assert.equal(entries[0]?.contextLength, 1500);
  assert.equal(entries[0]?.supportsReasoning, true);
  assert.equal(entries[1]?.id, 'text-embedding-004');
});
