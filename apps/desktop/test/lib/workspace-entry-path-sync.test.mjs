import assert from "node:assert/strict";
import test from "node:test";

import {
  evictRecordKeysUnderPrefix,
  isUnderWorkspaceEntryPath,
  remapWorkspaceEntryPath,
} from "../../src/lib/workspace-entry-path-sync.ts";

test("isUnderWorkspaceEntryPath matches self and nested paths", () => {
  assert.equal(isUnderWorkspaceEntryPath("src", "src"), true);
  assert.equal(isUnderWorkspaceEntryPath("src", "src/App.tsx"), true);
  assert.equal(isUnderWorkspaceEntryPath("src", "lib/App.tsx"), false);
  assert.equal(isUnderWorkspaceEntryPath("", "src"), false);
});

test("remapWorkspaceEntryPath remaps exact and nested paths", () => {
  assert.equal(remapWorkspaceEntryPath("src/App.tsx", "src/Main.tsx", "src/App.tsx"), "src/Main.tsx");
  assert.equal(
    remapWorkspaceEntryPath("src", "lib", "src/components/Button.tsx"),
    "lib/components/Button.tsx",
  );
  assert.equal(remapWorkspaceEntryPath("src", "lib", "other/App.tsx"), null);
});

test("evictRecordKeysUnderPrefix removes prefix and descendants", () => {
  const record = {
    "": { status: "ready" },
    src: { status: "ready" },
    "src/components": { status: "ready" },
    lib: { status: "ready" },
  };

  const next = evictRecordKeysUnderPrefix(record, "src");
  assert.deepEqual(next, {
    "": { status: "ready" },
    lib: { status: "ready" },
  });
});
