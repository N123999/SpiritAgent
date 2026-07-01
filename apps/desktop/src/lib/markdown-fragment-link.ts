/** Same-document markdown anchor href such as `#desktop`. */
export function isMarkdownFragmentHref(href: string): boolean {
  const trimmed = href.trim();
  return trimmed.startsWith("#") && trimmed.length > 1;
}

export function decodeMarkdownFragmentId(fragmentHref: string): string | null {
  const raw = fragmentHref.trim().slice(1);
  if (!raw) {
    return null;
  }
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

export function resolveMarkdownFragmentTarget(
  fragmentHref: string,
  container: ParentNode,
): HTMLElement | null {
  const id = decodeMarkdownFragmentId(fragmentHref);
  if (!id) {
    return null;
  }
  const target = container.querySelector(`#${CSS.escape(id)}`);
  return target instanceof HTMLElement ? target : null;
}

export function scrollMarkdownFragmentIntoView(
  fragmentHref: string,
  anchor: HTMLElement,
): boolean {
  if (!isMarkdownFragmentHref(fragmentHref)) {
    return false;
  }
  const scrollRoot =
    anchor.closest("[data-radix-scroll-area-viewport]")
    ?? anchor.closest("[data-spirit-markdown-root]")
    ?? document;
  const target = resolveMarkdownFragmentTarget(fragmentHref, scrollRoot);
  if (!target) {
    return false;
  }
  target.scrollIntoView({ behavior: "smooth", block: "start" });
  return true;
}
