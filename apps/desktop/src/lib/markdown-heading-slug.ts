import type { ReactNode } from "react";

/** GitHub-compatible heading slug for same-document markdown anchors. */
export function slugifyMarkdownHeadingText(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export function reactNodeTextContent(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") {
    return String(node);
  }
  if (Array.isArray(node)) {
    return node.map(reactNodeTextContent).join("");
  }
  if (node && typeof node === "object" && "props" in node) {
    const element = node as { props: { children?: ReactNode } };
    return reactNodeTextContent(element.props.children);
  }
  return "";
}

export function slugifyMarkdownHeadingChildren(children: ReactNode): string | undefined {
  const slug = slugifyMarkdownHeadingText(reactNodeTextContent(children));
  return slug || undefined;
}
