import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { AgentsSettingsRow } from "../../src/components/settings/panels/agents-settings-panel.tsx";

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcRoot = join(__dirname, "../../src/components/settings");

const PANEL_FILES = [
  ["AgentsSettingsPanel", "panels/agents-settings-panel.tsx"],
  ["AppearanceSettingsPanel", "panels/appearance-settings-panel.tsx"],
  ["DeveloperSettingsPanel", "panels/developer-settings-panel.tsx"],
  ["DreamSettingsPanel", "panels/dream-settings-panel.tsx"],
  ["ExtensionConfigurationPanel", "panels/extension-configuration-panel.tsx"],
  ["ExtensionsSettingsPanel", "panels/extensions-settings-panel.tsx"],
  ["HooksSettingsPanel", "panels/hooks-settings-panel.tsx"],
  ["IntegrationsSettingsPanel", "panels/integrations-settings-panel.tsx"],
  ["McpsSettingsPanel", "panels/mcps-settings-panel.tsx"],
  ["NetworksSettingsPanel", "panels/networks-settings-panel.tsx"],
  ["RulesSettingsPanel", "panels/rules-settings-panel.tsx"],
  ["SkillsSettingsPanel", "panels/skills-settings-panel.tsx"],
  ["ModelsSettingsPanel", "models/models-settings-panel.tsx"],
  ["SettingsView", "settings-view.tsx"],
];

for (const [exportName, relativePath] of PANEL_FILES) {
  test(`settings module file exports ${exportName}`, async () => {
    const source = await readFile(join(srcRoot, relativePath), "utf8");
    assert.match(
      source,
      new RegExp(`export function ${exportName}\\b`),
      `${exportName} in ${relativePath}`,
    );
  });
}

test("settings barrel re-exports SettingsView and SettingsFormState", async () => {
  const barrel = await readFile(join(__dirname, "../../src/components/settings-view.tsx"), "utf8");
  assert.match(barrel, /export \{ SettingsView \} from "@\/components\/settings\/settings-view"/);
  assert.match(barrel, /export type \{ SettingsFormState \} from "@\/components\/settings\/types"/);
});

test("AgentsSettingsRow uses grid layout without shared SettingsRow border", () => {
  const html = renderToStaticMarkup(
    React.createElement(
      AgentsSettingsRow,
      {
        label: "LSP",
        description: "Enable language servers",
        htmlFor: "settings-lsp-enabled",
      },
      React.createElement("span", null, "control"),
    ),
  );

  assert.match(html, /sm:grid-cols-\[minmax\(0,1fr\)_auto\]/);
  assert.doesNotMatch(html, /border-b/);
  assert.match(html, /text-sm text-muted-foreground/);
  assert.match(html, /for="settings-lsp-enabled"/);
});
