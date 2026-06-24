import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  abortCodeCompletionCommand,
  recordCodeCompletionFileStateCommand,
  requestCodeCompletionCommand,
  resetCodeCompletionJournalCommand,
} from '../../dist-electron/src/host/code-completion-commands.js';
import { defaultAgentsConfig } from '../../dist-electron/src/host/storage.js';

const workspaceRoot = '/tmp/code-completion-test';
const baseConfig = {
  models: [
    {
      name: 'gpt-4o-mini',
      apiBase: 'https://api.openai.com/v1',
      reasoningEffort: 'default',
      capabilities: ['chat'],
    },
  ],
  activeModel: 'gpt-4o-mini',
  recentWorkspaces: [],
  windowsMica: true,
  systemNotifications: true,
  agentMode: 'agent',
  webHost: { enabled: false, host: '127.0.0.1', port: 1421 },
  dreams: { enabled: false, debugMode: false },
  agents: defaultAgentsConfig(),
  networks: { llmHttpVersion: 'http2' },
};

test('requestCodeCompletionCommand returns empty when lightweight model missing', async () => {
  const result = await requestCodeCompletionCommand(
    {
      workspaceRoot,
      config: {
        ...baseConfig,
        lightweightChatModel: 'missing-model',
      },
    },
    {
      relativePath: 'src/a.ts',
      languageId: 'typescript',
      documentText: 'const a = 1;',
      cursorLine: 1,
      cursorColumn: 12,
    },
  );
  assert.deepEqual(result, { operations: [] });
});

test('requestCodeCompletionCommand returns empty when code completion disabled', async () => {
  const result = await requestCodeCompletionCommand(
    {
      workspaceRoot,
      config: {
        ...baseConfig,
        agents: {
          ...defaultAgentsConfig(),
          codeCompletion: { enabled: false },
        },
      },
    },
    {
      relativePath: 'src/a.ts',
      languageId: 'typescript',
      documentText: 'const a = 1;',
      cursorLine: 1,
      cursorColumn: 12,
    },
  );
  assert.deepEqual(result, { operations: [] });
});

test('record and reset journal commands do not throw', () => {
  const context = { workspaceRoot: `${workspaceRoot}-journal`, config: baseConfig };
  recordCodeCompletionFileStateCommand(context, {
    relativePath: 'src/a.ts',
    baselineText: 'a',
    currentText: 'b',
  });
  resetCodeCompletionJournalCommand(context);
  abortCodeCompletionCommand(context.workspaceRoot);
});
