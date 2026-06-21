import assert from "node:assert/strict";
import test from "node:test";

import {
  applyWorkspaceGroupReorderBoundaryTargetIndex,
  clampWorkspaceGroupDragOffsetY,
  clampWorkspaceGroupPointerY,
  clampWorkspaceGroupReorderProbeY,
  computeWorkspaceGroupDragProbeY,
  computeWorkspaceGroupTargetIndex,
  computeWorkspaceGroupTargetIndexFromLayoutTops,
  getWorkspaceGroupDragOffsetBounds,
} from "../../src/lib/workspace-group-reorder-target.ts";

function rects(entries) {
  return new Map(Object.entries(entries));
}

test("computeWorkspaceGroupTargetIndex does not swap down until pointer passes neighbor midpoint", () => {
  const order = ["a", "b", "c"];
  const measurements = rects({
    a: { top: 194, height: 32 },
    b: { top: 226, height: 32 },
    c: { top: 258, height: 32 },
  });

  assert.equal(computeWorkspaceGroupTargetIndex(210, order, "a", measurements), 0);
  assert.equal(computeWorkspaceGroupTargetIndex(243, order, "a", measurements), 1);
});

test("computeWorkspaceGroupTargetIndex stays stable after moving down one slot", () => {
  const order = ["b", "a", "c"];
  const measurements = rects({
    b: { top: 194, height: 32 },
    a: { top: 226, height: 32 },
    c: { top: 258, height: 32 },
  });

  assert.equal(computeWorkspaceGroupTargetIndex(212, order, "a", measurements), 1);
});

test("computeWorkspaceGroupTargetIndex swaps up when pointer crosses upper neighbor midpoint", () => {
  const order = ["b", "a", "c"];
  const measurements = rects({
    b: { top: 194, height: 32 },
    a: { top: 226, height: 32 },
    c: { top: 258, height: 32 },
  });

  assert.equal(computeWorkspaceGroupTargetIndex(205, order, "a", measurements), 0);
});

test("clampWorkspaceGroupDragOffsetY keeps visual top within first and last slot", () => {
  const order = ["a", "b", "c"];
  const layoutTops = new Map([
    ["a", 100],
    ["b", 200],
    ["c", 300],
  ]);

  assert.equal(clampWorkspaceGroupDragOffsetY(order, layoutTops, 200, -150), -100);
  assert.equal(clampWorkspaceGroupDragOffsetY(order, layoutTops, 200, 200), 100);
  assert.equal(clampWorkspaceGroupDragOffsetY(order, layoutTops, 200, 0), 0);
});

test("computeWorkspaceGroupDragProbeY uses workspace row header center not full card height", () => {
  assert.equal(computeWorkspaceGroupDragProbeY(258, -64), 210);
  assert.equal(computeWorkspaceGroupDragProbeY(226, -32), 210);
});

test("computeWorkspaceGroupTargetIndexFromLayoutTops uses header midpoints for tall groups", () => {
  const order = ["a", "b", "c"];
  const layoutTops = new Map([
    ["a", 194],
    ["b", 226],
    ["c", 258],
  ]);
  assert.equal(computeWorkspaceGroupTargetIndexFromLayoutTops(210, order, "c", layoutTops), 1);
  assert.equal(computeWorkspaceGroupTargetIndexFromLayoutTops(242, order, "c", layoutTops), 2);
});

test("applyWorkspaceGroupReorderBoundaryTargetIndex advances slot when pinned to top", () => {
  const bounds = { minOffset: -32, maxOffset: 32 };
  assert.equal(
    applyWorkspaceGroupReorderBoundaryTargetIndex(1, 1, 3, -32, bounds, -8),
    0,
  );
  assert.equal(
    applyWorkspaceGroupReorderBoundaryTargetIndex(1, 2, 3, -64, bounds, -8),
    1,
  );
  assert.equal(
    applyWorkspaceGroupReorderBoundaryTargetIndex(1, 1, 3, -32, bounds, 8),
    1,
  );
});

test("computeWorkspaceGroupTargetIndexFromLayoutTops stays at last index with pointer offset", () => {
  const order = ["a", "b", "c"];
  const layoutTops = new Map([
    ["a", 194],
    ["b", 226],
    ["c", 258],
  ]);
  assert.equal(computeWorkspaceGroupTargetIndexFromLayoutTops(274, order, "c", layoutTops), 2);
  assert.equal(computeWorkspaceGroupTargetIndexFromLayoutTops(340, order, "c", layoutTops), 2);
});

test("applyWorkspaceGroupReorderBoundaryTargetIndex advances down only when dragging down", () => {
  const bounds = { minOffset: -32, maxOffset: 98 };
  assert.equal(
    applyWorkspaceGroupReorderBoundaryTargetIndex(1, 1, 3, 98, bounds, 12),
    2,
  );
  assert.equal(
    applyWorkspaceGroupReorderBoundaryTargetIndex(1, 1, 3, 98, bounds, -4),
    1,
  );
});

test("clampWorkspaceGroupReorderProbeY clamps to header centers of first and last slots", () => {
  const order = ["a", "b"];
  const layoutTops = new Map([
    ["a", 100],
    ["b", 200],
  ]);
  assert.equal(clampWorkspaceGroupReorderProbeY(order, layoutTops, 50), 116);
  assert.equal(clampWorkspaceGroupReorderProbeY(order, layoutTops, 250), 216);
});

test("clampWorkspaceGroupPointerY stays within list vertical span", () => {
  const order = ["a", "b"];
  const layoutTops = new Map([
    ["a", 100],
    ["b", 200],
  ]);
  const heights = new Map([
    ["a", 32],
    ["b", 32],
  ]);

  assert.equal(clampWorkspaceGroupPointerY(order, layoutTops, heights, 50), 100);
  assert.equal(clampWorkspaceGroupPointerY(order, layoutTops, heights, 150), 150);
  assert.equal(clampWorkspaceGroupPointerY(order, layoutTops, heights, 300), 232);
});
