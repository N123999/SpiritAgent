import assert from "node:assert/strict";
import test from "node:test";

import {
  clampUiLayoutScale,
  DEFAULT_UI_LAYOUT_SCALE,
  normalizeUiLayoutScale,
  resolveUiLayoutZoomShortcutAction,
  stepUiLayoutScale,
  UI_LAYOUT_SCALE_MAX,
  UI_LAYOUT_SCALE_MIN,
} from "../../src/lib/ui-layout-scale.ts";

test("clampUiLayoutScale clamps to 0.8–1.25", () => {
  assert.equal(clampUiLayoutScale(0.7), UI_LAYOUT_SCALE_MIN);
  assert.equal(clampUiLayoutScale(1.3), UI_LAYOUT_SCALE_MAX);
  assert.equal(clampUiLayoutScale(1), DEFAULT_UI_LAYOUT_SCALE);
  assert.equal(clampUiLayoutScale(Number.NaN), DEFAULT_UI_LAYOUT_SCALE);
});

test("normalizeUiLayoutScale falls back to default for invalid input", () => {
  assert.equal(normalizeUiLayoutScale(null), DEFAULT_UI_LAYOUT_SCALE);
  assert.equal(normalizeUiLayoutScale(""), DEFAULT_UI_LAYOUT_SCALE);
  assert.equal(normalizeUiLayoutScale("not-a-number"), DEFAULT_UI_LAYOUT_SCALE);
  assert.equal(normalizeUiLayoutScale("1.1"), 1.1);
});

test("stepUiLayoutScale steps by 0.1 and stops at bounds", () => {
  assert.equal(stepUiLayoutScale(1, "in"), 1.1);
  assert.equal(stepUiLayoutScale(1, "out"), 0.9);
  assert.equal(stepUiLayoutScale(UI_LAYOUT_SCALE_MAX, "in"), UI_LAYOUT_SCALE_MAX);
  assert.equal(stepUiLayoutScale(UI_LAYOUT_SCALE_MIN, "out"), UI_LAYOUT_SCALE_MIN);
});

test("resolveUiLayoutZoomShortcutAction maps mod zoom keys", () => {
  const mod = { defaultPrevented: false, modPressed: true, altKey: false };

  assert.equal(resolveUiLayoutZoomShortcutAction({ ...mod, key: "=" }), "in");
  assert.equal(resolveUiLayoutZoomShortcutAction({ ...mod, key: "+" }), "in");
  assert.equal(resolveUiLayoutZoomShortcutAction({ ...mod, key: "-" }), "out");
  assert.equal(resolveUiLayoutZoomShortcutAction({ ...mod, key: "_" }), "out");
  assert.equal(resolveUiLayoutZoomShortcutAction({ ...mod, key: "0" }), "reset");
});

test("resolveUiLayoutZoomShortcutAction ignores non-mod and defaultPrevented", () => {
  assert.equal(
    resolveUiLayoutZoomShortcutAction({
      defaultPrevented: false,
      modPressed: false,
      altKey: false,
      key: "=",
    }),
    null,
  );
  assert.equal(
    resolveUiLayoutZoomShortcutAction({
      defaultPrevented: true,
      modPressed: true,
      altKey: false,
      key: "=",
    }),
    null,
  );
  assert.equal(
    resolveUiLayoutZoomShortcutAction({
      defaultPrevented: false,
      modPressed: true,
      altKey: true,
      key: "=",
    }),
    null,
  );
});
