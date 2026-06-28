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

test("viewportRectToScaleRootLocal converts viewport box under layout scale", () => {
  function viewportRectToScaleRootLocal(rect, scaleRootRect, scale, isScaled) {
    if (!isScaled) {
      return rect;
    }
    return {
      left: (rect.left - scaleRootRect.left) / scale,
      top: (rect.top - scaleRootRect.top) / scale,
      width: Math.max(rect.width / scale, 1),
      height: Math.max(rect.height / scale, 1),
    };
  }

  const viewport = { left: 120, top: 240, width: 8, height: 20 };
  assert.deepEqual(viewportRectToScaleRootLocal(viewport, { left: 0, top: 0 }, 1, false), viewport);
  assert.deepEqual(viewportRectToScaleRootLocal(viewport, { left: 0, top: 0 }, 1.1, true), {
    left: 120 / 1.1,
    top: 240 / 1.1,
    width: 8 / 1.1,
    height: 20 / 1.1,
  });
  assert.deepEqual(
    viewportRectToScaleRootLocal(viewport, { left: 10, top: 20 }, 0.9, true),
    {
      left: (120 - 10) / 0.9,
      top: (240 - 20) / 0.9,
      width: 8 / 0.9,
      height: 20 / 0.9,
    },
  );
});

test("viewportLengthToScaleRootLocal converts viewport delta under layout scale", () => {
  function viewportLengthToScaleRootLocal(length, scale, isScaled) {
    if (!isScaled) {
      return length;
    }
    return length / scale;
  }

  assert.ok(Math.abs(viewportLengthToScaleRootLocal(110, 1.1, true) - 100) < 1e-9);
  assert.ok(Math.abs(viewportLengthToScaleRootLocal(90, 0.9, true) - 100) < 1e-9);
  assert.equal(viewportLengthToScaleRootLocal(100, 1.1, false), 100);
});
