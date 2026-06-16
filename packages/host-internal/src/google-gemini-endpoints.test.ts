import assert from 'node:assert/strict';
import test from 'node:test';

import {
  GOOGLE_GEMINI_API_BASE,
  GOOGLE_GEMINI_NATIVE_API_ROOT,
  assertGoogleGeminiApiBase,
  googleNativeModelsListUrl,
  isGoogleGeminiGenerativeLanguageApiBase,
} from './google-gemini-endpoints.js';

test('isGoogleGeminiGenerativeLanguageApiBase accepts Gemini preset and native roots', () => {
  assert.equal(isGoogleGeminiGenerativeLanguageApiBase(GOOGLE_GEMINI_API_BASE), true);
  assert.equal(isGoogleGeminiGenerativeLanguageApiBase(`${GOOGLE_GEMINI_API_BASE}/`), true);
  assert.equal(isGoogleGeminiGenerativeLanguageApiBase(GOOGLE_GEMINI_NATIVE_API_ROOT), true);
});

test('isGoogleGeminiGenerativeLanguageApiBase rejects non-Google hosts', () => {
  assert.equal(isGoogleGeminiGenerativeLanguageApiBase('https://api.openai.com/v1'), false);
  assert.equal(isGoogleGeminiGenerativeLanguageApiBase('http://generativelanguage.googleapis.com/v1beta'), false);
  assert.equal(isGoogleGeminiGenerativeLanguageApiBase(''), false);
  assert.equal(isGoogleGeminiGenerativeLanguageApiBase('not-a-url'), false);
});

test('assertGoogleGeminiApiBase throws for invalid host', () => {
  assert.throws(
    () => assertGoogleGeminiApiBase('https://api.openai.com/v1'),
    /generativelanguage\.googleapis\.com/,
  );
});

test('googleNativeModelsListUrl derives native models endpoint from api base', () => {
  assert.equal(
    googleNativeModelsListUrl(GOOGLE_GEMINI_API_BASE),
    `${GOOGLE_GEMINI_NATIVE_API_ROOT}/models?pageSize=1000`,
  );
  assert.equal(
    googleNativeModelsListUrl(GOOGLE_GEMINI_API_BASE, 'page-2'),
    `${GOOGLE_GEMINI_NATIVE_API_ROOT}/models?pageSize=1000&pageToken=page-2`,
  );
});
