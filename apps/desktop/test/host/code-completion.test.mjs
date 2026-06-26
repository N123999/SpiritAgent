import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  abortCodeCompletionCommand,
  recordCodeCompletionFileStateCommand,
  requestCodeCompletionCommand,
  resetCodeCompletionJournalCommand,
} from '../../dist-electron/src/host/code-completion-commands.js';
import { buildCodeCompletionTransportConfig } from '../../dist-electron/src/host/model-config.js';
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

test('buildCodeCompletionTransportConfig disables DeepSeek thinking', () => {
  const config = buildCodeCompletionTransportConfig({
    apiKey: 'test-key',
    model: 'deepseek-v4-flash',
    baseUrl: 'https://api.deepseek.com',
    workspaceRoot,
    profile: {
      provider: 'deepseek',
      capabilities: ['chat'],
      reasoningEffort: 'high',
    },
  });
  assert.equal(config.llmVendor, 'deepseek');
  assert.equal(config.reasoningEffort, 'default');
  assert.equal(config.vendorExtendedThinking, false);
  assert.equal(config.transportRequestProfile, 'code-completion');
});

test('buildCodeCompletionTransportConfig disables Moonshot AI thinking', () => {
  const config = buildCodeCompletionTransportConfig({
    apiKey: 'test-key',
    model: 'kimi-k2.5',
    baseUrl: 'https://api.moonshot.ai/v1',
    workspaceRoot,
    profile: {
      provider: 'moonshot-ai',
      capabilities: ['chat'],
      reasoningEffort: 'high',
    },
  });
  assert.equal(config.llmVendor, 'moonshot-ai');
  assert.equal(config.reasoningEffort, 'default');
  assert.equal(config.vendorExtendedThinking, false);
  assert.equal(config.transportRequestProfile, 'code-completion');
});

test('buildCodeCompletionTransportConfig disables OpenAI reasoning', () => {
  const config = buildCodeCompletionTransportConfig({
    apiKey: 'test-key',
    model: 'gpt-4o-mini',
    baseUrl: 'https://api.openai.com/v1',
    workspaceRoot,
    profile: {
      provider: 'openai',
      capabilities: ['chat'],
      reasoningEffort: 'default',
    },
  });
  assert.equal(config.vendorExtendedThinking, undefined);
  assert.equal(config.reasoningEffort, 'none');
  assert.equal(config.transportRequestProfile, 'code-completion');
});

test('buildCodeCompletionTransportConfig disables custom provider reasoning', () => {
  const config = buildCodeCompletionTransportConfig({
    apiKey: 'test-key',
    model: 'local-model',
    baseUrl: 'https://llm.example/v1',
    workspaceRoot,
    profile: {
      provider: 'custom',
      capabilities: ['chat'],
      reasoningEffort: 'high',
    },
  });
  assert.equal(config.llmVendor, 'custom');
  assert.equal(config.reasoningEffort, 'none');
  assert.equal(config.transportRequestProfile, 'code-completion');
});
