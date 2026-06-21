import assert from "node:assert/strict";
import test from "node:test";

import {
  applyWorkspaceGroupOrder,
  sortWorkspaceGroupsByModifiedDesc,
  workspaceGroupIdsInOrder,
} from "../../src/lib/workspace-sidebar-order.ts";

function group(id, latestModifiedAtUnixMs) {
  return { id, latestModifiedAtUnixMs, label: id };
}

test("applyWorkspaceGroupOrder falls back to modified desc when saved order is empty", () => {
  const groups = [group("b", 100), group("a", 200), group("c", 50)];
  assert.deepEqual(applyWorkspaceGroupOrder(groups, []), [
    group("a", 200),
    group("b", 100),
    group("c", 50),
  ]);
});

test("applyWorkspaceGroupOrder respects saved order for known ids", () => {
  const groups = [group("a", 200), group("b", 100), group("c", 50)];
  assert.deepEqual(applyWorkspaceGroupOrder(groups, ["c", "a", "b"]), [
    group("c", 50),
    group("a", 200),
    group("b", 100),
  ]);
});

test("applyWorkspaceGroupOrder appends new groups by modified desc and ignores stale ids", () => {
  const groups = [group("a", 200), group("b", 100), group("d", 150)];
  assert.deepEqual(applyWorkspaceGroupOrder(groups, ["missing", "b", "a"]), [
    group("b", 100),
    group("a", 200),
    group("d", 150),
  ]);
});

test("applyWorkspaceGroupOrder deduplicates saved order entries", () => {
  const groups = [group("a", 200), group("b", 100)];
  assert.deepEqual(applyWorkspaceGroupOrder(groups, ["b", "b", "a"]), [
    group("b", 100),
    group("a", 200),
  ]);
});

test("workspaceGroupIdsInOrder returns ids in list order", () => {
  const groups = [group("x", 1), group("y", 2)];
  assert.deepEqual(workspaceGroupIdsInOrder(groups), ["x", "y"]);
});

test("sortWorkspaceGroupsByModifiedDesc orders descending", () => {
  const groups = [group("low", 1), group("high", 99), group("mid", 10)];
  assert.deepEqual(sortWorkspaceGroupsByModifiedDesc(groups), [
    group("high", 99),
    group("mid", 10),
    group("low", 1),
  ]);
});
