import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { AuthState, createAuthState } from '../src/auth/auth-state.js';
import { buildAuthMethods, buildAuthMethodsForStartup, buildTerminalAuthMethod } from '../src/auth/build-auth-methods.js';
import {
  TERMINAL_AUTH_ARGS,
  TERMINAL_AUTH_METHOD_ID,
} from '../src/auth/constants.js';
import { canCreateSession, createInitialAuthState, isEnvPreAuthenticated } from '../src/auth/session-auth.js';
import { loadBaseConfig, resolveEnvApiKey } from '../src/config.js';
import { hasResolvableCredentials, setKeyringStoreForTests } from '../src/credentials/index.js';
import { providerKeyAccount } from '../src/credentials/provider-accounts.js';
import {
  validateAzureSetup,
  validateBedrockCredentials,
  validateCustomSetup,
  validateModelName,
  buildSetupProfile,
} from '../src/setup/provider-wizard.js';
import { resolveTransportConfig } from '../src/transport/resolve-transport.js';

test('buildTerminalAuthMethod declares terminal setup args', () => {
  const method = buildTerminalAuthMethod();
  assert.equal(method.id, TERMINAL_AUTH_METHOD_ID);
  assert.equal((method as { type?: string }).type, 'terminal');
  assert.deepEqual((method as { args?: string[] }).args, [...TERMINAL_AUTH_ARGS]);
});

test('buildAuthMethods returns a non-empty terminal method list', () => {
  const methods = buildAuthMethods();
  assert.equal(methods.length, 1);
  assert.equal((methods[0] as { type?: string }).type, 'terminal');
});

test('AuthState pre-authenticates when constructed with true', () => {
  const state = createAuthState(true);
  assert.equal(state.isAuthenticated(), true);
  state.logout();
  assert.equal(state.isAuthenticated(), false);
});

test('canCreateSession allows env API key without authenticate', () => {
  const previous = process.env['SPIRIT_ACP_API_KEY'];
  process.env['SPIRIT_ACP_API_KEY'] = 'test-key';
  try {
    const config = loadBaseConfig();
    const authState = new AuthState(false);
    assert.equal(canCreateSession(config, authState), true);
    assert.equal(isEnvPreAuthenticated(), true);
  } finally {
    if (previous === undefined) {
      delete process.env['SPIRIT_ACP_API_KEY'];
    } else {
      process.env['SPIRIT_ACP_API_KEY'] = previous;
    }
  }
});

test('buildAuthMethodsForStartup omits methods when shared credentials exist', () => {
  const previous = process.env['SPIRIT_ACP_API_KEY'];
  delete process.env['SPIRIT_ACP_API_KEY'];

  const dir = mkdtempSync(join(tmpdir(), 'spirit-acp-auth-'));
  writeFileSync(
    join(dir, 'config.json'),
    JSON.stringify({
      models: [{
        name: 'gpt-4o-mini',
        apiBase: 'https://api.openai.com/v1',
        provider: 'openai',
      }],
      activeModel: 'gpt-4o-mini',
    }),
    'utf8',
  );

  const passwords = new Map<string, string>();
  setKeyringStoreForTests({
    getPassword: (_service, account) => passwords.get(account),
    setPassword: (_service, account, password) => {
      passwords.set(account, password);
    },
    deletePassword: (_service, account) => {
      passwords.delete(account);
    },
  });
  passwords.set(providerKeyAccount('openai'), 'stored-key');

  try {
    assert.equal(buildAuthMethodsForStartup(dir).length, 0);
    assert.equal(buildAuthMethodsForStartup(mkdtempSync(join(tmpdir(), 'spirit-acp-empty-'))).length, 1);
  } finally {
    setKeyringStoreForTests(undefined);
    if (previous === undefined) {
      delete process.env['SPIRIT_ACP_API_KEY'];
    } else {
      process.env['SPIRIT_ACP_API_KEY'] = previous;
    }
  }
});

test('createInitialAuthState pre-authenticates when shared credentials exist', () => {
  const previous = process.env['SPIRIT_ACP_API_KEY'];
  delete process.env['SPIRIT_ACP_API_KEY'];

  const dir = mkdtempSync(join(tmpdir(), 'spirit-acp-auth-'));
  writeFileSync(
    join(dir, 'config.json'),
    JSON.stringify({
      models: [{
        name: 'gpt-4o-mini',
        apiBase: 'https://api.openai.com/v1',
        provider: 'openai',
      }],
      activeModel: 'gpt-4o-mini',
    }),
    'utf8',
  );

  const passwords = new Map<string, string>();
  setKeyringStoreForTests({
    getPassword: (_service, account) => passwords.get(account),
    setPassword: (_service, account, password) => {
      passwords.set(account, password);
    },
    deletePassword: (_service, account) => {
      passwords.delete(account);
    },
  });
  passwords.set(providerKeyAccount('openai'), 'stored-key');

  try {
    const config = loadBaseConfig();
    config.spiritDataDir = dir;
    const authState = createInitialAuthState(config);
    assert.equal(authState.isAuthenticated(), true);
    assert.equal(canCreateSession(config, authState), true);
  } finally {
    setKeyringStoreForTests(undefined);
    if (previous === undefined) {
      delete process.env['SPIRIT_ACP_API_KEY'];
    } else {
      process.env['SPIRIT_ACP_API_KEY'] = previous;
    }
  }
});

