import type { BrowserElementAttachment } from "./browser-element-attachment";
import { browserElementContextText } from "./browser-element-wire-text.js";
import type { PrDiffAttachment } from "./pr-diff-attachment.js";
import { parsePrDiffWireMeta, prDiffContextText, scanPrDiffWireBlocks } from "./pr-diff-wire-text.js";

export { browserElementContextText };
export { prDiffContextText };

export type RichSegment =
  | { kind: "text"; value: string }
  | { kind: "element"; attachment: BrowserElementAttachment }
  | { kind: "prDiff"; attachment: PrDiffAttachment }
  | { kind: "workspaceFile"; path: string }
  | { kind: "loop" }
  | { kind: "plan" }
  | { kind: "ask" }
  | { kind: "debug" }
  | { kind: "skill"; alias: string };

export type ActiveWorkspaceFileReferenceQuery = {
  start: number;
  end: number;
  raw: string;
};

export type ActiveSkillSlashQuery = {
  start: number;
  end: number;
  raw: string;
};

export function normalizeWorkspaceFilePath(path: string): string {
  return path.replace(/\\/gu, "/");
}

export function workspaceFilePlainToken(path: string): string {
  return `@${normalizeWorkspaceFilePath(path)}`;
}

function plainTextLength(seg: RichSegment): number {
  if (seg.kind === "text") {
    return seg.value.length;
  }
  if (seg.kind === "workspaceFile") {
    return workspaceFilePlainToken(seg.path).length;
  }
  return 0;
}

export const EMPTY_TEXT_SEGMENT: RichSegment = { kind: "text", value: "" };

export function emptySegments(): RichSegment[] {
  return [{ kind: "text", value: "" }];
}

export function mergeAdjacentTextSegments(segs: RichSegment[]): RichSegment[] {
  const out: RichSegment[] = [];
  for (const seg of segs) {
    if (seg.kind === "text") {
      const prev = out[out.length - 1];
      if (prev?.kind === "text") {
        prev.value += seg.value;
      } else {
        out.push({ kind: "text", value: seg.value });
      }
    } else {
      out.push(seg);
    }
  }
  return out.length > 0 ? out : emptySegments();
}

export function segmentsToPlainText(segs: RichSegment[]): string {
  return segs.map((s) => {
    if (s.kind === "text") {
      return s.value;
    }
    if (s.kind === "workspaceFile") {
      return workspaceFilePlainToken(s.path);
    }
    return "";
  }).join("");
}

/** True when composer has no user-visible text (incl. lone `<br>` newlines, not intentional line breaks). */
export function isComposerPlainEmpty(plain: string): boolean {
  if (plain.length === 0) {
    return true;
  }
  const withoutNewlines = plain.replace(/\r?\n/g, "");
  if (withoutNewlines.length === 0) {
    return true;
  }
  return /^[\t \u00a0]*$/u.test(withoutNewlines);
}

export function normalizeComposerPlain(plain: string): string {
  return isComposerPlainEmpty(plain) ? "" : plain;
}

export function segmentsToAttachments(segs: RichSegment[]): BrowserElementAttachment[] {
  return segs
    .filter((s): s is Extract<RichSegment, { kind: "element" }> => s.kind === "element")
    .map((s) => s.attachment);
}

export function hasSkillSegment(segs: RichSegment[]): boolean {
  return segs.some((s) => s.kind === "skill");
}

/** Separator between serialized parts; avoids extra blank lines around inline chips. */
export function messageSegmentSeparator(prev: RichSegment, next: RichSegment): string {
  if (prev.kind === "text" && next.kind === "text") return "";

  if (prev.kind === "text" && next.kind === "element") {
    const v = prev.value;
    if (!v) return "\n";
    if (v.endsWith("\n\n")) return "";
    if (v.endsWith("\n")) return "\n";
    return "\n";
  }

  if (prev.kind === "text" && next.kind === "prDiff") {
    const v = prev.value;
    if (!v) return "\n";
    if (v.endsWith("\n\n")) return "";
    if (v.endsWith("\n")) return "\n";
    return "\n";
  }

  if (prev.kind === "element" && next.kind === "text") {
    const v = next.value;
    if (!v) return "";
    if (v.startsWith("\n\n")) return "\n";
    if (v.startsWith("\n")) return "\n";
    return "\n";
  }

  if (prev.kind === "prDiff" && next.kind === "text") {
    const v = next.value;
    if (!v) return "";
    if (v.startsWith("\n\n")) return "\n";
    if (v.startsWith("\n")) return "\n";
    return "\n";
  }

  if (prev.kind === "workspaceFile" || next.kind === "workspaceFile" || prev.kind === "skill" || next.kind === "skill") {
    return "";
  }

  return "\n\n";
}

