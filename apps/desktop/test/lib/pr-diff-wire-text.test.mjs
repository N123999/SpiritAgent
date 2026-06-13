import assert from "node:assert/strict";
import test from "node:test";

import { buildPrDiffSnippetText } from "../../src/lib/pr-diff-text.ts";
import {
  parsePrDiffWireMeta,
  prDiffContextText,
  scanPrDiffWireBlocks,
} from "../../src/lib/pr-diff-wire-text.ts";
import {
  messageContentToRichSegments,
  parseMessageContentParts,
  segmentsToMessageText,
} from "../../src/lib/composer-segment-model.ts";

test("prDiffContextText serializes PR URL, filename, line range, status, and diff body", () => {
  const wire = prDiffContextText({
    prUrl: "https://github.com/o/r/pull/42",
    filename: "src/foo.ts",
    lineStart: 12,
    lineEnd: 20,
    status: "open",
    diffText: buildPrDiffSnippetText("src/foo.ts", "@@ -1 +1 @@\n+hello"),
  });

  assert.match(wire, /Selected diff from https:\/\/github\.com\/o\/r\/pull\/42/);
  assert.match(wire, /src\/foo\.ts, L12-20, status:open/);
  assert.match(wire, /```diff\n/);
  assert.match(wire, /diff --git a\/src\/foo\.ts b\/src\/foo\.ts/);
});

test("parsePrDiffWireMeta round-trips line range and status", () => {
  const parsed = parsePrDiffWireMeta("src/foo.ts, L12-20, status:merged");
  assert.deepEqual(parsed, {
    filename: "src/foo.ts",
    lineStart: 12,
    lineEnd: 20,
    status: "merged",
  });
});

test("segmentsToMessageText and parseMessageContentParts round-trip PR diff chips", () => {
  const attachment = {
    id: "pr-1",
    prUrl: "https://github.com/o/r/pull/7",
    filename: "apps/desktop/src/App.tsx",
    lineStart: 42,
    lineEnd: 42,
    status: "draft",
    diffText: buildPrDiffSnippetText("apps/desktop/src/App.tsx", "@@ -1 +1 @@\n+change"),
  };
  const message = segmentsToMessageText([{ kind: "prDiff", attachment }]);
  const parts = parseMessageContentParts(message);
  assert.equal(parts.length, 1);
  assert.equal(parts[0]?.kind, "prDiff");
  if (parts[0]?.kind !== "prDiff") {
    return;
  }
  assert.equal(parts[0].filename, "apps/desktop/src/App.tsx");
  assert.equal(parts[0].lineStart, 42);
  assert.equal(parts[0].lineEnd, 42);
  assert.equal(parts[0].status, "draft");
  assert.match(parts[0].diffText, /App\.tsx/);

  const segments = messageContentToRichSegments(message, "rewind");
  assert.equal(segments.length, 1);
  assert.equal(segments[0]?.kind, "prDiff");
});

test("scanPrDiffWireBlocks parses diff body containing standalone fence lines", () => {
  const diffBody = ["+before", "```", "+after"].join("\n");
  const wire = prDiffContextText({
    prUrl: "https://github.com/o/r/pull/9",
    filename: "docs/readme.md",
    lineStart: 1,
    lineEnd: 3,
    status: "open",
    diffText: diffBody,
  });
  const blocks = scanPrDiffWireBlocks(wire);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0]?.diffText, diffBody);
});
