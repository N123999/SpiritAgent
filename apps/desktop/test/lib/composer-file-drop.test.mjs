import assert from "node:assert/strict";
import test from "node:test";

import {
  SPIRIT_WORKSPACE_ENTRY_MIME,
  isComposerFileDropAccepted,
  resolveComposerDropAbsolutePaths,
} from "../../src/lib/composer-file-drop.ts";

function mockDataTransfer({ types = [], files = [], data = {} } = {}) {
  return {
    types,
    files,
    getData(type) {
      return data[type] ?? "";
    },
  };
}

test("isComposerFileDropAccepted accepts Files and spirit workspace entry", () => {
  assert.equal(isComposerFileDropAccepted(mockDataTransfer({ types: ["Files"] })), true);
  assert.equal(
    isComposerFileDropAccepted(mockDataTransfer({ types: [SPIRIT_WORKSPACE_ENTRY_MIME] })),
    true,
  );
  assert.equal(isComposerFileDropAccepted(mockDataTransfer({ types: ["text/plain"] })), false);
});

test("resolveComposerDropAbsolutePaths maps spirit workspace file to absolute path", () => {
  const paths = resolveComposerDropAbsolutePaths(
    {
      dataTransfer: mockDataTransfer({
        types: [SPIRIT_WORKSPACE_ENTRY_MIME],
        data: {
          [SPIRIT_WORKSPACE_ENTRY_MIME]: JSON.stringify({
            relativePath: "src/foo.ts",
            kind: "file",
          }),
        },
      }),
    },
    {
      workspaceRoot: "D:/proj",
      getPathForFile: () => null,
    },
  );
  assert.deepEqual(paths, ["D:/proj/src/foo.ts"]);
});

test("resolveComposerDropAbsolutePaths ignores spirit workspace directories", () => {
  const paths = resolveComposerDropAbsolutePaths(
    {
      dataTransfer: mockDataTransfer({
        types: [SPIRIT_WORKSPACE_ENTRY_MIME],
        data: {
          [SPIRIT_WORKSPACE_ENTRY_MIME]: JSON.stringify({
            relativePath: "src/",
            kind: "dir",
          }),
        },
      }),
    },
    {
      workspaceRoot: "D:/proj",
      getPathForFile: () => null,
    },
  );
  assert.deepEqual(paths, []);
});

test("resolveComposerDropAbsolutePaths reads OS dropped files via getPathForFile", () => {
  const fileA = { name: "a.txt" };
  const fileB = { name: "b.txt" };
  const paths = resolveComposerDropAbsolutePaths(
    {
      dataTransfer: mockDataTransfer({
        types: ["Files"],
        files: [fileA, fileB],
      }),
    },
    {
      workspaceRoot: "D:/proj",
      getPathForFile: (file) => (file === fileA ? "D:/tmp/a.txt" : "D:/tmp/b.txt"),
    },
  );
  assert.deepEqual(paths, ["D:/tmp/a.txt", "D:/tmp/b.txt"]);
});

test("resolveComposerDropAbsolutePaths deduplicates repeated paths", () => {
  const file = { name: "dup.txt" };
  const paths = resolveComposerDropAbsolutePaths(
    {
      dataTransfer: mockDataTransfer({
        types: ["Files"],
        files: [file, file],
      }),
    },
    {
      workspaceRoot: "D:/proj",
      getPathForFile: () => "D:/tmp/dup.txt",
    },
  );
  assert.deepEqual(paths, ["D:/tmp/dup.txt"]);
});
