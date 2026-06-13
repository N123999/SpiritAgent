import type { PrDiffAttachment } from "./pr-diff-attachment.js";

function formatPrDiffWireMeta(attachment: Pick<PrDiffAttachment, "filename" | "lineStart" | "lineEnd" | "status">): string {
  const normalized = attachment.filename.replace(/\\/gu, "/").trim() || "file";
  const hasLines = attachment.lineStart > 0 && attachment.lineEnd > 0;
  const linePart = hasLines ? `, L${attachment.lineStart}-${attachment.lineEnd}` : "";
  return `${normalized}${linePart}, status:${attachment.status}`;
}

/** Wire-format PR diff block (shared by attachment + composer segment model). */
export function prDiffContextText(attachment: Pick<PrDiffAttachment, "prUrl" | "filename" | "lineStart" | "lineEnd" | "status" | "diffText">): string {
  const meta = formatPrDiffWireMeta(attachment);
  return `Selected diff from ${attachment.prUrl} (${meta}):\n\`\`\`diff\n${attachment.diffText}\n\`\`\``;
}

export const PR_DIFF_BLOCK_RE =
  /Selected diff from ([^\n]+) \(([^)]*)\):\n```diff\n[\s\S]*?\n```/g;

export function parsePrDiffWireMeta(meta: string): {
  filename: string;
  lineStart: number;
  lineEnd: number;
  status: PrDiffAttachment["status"];
} | null {
  const trimmed = meta.trim();
  const statusMatch = /,\s*status:(open|merged|closed|draft)\s*$/u.exec(trimmed);
  if (!statusMatch) {
    return null;
  }
  const status = statusMatch[1] as PrDiffAttachment["status"];
  const beforeStatus = trimmed.slice(0, statusMatch.index);
  const lineMatch = /,\s*L(\d+)-(\d+)\s*$/u.exec(beforeStatus);
  if (lineMatch) {
    const filename = beforeStatus.slice(0, lineMatch.index).trim();
    return {
      filename,
      lineStart: Number(lineMatch[1]),
      lineEnd: Number(lineMatch[2]),
      status,
    };
  }
  return {
    filename: beforeStatus.trim(),
    lineStart: 0,
    lineEnd: 0,
    status,
  };
}
