import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';

import { SessionRegistry } from '../../dist-electron/src/host/session-registry.js';
import { restoreStoredSessionState } from '../../dist-electron/src/host/sessions.js';
import { buildV2StoredSession } from './chat-schema-fixture.mjs';
import {
  isProvisionalSessionPath,
  provisionalNewSessionPath,
} from '../../dist-electron/src/host/storage.js';

test('SessionRegistry tracks active bundle after upsertFromRestored', () => {
  const registry = new SessionRegistry();
  const restored = restoreStoredSessionState({
    filePath: 'D:/SpiritAgent/chats/test-session.json',
    loaded: buildV2StoredSession({ userContent: 'hello' }),
  });

  const bundle = registry.upsertFromRestored(
    'D:/SpiritAgent/repo',
    restored,
    (messages) => ({
      toMessages: () => messages,
      snapshot: () => [],
    }),
  );

  assert.equal(registry.activeSessionId(), bundle.id);
  assert.equal(registry.requireActive().messages.length, 1);
  assert.equal(registry.requireActive().activeSession?.displayName, 'hello');
});

test('SessionRegistry resetActive clears conversation state', () => {
  const registry = new SessionRegistry();
  registry.ensureDraft('D:/SpiritAgent/repo');
  registry.resetActive('D:/SpiritAgent/repo');
  const bundle = registry.requireActive();
  assert.equal(bundle.messages.length, 0);
  assert.equal(bundle.activeSession, undefined);
});

test('SessionRegistry beginNewActive assigns a stable workspace provisional path', () => {
  const registry = new SessionRegistry();
  const workspaceRoot = 'D:/SpiritAgent/repo';
  const bundle = registry.beginNewActive(workspaceRoot);

  assert.equal(bundle.activeSession?.displayName, 'New conversation');
  assert.equal(
    path.resolve(bundle.activeSession?.filePath ?? ''),
    path.resolve(provisionalNewSessionPath(workspaceRoot)),
  );
  assert.equal(isProvisionalSessionPath(bundle.id), true);
});

test('SessionRegistry activateExisting sets active session id', () => {
  const registry = new SessionRegistry();
  const workspaceRoot = 'D:/SpiritAgent/repo';
  const first = registry.beginNewActive(workspaceRoot);
  first.messages.push({ id: 1, role: 'user', content: 'hello', pending: false });
  const sessionPath = path.resolve('D:/SpiritAgent/chats/chat-active.json');
  first.activeSession = {
    filePath: sessionPath,
    displayName: 'chat-active',
    kind: 'stored',
  };
  registry.rekeyBundle(first, sessionPath);

  const second = registry.beginNewActive(workspaceRoot);
  second.messages.push({ id: 1, role: 'user', content: 'other', pending: false });

  registry.activateExisting(first);
  assert.equal(registry.activeSessionId(), sessionPath);
  assert.equal(registry.getActive(), first);
});

test('SessionRegistry beginNewActive reuses the same provisional slot per workspace', () => {
  const registry = new SessionRegistry();
  const workspaceRoot = 'D:/SpiritAgent/repo';
  const first = registry.beginNewActive(workspaceRoot);
  const second = registry.beginNewActive(workspaceRoot);

  assert.equal(path.resolve(first.id), path.resolve(second.id));
  assert.equal(path.resolve(first.id), path.resolve(provisionalNewSessionPath(workspaceRoot)));
});

test('SessionRegistry rekeyBundle moves draft map entry to session file path', () => {
  const registry = new SessionRegistry();
  const bundle = registry.beginNewActive('D:/SpiritAgent/repo');
  const draftKey = bundle.id;
  const sessionPath = path.resolve('D:/SpiritAgent/chats/chat-rekey.json');
  bundle.activeSession = {
    filePath: sessionPath,
    displayName: 'live',
    kind: 'stored',
  };
  bundle.runtime = { isBusy: () => true };

  registry.rekeyBundle(bundle, sessionPath);

  assert.equal(registry.get(draftKey), undefined);
  assert.equal(registry.get(sessionPath), bundle);
  assert.equal(registry.findBySessionPath(sessionPath), bundle);
  assert.equal(registry.activeSessionId(), sessionPath);
});

test('SessionRegistry upsertFromRestored finds bundle after rekey and keeps runtime', () => {
  const registry = new SessionRegistry();
  const sessionPath = path.resolve('D:/SpiritAgent/chats/chat-runtime-keep.json');
  const bundle = registry.beginNewActive('D:/SpiritAgent/repo');
  bundle.activeSession = { filePath: sessionPath, displayName: 'keep', kind: 'stored' };
  bundle.messages.push({ id: 1, role: 'user', content: 'live', pending: false });
  bundle.runtime = { isBusy: () => true };
  registry.rekeyBundle(bundle, sessionPath);

  const stale = restoreStoredSessionState({
    filePath: sessionPath,
    loaded: buildV2StoredSession({ userContent: 'stale' }),
  });
  registry.upsertFromRestored(
    'D:/SpiritAgent/repo',
    stale,
    (messages) => ({
      toMessages: () => messages,
      snapshot: () => [],
    }),
  );

  assert.equal(registry.get(sessionPath)?.messages[0]?.content, 'live');
  assert.equal(registry.get(sessionPath)?.runtime?.isBusy(), true);
  assert.equal([...registry.all()].length, 1);
});

test('SessionRegistry upsertFromRestored does not clobber bundle with attached runtime', () => {
  const registry = new SessionRegistry();
  const filePath = 'D:/SpiritAgent/chats/session-live.json';
  const live = restoreStoredSessionState({
    filePath,
    loaded: buildV2StoredSession({ userContent: 'live turn' }),
  });
  const bundle = registry.upsertFromRestored(
    'D:/SpiritAgent/repo',
    live,
    (messages) => ({
      toMessages: () => messages,
      snapshot: () => [],
    }),
  );
  bundle.messages.push({
    id: 2,
    role: 'assistant',
    content: 'in-flight assistant chunk',
    pending: true,
  });
  bundle.runtime = { isBusy: () => true };

  const staleDisk = restoreStoredSessionState({
    filePath,
    loaded: buildV2StoredSession({ userContent: 'stale from disk' }),
  });
  registry.upsertFromRestored(
    'D:/SpiritAgent/repo',
    staleDisk,
    (messages) => ({
      toMessages: () => messages,
      snapshot: () => [{ turn: 1, segments: [] }],
    }),
  );

  const reloaded = registry.get(bundle.id);
  assert.ok(reloaded);
  assert.equal(reloaded.messages.length, 2);
  assert.equal(reloaded.messages[0].content, 'live turn');
  assert.equal(reloaded.messages[1].content, 'in-flight assistant chunk');
  assert.equal(registry.activeSessionId(), bundle.id);
});

test('SessionRegistry beginNewActive keeps prior bundle in memory', () => {
  const registry = new SessionRegistry();
  const filePath = 'D:/SpiritAgent/chats/session-a.json';
  const restored = restoreStoredSessionState({
    filePath,
    loaded: buildV2StoredSession({ userContent: 'keep me' }),
  });
  registry.upsertFromRestored(
    'D:/SpiritAgent/repo',
    restored,
    (messages) => ({
      toMessages: () => messages,
      snapshot: () => [],
    }),
  );

  const first = registry.requireActive();
  const second = registry.beginNewActive('D:/SpiritAgent/repo');
  assert.notEqual(second.id, first.id);
  assert.equal(registry.get(first.id)?.messages[0]?.content, 'keep me');
  assert.equal(registry.activeSessionId(), second.id);
});
