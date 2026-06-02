/** Pixels of movement before a pointer down becomes marquee drag (not element click). */
export const MIN_MARQUEE_PX = 3;

export type MarqueeRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type PickerOverlayMode = "element" | "marquee";

export type PickerMarqueeResult = MarqueeRect & {
  tagName: string;
  outerHTML: string;
};

/** Normalize drag corners to viewport rect; width/height clamped to at least 1. */
export function normalizeDragRect(x0: number, y0: number, x1: number, y1: number): MarqueeRect {
  const x = Math.min(x0, x1);
  const y = Math.min(y0, y1);
  const width = Math.max(Math.abs(x1 - x0), 1);
  const height = Math.max(Math.abs(y1 - y0), 1);
  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(height),
  };
}

export function marqueeCenter(rect: MarqueeRect): { cx: number; cy: number } {
  return {
    cx: Math.round(rect.x + rect.width / 2),
    cy: Math.round(rect.y + rect.height / 2),
  };
}

export function pickerRectsEqual(
  a: MarqueeRect | null | undefined,
  b: MarqueeRect | null | undefined,
): boolean {
  if (!a || !b) return a === b;
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

const PICKER_OVERLAY_RING =
  "inset 0 0 0 2px #60a5fa";

/** Direct DOM update for marquee overlay (bypasses React render during drag). */
export function applyPickerOverlayBox(el: HTMLElement, rect: MarqueeRect): void {
  el.style.left = `${rect.x}px`;
  el.style.top = `${rect.y}px`;
  el.style.width = `${rect.width}px`;
  el.style.height = `${rect.height}px`;
  el.style.opacity = "1";
  el.style.boxShadow = PICKER_OVERLAY_RING;
  el.style.background = "rgba(147,197,253,0.15)";
  el.style.borderRadius = "2px";
}

export function hidePickerOverlayBox(el: HTMLElement): void {
  el.style.opacity = "0";
}
export function clearPickerOverlayInlineStyles(el: HTMLElement): void {
  hidePickerOverlayBox(el);
  el.style.left = "";
  el.style.top = "";
  el.style.width = "";
  el.style.height = "";
  el.style.boxShadow = "";
  el.style.background = "";
  el.style.borderRadius = "";
}

/**
 * Guest-page script: hover/click element pick + drag marquee pick.
 * - Hover: highlight element bounding box (animated in host UI).
 * - Click (no drag): capture element box.
 * - Drag (>= MIN_MARQUEE_PX): capture user marquee; element from center point.
 */
export function buildPickerInjectScript(): string {
  return `
(function() {
  if (window.__spiritPickerCleanup) window.__spiritPickerCleanup();

  var MARQUEE_THRESHOLD = ${MIN_MARQUEE_PX};
  var startX = 0;
  var startY = 0;
  var pointerDown = false;
  var marqueeDrag = false;

  function normalizeRect(x0, y0, x1, y1) {
    var x = Math.min(x0, x1);
    var y = Math.min(y0, y1);
    var w = Math.max(Math.abs(x1 - x0), 1);
    var h = Math.max(Math.abs(y1 - y0), 1);
    return { x: Math.round(x), y: Math.round(y), width: Math.round(w), height: Math.round(h) };
  }

  function elementRect(el) {
    var r = el.getBoundingClientRect();
    return {
      x: Math.round(r.left),
      y: Math.round(r.top),
      width: Math.round(r.width),
      height: Math.round(r.height),
    };
  }

  function hoverElement(e) {
    if (pointerDown) return;
    var el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el) {
      window.__spiritPickerRect = null;
      window.__spiritPickerRectMode = null;
      return;
    }
    window.__spiritPickerRect = elementRect(el);
    window.__spiritPickerRectMode = 'element';
  }

  function onDown(e) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    pointerDown = true;
    marqueeDrag = false;
    startX = e.clientX;
    startY = e.clientY;
  }

  function onMove(e) {
    if (!pointerDown) {
      hoverElement(e);
      return;
    }
    var dx = e.clientX - startX;
    var dy = e.clientY - startY;
    if (!marqueeDrag) {
      if (Math.abs(dx) < MARQUEE_THRESHOLD && Math.abs(dy) < MARQUEE_THRESHOLD) {
        return;
      }
      marqueeDrag = true;
    }
    e.preventDefault();
    e.stopPropagation();
    window.__spiritPickerRect = normalizeRect(startX, startY, e.clientX, e.clientY);
    window.__spiritPickerRectMode = 'marquee';
  }

  function onUp(e) {
    if (!pointerDown) return;
    e.preventDefault();
    e.stopPropagation();
    pointerDown = false;
    window.__spiritPickerRect = null;
    window.__spiritPickerRectMode = null;

    if (marqueeDrag) {
      marqueeDrag = false;
      var rect = normalizeRect(startX, startY, e.clientX, e.clientY);
      var cx = Math.round(rect.x + rect.width / 2);
      var cy = Math.round(rect.y + rect.height / 2);
      var centerEl = document.elementFromPoint(cx, cy);
      if (!centerEl) return;
      window.__spiritPickerResult = {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        tagName: centerEl.tagName,
        outerHTML: centerEl.outerHTML,
      };
      window.__spiritPickerDone = true;
      return;
    }

    var el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el) return;
    var picked = elementRect(el);
    window.__spiritPickerResult = {
      x: picked.x,
      y: picked.y,
      width: picked.width,
      height: picked.height,
      tagName: el.tagName,
      outerHTML: el.outerHTML,
    };
    window.__spiritPickerDone = true;
  }

  function resetPointer() {
    pointerDown = false;
    marqueeDrag = false;
  }

  window.addEventListener('blur', resetPointer);

  document.addEventListener('mousedown', onDown, true);
  document.addEventListener('mousemove', onMove, true);
  document.addEventListener('mouseup', onUp, true);

  window.__spiritPickerDone = false;
  window.__spiritPickerRect = null;
  window.__spiritPickerRectMode = null;
  window.__spiritPickerResult = null;

  window.__spiritPickerCleanup = function() {
    document.removeEventListener('mousedown', onDown, true);
    document.removeEventListener('mousemove', onMove, true);
    document.removeEventListener('mouseup', onUp, true);
    window.removeEventListener('blur', resetPointer);
    resetPointer();
    window.__spiritPickerRect = null;
    window.__spiritPickerRectMode = null;
  };
  true;
})();
`.trim();
}

export const PICKER_INJECT_CSS =
  "* { cursor: crosshair !important; user-select: none !important; -webkit-user-select: none !important; }";
