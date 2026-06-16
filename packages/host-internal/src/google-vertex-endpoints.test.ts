import test from 'node:test';
import assert from 'node:assert/strict';

import {
  extractVertexProjectAndLocationFromApiBase,
  normalizeVertexLocation,
  normalizeVertexProject,
  vertexApiBaseFromProjectAndLocation,
  vertexPublisherModelsListUrl,
} from './google-vertex-endpoints.js';

test('vertex endpoint helpers derive api base and list url', () => {
  assert.equal(normalizeVertexProject(' My-Project '), 'My-Project');
  assert.equal(normalizeVertexLocation(' US-Central1 '), 'us-central1');
  assert.equal(
    vertexApiBaseFromProjectAndLocation('my-project', 'us-central1'),
    'https://us-central1-aiplatform.googleapis.com/v1/projects/my-project/locations/us-central1',
  );
  assert.equal(
    vertexPublisherModelsListUrl('my-project', 'us-central1'),
    'https://us-central1-aiplatform.googleapis.com/v1/projects/my-project/locations/us-central1/publishers/google/models?pageSize=100',
  );
});

test('extractVertexProjectAndLocationFromApiBase parses managed endpoint', () => {
  assert.deepEqual(
    extractVertexProjectAndLocationFromApiBase(
      'https://us-central1-aiplatform.googleapis.com/v1/projects/demo/locations/us-central1',
    ),
    { project: 'demo', location: 'us-central1' },
  );
});
