import { useEffect, type RefObject } from "react";

/** 与 `styles.css` keyframes 名称一致 */
const COLLAPSIBLE_ANIMATION_NAMES = new Set([
  "collapsible-down",
  "collapsible-up",
  "spirit-collapsible-down",
  "spirit-collapsible-up",
]);

type ScrollEdge = "top" | "bottom" | "middle";

type MotionSession = {
  target: HTMLElement;
  animationName: string;
  startScrollHeight: number;
  startAnimHeight: number;
  scrollEdge: ScrollEdge;
};

function scrollAreaViewport(root: HTMLElement): HTMLElement | null {
  const viewport = root.querySelector("[data-radix-scroll-area-viewport]");
  return viewport instanceof HTMLElement ? viewport : null;
}

function scrollAreaNodes(root: HTMLElement): {
  viewport: HTMLElement;
  content: HTMLElement;
} | null {
  const viewport = root.querySelector("[data-radix-scroll-area-viewport]");
  const content = viewport?.firstElementChild;
  if (!(viewport instanceof HTMLElement) || !(content instanceof HTMLElement)) {
    return null;
  }
  return { viewport, content };
}

function verticalScrollbar(root: HTMLElement): HTMLElement | null {
  const scrollbar = root.querySelector('[data-orientation="vertical"]');
  return scrollbar instanceof HTMLElement ? scrollbar : null;
}

function isCollapsibleAnimation(event: AnimationEvent): boolean {
  return COLLAPSIBLE_ANIMATION_NAMES.has(event.animationName);
}

function maxScrollTop(viewport: HTMLElement): number {
  return Math.max(0, viewport.scrollHeight - viewport.clientHeight);
}

function getScrollEdge(viewport: HTMLElement): ScrollEdge {
  const max = maxScrollTop(viewport);
  if (max <= 0 || viewport.scrollTop <= 1) {
    return "top";
  }
  if (viewport.scrollTop >= max - 1) {
    return "bottom";
  }
  return "middle";
}

function clampScrollTop(viewport: HTMLElement): void {
  const max = maxScrollTop(viewport);
  if (viewport.scrollTop > max) {
    viewport.scrollTop = max;
  }
}

function pinScrollToEdge(viewport: HTMLElement, edge: ScrollEdge): void {
  if (edge === "bottom") {
    viewport.scrollTop = maxScrollTop(viewport);
    return;
  }
  if (edge === "top") {
    viewport.scrollTop = 0;
  }
}

/**
 * 动画目标高度变化量推算内容高度，弥补 scrollHeight 在顶/底贴边时提前停滞。
 */
function effectiveContentSize(
  viewport: HTMLElement,
  sessions: readonly MotionSession[],
): number {
  if (sessions.length === 0) {
    return viewport.scrollHeight;
  }
  let effective = viewport.scrollHeight;
  for (const session of sessions) {
    const animHeight = session.target.getBoundingClientRect().height;
    const projected = session.startScrollHeight + (animHeight - session.startAnimHeight);
    if (session.animationName === "collapsible-up" || session.animationName === "spirit-collapsible-up") {
      effective = Math.min(effective, projected);
    } else {
      effective = Math.max(effective, projected);
    }
  }
  return Math.max(viewport.clientHeight, effective);
}

function computeThumbMetrics(
  viewport: HTMLElement,
  scrollbar: HTMLElement,
  contentSize = viewport.scrollHeight,
): {
  thumbSize: number;
  thumbOffset: number;
} {
  const viewportSize = viewport.clientHeight;
  const computedStyle = getComputedStyle(scrollbar);
  const paddingStart = Number.parseInt(computedStyle.paddingTop, 10) || 0;
  const paddingEnd = Number.parseInt(computedStyle.paddingBottom, 10) || 0;
  // 轨道 h-full 随 Root 撑高时会远大于 viewport，直接用 clientHeight 会把拇指算成「铺满视口」
  const scrollbarSize = Math.min(scrollbar.clientHeight, viewportSize);
  const ratio = contentSize > 0 ? viewportSize / contentSize : 1;
  const thumbSize = Math.max((scrollbarSize - paddingStart - paddingEnd) * ratio, 18);
  const maxScrollPos = Math.max(0, contentSize - viewportSize);
  const maxThumbPos = Math.max(0, scrollbarSize - paddingStart - paddingEnd - thumbSize);
  const thumbOffset =
    maxScrollPos > 0 ? (viewport.scrollTop / maxScrollPos) * maxThumbPos : 0;
  return { thumbSize, thumbOffset };
}

/** 动画期间 Radix sizes 滞后，手动同步拇指高度与位移（勿 dispatch scroll，避免用陈旧 sizes 算位置）。 */
function syncScrollbarMetrics(
  root: HTMLElement,
  viewport: HTMLElement,
  sessions: readonly MotionSession[] = [],
): boolean {
  const scrollbar = verticalScrollbar(root);
  const thumb = scrollbar?.firstElementChild;
  if (!scrollbar || !(thumb instanceof HTMLElement)) {
    return false;
  }
  const contentSize = effectiveContentSize(viewport, sessions);
  const { thumbSize, thumbOffset } = computeThumbMetrics(viewport, scrollbar, contentSize);
  scrollbar.style.setProperty("--radix-scroll-area-thumb-height", `${thumbSize}px`);
  thumb.style.transform = `translate3d(0, ${thumbOffset}px, 0)`;
  return true;
}

