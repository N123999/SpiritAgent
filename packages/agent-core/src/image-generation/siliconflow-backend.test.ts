import assert from 'node:assert/strict';
import test from 'node:test';

import { mapSiliconFlowImageSize } from './siliconflow-backend.js';

test('mapSiliconFlowImageSize accepts known enum values only', () => {
  assert.equal(mapSiliconFlowImageSize('1280x720'), '1280x720');
  assert.equal(mapSiliconFlowImageSize('1024x768'), undefined);
  assert.equal(mapSiliconFlowImageSize(undefined), undefined);
});
