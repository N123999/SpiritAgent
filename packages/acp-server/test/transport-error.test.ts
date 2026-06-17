import assert from 'node:assert/strict';
import test from 'node:test';

import { mapSessionSetupError } from '../src/transport/map-setup-error.js';

test('mapSessionSetupError maps missing credentials to authRequired', () => {
  const err = mapSessionSetupError(new Error('No API key found for model "gpt-4o-mini". Run --setup again.'));
  assert.equal(err.code, -32000);
});

test('mapSessionSetupError maps unexpected failures to internalError', () => {
  const err = mapSessionSetupError(new Error('Unexpected runtime failure'));
  assert.equal(err.code, -32603);
});
