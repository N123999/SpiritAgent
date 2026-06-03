import assert from "node:assert/strict";
import test from "node:test";

import { isManagedGeneratedImageRef } from "../../src/lib/managed-generated-image.ts";

test("isManagedGeneratedImageRef detects spirit-image protocol", () => {
  assert.equal(isManagedGeneratedImageRef("spirit-image://generated/abc"), true);
  assert.equal(isManagedGeneratedImageRef("https://example.com/a.png"), false);
});
