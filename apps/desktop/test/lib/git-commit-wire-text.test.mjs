import assert from "node:assert/strict";
import test from "node:test";

import {
  gitCommitContextText,
  parseGitCommitWireMeta,
  scanGitCommitWireBlocks,
} from "../../src/lib/git-commit-wire-text.ts";

test("gitCommitContextText serializes oid, meta, and full message body", () => {
  const wire = gitCommitContextText({
    oid: "abc123def456",
    subject: "feat: add chip",
    author: "Alice",
    authoredAt: "2024-01-02 10:00:00 +0000",
    fullMessage: "feat: add chip\n\nBody paragraph.",
  });

  assert.match(wire, /Selected git commit abc123def456 \(feat: add chip\tAlice\t2024-01-02 10:00:00 \+0000\):/);
  assert.match(wire, /```text\nfeat: add chip\n\nBody paragraph\.\n```/);
});

test("parseGitCommitWireMeta parses tab-separated meta with subject tabs", () => {
  const parsed = parseGitCommitWireMeta("feat:\tpart two\tAlice\t2024-01-02 10:00:00 +0000");
  assert.deepEqual(parsed, {
    subject: "feat:\tpart two",
    author: "Alice",
    authoredAt: "2024-01-02 10:00:00 +0000",
  });
});

test("scanGitCommitWireBlocks parses subject containing parentheses", () => {
  const wire = gitCommitContextText({
    oid: "f4d96fad0282ed8a134ac5af73e425cef17baede",
    subject: "fix(desktop): tool-execution-finished 继承预览 suppressExpand 与 argsExcerpt",
    author: "XianYu",
    authoredAt: "2026-07-01 05:47:43 +0800",
    fullMessage:
      "fix(desktop): tool-execution-finished 继承预览 suppressExpand 与 argsExcerpt\n\n- bullet one\n- bullet two",
  });

  const blocks = scanGitCommitWireBlocks(`${wire}\n 你好`);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0]?.oid, "f4d96fad0282ed8a134ac5af73e425cef17baede");
  const parsed = parseGitCommitWireMeta(blocks[0]?.meta ?? "");
  assert.deepEqual(parsed, {
    subject: "fix(desktop): tool-execution-finished 继承预览 suppressExpand 与 argsExcerpt",
    author: "XianYu",
    authoredAt: "2026-07-01 05:47:43 +0800",
  });
});

test("scanGitCommitWireBlocks and message round-trip", () => {
  const wire = gitCommitContextText({
    oid: "deadbeef",
    subject: "fix: bug",
    author: "Bob",
    authoredAt: "2025-06-01 12:00:00 +0000",
    fullMessage: "fix: bug\n\nDetails here.",
  });

  const blocks = scanGitCommitWireBlocks(wire);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0]?.oid, "deadbeef");
  assert.equal(blocks[0]?.fullMessage, "fix: bug\n\nDetails here.");
});
