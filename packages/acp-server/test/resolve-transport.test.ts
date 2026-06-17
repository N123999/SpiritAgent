import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { loadBaseConfig } from '../src/config.js';
import {
  providerAccessKeyIdAccount,
  providerSecretAccessKeyAccount,
  providerVertexClientEmailAccount,
  providerVertexPrivateKeyAccount,
} from '../src/credentials/provider-accounts.js';
import { setKeyringStoreForTests } from '../src/credentials/index.js';
import { resolveTransportConfig } from '../src/transport/resolve-transport.js';

test('resolveTransportConfig builds bedrock transport from IAM credentials', () => {
  const dir = mkdtempSync(join(tmpdir(), 'spirit-acp-bedrock-'));
  writeFileSync(
    join(dir, 'config.json'),
    JSON.stringify({
      models: [{
        name: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
        apiBase: 'https://bedrock-runtime.us-east-1.amazonaws.com',
        provider: 'amazon-bedrock',
        transportKind: 'bedrock',
        awsRegion: 'us-east-1',
      }],
      activeModel: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
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
  passwords.set(providerAccessKeyIdAccount('amazon-bedrock'), 'AKIAEXAMPLE');
  passwords.set(providerSecretAccessKeyAccount('amazon-bedrock'), 'secret-key');

  try {
    const config = loadBaseConfig();
    config.spiritDataDir = dir;
    const transport = resolveTransportConfig(config);
    assert.equal(transport.transportKind, 'bedrock');
    if (transport.transportKind === 'bedrock') {
      assert.equal(transport.region, 'us-east-1');
      assert.equal(transport.accessKeyId, 'AKIAEXAMPLE');
      assert.equal(transport.secretAccessKey, 'secret-key');
    }
  } finally {
    setKeyringStoreForTests(undefined);
  }
});

test('resolveTransportConfig builds vertex transport from service account credentials', () => {
  const dir = mkdtempSync(join(tmpdir(), 'spirit-acp-vertex-'));
  writeFileSync(
    join(dir, 'config.json'),
    JSON.stringify({
      models: [{
        name: 'gemini-2.0-flash',
        apiBase: 'https://us-central1-aiplatform.googleapis.com/v1',
        provider: 'google-vertex-ai',
        vertexProject: 'my-project',
        vertexLocation: 'us-central1',
      }],
      activeModel: 'gemini-2.0-flash',
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
  passwords.set(providerVertexClientEmailAccount('google-vertex-ai'), 'sa@my-project.iam.gserviceaccount.com');
  passwords.set(providerVertexPrivateKeyAccount('google-vertex-ai'), '-----BEGIN PRIVATE KEY-----\nkey\n-----END PRIVATE KEY-----');

  try {
    const config = loadBaseConfig();
    config.spiritDataDir = dir;
    const transport = resolveTransportConfig(config);
    assert.equal(transport.transportKind, 'openai-compatible');
    if (transport.transportKind === 'openai-compatible') {
      assert.equal(transport.vertexProject, 'my-project');
      assert.equal(transport.vertexLocation, 'us-central1');
      assert.equal(transport.vertexClientEmail, 'sa@my-project.iam.gserviceaccount.com');
      assert.ok(transport.vertexPrivateKey?.includes('BEGIN PRIVATE KEY'));
    }
  } finally {
    setKeyringStoreForTests(undefined);
  }
});
