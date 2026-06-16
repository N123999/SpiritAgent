import assert from 'node:assert/strict';
import test from 'node:test';

import {
  azureApiBaseFromResourceName,
  extractAzureResourceNameFromApiBase,
  isValidAzureResourceName,
  normalizeAzureResourceName,
  validateAzureResourceName,
} from './azure-resource.js';

test('normalizeAzureResourceName trims whitespace', () => {
  assert.equal(normalizeAzureResourceName('  my-resource  '), 'my-resource');
});

test('azureApiBaseFromResourceName builds openai v1 base url', () => {
  assert.equal(
    azureApiBaseFromResourceName('my-openai-resource'),
    'https://my-openai-resource.openai.azure.com/openai/v1',
  );
});

test('extractAzureResourceNameFromApiBase parses resource segment', () => {
  assert.equal(
    extractAzureResourceNameFromApiBase('https://my-openai-resource.openai.azure.com/openai/v1'),
    'my-openai-resource',
  );
  assert.equal(
    extractAzureResourceNameFromApiBase('https://my-openai-resource.openai.azure.com/openai/v1/'),
    'my-openai-resource',
  );
  assert.equal(extractAzureResourceNameFromApiBase('https://api.openai.com/v1'), undefined);
});

test('isValidAzureResourceName rejects invalid characters', () => {
  assert.equal(isValidAzureResourceName('my-openai-resource'), true);
  assert.equal(isValidAzureResourceName('-bad'), false);
  assert.equal(isValidAzureResourceName('bad@host'), false);
});

test('validateAzureResourceName returns normalized value', () => {
  assert.equal(validateAzureResourceName('  my-resource  '), 'my-resource');
  assert.throws(() => validateAzureResourceName('bad name'));
});
