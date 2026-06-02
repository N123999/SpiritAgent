import assert from "node:assert/strict";
import { test } from "node:test";

import {
  caretToPlainTextOffset,
  insertSegmentAtCaret,
  mergeAdjacentTextSegments,
  messageSegmentSeparator,
  segmentsToMessageText,
  segmentsToPlainText,
  syncSegmentsFromExternalValue,
  trimMessageTextAroundElements,
  messageContentToRichSegments,
} from "../src/lib/composer-segment-model.ts";

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
