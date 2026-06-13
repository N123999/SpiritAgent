import type { PrDiffAttachment } from "./pr-diff-attachment.js";

function formatPrDiffWireMeta(attachment: Pick<PrDiffAttachment, "filename" | "lineStart" | "lineEnd" | "status">): string {
  const normalized = attachment.filename.replace(/\\/gu, "/").trim() || "file";
  const hasLines = attachment.lineStart > 0 && attachment.lineEnd > 0;
  const linePart = hasLines ? `L${attachment.lineStart}-${attachment.lineEnd}` : "-";
  return `${normalized}\t${linePart}\t${attachment.status}`;
}

const PR_DIFF_HEADER_PREFIX = "Selected diff from ";
const PR_DIFF_HEADER_RE = /^Selected diff from ([^\n]+?) \(([^)]*)\):$/u;

function chooseDiffFence(diffText: string): { open: string; close: string } {
  if (!/^\s*```/m.test(diffText)) {
    return { open: "```diff\n", close: "\n```" };
  }
  return { open: "````diff\n", close: "\n````" };
}

/** Wire-format PR diff block (shared by attachment + composer segment model). */
export function prDiffContextText(attachment: Pick<PrDiffAttachment, "prUrl" | "filename" | "lineStart" | "lineEnd" | "status" | "diffText">): string {
  const meta = formatPrDiffWireMeta(attachment);
  const fence = chooseDiffFence(attachment.diffText);
  return `Selected diff from ${attachment.prUrl} (${meta}):\n${fence.open}${attachment.diffText}${fence.close}`;
}

export type ParsedPrDiffWireBlock = {
  index: number;
  length: number;
  prUrl: string;
  meta: string;
  diffText: string;
};

const PR_DIFF_OPEN_FENCE_RE = /^(`{3,})diff\n/;

/** Scan wire text for PR diff blocks; closing fence must be a standalone line. */
export function scanPrDiffWireBlocks(content: string): ParsedPrDiffWireBlock[] {
  const blocks: ParsedPrDiffWireBlock[] = [];
  let searchFrom = 0;

  while (searchFrom < content.length) {
    const headerIndex = content.indexOf(PR_DIFF_HEADER_PREFIX, searchFrom);
    if (headerIndex === -1) {
      break;
    }

    const headerLineEnd = content.indexOf("\n", headerIndex);
    if (headerLineEnd === -1) {
      break;
    }

    const headerLine = content.slice(headerIndex, headerLineEnd);
    const headerMatch = PR_DIFF_HEADER_RE.exec(headerLine);
    if (!headerMatch) {
      searchFrom = headerIndex + 1;
      continue;
    }

    let cursor = headerLineEnd + 1;
    const fenceTail = content.slice(cursor);
    const openFenceMatch = PR_DIFF_OPEN_FENCE_RE.exec(fenceTail);
    if (!openFenceMatch) {
      searchFrom = headerIndex + 1;
      continue;
    }
    const fenceMark = openFenceMatch[1] ?? "```";
    const closeFence = fenceMark;
    cursor += openFenceMatch[0].length;

    const diffLines: string[] = [];
    let closed = false;
    while (cursor <= content.length) {
      const nextLineEnd = content.indexOf("\n", cursor);
      const lineEnd = nextLineEnd === -1 ? content.length : nextLineEnd;
      const line = content.slice(cursor, lineEnd);
      if (line === closeFence) {
        const blockEnd = nextLineEnd === -1 ? content.length : nextLineEnd + 1;
        blocks.push({
          index: headerIndex,
          length: blockEnd - headerIndex,
          prUrl: headerMatch[1]?.trim() ?? "",
          meta: headerMatch[2]?.trim() ?? "",
          diffText: diffLines.join("\n"),
        });
        searchFrom = blockEnd;
        closed = true;
        break;
      }
      diffLines.push(line);
      if (nextLineEnd === -1) {
        break;
      }
      cursor = nextLineEnd + 1;
    }

    if (!closed) {
      searchFrom = headerIndex + 1;
    }
  }

  return blocks;
}

/** @deprecated Prefer scanPrDiffWireBlocks for parsing; kept for tests referencing the pattern. */
export const PR_DIFF_BLOCK_RE =
  /Selected diff from ([^\n]+) \(([^)]*)\):\n```diff\n[\s\S]*?\n```/g;

export function parsePrDiffWireMeta(meta: string): {
  filename: string;
  lineStart: number;
  lineEnd: number;
  status: PrDiffAttachment["status"];
} | null {
  const trimmed = meta.trim();
  const tabParts = trimmed.split("\t");
  if (tabParts.length === 3) {
    const filename = tabParts[0]?.trim() ?? "";
    const linePart = tabParts[1]?.trim() ?? "";
    const statusRaw = tabParts[2]?.trim() ?? "";
    if (
      filename
      && (statusRaw === "open" || statusRaw === "merged" || statusRaw === "closed" || statusRaw === "draft")
    ) {
      if (linePart === "-") {
        return { filename, lineStart: 0, lineEnd: 0, status: statusRaw };
      }
      const lineMatch = /^L(\d+)-(\d+)$/u.exec(linePart);
      if (lineMatch) {
        return {
          filename,
          lineStart: Number(lineMatch[1]),
          lineEnd: Number(lineMatch[2]),
          status: statusRaw,
        };
      }
    }
  }

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
