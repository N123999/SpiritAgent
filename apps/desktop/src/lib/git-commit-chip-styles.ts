import { PLAN_CHIP_CLASS, PLAN_CHIP_ICON_CLASS } from "@/lib/plan-chip-styles";
import type { GitCommitAttachment } from "@/lib/git-commit-attachment";

const GIT_COMMIT_ICON_PATH =
  '<circle cx="12" cy="12" r="4"/><line x1="1.05" y1="12" x2="7" y2="12"/><line x1="17.01" y1="12" x2="22.96" y2="12"/>';

export function formatGitCommitChipLabel(subject: string): string {
  const trimmed = subject.trim();
  if (trimmed.length <= 48) {
    return trimmed;
  }
  return `${trimmed.slice(0, 45)}…`;
}

export function formatGitCommitChipTitle(attachment: GitCommitAttachment): string {
  const shortOid = attachment.oid.length > 7 ? attachment.oid.slice(0, 7) : attachment.oid;
  return `${shortOid} — ${attachment.author} — ${attachment.authoredAt}`;
}

export function makeGitCommitChipNode(attachment: GitCommitAttachment, doc: Document): HTMLElement {
  const span = doc.createElement("span");
  span.contentEditable = "false";
  span.setAttribute("data-git-commit-chip", "true");
  span.dataset.gitCommitChip = "true";
  span.dataset.gitCommitId = attachment.id;
  span.dataset.gitCommitOid = attachment.oid;
  span.dataset.gitCommitSubject = attachment.subject;
  span.dataset.gitCommitAuthor = attachment.author;
  span.dataset.gitCommitAuthoredAt = attachment.authoredAt;
  span.dataset.gitCommitFullMessage = attachment.fullMessage;
  span.title = formatGitCommitChipTitle(attachment);
  span.className = PLAN_CHIP_CLASS;
  span.setAttribute(
    "aria-label",
    formatGitCommitChipLabel(attachment.subject),
  );

  const icon = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
  icon.setAttribute("viewBox", "0 0 24 24");
  icon.setAttribute("width", "10");
  icon.setAttribute("height", "10");
  icon.setAttribute("fill", "none");
  icon.setAttribute("stroke", "currentColor");
  icon.setAttribute("stroke-width", "2");
  icon.setAttribute("stroke-linecap", "round");
  icon.setAttribute("stroke-linejoin", "round");
  icon.setAttribute("class", PLAN_CHIP_ICON_CLASS);
  icon.setAttribute("aria-hidden", "true");
  icon.innerHTML = GIT_COMMIT_ICON_PATH;

  span.appendChild(icon);
  span.appendChild(doc.createTextNode(formatGitCommitChipLabel(attachment.subject)));
  return span;
}
