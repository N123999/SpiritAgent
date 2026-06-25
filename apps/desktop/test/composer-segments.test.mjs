import assert from "node:assert/strict";
import { test } from "node:test";

import {
  caretToPlainTextOffset,
  emptySegments,
  insertSegmentAtCaret,
  isComposerPlainEmpty,
  mergeAdjacentTextSegments,
  normalizeComposerPlain,
  messageSegmentSeparator,
  plainTextOffsetToCaret,
  replaceSkillSlashQueryInSegments,
  replaceWorkspaceFileReferenceInSegments,
  segmentsToMessageText,
  segmentsToPlainText,
  syncSegmentsFromExternalValue,
  trimMessageTextAroundElements,
  messageContentToRichSegments,
  parseMessageContentParts,
  segmentsEqual,
} from "../src/lib/composer-segment-model.ts";
import {
  ensureLoopChipTypingTail,
  ensureLoopPinned,
  hasLoopSegment,
  insertLoopSegment,
  isCaretAtLoopRemovalPoint,
  normalizeCaretForPinnedLoopChip,
  removeLoopSegment,
} from "../src/lib/composer-loop-segments.ts";
import {
  isCaretAtInlineChipRemovalPoint,
  normalizeCaretForInlineAttachmentChips,
  removeInlineChipAtRemovalPoint,
} from "../src/lib/composer-inline-chip-caret.ts";
import { normalizeCaretForComposer } from "../src/lib/composer-caret-normalize.ts";
import {
  currentAgentModeSegment,
  ensureAgentModePinned,
  hasAgentModeSegment,
  insertAgentModeSegment,
  isCaretAtAgentModeRemovalPoint,
  removeAgentModeSegment,
} from "../src/lib/composer-agent-mode-segments.ts";
import {
  applyAgentModeChipPolicy,
  composerShowsPlaceholder,
  domParsedMissingRequiredAgentChip,
  shouldPinAgentModeChip,
  synchronizeTextFromDom,
} from "../src/lib/composer-agent-mode-policy.ts";

const sampleAttachment = {
  id: "el-1",
  tagName: "img",
  outerHtml: '<img src="x">',
  screenshotDataUrl: "",
  pageUrl: "https://example.com",
};

test("mergeAdjacentTextSegments merges neighbors", () => {
  const merged = mergeAdjacentTextSegments([
    { kind: "text", value: "a" },
    { kind: "text", value: "b" },
    { kind: "element", attachment: sampleAttachment },
    { kind: "text", value: " c" },
  ]);
  assert.equal(merged.length, 3);
  assert.equal(merged[0]?.kind === "text" && merged[0].value, "ab");
});

test("segmentsToPlainText preserves whitespace around elements", () => {
  const segs = [
    { kind: "text", value: "hello " },
    { kind: "element", attachment: sampleAttachment },
    { kind: "text", value: " world" },
  ];
  assert.equal(segmentsToPlainText(segs), "hello  world");
});

test("segmentsToMessageText keeps document order", () => {
  const segs = [
    { kind: "text", value: "before" },
    { kind: "element", attachment: sampleAttachment },
    { kind: "text", value: "after" },
  ];
  const message = segmentsToMessageText(segs);
  assert.match(message, /^before/);
  assert.match(message, /Selected element from https:\/\/example\.com/);
  assert.match(message, /after$/);
  assert.ok(message.indexOf("before") < message.indexOf("Selected element"));
  assert.ok(message.indexOf("Selected element") < message.indexOf("after"));
});

