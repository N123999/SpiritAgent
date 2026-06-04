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
  replaceWorkspaceFileReferenceInSegments,
  segmentsToMessageText,
  segmentsToPlainText,
  syncSegmentsFromExternalValue,
  trimMessageTextAroundElements,
  messageContentToRichSegments,
  parseMessageContentParts,
} from "../src/lib/composer-segment-model.ts";
import {
  ensureLoopPinned,
  hasLoopSegment,
  insertLoopSegment,
  removeLoopSegment,
} from "../src/lib/composer-loop-segments.ts";
import {
  currentAgentModeSegment,
  ensureAgentModePinned,
  hasAgentModeSegment,
  insertAgentModeSegment,
  isCaretAtAgentModeRemovalPoint,
  removeAgentModeSegment,
} from "../src/lib/composer-agent-mode-segments.ts";

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

test("insertLoopSegment pins loop at index 0", () => {
  const { segments } = insertLoopSegment([
    { kind: "text", value: "hello" },
  ]);
  assert.equal(segments[0]?.kind, "loop");
  assert.equal(segments[1]?.kind === "text" && segments[1].value, "hello");
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

test("ensureLoopPinned deduplicates and moves loop to front", () => {
  const pinned = ensureLoopPinned([
    { kind: "text", value: "tail" },
    { kind: "loop" },
    { kind: "loop" },
  ]);
  assert.equal(pinned.filter((s) => s.kind === "loop").length, 1);
  assert.equal(pinned[0]?.kind, "loop");
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

test("isComposerPlainEmpty treats lone newline as empty", () => {
  assert.equal(isComposerPlainEmpty(""), true);
  assert.equal(isComposerPlainEmpty("\n"), true);
  assert.equal(isComposerPlainEmpty(" \n "), true);
  assert.equal(isComposerPlainEmpty("/"), false);
  assert.equal(isComposerPlainEmpty("a\n"), false);
  assert.equal(normalizeComposerPlain("\n"), "");
});
