import assert from "node:assert/strict";
import test from "node:test";

import {
  modSlashShortcutKbdKeys,
  modSlashShortcutLabel,
  shortcutLabel,
} from "../../src/lib/desktop-shell.ts";

function withDesktopPlatform(platform, run) {
  const previousWindow = globalThis.window;
  globalThis.window = {
    spiritDesktop: { platform },
  };
  try {
    run();
  } finally {
    globalThis.window = previousWindow;
  }
}

test("shortcutLabel formats letter shortcuts per platform", () => {
  withDesktopPlatform("darwin", () => {
    assert.equal(shortcutLabel("n"), "⌘N");
  });
  withDesktopPlatform("win32", () => {
    assert.equal(shortcutLabel("n"), "Ctrl+N");
  });
});

test("modSlashShortcutKbdKeys returns slash shortcut chips per platform", () => {
  withDesktopPlatform("darwin", () => {
    assert.deepEqual(modSlashShortcutKbdKeys(), ["⌘", "/"]);
  });
  withDesktopPlatform("win32", () => {
    assert.deepEqual(modSlashShortcutKbdKeys(), ["Ctrl", "/"]);
  });
  withDesktopPlatform("linux", () => {
    assert.deepEqual(modSlashShortcutKbdKeys(), ["Ctrl", "/"]);
  });
});

test("modSlashShortcutLabel formats slash shortcut per platform", () => {
  withDesktopPlatform("darwin", () => {
    assert.equal(modSlashShortcutLabel(), "⌘/");
  });
  withDesktopPlatform("win32", () => {
    assert.equal(modSlashShortcutLabel(), "Ctrl+/");
  });
  withDesktopPlatform("linux", () => {
    assert.equal(modSlashShortcutLabel(), "Ctrl+/");
  });
});