test("segmentsToMessageText does not double-newline inline text after element", () => {
  const segs = [
    { kind: "element", attachment: sampleAttachment },
    { kind: "text", value: "你好啊\n这是什么" },
  ];
  const message = segmentsToMessageText(segs);
  assert.ok(!message.includes("```\n\n你好"));
  assert.match(message, /```\n你好啊/);
});

test("messageSegmentSeparator uses single newline between element and inline text", () => {
  assert.equal(
    messageSegmentSeparator(
      { kind: "element", attachment: sampleAttachment },
      { kind: "text", value: "你好" },
    ),
    "\n",
  );
});

const sampleTerminalAttachment = {
  id: "term-1",
  terminalName: "Terminal",
  lineStart: 10,
  lineEnd: 12,
  selectedText: "error output",
};

test("messageSegmentSeparator uses single newline between terminal chip and element", () => {
  assert.equal(
    messageSegmentSeparator(
      { kind: "terminalSnippet", attachment: sampleTerminalAttachment },
      { kind: "element", attachment: sampleAttachment },
    ),
    "\n",
  );
  assert.equal(
    messageSegmentSeparator(
      { kind: "element", attachment: sampleAttachment },
      { kind: "terminalSnippet", attachment: sampleTerminalAttachment },
    ),
    "\n",
  );
});

test("segmentsToMessageText does not double-newline terminal chip after element", () => {
  const message = segmentsToMessageText([
    { kind: "element", attachment: sampleAttachment },
    { kind: "terminalSnippet", attachment: sampleTerminalAttachment },
  ]);
  assert.ok(!message.includes("```\n\nSelected terminal"));
});

test("trimMessageTextAroundElements removes one structural newline after element", () => {
  assert.equal(trimMessageTextAroundElements("\n你好啊", { afterElement: true }), "你好啊");
  assert.equal(trimMessageTextAroundElements("你好啊\n", { beforeElement: true }), "你好啊");
});

test("caretToPlainTextOffset skips element segments in plain text", () => {
  const segs = [
    { kind: "text", value: "ab" },
    { kind: "element", attachment: sampleAttachment },
    { kind: "text", value: "cd" },
  ];
  assert.equal(caretToPlainTextOffset(segs, { segmentIndex: 0, offset: 1 }), 1);
  assert.equal(caretToPlainTextOffset(segs, { segmentIndex: 2, offset: 1 }), 3);
});

test("insertSegmentAtCaret places caret after text inserted into empty composer", () => {
  const { segments, caret } = insertSegmentAtCaret(
    emptySegments(),
    { segmentIndex: 0, offset: 0 },
    { kind: "text", value: "Concurrent" },
  );
  assert.equal(segmentsToPlainText(segments), "Concurrent");
  assert.equal(caretToPlainTextOffset(segments, caret), "Concurrent".length);
});

test("insertSegmentAtCaret splits text and leaves trailing text segment", () => {
  const { segments, caret } = insertSegmentAtCaret(
    [{ kind: "text", value: "hello world" }],
    { segmentIndex: 0, offset: 5 },
    { kind: "element", attachment: sampleAttachment },
  );
  assert.deepEqual(segments, [
    { kind: "text", value: "hello" },
    { kind: "element", attachment: sampleAttachment },
    { kind: "text", value: " world" },
  ]);
  assert.equal(caret.segmentIndex, 2);
  assert.equal(caret.offset, 0);
});

test("parseMessageContentParts splits @path tokens in plain text", () => {
  const parts = parseMessageContentParts("@apps/cli/src/main.rs 你好");
  assert.equal(parts.length, 2);
  assert.equal(parts[0]?.kind, "workspaceFile");
  assert.equal(parts[0]?.kind === "workspaceFile" && parts[0].path, "apps/cli/src/main.rs");
  assert.equal(parts[1]?.kind, "text");
  assert.equal(parts[1]?.kind === "text" && parts[1].value, " 你好");
});

test("messageContentToRichSegments rebuilds workspace file chips from wire text", () => {
  const segments = messageContentToRichSegments("@apps/cli/src/main.rs 你好", "msg-file");
  assert.equal(segments.length, 2);
  assert.equal(segments[0]?.kind, "workspaceFile");
  assert.equal(
    segments[0]?.kind === "workspaceFile" && segments[0].path,
    "apps/cli/src/main.rs",
  );
  assert.equal(segments[1]?.kind === "text" && segments[1].value, " 你好");
});

test("messageContentToRichSegments rebuilds skill chips from wire text", () => {
  const segments = messageContentToRichSegments("/create-skill 你好", "msg-skill");
  assert.equal(segments.length, 2);
  assert.equal(segments[0]?.kind, "skill");
  assert.equal(segments[0]?.kind === "skill" && segments[0].alias, "/create-skill");
  assert.equal(segments[1]?.kind === "text" && segments[1].value, " 你好");
});

test("parseMessageContentParts parses skill and workspace file inline refs", () => {
  const parts = parseMessageContentParts("/git-commit @README.md done");
  assert.deepEqual(parts, [
    { kind: "skill", alias: "/git-commit" },
    { kind: "text", value: " " },
    { kind: "workspaceFile", path: "README.md" },
    { kind: "text", value: " done" },
  ]);
});

test("messageContentToRichSegments rebuilds element chips from wire text", () => {
  const wire = segmentsToMessageText([
    { kind: "element", attachment: sampleAttachment },
    { kind: "text", value: "你好" },
  ]);
  const segments = messageContentToRichSegments(wire, "msg-1");
  assert.equal(segments.length, 2);
  assert.equal(segments[0]?.kind, "element");
  assert.equal(segments[1]?.kind === "text" && segments[1].value, "你好");
});

test("insertSegmentAtCaret adds trailing space after element at caret", () => {
  const { segments, caret } = insertSegmentAtCaret(
    [{ kind: "text", value: "" }],
    { segmentIndex: 0, offset: 0 },
    { kind: "element", attachment: sampleAttachment },
  );
  assert.deepEqual(segments, [
    { kind: "element", attachment: sampleAttachment },
    { kind: "text", value: " " },
  ]);
  assert.equal(caret.segmentIndex, 1);
  assert.equal(caret.offset, 1);
});

test("insertSegmentAtCaret preserves whitespace-only text after chip", () => {
  const { segments } = insertSegmentAtCaret(
    [{ kind: "element", attachment: sampleAttachment }, { kind: "text", value: "" }],
    { segmentIndex: 1, offset: 0 },
    { kind: "text", value: "   " },
  );
  const textSeg = segments.find((s) => s.kind === "text");
  assert.equal(textSeg?.kind === "text" && textSeg.value, "   ");
});

test("syncSegmentsFromExternalValue clears all segments when value empty", () => {
  const synced = syncSegmentsFromExternalValue(
    [
      { kind: "text", value: "x" },
      { kind: "element", attachment: sampleAttachment },
    ],
    "",
  );
  assert.deepEqual(synced, [{ kind: "text", value: "" }]);
});

test("syncSegmentsFromExternalValue keeps ask chip when syncing plain text", () => {
  const synced = syncSegmentsFromExternalValue(
    [
      { kind: "ask" },
      { kind: "text", value: "old" },
    ],
    "new",
  );
  assert.deepEqual(synced, [
    { kind: "ask" },
    { kind: "text", value: "new" },
  ]);
});

test("syncSegmentsFromExternalValue keeps plan chip after loop", () => {
  const synced = syncSegmentsFromExternalValue(
    [
      { kind: "loop" },
      { kind: "plan" },
      { kind: "text", value: "a" },
    ],
    "b",
  );
  assert.equal(synced[0]?.kind, "loop");
  assert.equal(synced[1]?.kind, "plan");
  assert.equal(synced[2]?.kind === "text" && synced[2].value, "b");
});

test("syncSegmentsFromExternalValue replaces text while keeping elements", () => {
  const synced = syncSegmentsFromExternalValue(
    [
      { kind: "text", value: "old" },
      { kind: "element", attachment: sampleAttachment },
    ],
    "new",
  );
  assert.deepEqual(synced, [
    { kind: "text", value: "new" },
    { kind: "element", attachment: sampleAttachment },
  ]);
});

test("insertLoopSegment pins loop before body text", () => {
  const { segments } = insertLoopSegment([
    { kind: "text", value: "hello" },
  ]);
  assert.equal(segments[0]?.kind, "loop");
  assert.equal(segments[1]?.kind === "text" && segments[1].value, "hello");
  assert.equal(hasLoopSegment(segments), true);
});

test("insertLoopSegment appends loop after existing agent mode chip", () => {
  const { segments } = insertLoopSegment([
    { kind: "ask" },
    { kind: "text", value: " " },
  ]);
  assert.equal(segments[0]?.kind, "ask");
  assert.equal(segments[1]?.kind, "loop");
  assert.equal(hasLoopSegment(segments), true);
});

test("insertLoopSegment adds trailing space after loop when composer empty", () => {
  const { segments, caret } = insertLoopSegment(emptySegments());
  assert.deepEqual(segments, [
    { kind: "loop" },
    { kind: "text", value: " " },
  ]);
  assert.equal(caret.segmentIndex, 1);
  assert.equal(caret.offset, 1);
});

test("ensureLoopChipTypingTail restores typed tail spacer after slash removal leaves loop only", () => {
  const pinned = ensureLoopChipTypingTail([{ kind: "loop" }]);
  assert.deepEqual(pinned, [
    { kind: "loop" },
    { kind: "text", value: " " },
  ]);
});

test("applyLoopSlash order: remove slash then insert loop on empty composer", () => {
  const slashQuery = { start: 0, end: 5, raw: "/loop" };
  const afterRemove = replaceSkillSlashQueryInSegments(
    [{ kind: "text", value: "/loop" }],
    slashQuery,
    "",
    false,
  );
  const { segments, caret } = insertLoopSegment(afterRemove.segments);
  assert.deepEqual(segments, [
    { kind: "loop" },
    { kind: "text", value: " " },
  ]);
  assert.equal(caret.segmentIndex, 1);
  assert.equal(caret.offset, 1);
});

test("ensureLoopPinned deduplicates and moves misplaced loop before body", () => {
  const pinned = ensureLoopPinned([
    { kind: "text", value: "tail" },
    { kind: "loop" },
    { kind: "loop" },
  ]);
  assert.equal(pinned.filter((s) => s.kind === "loop").length, 1);
  assert.equal(pinned[0]?.kind, "loop");
});

test("ensureLoopPinned preserves ask then loop order", () => {
  const pinned = ensureLoopPinned([
    { kind: "ask" },
    { kind: "loop" },
    { kind: "text", value: "work" },
  ]);
  assert.equal(pinned[0]?.kind, "ask");
  assert.equal(pinned[1]?.kind, "loop");
  assert.equal(pinned[2]?.kind === "text" && pinned[2].value, "work");
});

test("segmentsToMessageText ignores loop chip", () => {
  const message = segmentsToMessageText([
    { kind: "loop" },
    { kind: "text", value: "do work" },
  ]);
  assert.equal(message, "do work");
});

test("removeLoopSegment drops loop only", () => {
  const next = removeLoopSegment([
    { kind: "loop" },
    { kind: "text", value: "keep" },
  ]);
  assert.equal(hasLoopSegment(next), false);
  assert.equal(next[0]?.kind === "text" && next[0].value, "keep");
});

test("insertAgentModeSegment pins plan after loop", () => {
  const { segments } = insertAgentModeSegment(
    [{ kind: "loop" }, { kind: "text", value: "work" }],
    "plan",
  );
  assert.equal(segments[0]?.kind, "loop");
  assert.equal(segments[1]?.kind, "plan");
  assert.equal(segments[2]?.kind === "text" && segments[2].value, "work");
});

test("replaceSkillSlashQueryInSegments preserves loop plan and skill when removing plan slash token", () => {
  const initial = [
    { kind: "loop" },
    { kind: "plan" },
    { kind: "skill", alias: "/git-commit" },
    { kind: "text", value: "please /ask" },
  ];
  const slashStart = caretToPlainTextOffset(initial, { segmentIndex: 3, offset: 7 });
  const slashEnd = caretToPlainTextOffset(initial, { segmentIndex: 3, offset: 11 });
  const { segments } = replaceSkillSlashQueryInSegments(
    initial,
    { start: slashStart, end: slashEnd, raw: "/ask" },
    "",
  );
  assert.equal(segments[0]?.kind, "loop");
  assert.equal(segments[1]?.kind, "plan");
  assert.ok(segments.some((s) => s.kind === "skill" && s.alias === "/git-commit"));
  assert.deepEqual(
    segments.filter((s) => s.kind === "text"),
    [{ kind: "text", value: "please " }],
  );
});

test("insertSegmentAtCaret allows multiple skill chips with different aliases", () => {
  const base = [
    { kind: "skill", alias: "/git-commit" },
    { kind: "text", value: " " },
  ];
  const { segments } = insertSegmentAtCaret(base, { segmentIndex: 1, offset: 1 }, {
    kind: "skill",
    alias: "/create-skill",
  });
  assert.equal(segments.filter((s) => s.kind === "skill").length, 2);
});

test("insertSegmentAtCaret adds skill inline while preserving loop and plan chips", () => {
  const base = [
    { kind: "loop" },
    { kind: "plan" },
    { kind: "text", value: "please " },
  ];
  const { segments } = insertSegmentAtCaret(base, { segmentIndex: 2, offset: 7 }, {
    kind: "skill",
    alias: "/git-commit",
  });
  assert.equal(segments[0]?.kind, "loop");
  assert.equal(segments[1]?.kind, "plan");
  assert.ok(segments.some((s) => s.kind === "skill" && s.alias === "/git-commit"));
  assert.ok(segments.some((s) => s.kind === "text" && s.value.includes("please")));
});

test("insertAgentModeSegment replaces plan with ask", () => {
  const { segments } = insertAgentModeSegment(
    [{ kind: "plan" }, { kind: "text", value: " " }],
    "ask",
  );
  assert.equal(currentAgentModeSegment(segments), "ask");
  assert.equal(segments.some((s) => s.kind === "plan"), false);
});

test("ensureAgentModePinned removes chip when agent mode", () => {
  const pinned = ensureAgentModePinned(
    [{ kind: "plan" }, { kind: "text", value: " " }],
    "agent",
  );
  assert.equal(hasAgentModeSegment(pinned), false);
  assert.deepEqual(pinned, [{ kind: "text", value: "" }]);
});

test("segmentsToMessageText ignores plan and ask chips", () => {
  const message = segmentsToMessageText([
    { kind: "plan" },
    { kind: "ask" },
    { kind: "text", value: "question" },
  ]);
  assert.equal(message, "question");
});

test("isCaretAtAgentModeRemovalPoint after plan chip", () => {
  const segs = [{ kind: "plan" }, { kind: "text", value: " " }];
  assert.equal(
    isCaretAtAgentModeRemovalPoint(segs, { segmentIndex: 1, offset: 0 }),
    true,
  );
  assert.equal(
    isCaretAtAgentModeRemovalPoint(segs, { segmentIndex: 1, offset: 1 }),
    false,
  );
});

test("removeAgentModeSegment drops plan only", () => {
  const next = removeAgentModeSegment([
    { kind: "loop" },
    { kind: "plan" },
    { kind: "text", value: "keep" },
  ]);
  assert.equal(hasAgentModeSegment(next), false);
  assert.equal(hasLoopSegment(next), true);
  assert.equal(next[1]?.kind === "text" && next[1].value, "keep");
});

test("removeAgentModeSegment strips chip-inserted tail spacer", () => {
  const next = removeAgentModeSegment([{ kind: "plan" }, { kind: "text", value: " " }]);
  assert.deepEqual(next, [{ kind: "text", value: "" }]);
});

test("removeAgentModeSegment strips leading spacer from typed body", () => {
  const next = removeAgentModeSegment([
    { kind: "ask" },
    { kind: "text", value: " hello" },
  ]);
  assert.deepEqual(next, [{ kind: "text", value: "hello" }]);
});

test("removeLoopSegment strips chip-inserted tail spacer", () => {
  const next = removeLoopSegment([{ kind: "loop" }, { kind: "text", value: " " }]);
  assert.deepEqual(next, [{ kind: "text", value: "" }]);
});

test("segmentsToPlainText includes workspace file token", () => {
  const segs = [
    { kind: "text", value: "see " },
    { kind: "workspaceFile", path: "apps/desktop/index.html" },
    { kind: "text", value: " please" },
  ];
  assert.equal(segmentsToPlainText(segs), "see @apps/desktop/index.html please");
});

test("segmentsToMessageText includes workspace file token inline", () => {
  const message = segmentsToMessageText([
    { kind: "text", value: "fix " },
    { kind: "workspaceFile", path: "src/App.tsx" },
  ]);
  assert.equal(message, "fix @src/App.tsx");
});

test("plainTextOffsetToCaret roundtrips with workspace file chip", () => {
  const segs = [
    { kind: "text", value: "see " },
    { kind: "workspaceFile", path: "apps/desktop/index.html" },
    { kind: "text", value: " tail" },
  ];
  const caret = { segmentIndex: 2, offset: 2 };
  const offset = caretToPlainTextOffset(segs, caret);
  const roundtrip = plainTextOffsetToCaret(segs, offset);
  assert.deepEqual(roundtrip, caret);
});

test("replaceSkillSlashQueryInSegments removes slash token and keeps loop chip", () => {
  const { segments } = replaceSkillSlashQueryInSegments(
    [
      { kind: "loop" },
      { kind: "text", value: "hi /git" },
    ],
    { start: 3, end: 7, raw: "/git" },
    "",
  );
  assert.deepEqual(segments, [
    { kind: "loop" },
    { kind: "text", value: "hi " },
  ]);
});

test("replaceSkillSlashQueryInSegments replaces mid-text slash token with finalized text", () => {
  const { segments, caret } = replaceSkillSlashQueryInSegments(
    [{ kind: "text", value: "see /log" }],
    { start: 4, end: 8, raw: "/log" },
    "/log-session",
    true,
  );
  assert.deepEqual(segments, [{ kind: "text", value: "see /log-session " }]);
  assert.equal(caret.segmentIndex, 0);
  assert.equal(caret.offset, 17);
});

test("replaceSkillSlashQueryInSegments keeps inline file chip when replacing nearby slash token", () => {
  const initial = [
    { kind: "workspaceFile", path: "src/foo.ts" },
    { kind: "text", value: " /git" },
  ];
  const slashStart = caretToPlainTextOffset(initial, { segmentIndex: 1, offset: 1 });
  const slashEnd = caretToPlainTextOffset(initial, { segmentIndex: 1, offset: 5 });
  const { segments } = replaceSkillSlashQueryInSegments(
    initial,
    { start: slashStart, end: slashEnd, raw: "/git" },
    "",
  );
  assert.equal(segments.some((s) => s.kind === "workspaceFile"), true);
  assert.deepEqual(
    segments.filter((s) => s.kind === "text"),
    [{ kind: "text", value: " " }],
  );
});

test("replaceWorkspaceFileReferenceInSegments inserts chip and caret after finalize space", () => {
  const { segments, caret } = replaceWorkspaceFileReferenceInSegments(
    [{ kind: "text", value: "@app" }],
    { start: 0, end: 4, raw: "@app" },
    "apps/desktop/index.html",
    true,
  );
  assert.deepEqual(segments, [
    { kind: "workspaceFile", path: "apps/desktop/index.html" },
    { kind: "text", value: " " },
  ]);
  assert.equal(caret.segmentIndex, 1);
  assert.equal(caret.offset, 1);
});

test("syncSegmentsFromExternalValue keeps workspace file chips", () => {
  const synced = syncSegmentsFromExternalValue(
    [
      { kind: "text", value: "old" },
      { kind: "workspaceFile", path: "src/foo.ts" },
    ],
    "new",
  );
  assert.deepEqual(synced, [
    { kind: "text", value: "new" },
    { kind: "workspaceFile", path: "src/foo.ts" },
  ]);
});

test("plainComposerTextToRichSegments rebuilds workspace file chips from @ tokens", async () => {
  const { plainComposerTextToRichSegments } = await import("../src/lib/composer-segment-model.ts");
  assert.deepEqual(plainComposerTextToRichSegments("see @src/foo.ts next"), [
    { kind: "text", value: "see " },
    { kind: "workspaceFile", path: "src/foo.ts" },
    { kind: "text", value: " next" },
  ]);
  assert.deepEqual(
    plainComposerTextToRichSegments("@D:/tmp/notes.txt"),
    [{ kind: "workspaceFile", path: "D:/tmp/notes.txt" }],
  );
});

test("syncSegmentsFromExternalValue hydrates @ tokens into chips when no inline chips", () => {
  const synced = syncSegmentsFromExternalValue(emptySegments(), "see @README.md");
  assert.deepEqual(synced, [
    { kind: "text", value: "see " },
    { kind: "workspaceFile", path: "README.md" },
  ]);
});

test("isComposerPlainEmpty treats lone newline as empty", () => {
  assert.equal(isComposerPlainEmpty(""), true);
  assert.equal(isComposerPlainEmpty("\n"), true);
  assert.equal(isComposerPlainEmpty(" \n "), true);
  assert.equal(isComposerPlainEmpty("/"), false);
  assert.equal(isComposerPlainEmpty("a\n"), false);
  assert.equal(normalizeComposerPlain("\n"), "");
});

test("domToSegments keeps trailing newline after real text", async () => {
  const { parseHTML } = await import("linkedom");
  const { window, document } = parseHTML("<!doctype html><html><body></body></html>");
  globalThis.Node = window.Node;
  globalThis.HTMLElement = window.HTMLElement;
  const { domToSegments, segmentsToPlainText } = await import("../src/lib/composer-segments.ts");
  const container = document.createElement("div");
  container.appendChild(document.createTextNode("你好"));
  container.appendChild(document.createElement("br"));
  const parsed = domToSegments(container);
  assert.equal(segmentsToPlainText(parsed), "你好\n");
});

test("domToSegments strips lone bogus newline from empty editor br", async () => {
  const { parseHTML } = await import("linkedom");
  const { window, document } = parseHTML("<!doctype html><html><body></body></html>");
  globalThis.Node = window.Node;
  globalThis.HTMLElement = window.HTMLElement;
  const { domToSegments, segmentsToPlainText } = await import("../src/lib/composer-segments.ts");
  const container = document.createElement("div");
  container.appendChild(document.createElement("br"));
  const parsed = domToSegments(container);
  assert.equal(segmentsToPlainText(parsed), "");
});

test("composerDomStructureMatchesSegments detects phantom br when plain empty", async () => {
  const { parseHTML } = await import("linkedom");
  const { window, document } = parseHTML("<!doctype html><html><body></body></html>");
  globalThis.Node = window.Node;
  globalThis.HTMLElement = window.HTMLElement;
  const {
    composerDomHasPhantomStructure,
    composerDomStructureMatchesSegments,
    emptySegments,
  } = await import("../src/lib/composer-segments.ts");
  const container = document.createElement("div");
  container.appendChild(document.createElement("br"));
  container.appendChild(document.createTextNode(""));
  container.appendChild(document.createElement("br"));
  container.appendChild(document.createTextNode(""));
  const segs = emptySegments();
  assert.equal(composerDomHasPhantomStructure(container, segs), true);
  assert.equal(composerDomStructureMatchesSegments(container, segs), false);
});

test("applyAgentModeChipPolicy inserts ask when not dismissed", () => {
  const segs = applyAgentModeChipPolicy(emptySegments(), { hostMode: "ask", dismissed: false });
  assert.equal(segs.some((s) => s.kind === "ask"), true);
  assert.equal(segs.find((s) => s.kind === "text")?.value, " ");
});

test("applyAgentModeChipPolicy removes chip when dismissed", () => {
  const segs = applyAgentModeChipPolicy(
    [{ kind: "ask" }, { kind: "text", value: " " }],
    { hostMode: "ask", dismissed: true },
  );
  assert.equal(hasAgentModeSegment(segs), false);
});

test("composerShowsPlaceholder false when ask chip present", () => {
  assert.equal(
    composerShowsPlaceholder([{ kind: "ask" }, { kind: "text", value: " " }], {
      composing: false,
      attachmentCount: 0,
    }),
    false,
  );
});

test("synchronizeTextFromDom keeps shell chips and adopts dom text", () => {
  const shell = [{ kind: "ask" }, { kind: "text", value: " " }];
  const dom = [{ kind: "text", value: "hello" }];
  const merged = synchronizeTextFromDom(shell, dom);
  assert.equal(merged[0]?.kind, "ask");
  assert.equal(merged[1]?.kind === "text" && merged[1].value, "hello");
});

test("synchronizeTextFromDom preserves ask then loop shell order", () => {
  const shell = [{ kind: "ask" }, { kind: "loop" }, { kind: "text", value: " " }];
  const dom = [{ kind: "text", value: "hello" }];
  const merged = synchronizeTextFromDom(shell, dom);
  assert.equal(merged[0]?.kind, "ask");
  assert.equal(merged[1]?.kind, "loop");
  assert.equal(merged[2]?.kind === "text" && merged[2].value, "hello");
});

test("normalizeCaretForPinnedLoopChip snaps caret before loop to after chip", () => {
  const segs = [{ kind: "loop" }, { kind: "text", value: " " }];
  const snapped = normalizeCaretForPinnedLoopChip(segs, { segmentIndex: 0, offset: 0 });
  assert.equal(snapped.segmentIndex, 1);
  assert.equal(snapped.offset, 1);
  assert.equal(
    isCaretAtLoopRemovalPoint(segs, snapped),
    false,
  );
  assert.equal(
    isCaretAtLoopRemovalPoint(segs, { segmentIndex: 1, offset: 0 }),
    true,
  );
});

test("normalizeCaretForPinnedLoopChip snaps caret on ask-then-loop chips", () => {
  const segs = [{ kind: "ask" }, { kind: "loop" }, { kind: "text", value: " " }];
  const snapped = normalizeCaretForPinnedLoopChip(segs, { segmentIndex: 1, offset: 0 });
  assert.equal(snapped.segmentIndex, 2);
  assert.equal(snapped.offset, 1);
  assert.equal(
    isCaretAtLoopRemovalPoint(segs, { segmentIndex: 2, offset: 0 }),
    true,
  );
});

test("normalizeCaretForInlineAttachmentChips snaps caret on file chip", () => {
  const segs = [
    { kind: "workspaceFile", path: "src/App.tsx" },
    { kind: "text", value: " tail" },
  ];
  const snapped = normalizeCaretForInlineAttachmentChips(segs, {
    segmentIndex: 0,
    offset: 0,
  });
  assert.equal(snapped.segmentIndex, 1);
  assert.equal(snapped.offset, 1);
});

test("isCaretAtInlineChipRemovalPoint and removeInlineChipAtRemovalPoint", () => {
  const segs = [
    { kind: "text", value: "see " },
    { kind: "workspaceFile", path: "src/foo.ts" },
    { kind: "text", value: " please" },
  ];
  const caret = { segmentIndex: 2, offset: 0 };
  assert.equal(isCaretAtInlineChipRemovalPoint(segs, caret), true);
  const removed = removeInlineChipAtRemovalPoint(segs, caret);
  assert.deepEqual(removed?.segments, [{ kind: "text", value: "see  please" }]);
});

test("normalizeCaretForComposer chains loop and inline chip fixes", () => {
  const segs = [
    { kind: "loop" },
    { kind: "workspaceFile", path: "a.ts" },
    { kind: "text", value: " " },
  ];
  const snapped = normalizeCaretForComposer(segs, { segmentIndex: 1, offset: 0 });
  assert.equal(snapped.segmentIndex, 2);
  assert.equal(snapped.offset, 1);
});

test("domParsedMissingRequiredAgentChip when shell has ask but dom lost it", () => {
  assert.equal(
    domParsedMissingRequiredAgentChip(
      [{ kind: "ask" }, { kind: "text", value: " " }],
      [{ kind: "text", value: "" }],
      { hostMode: "ask", dismissed: false },
    ),
    true,
  );
  assert.equal(shouldPinAgentModeChip({ hostMode: "ask", dismissed: true }), false);
});

// --- Skill chip tests ---

test("segmentsToMessageText serializes skill chip as alias", () => {
  const message = segmentsToMessageText([
    { kind: "skill", alias: "/git-commit" },
    { kind: "text", value: " fix typo" },
  ]);
  assert.equal(message, "/git-commit fix typo");
});

test("segmentsToPlainText returns empty for skill chip", () => {
  const segs = [
    { kind: "skill", alias: "/git-commit" },
    { kind: "text", value: " extra" },
  ];
  assert.equal(segmentsToPlainText(segs), " extra");
});

test("insertSegmentAtCaret inserts skill chip with trailing space", () => {
  const { segments, caret } = insertSegmentAtCaret(
    [{ kind: "text", value: "" }],
    { segmentIndex: 0, offset: 0 },
    { kind: "skill", alias: "/git-push" },
  );
  assert.deepEqual(segments, [
    { kind: "skill", alias: "/git-push" },
    { kind: "text", value: " " },
  ]);
  assert.equal(caret.segmentIndex, 1);
  assert.equal(caret.offset, 1);
});

test("isCaretAtInlineChipRemovalPoint detects caret after skill chip", () => {
  const segs = [
    { kind: "skill", alias: "/git-commit" },
    { kind: "text", value: " " },
  ];
  assert.equal(
    isCaretAtInlineChipRemovalPoint(segs, { segmentIndex: 1, offset: 0 }),
    true,
  );
  assert.equal(
    isCaretAtInlineChipRemovalPoint(segs, { segmentIndex: 1, offset: 1 }),
    false,
  );
});

test("removeInlineChipAtRemovalPoint removes skill chip on backspace", () => {
  const segs = [
    { kind: "skill", alias: "/git-merge" },
    { kind: "text", value: " " },
  ];
  const removed = removeInlineChipAtRemovalPoint(segs, { segmentIndex: 1, offset: 0 });
  assert.deepEqual(removed?.segments, [{ kind: "text", value: "" }]);
  assert.equal(removed?.caret.segmentIndex, 0);
  assert.equal(removed?.caret.offset, 0);
});

test("removeInlineChipAtRemovalPoint strips double spacer after create-rule chip", () => {
  const removed = removeInlineChipAtRemovalPoint(
    [{ kind: "skill", alias: "/create-rule" }, { kind: "text", value: "  " }],
    { segmentIndex: 1, offset: 0 },
  );
  assert.deepEqual(removed?.segments, [{ kind: "text", value: "" }]);
});

test("syncSegmentsFromExternalValue preserves skill chip", () => {
  const synced = syncSegmentsFromExternalValue(
    [
      { kind: "text", value: "old" },
      { kind: "skill", alias: "/git-commit" },
    ],
    "new",
  );
  assert.deepEqual(synced, [
    { kind: "text", value: "new" },
    { kind: "skill", alias: "/git-commit" },
  ]);
});

test("segmentsEqual compares skill chips by alias", () => {
  const a = [{ kind: "skill", alias: "/git-commit" }];
  const b = [{ kind: "skill", alias: "/git-commit" }];
  const c = [{ kind: "skill", alias: "/git-push" }];
  assert.equal(segmentsEqual(a, b), true);
  assert.equal(segmentsEqual(a, c), false);
});

test("composerShowsPlaceholder false when skill chip present", () => {
  assert.equal(
    composerShowsPlaceholder(
      [{ kind: "skill", alias: "/git-commit" }, { kind: "text", value: " " }],
      { composing: false, attachmentCount: 0 },
    ),
    false,
  );
});

test("composerShowsPlaceholder false when prDiff chip present", () => {
  assert.equal(
    composerShowsPlaceholder(
      [
        {
          kind: "prDiff",
          attachment: {
            id: "pr-1",
            prUrl: "https://github.com/o/r/pull/1",
            filename: "src/foo.ts",
            lineStart: 9,
            lineEnd: 9,
            diffText: "diff",
            status: "merged",
          },
        },
        { kind: "text", value: " " },
      ],
      { composing: false, attachmentCount: 0 },
    ),
    false,
  );
});

test("normalizeCaretForInlineAttachmentChips snaps caret on prDiff chip", () => {
  const segs = [
    {
      kind: "prDiff",
      attachment: {
        id: "pr-1",
        prUrl: "https://github.com/o/r/pull/1",
        filename: "src/foo.ts",
        lineStart: 9,
        lineEnd: 9,
        diffText: "diff",
        status: "open",
      },
    },
    { kind: "text", value: " tail" },
  ];
  const snapped = normalizeCaretForInlineAttachmentChips(segs, {
    segmentIndex: 0,
    offset: 0,
  });
  assert.equal(snapped.segmentIndex, 1);
  assert.equal(snapped.offset, 1);
});

test("normalizeCaretForInlineAttachmentChips snaps caret on skill chip", () => {
  const segs = [
    { kind: "skill", alias: "/git-commit" },
    { kind: "text", value: " tail" },
  ];
  const snapped = normalizeCaretForInlineAttachmentChips(segs, {
    segmentIndex: 0,
    offset: 0,
  });
  assert.equal(snapped.segmentIndex, 1);
  assert.equal(snapped.offset, 1);
});

test("composerShowsPlaceholder false when terminalSnippet chip present", () => {
  assert.equal(
    composerShowsPlaceholder(
      [
        {
          kind: "terminalSnippet",
          attachment: {
            id: "term-1",
            terminalName: "Terminal",
            lineStart: 10,
            lineEnd: 12,
            selectedText: "error output",
          },
        },
        { kind: "text", value: " " },
      ],
      { composing: false, attachmentCount: 0 },
    ),
    false,
  );
});

test("normalizeCaretForInlineAttachmentChips snaps caret on terminalSnippet chip", () => {
  const segs = [
    {
      kind: "terminalSnippet",
      attachment: {
        id: "term-1",
        terminalName: "Terminal",
        lineStart: 3,
        lineEnd: 5,
        selectedText: "log line",
      },
    },
    { kind: "text", value: " tail" },
  ];
  const snapped = normalizeCaretForInlineAttachmentChips(segs, {
    segmentIndex: 0,
    offset: 0,
  });
  assert.equal(snapped.segmentIndex, 1);
  assert.equal(snapped.offset, 1);
});

test("isCaretAtInlineChipRemovalPoint detects caret after terminalSnippet chip", () => {
  const segs = [
    {
      kind: "terminalSnippet",
      attachment: {
        id: "term-1",
        terminalName: "npm run dev",
        lineStart: 1,
        lineEnd: 1,
        selectedText: "done",
      },
    },
    { kind: "text", value: " " },
  ];
  assert.equal(
    isCaretAtInlineChipRemovalPoint(segs, { segmentIndex: 1, offset: 0 }),
    true,
  );
});

test("removeInlineChipAtRemovalPoint removes terminalSnippet chip on backspace", () => {
  const segs = [
    {
      kind: "terminalSnippet",
      attachment: {
        id: "term-1",
        terminalName: "Terminal",
        lineStart: 2,
        lineEnd: 4,
        selectedText: "stderr",
      },
    },
    { kind: "text", value: "  " },
  ];
  const result = removeInlineChipAtRemovalPoint(segs, { segmentIndex: 1, offset: 0 });
  assert.ok(result);
  assert.equal(result.segments.some((s) => s.kind === "terminalSnippet"), false);
});

test("syncSegmentsFromExternalValue preserves terminalSnippet chip", () => {
  const synced = syncSegmentsFromExternalValue(
    [
      {
        kind: "terminalSnippet",
        attachment: {
          id: "term-1",
          terminalName: "Terminal",
          lineStart: 1,
          lineEnd: 2,
          selectedText: "x",
        },
      },
      { kind: "text", value: " " },
    ],
    "follow up",
  );
  assert.equal(synced.some((s) => s.kind === "terminalSnippet"), true);
  assert.equal(synced.some((s) => s.kind === "text" && s.value === "follow up"), true);
});

const sampleFileSnippetAttachment = {
  id: "file-1",
  filePath: "apps/desktop/src/App.tsx",
  lineStart: 10,
  lineEnd: 12,
  selectedText: "const App = () => null;",
};

test("composerShowsPlaceholder false when fileSnippet chip present", () => {
  assert.equal(
    composerShowsPlaceholder(
      [{ kind: "fileSnippet", attachment: sampleFileSnippetAttachment }, { kind: "text", value: " " }],
      { composing: false, attachmentCount: 0 },
    ),
    false,
  );
});

test("normalizeCaretForInlineAttachmentChips snaps caret on fileSnippet chip", () => {
  const segs = [
    { kind: "fileSnippet", attachment: sampleFileSnippetAttachment },
    { kind: "text", value: " tail" },
  ];
  const snapped = normalizeCaretForInlineAttachmentChips(segs, {
    segmentIndex: 0,
    offset: 0,
  });
  assert.equal(snapped.segmentIndex, 1);
  assert.equal(snapped.offset, 1);
});

test("isCaretAtInlineChipRemovalPoint detects caret after fileSnippet chip", () => {
  const segs = [
    { kind: "fileSnippet", attachment: sampleFileSnippetAttachment },
    { kind: "text", value: " " },
  ];
  assert.equal(
    isCaretAtInlineChipRemovalPoint(segs, { segmentIndex: 1, offset: 0 }),
    true,
  );
});

test("removeInlineChipAtRemovalPoint removes fileSnippet chip on backspace", () => {
  const segs = [
    { kind: "fileSnippet", attachment: sampleFileSnippetAttachment },
    { kind: "text", value: " " },
  ];
  const result = removeInlineChipAtRemovalPoint(segs, { segmentIndex: 1, offset: 0 });
  assert.ok(result);
  assert.equal(result.segments.some((s) => s.kind === "fileSnippet"), false);
});

test("syncSegmentsFromExternalValue preserves fileSnippet chip", () => {
  const synced = syncSegmentsFromExternalValue(
    [{ kind: "fileSnippet", attachment: sampleFileSnippetAttachment }, { kind: "text", value: " " }],
    "follow up",
  );
  assert.equal(synced.some((s) => s.kind === "fileSnippet"), true);
  assert.equal(synced.some((s) => s.kind === "text" && s.value === "follow up"), true);
});

test("insertSegmentAtCaret adds trailing space after fileSnippet at caret", () => {
  const { segments, caret } = insertSegmentAtCaret(
    [{ kind: "text", value: "" }],
    { segmentIndex: 0, offset: 0 },
    { kind: "fileSnippet", attachment: sampleFileSnippetAttachment },
  );
  assert.deepEqual(segments, [
    { kind: "fileSnippet", attachment: sampleFileSnippetAttachment },
    { kind: "text", value: " " },
  ]);
  assert.equal(caret.segmentIndex, 1);
  assert.equal(caret.offset, 1);
});