function clearScrollbarOverrides(root: HTMLElement): void {
  const scrollbar = verticalScrollbar(root);
  if (!scrollbar) {
    return;
  }
  scrollbar.style.removeProperty("--radix-scroll-area-thumb-height");
  const thumb = scrollbar.firstElementChild;
  if (thumb instanceof HTMLElement) {
    thumb.style.removeProperty("transform");
  }
}

/**
 * Collapsible keyframe 动画期间：钳制 scrollTop + 同步滚动条拇指尺寸/位置。
 * 动画结束后继续随 scroll/resize 同步（勿 clear：scrollHeight 未稳定时 clear 会闪跳）。
 * effect cleanup 仅在本周期曾 sync 时 clear，避免抹掉 Radix 变量（浮层 Strict Mode 重挂载）。
 */
export function useScrollAreaMotionSync(rootRef: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const root = rootRef.current;
    if (!root) {
      return;
    }

    let rafId = 0;
    let activeMotions = 0;
    let motionSessions: MotionSession[] = [];
    let contentResizeObserver: ResizeObserver | null = null;
    let appliedOverrides = false;
    let postAnimationSync = false;

    const syncFromViewport = (viewport: HTMLElement) => {
      for (const session of motionSessions) {
        pinScrollToEdge(viewport, session.scrollEdge);
      }
      if (syncScrollbarMetrics(root, viewport, motionSessions)) {
        appliedOverrides = true;
      }
    };

    const syncAfterAnimation = (viewport: HTMLElement) => {
      if (syncScrollbarMetrics(root, viewport)) {
        appliedOverrides = true;
      }
    };

    const onViewportScroll = () => {
      const viewport = scrollAreaViewport(root);
      if (!viewport) {
        return;
      }
      if (activeMotions > 0) {
        syncFromViewport(viewport);
        return;
      }
      if (postAnimationSync) {
        syncAfterAnimation(viewport);
      }
    };

    const tick = () => {
      const nodes = scrollAreaNodes(root);
      if (nodes) {
        clampScrollTop(nodes.viewport);
        syncFromViewport(nodes.viewport);
      }
      if (activeMotions > 0) {
        rafId = requestAnimationFrame(tick);
      }
    };

    const ensureContentResizeObserver = (viewport: HTMLElement, content: HTMLElement) => {
      if (contentResizeObserver) {
        return;
      }
      contentResizeObserver = new ResizeObserver(() => {
        if (activeMotions > 0) {
          syncFromViewport(viewport);
          return;
        }
        if (postAnimationSync) {
          syncAfterAnimation(viewport);
        }
      });
      contentResizeObserver.observe(content);
    };

    const onMotionStart = (event: AnimationEvent) => {
      if (!root.contains(event.target as Node) || !isCollapsibleAnimation(event)) {
        return;
      }
      postAnimationSync = false;
      activeMotions += 1;
      const viewport = scrollAreaViewport(root);
      const animTarget = event.target instanceof HTMLElement ? event.target : null;
      if (viewport && animTarget) {
        motionSessions.push({
          target: animTarget,
          animationName: event.animationName,
          startScrollHeight: viewport.scrollHeight,
          startAnimHeight: animTarget.getBoundingClientRect().height,
          scrollEdge: getScrollEdge(viewport),
        });
      }
      if (activeMotions === 1) {
        const nodes = scrollAreaNodes(root);
        if (nodes) {
          ensureContentResizeObserver(nodes.viewport, nodes.content);
        }
        if (viewport) {
          syncFromViewport(viewport);
        }
        rafId = requestAnimationFrame(tick);
      }
    };

    const onMotionEnd = (event: AnimationEvent) => {
      if (!root.contains(event.target as Node) || !isCollapsibleAnimation(event)) {
        return;
      }
      activeMotions = Math.max(0, activeMotions - 1);
      const animTarget = event.target instanceof HTMLElement ? event.target : null;
      if (animTarget) {
        motionSessions = motionSessions.filter((session) => session.target !== animTarget);
      }
      if (activeMotions === 0) {
        cancelAnimationFrame(rafId);
        motionSessions = [];
        const viewport = scrollAreaViewport(root);
        if (viewport) {
          clampScrollTop(viewport);
          syncAfterAnimation(viewport);
          postAnimationSync = true;
          const nodes = scrollAreaNodes(root);
          if (nodes) {
            ensureContentResizeObserver(nodes.viewport, nodes.content);
          }
        }
      }
    };

    const viewport = scrollAreaViewport(root);
    viewport?.addEventListener("scroll", onViewportScroll, { passive: true });

    root.addEventListener("animationstart", onMotionStart, true);
    root.addEventListener("animationend", onMotionEnd, true);
    root.addEventListener("animationcancel", onMotionEnd, true);

    return () => {
      activeMotions = 0;
      postAnimationSync = false;
      motionSessions = [];
      cancelAnimationFrame(rafId);
      contentResizeObserver?.disconnect();
      contentResizeObserver = null;
      viewport?.removeEventListener("scroll", onViewportScroll);
      if (appliedOverrides) {
        clearScrollbarOverrides(root);
      }
      root.removeEventListener("animationstart", onMotionStart, true);
      root.removeEventListener("animationend", onMotionEnd, true);
      root.removeEventListener("animationcancel", onMotionEnd, true);
    };
  }, [rootRef]);
}
