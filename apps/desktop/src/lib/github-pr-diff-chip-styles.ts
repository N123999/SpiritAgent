import { workspaceFileBasename } from "@/lib/file-picker-path";
import { GITHUB_PR_CLOSED_CHIP_CLASS } from "@/lib/github-pr-merged-badge-styles";
import type { PrDiffAttachment, PullRequestChipStatus } from "@/lib/pr-diff-attachment";

const PR_DIFF_CHIP_BASE =
  "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs font-medium leading-none select-none align-middle mx-0.5";

export function prDiffChipClassForStatus(status: PullRequestChipStatus): string {
  switch (status) {
    case "merged":
      return `${PR_DIFF_CHIP_BASE} border-transparent bg-[#7954dc]/15 text-[#575786] dark:bg-[#855ae8]/22 dark:text-[#7574a6]`;
    case "closed":
      return `${PR_DIFF_CHIP_BASE} ${GITHUB_PR_CLOSED_CHIP_CLASS}`;
    case "draft":
      return `${PR_DIFF_CHIP_BASE} border-border/50 bg-background text-foreground/75 dark:border-white/10 dark:bg-input/30 dark:text-foreground/70`;
    case "open":
    default:
      return `${PR_DIFF_CHIP_BASE} border-transparent bg-[#1a7f37]/15 text-[#296837] dark:bg-[#238636]/22 dark:text-[#57a773]`;
  }
}

export function formatPrDiffChipLabel(
  filename: string,
  lineStart: number,
  lineEnd: number,
): string {
  const base = workspaceFileBasename(filename.replace(/\\/gu, "/"));
  if (lineStart > 0 && lineEnd > 0) {
    return `${base} L${lineStart}-${lineEnd}`;
  }
  return base;
}

export function formatPrDiffChipTitle(attachment: PrDiffAttachment): string {
  const normalized = attachment.filename.replace(/\\/gu, "/");
  const linePart =
    attachment.lineStart > 0 && attachment.lineEnd > 0
      ? ` — L${attachment.lineStart}-${attachment.lineEnd}`
      : "";
  return `${normalized} — ${attachment.prUrl}${linePart}`;
}

const GIT_PULL_REQUEST_ICON_PATH =
  '<circle cx="6" cy="6" r="3"/><path d="M6 9v12"/><path d="M21 3v5a4 4 0 0 1-4 4H6"/>';

const GIT_PULL_REQUEST_CLOSED_ICON_PATH =
  '<circle cx="6" cy="6" r="3"/><path d="M6 9v12"/><path d="M21 3v5a4 4 0 0 1-4 4H6"/><path d="m18 9-6 6"/><path d="m12 9 6 6"/>';

const GIT_PULL_REQUEST_DRAFT_ICON_PATH =
  '<circle cx="6" cy="6" r="3"/><path d="M6 9v12"/><path d="M21 3v5a4 4 0 0 1-4 4H6"/><path d="M15 3h2v4"/><path d="M17 5h-4"/>';

function prDiffIconPaths(status: PullRequestChipStatus): string {
  switch (status) {
    case "closed":
      return GIT_PULL_REQUEST_CLOSED_ICON_PATH;
    case "draft":
      return GIT_PULL_REQUEST_DRAFT_ICON_PATH;
    default:
      return GIT_PULL_REQUEST_ICON_PATH;
  }
}

export function makePrDiffChipNode(attachment: PrDiffAttachment, doc: Document): HTMLElement {
  const span = doc.createElement("span");
  span.contentEditable = "false";
  span.dataset.prDiffId = attachment.id;
  span.dataset.prDiffUrl = attachment.prUrl;
  span.dataset.prDiffFilename = attachment.filename;
  span.dataset.prDiffLineStart = String(attachment.lineStart);
  span.dataset.prDiffLineEnd = String(attachment.lineEnd);
  span.dataset.prDiffText = attachment.diffText;
  span.dataset.prDiffStatus = attachment.status;
  span.dataset.prDiffChip = "true";
  span.setAttribute("data-pr-diff-chip", "true");
  span.className = prDiffChipClassForStatus(attachment.status);
  span.title = formatPrDiffChipTitle(attachment);

  const icon = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
  icon.setAttribute("viewBox", "0 0 24 24");
  icon.setAttribute("width", "10");
  icon.setAttribute("height", "10");
  icon.setAttribute("fill", "none");
  icon.setAttribute("stroke", "currentColor");
  icon.setAttribute("stroke-width", "2");
  icon.setAttribute("stroke-linecap", "round");
  icon.setAttribute("stroke-linejoin", "round");
  icon.setAttribute("aria-hidden", "true");
  icon.innerHTML = prDiffIconPaths(attachment.status);
  span.appendChild(icon);
  span.appendChild(
    doc.createTextNode(formatPrDiffChipLabel(attachment.filename, attachment.lineStart, attachment.lineEnd)),
  );
  return span;
}
