import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  loadSpiritConfig,
  saveProviderSetup,
  setKeyringStoreForTests,
} from '../src/credentials/index.js';
import { providerKeyAccount } from '../src/credentials/provider-accounts.js';

test('loadSpiritConfig returns undefined for invalid JSON', () => {
  const dir = mkdtempSync(join(tmpdir(), 'spirit-acp-config-'));
  writeFileSync(join(dir, 'config.json'), '{not json', 'utf8');
  assert.equal(loadSpiritConfig(dir), undefined);
});

test('saveProviderSetup writes keyring before config', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'spirit-acp-save-'));
  const setup = {
    profile: {
      name: 'gpt-4o-mini',
      apiBase: 'https://api.openai.com/v1',
      provider: 'openai' as const,
    },
    providerScope: 'openai' as const,
    apiKey: 'secret-key',
  };

  setKeyringStoreForTests({
    getPassword: () => undefined,
    setPassword: () => {
      throw new Error('keyring unavailable');
    },
    deletePassword: () => {},
  });

  try {
    await assert.rejects(
      () => saveProviderSetup(dir, setup),
      /keyring unavailable/,
    );
    assert.equal(existsSync(join(dir, 'config.json')), false);
  } finally {
    setKeyringStoreForTests(undefined);
  }
});

test('saveProviderSetup persists keyring and config together', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'spirit-acp-save-'));
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

  const setup = {
    profile: {
      name: 'gpt-4o-mini',
      apiBase: 'https://api.openai.com/v1',
      provider: 'openai' as const,
    },
    providerScope: 'openai' as const,
    apiKey: 'secret-key',
  };

  try {
    await saveProviderSetup(dir, setup);
    assert.equal(passwords.get(providerKeyAccount('openai')), 'secret-key');
    const config = loadSpiritConfig(dir);
    assert.equal(config?.activeModel, 'gpt-4o-mini');
    assert.equal(config?.models.length, 1);
  } finally {
    setKeyringStoreForTests(undefined);
  }
});
