import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  COMPOSER_DRAFT_STORAGE_KEY,
  clearComposerDraft,
  normalizeComposerSessionKey,
  readComposerDraft,
  writeComposerDraft,
} from '../../dist-electron/src/lib/composer-draft-store.js';

function createMemoryStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
    values,
  };
}

test('normalizeComposerSessionKey normalizes Windows-style paths', () => {
  assert.equal(
    normalizeComposerSessionKey('D:\\SpiritAgent\\Chats\\A.json'),
    'd:/spiritagent/chats/a.json',
  );
});

test('writeComposerDraft and readComposerDraft round-trip text attachments and segments', () => {
  const storage = createMemoryStorage();
  const sessionKey = 'D:/SpiritAgent/chats/session-a.json';
  const segments = [
    { kind: 'text', value: 'fix ' },
    { kind: 'workspaceFile', path: 'src/App.tsx' },
    { kind: 'skill', alias: '/git-commit' },
  ];

  writeComposerDraft(
    sessionKey,
    {
      text: 'fix @src/App.tsx',
      localFilePaths: ['D:\\tmp\\note.png', 'D:/tmp/note.png'],
      segments,
    },
    storage,
  );

  const restored = readComposerDraft(sessionKey, storage);
  assert.deepEqual(restored, {
    text: 'fix @src/App.tsx',
    localFilePaths: ['D:/tmp/note.png'],
    segments,
    updatedAt: restored.updatedAt,
  });
  assert.equal(typeof restored.updatedAt, 'number');
});

test('writeComposerDraft deletes empty drafts', () => {
  const storage = createMemoryStorage();
  const sessionKey = 'session-empty';

  writeComposerDraft(sessionKey, { text: 'temp', localFilePaths: [], segments: [] }, storage);
  writeComposerDraft(sessionKey, { text: '   ', localFilePaths: [], segments: [] }, storage);

  assert.equal(readComposerDraft(sessionKey, storage), undefined);
  const raw = JSON.parse(storage.getItem(COMPOSER_DRAFT_STORAGE_KEY));
  assert.equal(raw.drafts['session-empty'], undefined);
});

test('readComposerDraft discards v1 drafts without migration', () => {
  const storage = createMemoryStorage();
  storage.setItem(
    COMPOSER_DRAFT_STORAGE_KEY,
    JSON.stringify({
      version: 1,
      drafts: {
        'legacy-session': {
          text: '@README.md hello',
          localFilePaths: [],
          updatedAt: 1,
        },
      },
    }),
  );

  assert.equal(readComposerDraft('legacy-session', storage), undefined);
});

test('clearComposerDraft removes a stored draft', () => {
  const storage = createMemoryStorage();
  const sessionKey = 'session-clear';

  writeComposerDraft(sessionKey, { text: 'keep me briefly', localFilePaths: [], segments: [] }, storage);
  clearComposerDraft(sessionKey, storage);

  assert.equal(readComposerDraft(sessionKey, storage), undefined);
});

test('readComposerDraft returns undefined for corrupted storage', () => {
  const storage = createMemoryStorage();
  storage.setItem(COMPOSER_DRAFT_STORAGE_KEY, '{not-json');

  assert.equal(readComposerDraft('any-session', storage), undefined);
});
