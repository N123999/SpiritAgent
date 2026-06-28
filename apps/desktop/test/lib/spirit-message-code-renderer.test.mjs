import assert from "node:assert/strict";
import { test } from "node:test";

const FENCE_LANGUAGE_PATTERN = /language-([^\s]+)/;

function extractFenceLanguage(className) {
  const match = className?.match(FENCE_LANGUAGE_PATTERN);
  return match?.[1] ?? "";
}

test("spirit streamdown code component extracts fence language from className", () => {
  assert.equal(extractFenceLanguage("language-python"), "python");
  assert.equal(extractFenceLanguage("language-text extra"), "text");
  assert.equal(extractFenceLanguage("rounded language-typescript"), "typescript");
  assert.equal(extractFenceLanguage("rounded"), "");
  assert.equal(extractFenceLanguage(undefined), "");
});
