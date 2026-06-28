export type WorkspaceNewToolTabShortcutBridge = {
  open(): void;
};

let bridge: WorkspaceNewToolTabShortcutBridge | null = null;

export function registerWorkspaceNewToolTabShortcut(
  registration: WorkspaceNewToolTabShortcutBridge,
): void {
  bridge = registration;
}

export function unregisterWorkspaceNewToolTabShortcut(): void {
  bridge = null;
}

export function triggerWorkspaceNewToolTabShortcut(): boolean {
  if (!bridge) {
    return false;
  }
  bridge.open();
  return true;
}

export function resetWorkspaceNewToolTabShortcutBridgeForTests(): void {
  bridge = null;
}
