import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import {
  KEYRING_MAX_CHUNK_UTF16_BYTES,
  KEYRING_MAX_UTF16_BYTES,
  KEYRING_SHARD_MARKER,
  buildShardedKeyringPrimary,
  parseShardedKeyringPrimary,
  shardKeyringAccount,
  splitKeyringPassword,
} from '../../dist-electron/src/host/keyring-secret.js';

function utf16LeByteLength(value) {
  return Buffer.byteLength(value, 'utf16le');
}

test('splitKeyringPassword keeps short secrets in one chunk', () => {
  assert.deepEqual(splitKeyringPassword('bedrock-api-key-abc'), ['bedrock-api-key-abc']);
});

test('splitKeyringPassword shards Bedrock-scale bearer tokens by UTF-16 bytes', () => {
  const token = `bedrock-api-key-${'A'.repeat(2180)}`;
  assert.equal(token.length, 2196);
  assert.ok(utf16LeByteLength(token) > KEYRING_MAX_UTF16_BYTES);
  const chunks = splitKeyringPassword(token);
  assert.equal(chunks.length, 2);
  assert.equal(chunks.join(''), token);
  assert.ok(chunks.every((chunk) => utf16LeByteLength(chunk) <= KEYRING_MAX_CHUNK_UTF16_BYTES));
  assert.ok(chunks.every((chunk) => utf16LeByteLength(chunk) <= KEYRING_MAX_UTF16_BYTES));
});

test('sharded keyring marker round-trips shard count', () => {
  const primary = buildShardedKeyringPrimary(3);
  assert.equal(primary, `${KEYRING_SHARD_MARKER}3`);
  assert.equal(parseShardedKeyringPrimary(primary), 3);
  assert.equal(parseShardedKeyringPrimary('plain-secret'), undefined);
});

test('shardKeyringAccount keeps base account stable', () => {
  assert.equal(
    shardKeyringAccount('provider::amazon-bedrock', 1),
    'provider::amazon-bedrock::shard::1',
  );
});

test('setKeyringPassword writes sharded secrets before primary marker', () => {
  const sourcePath = join(
    dirname(fileURLToPath(import.meta.url)),
    '../../src/host/keyring-secret.ts',
  );
  const source = readFileSync(sourcePath, 'utf8');
  const shardWriteIndex = source.indexOf('shardKeyringAccount(account, index)');
  const primaryWriteIndex = source.indexOf('buildShardedKeyringPrimary(chunks.length)');
  assert.ok(shardWriteIndex > 0);
  assert.ok(primaryWriteIndex > shardWriteIndex);
});
