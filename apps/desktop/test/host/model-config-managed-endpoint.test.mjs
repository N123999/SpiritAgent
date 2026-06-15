import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  resolveDesktopTransportKind,
  resolveProfileApiBase,
} from '../../dist-electron/src/host/model-config.js';

test('resolveProfileApiBase uses preset endpoint for google provider profiles', () => {
  assert.equal(
    resolveProfileApiBase({
      provider: 'google',
      transportKind: 'openai-compatible',
      apiBase: 'https://api.openai.com/v1',
    }),
    'https://generativelanguage.googleapis.com/v1beta/openai',
  );
});

test('resolveProfileApiBase keeps custom provider apiBase override', () => {
  assert.equal(
    resolveProfileApiBase({
      provider: 'custom',
      transportKind: 'openai-compatible',
      apiBase: 'https://custom.example/v1',
    }),
    'https://custom.example/v1',
  );
});

test('resolveDesktopTransportKind downgrades google open-responses to openai-compatible', () => {
  assert.equal(
    resolveDesktopTransportKind({
      provider: 'google',
      transportKind: 'open-responses',
    }),
    'openai-compatible',
  );
});
