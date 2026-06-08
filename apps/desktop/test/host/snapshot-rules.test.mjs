import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildDesktopSnapshot } from '../../dist-electron/src/host/snapshot.js';

test('buildDesktopSnapshot maps rulesList from metadata entries', () => {
  const snapshot = buildDesktopSnapshot({
    workspaceRoot: 'C:/workspace/demo',
    config: {
      models: [],
      activeModel: '',
      recentWorkspaces: [],
      dreams: {},
      networks: { llmHttpVersion: 'http2' },
    },
    git: { available: false },
    metadata: {
      rules: {
        discovered: 1,
        enabled: 1,
        enabledRules: [],
        entries: [
          {
            source: {
              id: 'rule-spirit',
              scope: 'workspace',
              rootKind: 'workspaceSpirit',
              title: '工作区 Spirit 规则',
              shortLabel: '.spirit/rule.md',
              path: 'C:/workspace/demo/.spirit/rule.md',
            },
            exists: true,
            enabled: true,
            preview: { excerpt: '# Rules\nhello', truncated: false },
          },
          {
            source: {
              id: 'rule-agents',
              scope: 'workspace',
              rootKind: 'workspaceAgents',
              title: '工作区 AGENTS 规则',
              shortLabel: 'AGENTS.md',
              path: 'C:/workspace/demo/AGENTS.md',
            },
            exists: false,
            enabled: false,
          },
        ],
      },
      skills: {
        discovered: 0,
        enabled: 0,
        enabledSkillCatalog: [],
        entries: [],
      },
      planMetadata: {
        path: '',
        exists: false,
        agentMode: 'agent',
        planMode: false,
      },
    },
    plan: { path: '', exists: false },
    extensionsList: [],
    extensionCss: [],
    dreamCollectorStatus: { state: 'disabled' },
    runtimeReady: true,
    modelKeyPresence: {},
    activeApiKeyConfigured: false,
    mcpStatus: { servers: [] },
    mcpServers: [],
    lsp: { providers: [] },
    conversation: {
      messages: [],
      isBusy: false,
      isBlocked: false,
    },
    composerSessionKey: 'test',
  });

  assert.equal(snapshot.rulesList.length, 2);
  assert.equal(snapshot.rulesList[0]?.rootKind, 'workspaceSpirit');
  assert.equal(snapshot.rulesList[0]?.previewExcerpt, '# Rules\nhello');
  assert.equal(snapshot.rulesList[1]?.exists, false);
});
