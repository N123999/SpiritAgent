import assert from "node:assert/strict";
import test from "node:test";

import {
  messageContentToRichSegments,
  parseMessageContentParts,
  segmentsToMessageText,
} from "../../src/lib/composer-segment-model.ts";
import {
  fileSnippetContextText,
  parseFileSnippetLinePart,
  scanFileSnippetWireBlocks,
} from "../../src/lib/file-snippet-wire-text.ts";

test("fileSnippetContextText serializes file path, line range, and selected text", () => {
  const wire = fileSnippetContextText({
    filePath: "apps/desktop/src/foo.ts",
    lineStart: 10,
    lineEnd: 15,
    selectedText: "const x = 1;\nconst y = 2;",
  });

  assert.match(wire, /Selected text from apps\/desktop\/src\/foo\.ts/);
  assert.match(wire, /\(L10-15\):/);
  assert.match(wire, /```text\n/);
  assert.match(wire, /const x = 1;/);
});

test("parseFileSnippetLinePart parses line range suffix", () => {
  const parsed = parseFileSnippetLinePart("L3-7");
  assert.deepEqual(parsed, {
    lineStart: 3,
    lineEnd: 7,
  });
});

test("parseFileSnippetLinePart parses preview placeholder dash suffix", () => {
  assert.deepEqual(parseFileSnippetLinePart("-"), { lineStart: 0, lineEnd: 0 });
});

test("wire round-trips file paths containing parentheses", () => {
  const attachment = {
    id: "file-paren",
    filePath: "src/foo (copy).ts",
    lineStart: 5,
    lineEnd: 8,
    selectedText: "export {}",
  };
  const message = segmentsToMessageText([{ kind: "fileSnippet", attachment }]);
  const parts = parseMessageContentParts(message);
  assert.equal(parts.length, 1);
  assert.equal(parts[0]?.kind, "fileSnippet");
  if (parts[0]?.kind !== "fileSnippet") {
    return;
  }
  assert.equal(parts[0].filePath, "src/foo (copy).ts");
  assert.equal(parts[0].lineStart, 5);
  assert.equal(parts[0].lineEnd, 8);
});

test("segmentsToMessageText and parseMessageContentParts round-trip file snippet chips", () => {
  const attachment = {
    id: "file-1",
    filePath: "apps/desktop/src/App.tsx",
    lineStart: 42,
    lineEnd: 44,
    selectedText: "line one\nline two",
  };
  const message = segmentsToMessageText([{ kind: "fileSnippet", attachment }]);
  const parts = parseMessageContentParts(message);
  assert.equal(parts.length, 1);
  assert.equal(parts[0]?.kind, "fileSnippet");
  if (parts[0]?.kind !== "fileSnippet") {
    return;
  }
  assert.equal(parts[0].filePath, "apps/desktop/src/App.tsx");
  assert.equal(parts[0].lineStart, 42);
  assert.equal(parts[0].lineEnd, 44);
  assert.equal(parts[0].selectedText, "line one\nline two");

  const segments = messageContentToRichSegments(message, "rewind");
  assert.equal(segments.length, 1);
  assert.equal(segments[0]?.kind, "fileSnippet");
});

test("scanFileSnippetWireBlocks parses body containing standalone fence lines", () => {
  const body = ["before", "```", "after"].join("\n");
  const wire = fileSnippetContextText({
    filePath: "README.md",
    lineStart: 1,
    lineEnd: 3,
    selectedText: body,
  });
  const blocks = scanFileSnippetWireBlocks(wire);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0]?.selectedText, body);
});

test("scanFileSnippetWireBlocks ignores header with embedded newline in path", () => {
  const wire = "Selected text from apps/foo\nbar.ts (L1-2):\n```text\nbody\n```";
  assert.equal(scanFileSnippetWireBlocks(wire).length, 0);
});

test("wire round-trips paths containing line-range-like parentheses", () => {
  const attachment = {
    id: "file-suffix",
    filePath: "docs/readme (L1-2)",
    lineStart: 5,
    lineEnd: 6,
    selectedText: "note",
  };
  const message = segmentsToMessageText([{ kind: "fileSnippet", attachment }]);
  const parts = parseMessageContentParts(message);
  assert.equal(parts.length, 1);
  assert.equal(parts[0]?.kind, "fileSnippet");
  if (parts[0]?.kind !== "fileSnippet") {
    return;
  }
  assert.equal(parts[0].filePath, "docs/readme (L1-2)");
  assert.equal(parts[0].lineStart, 5);
  assert.equal(parts[0].lineEnd, 6);
});

test("parseMessageContentParts treats wire-shaped plain text as fileSnippet block", () => {
  const wireLike = fileSnippetContextText({
    filePath: "src/example.ts",
    lineStart: 2,
    lineEnd: 4,
    selectedText: "hello",
  });
  const parts = parseMessageContentParts(wireLike);
  assert.equal(parts.length, 1);
  assert.equal(parts[0]?.kind, "fileSnippet");
});