test('canCreateSession requires authenticate when using shared credentials without pre-auth', () => {
  const previous = process.env['SPIRIT_ACP_API_KEY'];
  delete process.env['SPIRIT_ACP_API_KEY'];

  const dir = mkdtempSync(join(tmpdir(), 'spirit-acp-auth-'));
  writeFileSync(
    join(dir, 'config.json'),
    JSON.stringify({
      models: [{
        name: 'gpt-4o-mini',
        apiBase: 'https://api.openai.com/v1',
        provider: 'openai',
      }],
      activeModel: 'gpt-4o-mini',
    }),
    'utf8',
  );

  const passwords = new Map<string, string>();
  setKeyringStoreForTests({
    getPassword: (_service, account) => passwords.get(account),
    setPassword: (_service, account, password) => {
      passwords.set(account, password);
    },
    deletePassword: (_service, account) => {
      passwords.delete(account);
    },
  });
  passwords.set(providerKeyAccount('openai'), 'stored-key');

  try {
    const config = loadBaseConfig();
    config.spiritDataDir = dir;
    const unauthenticated = new AuthState(false);
    assert.equal(hasResolvableCredentials(dir), true);
    assert.equal(canCreateSession(config, unauthenticated), false);

    unauthenticated.markAuthenticated();
    assert.equal(canCreateSession(config, unauthenticated), true);
  } finally {
    setKeyringStoreForTests(undefined);
    if (previous === undefined) {
      delete process.env['SPIRIT_ACP_API_KEY'];
    } else {
      process.env['SPIRIT_ACP_API_KEY'] = previous;
    }
  }
});

test('loadBaseConfig does not require SPIRIT_ACP_API_KEY', () => {
  const previous = process.env['SPIRIT_ACP_API_KEY'];
  delete process.env['SPIRIT_ACP_API_KEY'];
  try {
    const config = loadBaseConfig();
    assert.equal(config.apiKey, undefined);
  } finally {
    if (previous === undefined) {
      delete process.env['SPIRIT_ACP_API_KEY'];
    } else {
      process.env['SPIRIT_ACP_API_KEY'] = previous;
    }
  }
});

test('resolveEnvApiKey rejects unexpanded placeholders', () => {
  const previous = process.env['SPIRIT_ACP_API_KEY'];
  process.env['SPIRIT_ACP_API_KEY'] = '${SPIRIT_ACP_API_KEY}';
  try {
    assert.throws(() => resolveEnvApiKey(), /unexpanded placeholder/);
  } finally {
    if (previous === undefined) {
      delete process.env['SPIRIT_ACP_API_KEY'];
    } else {
      process.env['SPIRIT_ACP_API_KEY'] = previous;
    }
  }
});

test('resolveTransportConfig prefers env override', () => {
  const previousKey = process.env['SPIRIT_ACP_API_KEY'];
  const previousModel = process.env['SPIRIT_ACP_MODEL'];
  process.env['SPIRIT_ACP_API_KEY'] = 'env-key';
  process.env['SPIRIT_ACP_MODEL'] = 'gpt-test';
  try {
    const config = loadBaseConfig();
    const transport = resolveTransportConfig(config);
    assert.equal(transport.transportKind, 'openai-compatible');
    if (transport.transportKind === 'openai-compatible') {
      assert.equal(transport.apiKey, 'env-key');
      assert.equal(transport.model, 'gpt-test');
    }
  } finally {
    if (previousKey === undefined) {
      delete process.env['SPIRIT_ACP_API_KEY'];
    } else {
      process.env['SPIRIT_ACP_API_KEY'] = previousKey;
    }
    if (previousModel === undefined) {
      delete process.env['SPIRIT_ACP_MODEL'];
    } else {
      process.env['SPIRIT_ACP_MODEL'] = previousModel;
    }
  }
});

test('setup validation helpers catch missing fields', () => {
  assert.ok(validateModelName(''));
  assert.ok(validateBedrockCredentials({ awsRegion: 'us-east-1' }));
  assert.ok(validateAzureSetup({ azureResourceName: 'my-resource', apiKey: 'k', modelName: '' }));
  assert.equal(
    validateCustomSetup({ apiBase: 'https://example.com/v1', apiKey: 'k', modelName: 'm' }),
    undefined,
  );
});

test('buildSetupProfile resolves preset provider api base', () => {
  const profile = buildSetupProfile({
    provider: 'openai',
    modelName: 'gpt-4o-mini',
  });
  assert.equal(profile.provider, 'openai');
  assert.ok(profile.apiBase.includes('openai.com'));
});
