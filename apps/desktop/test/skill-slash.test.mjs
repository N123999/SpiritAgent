import assert from "node:assert/strict";
import { test } from "node:test";

import { currentWorkspaceFileReferenceQuery } from "@spirit-agent/host-internal/workspace-file-reference-query";

import {
  buildSkillSlashSuggestions,
  currentSkillSlashQuery,
  currentSkillSlashQueryAtCursor,
  skillSlashQueryKey,
} from "../src/lib/skill-slash.ts";

test("buildSkillSlashSuggestions excludes start-implementing slash", () => {
  const suggestions = buildSkillSlashSuggestions("/", []);
  assert.equal(suggestions.some((item) => item.alias === "/start-implementing"), false);
});

test("buildSkillSlashSuggestions includes loop command", () => {
  const suggestions = buildSkillSlashSuggestions("/loop", []);
  assert.ok(suggestions.some((item) => item.kind === "loop" && item.alias === "/loop"));
});

test("buildSkillSlashSuggestions filters loop by prefix", () => {
  const suggestions = buildSkillSlashSuggestions("/lo", []);
  assert.ok(suggestions.some((item) => item.kind === "loop"));
  assert.equal(buildSkillSlashSuggestions("/compact", []).some((item) => item.kind === "loop"), false);
});

test("buildSkillSlashSuggestions includes plan and ask commands", () => {
  const suggestions = buildSkillSlashSuggestions("/", []);
  assert.ok(suggestions.some((item) => item.kind === "plan" && item.alias === "/plan"));
  assert.ok(suggestions.some((item) => item.kind === "ask" && item.alias === "/ask"));
});

test("buildSkillSlashSuggestions filters plan by prefix", () => {
  const suggestions = buildSkillSlashSuggestions("/p", []);
  assert.ok(suggestions.some((item) => item.kind === "plan"));
  assert.equal(buildSkillSlashSuggestions("/ask", []).some((item) => item.kind === "plan"), false);
});

test("currentSkillSlashQueryAtCursor matches slash token in middle of text", () => {
  const input = "hello /git";
  const query = currentSkillSlashQueryAtCursor(input, Array.from(input).length);
  assert.deepEqual(query, {
    start: 6,
    end: 10,
    raw: "/git",
  });
});

test("currentSkillSlashQueryAtCursor matches leading slash token", () => {
  const input = "/loop";
  const query = currentSkillSlashQueryAtCursor(input, Array.from(input).length);
  assert.deepEqual(query, { start: 0, end: 5, raw: "/loop" });
});

test("currentSkillSlashQueryAtCursor matches mid-text plan token", () => {
  const input = "please /plan";
  const query = currentSkillSlashQueryAtCursor(input, Array.from(input).length);
  assert.deepEqual(query, {
    start: 7,
    end: 12,
    raw: "/plan",
  });
});

test("currentSkillSlashQueryAtCursor rejects slash command followed by extra text", () => {
  assert.equal(
    currentSkillSlashQueryAtCursor("/loop extra", Array.from("/loop extra").length),
    undefined,
  );
  assert.equal(
    currentSkillSlashQueryAtCursor("hi /foo bar", Array.from("hi /foo bar").length),
    undefined,
  );
});

test("currentSkillSlashQueryAtCursor returns undefined when caret is outside slash token", () => {
  assert.equal(currentSkillSlashQueryAtCursor("hello world", 5), undefined);
});

test("currentSkillSlashQuery delegates to cursor-at-end behavior", () => {
  assert.equal(currentSkillSlashQuery("/loop"), "/loop");
  assert.equal(currentSkillSlashQuery("text /git"), "/git");
  assert.equal(currentSkillSlashQuery("hello world"), undefined);
});

test("skillSlashQueryKey is stable for the same query", () => {
  const query = { start: 1, end: 5, raw: "/git" };
  assert.equal(skillSlashQueryKey(query), "1\u00005\u0000/git");
});

test("slash and file-reference queries target different caret tokens", () => {
  const input = "see @src/foo.ts then /git";
  const fileCaret = Array.from("see @").length;
  const slashCaret = Array.from(input).length;
  const fileQuery = currentWorkspaceFileReferenceQuery(input, fileCaret);
  const slashQuery = currentSkillSlashQueryAtCursor(input, slashCaret);
  assert.ok(fileQuery?.raw.startsWith("@"));
  assert.equal(slashQuery?.raw, "/git");
  assert.notEqual(fileQuery?.raw, slashQuery?.raw);
});

test("buildSkillSlashSuggestions returns empty for undefined query", () => {
  assert.deepEqual(buildSkillSlashSuggestions(undefined, []), []);
});
