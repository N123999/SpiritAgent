import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildPickerInjectScript,
  marqueeCenter,
  MIN_MARQUEE_PX,
  normalizeDragRect,
} from "../src/lib/browser-element-picker.ts";

test("normalizeDragRect handles all drag directions", () => {
  assert.deepEqual(normalizeDragRect(10, 20, 50, 80), { x: 10, y: 20, width: 40, height: 60 });
  assert.deepEqual(normalizeDragRect(50, 80, 10, 20), { x: 10, y: 20, width: 40, height: 60 });
  assert.deepEqual(normalizeDragRect(5, 5, 5, 5), { x: 5, y: 5, width: 1, height: 1 });
});

test("normalizeDragRect clamps tiny drags to at least 1px", () => {
  const rect = normalizeDragRect(100, 100, 101, 100);
  assert.equal(rect.width, 1);
  assert.equal(rect.height, 1);
});

test("marqueeCenter returns rounded center of rect", () => {
  assert.deepEqual(marqueeCenter({ x: 0, y: 0, width: 10, height: 10 }), { cx: 5, cy: 5 });
  assert.deepEqual(marqueeCenter({ x: 1, y: 2, width: 5, height: 7 }), { cx: 4, cy: 6 });
});

test("buildPickerInjectScript supports element hover/click and marquee drag", () => {
  const script = buildPickerInjectScript();
  assert.match(script, /hoverElement/);
  assert.match(script, /setPickerRect\(elementRect\(el\), 'element'\)/);
  assert.match(script, /setPickerRect\(normalizeRect\(startX, startY, e\.clientX, e\.clientY\), 'marquee'\)/);
  assert.match(script, new RegExp(`MARQUEE_THRESHOLD = ${MIN_MARQUEE_PX}`));
  assert.match(script, /elementFromPoint/);
  assert.match(script, /getBoundingClientRect/);
  assert.match(script, /__spiritPickerOverlay/);
  assert.match(script, /applyOverlayBox/);
});
