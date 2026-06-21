import assert from "node:assert/strict";
import test from "node:test";

import {
  captureListFlipTops,
  prefersReducedSidebarReorderMotion,
} from "../../src/lib/list-flip-animation.ts";

test("captureListFlipTops records node tops in order", () => {
  const nodeA = {
    getBoundingClientRect: () => ({ top: 10 }),
  };
  const nodeB = {
    getBoundingClientRect: () => ({ top: 48 }),
  };
  const nodeById = new Map([
    ["a", nodeA],
    ["b", nodeB],
  ]);

  assert.deepEqual(captureListFlipTops(nodeById, ["a", "b"]), new Map([
    ["a", 10],
    ["b", 48],
  ]));
});

test("prefersReducedSidebarReorderMotion is boolean", () => {
  assert.equal(typeof prefersReducedSidebarReorderMotion(), "boolean");
});
