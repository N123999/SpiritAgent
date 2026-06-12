import assert from "node:assert/strict";
import test from "node:test";

import {
  ctrlLetterShortcutKbdKeys,
  isModAltShortcutPressed,
  isModShortcutPressed,
  modAltLetterShortcutKbdKeys,
  modLetterShortcutKbdKeys,
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

test("ctrlLetterShortcutKbdKeys returns physical Control letter shortcut chips per platform", () => {
  withDesktopPlatform("darwin", () => {
    assert.deepEqual(ctrlLetterShortcutKbdKeys("c"), ["⌃", "C"]);
  });
  withDesktopPlatform("win32", () => {
    assert.deepEqual(ctrlLetterShortcutKbdKeys("c"), ["Ctrl", "C"]);
  });
  withDesktopPlatform("linux", () => {
    assert.deepEqual(ctrlLetterShortcutKbdKeys("c"), ["Ctrl", "C"]);
  });
});

test("modLetterShortcutKbdKeys returns letter shortcut chips per platform", () => {
  withDesktopPlatform("darwin", () => {
    assert.deepEqual(modLetterShortcutKbdKeys("b"), ["⌘", "B"]);
  });
  withDesktopPlatform("win32", () => {
    assert.deepEqual(modLetterShortcutKbdKeys("b"), ["Ctrl", "B"]);
  });
  withDesktopPlatform("linux", () => {
    assert.deepEqual(modLetterShortcutKbdKeys("b"), ["Ctrl", "B"]);
  });
});

test("modAltLetterShortcutKbdKeys returns alt-mod letter shortcut chips per platform", () => {
  withDesktopPlatform("darwin", () => {
    assert.deepEqual(modAltLetterShortcutKbdKeys("b"), ["⌥", "⌘", "B"]);
  });
  withDesktopPlatform("win32", () => {
    assert.deepEqual(modAltLetterShortcutKbdKeys("b"), ["Ctrl", "Alt", "B"]);
  });
  withDesktopPlatform("linux", () => {
    assert.deepEqual(modAltLetterShortcutKbdKeys("b"), ["Ctrl", "Alt", "B"]);
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

test("isModShortcutPressed uses Command on macOS and Ctrl elsewhere", () => {
  withDesktopPlatform("darwin", () => {
    assert.equal(isModShortcutPressed({ altKey: false, ctrlKey: true, metaKey: false }), false);
    assert.equal(isModShortcutPressed({ altKey: false, ctrlKey: false, metaKey: true }), true);
  });
  withDesktopPlatform("win32", () => {
    assert.equal(isModShortcutPressed({ altKey: false, ctrlKey: true, metaKey: false }), true);
    assert.equal(isModShortcutPressed({ altKey: false, ctrlKey: false, metaKey: true }), false);
  });
});

test("isModAltShortcutPressed requires Alt plus the platform primary modifier", () => {
  withDesktopPlatform("darwin", () => {
    assert.equal(
      isModAltShortcutPressed({ altKey: true, ctrlKey: true, metaKey: false }),
      false,
    );
    assert.equal(
      isModAltShortcutPressed({ altKey: true, ctrlKey: false, metaKey: true }),
      true,
    );
  });
  withDesktopPlatform("win32", () => {
    assert.equal(
      isModAltShortcutPressed({ altKey: true, ctrlKey: true, metaKey: false }),
      true,
    );
    assert.equal(
      isModAltShortcutPressed({ altKey: true, ctrlKey: false, metaKey: true }),
      false,
    );
  });
});