export function segmentsToMessageText(segs: RichSegment[]): string {
  const merged = mergeAdjacentTextSegments(segs).filter(
    (s) => s.kind !== "loop" && s.kind !== "plan" && s.kind !== "ask" && s.kind !== "debug",
  );
  let out = "";
  for (let i = 0; i < merged.length; i++) {
    const seg = merged[i]!;
    const piece =
      seg.kind === "text"
        ? seg.value
        : seg.kind === "workspaceFile"
          ? workspaceFilePlainToken(seg.path)
          : seg.kind === "skill"
            ? seg.alias
            : seg.kind === "prDiff"
              ? prDiffContextText(seg.attachment)
              : browserElementContextText(seg.attachment);
    if (seg.kind === "text" && !piece) continue;

    if (!out) {
      out = piece;
      continue;
    }
    const prev = merged[i - 1]!;
    out += messageSegmentSeparator(prev, seg) + piece;
  }
  return out;
}

/** Trim one structural newline adjacent to an element block for inline bubble display. */
export function trimMessageTextAroundElements(
  value: string,
  opts: { afterElement?: boolean; beforeElement?: boolean },
): string {
  let v = value;
  if (opts.afterElement) {
    v = v.replace(/^\n/, "");
  }
  if (opts.beforeElement) {
    v = v.replace(/\n$/, "");
  }
  return v;
}

