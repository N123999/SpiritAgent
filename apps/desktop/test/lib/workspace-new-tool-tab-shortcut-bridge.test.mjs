import assert from "node:assert/strict";
import test, { afterEach } from "node:test";

import {
  registerWorkspaceNewToolTabShortcut,
  resetWorkspaceNewToolTabShortcutBridgeForTests,
  triggerWorkspaceNewToolTabShortcut,
  unregisterWorkspaceNewToolTabShortcut,
} from "../../src/lib/workspace-new-tool-tab-shortcut-bridge.ts";

afterEach(() => {
  resetWorkspaceNewToolTabShortcutBridgeForTests();
});

test("triggerWorkspaceNewToolTabShortcut returns false when bridge is not registered", () => {
  assert.equal(triggerWorkspaceNewToolTabShortcut(), false);
});

test("triggerWorkspaceNewToolTabShortcut invokes registered open handler", () => {
  let opened = 0;
  registerWorkspaceNewToolTabShortcut({
    open() {
      opened += 1;
    },
  });

  assert.equal(triggerWorkspaceNewToolTabShortcut(), true);
  assert.equal(opened, 1);
});

test("unregisterWorkspaceNewToolTabShortcut clears bridge", () => {
  registerWorkspaceNewToolTabShortcut({
    open() {},
  });
  unregisterWorkspaceNewToolTabShortcut();
  assert.equal(triggerWorkspaceNewToolTabShortcut(), false);
});
