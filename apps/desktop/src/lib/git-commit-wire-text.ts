import type { GitCommitAttachment } from "./git-commit-attachment.js";

function formatGitCommitWireMeta(
  attachment: Pick<GitCommitAttachment, "subject" | "author" | "authoredAt">,
): string {
  return `${attachment.subject}\t${attachment.author}\t${attachment.authoredAt}`;
}

const GIT_COMMIT_HEADER_PREFIX = "Selected git commit ";
/** Meta 在括号内且 subject 可含 `)`；用贪婪匹配到行末 `):`。 */
const GIT_COMMIT_HEADER_RE = /^Selected git commit (\S+) \((.*)\):$/u;

function chooseTextFence(text: string): { open: string; close: string } {
  if (!/^\s*```/m.test(text)) {
    return { open: "```text\n", close: "\n```" };
  }
  return { open: "````text\n", close: "\n````" };
}

/** Wire-format git commit block (shared by attachment + composer segment model). */
export function gitCommitContextText(
  attachment: Pick<GitCommitAttachment, "oid" | "subject" | "author" | "authoredAt" | "fullMessage">,
): string {
  const meta = formatGitCommitWireMeta(attachment);
  const fence = chooseTextFence(attachment.fullMessage);
  return `Selected git commit ${attachment.oid} (${meta}):\n${fence.open}${attachment.fullMessage}${fence.close}`;
}

export type ParsedGitCommitWireBlock = {
  index: number;
  length: number;
  oid: string;
  meta: string;
  fullMessage: string;
};

const GIT_COMMIT_OPEN_FENCE_RE = /^(`{3,})text\n/;

/** Scan wire text for git commit blocks; closing fence must be a standalone line. */
export function scanGitCommitWireBlocks(content: string): ParsedGitCommitWireBlock[] {
  const blocks: ParsedGitCommitWireBlock[] = [];
  let searchFrom = 0;

  while (searchFrom < content.length) {
    const headerIndex = content.indexOf(GIT_COMMIT_HEADER_PREFIX, searchFrom);
    if (headerIndex === -1) {
      break;
    }

    const headerLineEnd = content.indexOf("\n", headerIndex);
    if (headerLineEnd === -1) {
      break;
    }

    const headerLine = content.slice(headerIndex, headerLineEnd);
    const headerMatch = GIT_COMMIT_HEADER_RE.exec(headerLine);
    if (!headerMatch) {
      searchFrom = headerIndex + 1;
      continue;
    }

    let cursor = headerLineEnd + 1;
    const fenceTail = content.slice(cursor);
    const openFenceMatch = GIT_COMMIT_OPEN_FENCE_RE.exec(fenceTail);
    if (!openFenceMatch) {
      searchFrom = headerIndex + 1;
      continue;
    }
    const fenceMark = openFenceMatch[1] ?? "```";
    const closeFence = fenceMark;
    cursor += openFenceMatch[0].length;

    const messageLines: string[] = [];
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
          oid: headerMatch[1]?.trim() ?? "",
          meta: headerMatch[2]?.trim() ?? "",
          fullMessage: messageLines.join("\n"),
        });
        searchFrom = blockEnd;
        closed = true;
        break;
      }
      messageLines.push(line);
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

export function parseGitCommitWireMeta(meta: string): {
  subject: string;
  author: string;
  authoredAt: string;
} | null {
  const parts = meta.trim().split("\t");
  if (parts.length < 3) {
    return null;
  }
  const authoredAt = parts[parts.length - 1]?.trim() ?? "";
  const author = parts[parts.length - 2]?.trim() ?? "";
  const subject = parts.slice(0, -2).join("\t").trim();
  if (!subject || !author || !authoredAt) {
    return null;
  }
  return { subject, author, authoredAt };
}
