import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildSkillSlashSuggestions,
  isCreateRuleSlashInput,
} from "../src/lib/skill-slash.ts";

test("buildSkillSlashSuggestions includes create-rule command", () => {
  const suggestions = buildSkillSlashSuggestions("/create", []);
  assert.ok(suggestions.some((item) => item.kind === "create-rule" && item.alias === "/create-rule"));
});

test("isCreateRuleSlashInput matches command with prompt", () => {
  assert.equal(isCreateRuleSlashInput("/create-rule 使用中文 commit"), true);
  assert.equal(isCreateRuleSlashInput("/create-skill foo"), false);
});

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