export function segmentsEqual(a: RichSegment[], b: RichSegment[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((seg, i) => {
    const other = b[i];
    if (seg.kind !== other.kind) return false;
    if (seg.kind === "text" && other.kind === "text") {
      return seg.value === other.value;
    }
    if (seg.kind === "element" && other.kind === "element") {
      return seg.attachment.id === other.attachment.id;
    }
    if (seg.kind === "prDiff" && other.kind === "prDiff") {
      return seg.attachment.id === other.attachment.id;
    }
    if (seg.kind === "workspaceFile" && other.kind === "workspaceFile") {
      return seg.path === other.path;
    }
    if (seg.kind === "loop" && other.kind === "loop") {
      return true;
    }
    if (seg.kind === "plan" && other.kind === "plan") {
      return true;
    }
    if (seg.kind === "ask" && other.kind === "ask") {
      return true;
    }
    if (seg.kind === "skill" && other.kind === "skill") {
      return seg.alias === other.alias;
    }
    return false;
  });
}

function pinAgentModeChipFromSegments(
  body: RichSegment[],
  segs: RichSegment[],
): RichSegment[] {
  const modeChip = segs.find((s) => s.kind === "plan" || s.kind === "ask" || s.kind === "debug");
  if (modeChip?.kind !== "plan" && modeChip?.kind !== "ask" && modeChip?.kind !== "debug") {
    return body;
  }
  const withoutMode = body.filter((s) => s.kind !== "plan" && s.kind !== "ask" && s.kind !== "debug");
  const loopPart = withoutMode.filter((s) => s.kind === "loop");
  const rest = withoutMode.filter((s) => s.kind !== "loop");
  return mergeAdjacentTextSegments([...loopPart, { kind: modeChip.kind }, ...rest]);
}

export function syncSegmentsFromExternalValue(segs: RichSegment[], value: string): RichSegment[] {
  const loopPinned = segs.some((s) => s.kind === "loop");
  const inlineChips = segs.filter(
    (s): s is Extract<RichSegment, { kind: "element" | "prDiff" | "workspaceFile" | "skill" }> =>
      s.kind === "element" || s.kind === "prDiff" || s.kind === "workspaceFile" || s.kind === "skill",
  );

  let body: RichSegment[];
  if (inlineChips.length === 0) {
    body = value ? [{ kind: "text", value }] : emptySegments();
  } else if (!value) {
    body = emptySegments();
  } else {
    const out: RichSegment[] = [];
    let textApplied = false;
    for (const seg of segs) {
      if (seg.kind === "element" || seg.kind === "prDiff" || seg.kind === "workspaceFile" || seg.kind === "skill") {
        out.push(seg);
      } else if (seg.kind === "text" && !textApplied) {
        out.push({ kind: "text", value });
        textApplied = true;
      }
    }
    if (!textApplied) {
      out.unshift({ kind: "text", value });
    }
    body = mergeAdjacentTextSegments(out);
  }

  let result = loopPinned
    ? mergeAdjacentTextSegments([{ kind: "loop" }, ...body])
    : body;
  return pinAgentModeChipFromSegments(result, segs);
}

export type SegmentCaret = {
  segmentIndex: number;
  offset: number;
};

/** When inserting a chip with no following text, add a space for caret spacing. */
function textFollowingChipInsert(after: string): string {
  return after === "" ? " " : after;
}

function isInlineChipSegment(
  seg: RichSegment | undefined,
): seg is Extract<RichSegment, { kind: "element" | "prDiff" | "workspaceFile" | "loop" | "skill" }> {
  return (
    seg?.kind === "element"
    || seg?.kind === "prDiff"
    || seg?.kind === "workspaceFile"
    || seg?.kind === "loop"
    || seg?.kind === "skill"
  );
}

export function insertSegmentAtCaret(
  segs: RichSegment[],
  caret: SegmentCaret,
  newSegment: RichSegment,
): { segments: RichSegment[]; caret: SegmentCaret } {
  const merged = mergeAdjacentTextSegments(segs);
  let index = Math.min(Math.max(caret.segmentIndex, 0), Math.max(merged.length - 1, 0));
  const seg = merged[index];

  let next: RichSegment[];

  if (seg?.kind === "text") {
    const before = seg.value.slice(0, caret.offset);
    const after = seg.value.slice(caret.offset);
    next = [
      ...merged.slice(0, index),
      ...(before ? [{ kind: "text" as const, value: before }] : []),
      newSegment,
      {
        kind: "text" as const,
        value:
          isInlineChipSegment(newSegment) ? textFollowingChipInsert(after) : after,
      },
      ...merged.slice(index + 1),
    ];
  } else if (isInlineChipSegment(seg)) {
    const insertAt = caret.offset === 0 ? index : index + 1;
    next = [
      ...merged.slice(0, insertAt),
      newSegment,
      {
        kind: "text" as const,
        value: isInlineChipSegment(newSegment) ? textFollowingChipInsert("") : "",
      },
      ...merged.slice(insertAt),
    ];
  } else {
    next = [
      newSegment,
      {
        kind: "text" as const,
        value: isInlineChipSegment(newSegment) ? textFollowingChipInsert("") : "",
      },
    ];
  }

  const normalized = mergeAdjacentTextSegments(next);
  let afterIndex = normalized.length - 1;
  let caretOffset = 0;
  if (newSegment.kind === "element") {
    const elIndex = normalized.findIndex(
      (s) => s.kind === "element" && s.attachment.id === newSegment.attachment.id,
    );
    if (elIndex >= 0) {
      afterIndex = elIndex + 1;
      const trailing = normalized[afterIndex];
      if (trailing?.kind === "text" && trailing.value === " ") {
        caretOffset = 1;
      }
    }
  } else if (newSegment.kind === "prDiff") {
    const diffIndex = normalized.findIndex(
      (s) => s.kind === "prDiff" && s.attachment.id === newSegment.attachment.id,
    );
    if (diffIndex >= 0) {
      afterIndex = diffIndex + 1;
      const trailing = normalized[afterIndex];
      if (trailing?.kind === "text" && trailing.value === " ") {
        caretOffset = 1;
      }
    }
  } else if (newSegment.kind === "workspaceFile") {
    const fileIndex = normalized.findIndex(
      (s) => s.kind === "workspaceFile" && s.path === newSegment.path,
    );
    if (fileIndex >= 0) {
      afterIndex = fileIndex + 1;
      const trailing = normalized[afterIndex];
      if (trailing?.kind === "text" && trailing.value.startsWith(" ")) {
        caretOffset = 1;
      }
    }
  } else if (newSegment.kind === "skill") {
    const skillIndex = normalized.findIndex(
      (s) => s.kind === "skill" && s.alias === newSegment.alias,
    );
    if (skillIndex >= 0) {
      afterIndex = skillIndex + 1;
      const trailing = normalized[afterIndex];
      if (trailing?.kind === "text" && trailing.value.startsWith(" ")) {
        caretOffset = 1;
      }
    }
  }
  return {
    segments: normalized,
    caret: { segmentIndex: afterIndex, offset: caretOffset },
  };
}

/** Plain-text offset (UTF-16 code units) for file-reference / insert-at-cursor APIs. */
export function caretToPlainTextOffset(segments: RichSegment[], caret: SegmentCaret): number {
  const merged = mergeAdjacentTextSegments(segments);
  let offset = 0;
  const index = Math.min(Math.max(caret.segmentIndex, 0), merged.length);
  for (let i = 0; i < index; i++) {
    offset += plainTextLength(merged[i]!);
  }
  const at = merged[index];
  if (at?.kind === "text") {
    offset += Math.min(Math.max(caret.offset, 0), at.value.length);
  }
  return offset;
}

export function plainTextOffsetToCaret(segments: RichSegment[], offset: number): SegmentCaret {
  const merged = mergeAdjacentTextSegments(segments);
  let remaining = Math.max(0, offset);

  for (let i = 0; i < merged.length; i++) {
    const seg = merged[i]!;
    const len = plainTextLength(seg);
    if (seg.kind === "text") {
      if (remaining <= len) {
        return { segmentIndex: i, offset: remaining };
      }
      remaining -= len;
      continue;
    }
    if (seg.kind === "workspaceFile") {
      if (remaining < len) {
        if (remaining === 0) {
          return { segmentIndex: i, offset: 0 };
        }
        const trailing = merged[i + 1];
        if (trailing?.kind === "text") {
          return { segmentIndex: i + 1, offset: 0 };
        }
        return { segmentIndex: i + 1, offset: 0 };
      }
      if (remaining === len) {
        const trailing = merged[i + 1];
        if (trailing?.kind === "text") {
          return { segmentIndex: i + 1, offset: 0 };
        }
        return { segmentIndex: i + 1, offset: 0 };
      }
      remaining -= len;
      continue;
    }
  }

  return caretAtEnd(merged);
}

export function replaceWorkspaceFileReferenceInSegments(
  segs: RichSegment[],
  query: ActiveWorkspaceFileReferenceQuery,
  path: string,
  finalize: boolean,
): { segments: RichSegment[]; caret: SegmentCaret } {
  const normalizedPath = normalizeWorkspaceFilePath(path);
  const merged = mergeAdjacentTextSegments(segs);
  const startCaret = plainTextOffsetToCaret(merged, query.start);
  const endCaret = plainTextOffsetToCaret(merged, query.end);
  const index = startCaret.segmentIndex;
  const seg = merged[index];

  if (seg?.kind !== "text" || endCaret.segmentIndex !== index) {
    return insertSegmentAtCaret(merged, caretAtEnd(merged), {
      kind: "workspaceFile",
      path: normalizedPath,
    });
  }

  const before = seg.value.slice(0, startCaret.offset);
  const after = seg.value.slice(endCaret.offset);
  let trailing = after;
  if (finalize) {
    const needsSpace = trailing.length === 0 || !/^\s/u.test(trailing.charAt(0));
    if (needsSpace) {
      trailing = ` ${trailing}`;
    }
  }

  const next: RichSegment[] = [
    ...merged.slice(0, index),
    ...(before ? [{ kind: "text" as const, value: before }] : []),
    { kind: "workspaceFile", path: normalizedPath },
    { kind: "text" as const, value: trailing },
    ...merged.slice(index + 1),
  ];

  const normalized = mergeAdjacentTextSegments(next);
  const fileIndex = normalized.findIndex(
    (s) => s.kind === "workspaceFile" && s.path === normalizedPath,
  );
  let afterIndex = fileIndex >= 0 ? fileIndex + 1 : normalized.length - 1;
  let caretOffset = 0;
  const trailingSeg = normalized[afterIndex];
  if (trailingSeg?.kind === "text" && trailingSeg.value.startsWith(" ")) {
    caretOffset = 1;
  }

  return {
    segments: normalized,
    caret: { segmentIndex: afterIndex, offset: caretOffset },
  };
}

export function replaceSkillSlashQueryInSegments(
  segs: RichSegment[],
  query: ActiveSkillSlashQuery,
  replacement: string,
  finalize = false,
): { segments: RichSegment[]; caret: SegmentCaret } {
  const merged = mergeAdjacentTextSegments(segs);
  const startCaret = plainTextOffsetToCaret(merged, query.start);
  const endCaret = plainTextOffsetToCaret(merged, query.end);
  const index = startCaret.segmentIndex;
  const seg = merged[index];

  if (seg?.kind !== "text" || endCaret.segmentIndex !== index) {
    return { segments: merged, caret: caretAtEnd(merged) };
  }

  const before = seg.value.slice(0, startCaret.offset);
  const after = seg.value.slice(endCaret.offset);
  let insertText = replacement;
  if (finalize && insertText.length > 0) {
    const needsSpace = after.length === 0 || !/^\s/u.test(after.charAt(0));
    if (needsSpace && !insertText.endsWith(" ")) {
      insertText += " ";
    }
  }

  const combined = `${before}${insertText}${after}`;
  const next: RichSegment[] = [
    ...merged.slice(0, index),
    ...(combined ? [{ kind: "text" as const, value: combined }] : []),
    ...merged.slice(index + 1),
  ];

  const normalized = mergeAdjacentTextSegments(next);
  const caretPlainOffset = query.start + Array.from(insertText).length;
  return {
    segments: normalized,
    caret: plainTextOffsetToCaret(normalized, caretPlainOffset),
  };
}

export function caretAtEnd(segs: RichSegment[]): SegmentCaret {
  const merged = mergeAdjacentTextSegments(segs);
  const lastIndex = merged.length - 1;
  const last = merged[lastIndex];
  if (last?.kind === "text") {
    return { segmentIndex: lastIndex, offset: last.value.length };
  }
  return { segmentIndex: lastIndex + 1, offset: 0 };
}

export type MessageContentPart =
  | { kind: "text"; value: string }
  | { kind: "element"; tagName: string; url: string; outerHtml: string }
  | {
      kind: "prDiff";
      prUrl: string;
      filename: string;
      lineStart: number;
      lineEnd: number;
      status: PrDiffAttachment["status"];
      diffText: string;
    }
  | { kind: "workspaceFile"; path: string };

const ELEMENT_BLOCK_RE = /Selected element from ([^\n]*):\n```html\n[\s\S]*?\n```/g;

type ParsedWireBlock = {
  index: number;
  length: number;
  part: MessageContentPart;
};

function findWireBlocks(content: string): ParsedWireBlock[] {
  const blocks: ParsedWireBlock[] = [];

  let match: RegExpExecArray | null;
  const elementRe = new RegExp(ELEMENT_BLOCK_RE.source, "g");
  while ((match = elementRe.exec(content)) !== null) {
    const url = match[1]?.trim() ?? "";
    const htmlMatch = /```html\n([\s\S]*?)\n```/.exec(match[0]);
    const outerHtml = htmlMatch?.[1] ?? "";
    const firstTag = outerHtml ? (/<(\w[\w-]*)/.exec(outerHtml)?.[1] ?? "element") : "element";
    blocks.push({
      index: match.index,
      length: match[0].length,
      part: { kind: "element", tagName: firstTag, url, outerHtml },
    });
  }

  for (const block of scanPrDiffWireBlocks(content)) {
    const parsed = parsePrDiffWireMeta(block.meta);
    if (!parsed) {
      continue;
    }
    blocks.push({
      index: block.index,
      length: block.length,
      part: {
        kind: "prDiff",
        prUrl: block.prUrl,
        filename: parsed.filename,
        lineStart: parsed.lineStart,
        lineEnd: parsed.lineEnd,
        status: parsed.status,
        diffText: block.diffText,
      },
    });
  }

  blocks.sort((left, right) => left.index - right.index);
  return blocks;
}
const WORKSPACE_FILE_REF_IN_TEXT_RE = /@([^\s@]+)/gu;

function expandTextWithWorkspaceFileRefs(text: string): MessageContentPart[] {
  if (!text) {
    return [];
  }

  const parts: MessageContentPart[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  const re = new RegExp(WORKSPACE_FILE_REF_IN_TEXT_RE.source, "gu");
  while ((match = re.exec(text)) !== null) {
    if (match.index > last) {
      parts.push({ kind: "text", value: text.slice(last, match.index) });
    }
    parts.push({
      kind: "workspaceFile",
      path: normalizeWorkspaceFilePath(match[1] ?? ""),
    });
    last = match.index + match[0].length;
  }

  if (last < text.length) {
    parts.push({ kind: "text", value: text.slice(last) });
  }

  return parts.length > 0 ? parts : [{ kind: "text", value: text }];
}

function pushExpandedTextParts(parts: MessageContentPart[], text: string): void {
  for (const part of expandTextWithWorkspaceFileRefs(text)) {
    parts.push(part);
  }
}

/** Parse wire-format user message text into text / element / PR diff / workspace file blocks. */
export function parseMessageContentParts(content: string): MessageContentPart[] {
  if (!content) {
    return [];
  }

  const blocks = findWireBlocks(content);
  if (blocks.length === 0) {
    return expandTextWithWorkspaceFileRefs(content);
  }

  const parts: MessageContentPart[] = [];
  let last = 0;
  for (const block of blocks) {
    if (block.index > last) {
      pushExpandedTextParts(parts, content.slice(last, block.index));
    }
    parts.push(block.part);
    last = block.index + block.length;
  }
  if (last < content.length) {
    pushExpandedTextParts(parts, content.slice(last));
  }
  return parts.length > 0 ? parts : expandTextWithWorkspaceFileRefs(content);
}

/** Rebuild composer segments from stored message content (e.g. message rewind). */
export function messageContentToRichSegments(
  content: string,
  idPrefix: string,
): RichSegment[] {
  const parts = parseMessageContentParts(content);
  if (parts.length === 0) {
    return content ? [{ kind: "text", value: content }] : emptySegments();
  }

  const segments: RichSegment[] = [];
  let elementIndex = 0;
  let prDiffIndex = 0;

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!;
    const prev = i > 0 ? parts[i - 1]! : null;
    const next = i < parts.length - 1 ? parts[i + 1]! : null;

    if (part.kind === "element") {
      const attachment: BrowserElementAttachment = {
        id: `${idPrefix}-el-${elementIndex++}`,
        tagName: part.tagName,
        outerHtml: part.outerHtml,
        screenshotDataUrl: "",
        pageUrl: part.url,
      };
      segments.push({ kind: "element", attachment });
      continue;
    }

    if (part.kind === "prDiff") {
      const attachment: PrDiffAttachment = {
        id: `${idPrefix}-pr-${prDiffIndex++}`,
        prUrl: part.prUrl,
        filename: part.filename,
        lineStart: part.lineStart,
        lineEnd: part.lineEnd,
        diffText: part.diffText,
        status: part.status,
      };
      segments.push({ kind: "prDiff", attachment });
      continue;
    }

    if (part.kind === "workspaceFile") {
      segments.push({ kind: "workspaceFile", path: part.path });
      continue;
    }

    const display = trimMessageTextAroundElements(part.value, {
      afterElement:
        prev?.kind === "element" || prev?.kind === "prDiff" || prev?.kind === "workspaceFile",
      beforeElement:
        next?.kind === "element" || next?.kind === "prDiff" || next?.kind === "workspaceFile",
    });
    if (display || segments.length === 0) {
      segments.push({ kind: "text", value: display });
    }
  }

  return mergeAdjacentTextSegments(segments.length > 0 ? segments : emptySegments());
}
