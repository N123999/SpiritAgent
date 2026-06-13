import assert from "node:assert/strict";
import test from "node:test";

import { buildPrDiffSnippetFromPatch, buildPrDiffSnippetText } from "../../src/lib/pr-diff-text.ts";
import { extractPatchBodyForLineRange } from "../../src/lib/pr-diff-patch-slice.ts";

const SAMPLE_PATCH = `@@ -10,6 +10,7 @@
 import foo
+import bar
 context
-deleted
+added
 trailing`;

test("extractPatchBodyForLineRange keeps +/- prefixes for selected gutter lines", () => {
  const body = extractPatchBodyForLineRange("src/foo.ts", SAMPLE_PATCH, 10, 13);
  assert.match(body, /^@@ -10,6 \+10,7 @@/);
  assert.match(body, /^ import foo$/m);
  assert.match(body, /^\+import bar$/m);
  assert.match(body, /^ context$/m);
  assert.match(body, /^-deleted$/m);
  assert.match(body, /^\+added$/m);
  assert.doesNotMatch(body, /trailing/);
});

test("buildPrDiffSnippetFromPatch wraps sliced body in unified diff header", () => {
  const snippet = buildPrDiffSnippetFromPatch("src/foo.ts", SAMPLE_PATCH, 11, 11);
  assert.match(snippet, /diff --git a\/src\/foo\.ts b\/src\/foo\.ts/);
  assert.match(snippet, /^\+import bar$/m);
  assert.doesNotMatch(snippet, /^ context$/m);
  assert.doesNotMatch(snippet, /^-deleted$/m);
});
