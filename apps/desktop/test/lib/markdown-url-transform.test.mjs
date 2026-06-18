import assert from "node:assert/strict";
import test from "node:test";

import {
  isManagedGeneratedImageRef,
  isManagedGeneratedVideoRef,
} from "../../src/lib/managed-generated-asset.ts";

test("isManagedGeneratedImageRef detects spirit-agent image protocol", () => {
  assert.equal(isManagedGeneratedImageRef("spirit://generated/image/abc.png"), true);
  assert.equal(isManagedGeneratedImageRef("spirit://generated/video/abc.mp4"), false);
  assert.equal(isManagedGeneratedImageRef("https://example.com/a.png"), false);
});

test("isManagedGeneratedVideoRef detects spirit-agent video protocol", () => {
  assert.equal(isManagedGeneratedVideoRef("spirit://generated/video/abc.mp4"), true);
  assert.equal(isManagedGeneratedVideoRef("spirit://generated/image/abc.png"), false);
});
