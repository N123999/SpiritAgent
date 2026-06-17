import { Entry } from '@napi-rs/keyring';

/** Windows Credential Manager UTF-16 blob limit (bytes). */
const KEYRING_MAX_UTF16_BYTES = 2560;

/** Chunk size with margin below {@link KEYRING_MAX_UTF16_BYTES}. */
const KEYRING_MAX_CHUNK_UTF16_BYTES = 2500;

const KEYRING_SHARD_MARKER = '__spirit_keyring_sharded_v1__:';

function utf16LeByteLength(value: string): number {
  return Buffer.byteLength(value, 'utf16le');
}

function shardKeyringAccount(baseAccount: string, index: number): string {
  return `${baseAccount}::shard::${index}`;
}

function splitKeyringPassword(
  password: string,
  maxUtf16Bytes = KEYRING_MAX_CHUNK_UTF16_BYTES,
): string[] {
  if (utf16LeByteLength(password) <= maxUtf16Bytes) {
    return [password];
  }

  const chunks: string[] = [];
  let offset = 0;
  while (offset < password.length) {
    let end = offset + 1;
    while (
      end < password.length
      && utf16LeByteLength(password.slice(offset, end + 1)) <= maxUtf16Bytes
    ) {
      end += 1;
    }
    chunks.push(password.slice(offset, end));
    offset = end;
  }
  return chunks;
}

function parseShardedKeyringPrimary(value: string): number | undefined {
  if (!value.startsWith(KEYRING_SHARD_MARKER)) {
    return undefined;
  }
  const count = Number.parseInt(value.slice(KEYRING_SHARD_MARKER.length), 10);
  if (!Number.isFinite(count) || count < 2) {
    return undefined;
  }
  return count;
}

function buildShardedKeyringPrimary(shardCount: number): string {
  return `${KEYRING_SHARD_MARKER}${shardCount}`;
}

function readKeyringEntry(service: string, account: string): string | undefined {
  try {
    const value = new Entry(service, account).getPassword();
    return value ?? undefined;
  } catch {
    return undefined;
  }
}

export function getKeyringPassword(service: string, account: string): string | undefined {
  const primary = readKeyringEntry(service, account);
  if (primary === undefined) {
    return undefined;
  }

  const shardCount = parseShardedKeyringPrimary(primary);
  if (shardCount === undefined) {
    return primary;
  }

  let joined = '';
  for (let index = 0; index < shardCount; index += 1) {
    const shard = readKeyringEntry(service, shardKeyringAccount(account, index));
    if (shard === undefined) {
      return undefined;
    }
    joined += shard;
  }
  return joined;
}

export function setKeyringPassword(service: string, account: string, password: string): void {
  deleteKeyringPassword(service, account);

  const chunks = splitKeyringPassword(password);
  if (chunks.length === 1) {
    new Entry(service, account).setPassword(chunks[0]!);
    return;
  }

  // 先写分片再写 primary 标记，避免崩溃后 primary 指向缺失 shard。
  for (let index = 0; index < chunks.length; index += 1) {
    new Entry(service, shardKeyringAccount(account, index)).setPassword(chunks[index]!);
  }
  new Entry(service, account).setPassword(buildShardedKeyringPrimary(chunks.length));
}

export function deleteKeyringPassword(service: string, account: string): void {
  const primary = readKeyringEntry(service, account);
  const shardCount = primary ? parseShardedKeyringPrimary(primary) : undefined;

  if (shardCount !== undefined) {
    for (let index = 0; index < shardCount; index += 1) {
      try {
        new Entry(service, shardKeyringAccount(account, index)).deletePassword();
      } catch {
        /* 无条目时忽略 */
      }
    }
  }

  try {
    new Entry(service, account).deletePassword();
  } catch {
    /* 无条目时忽略 */
  }
}

/** Test-only override for keyring operations. */
export interface KeyringStore {
  getPassword(service: string, account: string): string | undefined;
  setPassword(service: string, account: string, password: string): void;
  deletePassword(service: string, account: string): void;
}

export const defaultKeyringStore: KeyringStore = {
  getPassword: getKeyringPassword,
  setPassword: setKeyringPassword,
  deletePassword: deleteKeyringPassword,
};

let keyringStoreOverride: KeyringStore | undefined;

export function setKeyringStoreForTests(store: KeyringStore | undefined): void {
  keyringStoreOverride = store;
}

export function keyringStore(): KeyringStore {
  return keyringStoreOverride ?? defaultKeyringStore;
}
