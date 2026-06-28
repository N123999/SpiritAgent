import assert from "node:assert/strict";
import { test } from "node:test";

function trimTrailingNewlines(code) {
  let end = code.length;
  while (end > 0 && code[end - 1] === "\n") {
    end -= 1;
  }
  return code.slice(0, end);
}

function isEmptyTokenLine(line) {
  return line.length === 0 || (line.length === 1 && line[0]?.content === "");
}

function plainHighlightTokenCount(code) {
  const normalized = trimTrailingNewlines(code);
  return normalized.split("\n").length;
}

test("trimTrailingNewlines removes trailing fence newline", () => {
  assert.equal(trimTrailingNewlines("a\nb\n"), "a\nb");
  assert.equal(trimTrailingNewlines("a\nb\n\n"), "a\nb");
  assert.equal(trimTrailingNewlines(""), "");
});

test("plain highlight line count drops trailing blank line from source", () => {
  assert.equal(plainHighlightTokenCount("<agent_mode>\nline\n</agent_mode>\n"), 3);
});

test("isEmptyTokenLine detects shiki blank rows", () => {
  assert.equal(isEmptyTokenLine([]), true);
  assert.equal(isEmptyTokenLine([{ content: "" }]), true);
  assert.equal(isEmptyTokenLine([{ content: "x" }]), false);
});
