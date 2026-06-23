import assert from 'node:assert/strict';
import test from 'node:test';

import {
  JUMP_LIST_RECENT_LIMIT,
  buildJumpListLaunchArgs,
  buildWindowsJumpListCategories,
  pickRecentSessionsForJumpList,
  truncateJumpListTitle,
} from '../../dist-electron/src/lib/windows-jump-list-build.js';

function session(path, displayName, modifiedAtUnixMs) {
  return {
    path,
    displayName,
    modifiedAtUnixMs,
    workspaceRoot: '/workspace',
  };
}

test('pickRecentSessionsForJumpList sorts by modifiedAt desc and caps at five', () => {
  const sessions = [
    session('a', 'A', 100),
    session('b', 'B', 300),
    session('c', 'C', 200),
    session('d', 'D', 500),
    session('e', 'E', 400),
    session('f', 'F', 600),
    session('g', 'G', 50),
  ];
  const picked = pickRecentSessionsForJumpList(sessions);
  assert.equal(picked.length, JUMP_LIST_RECENT_LIMIT);
  assert.deepEqual(
    picked.map((item) => item.path),
    ['f', 'd', 'e', 'b', 'c'],
  );
});

test('buildJumpListLaunchArgs uses protocol only when packaged', () => {
  assert.equal(buildJumpListLaunchArgs('spirit://new-session'), 'spirit://new-session');
});

test('buildJumpListLaunchArgs quotes dev main script and protocol url', () => {
  assert.equal(
    buildJumpListLaunchArgs('spirit://new-session', 'D:\\SpiritAgent\\apps\\desktop\\electron\\main.ts'),
    '"D:\\SpiritAgent\\apps\\desktop\\electron\\main.ts" "spirit://new-session"',
  );
});

test('buildWindowsJumpListCategories omits custom group when no sessions', () => {
  const categories = buildWindowsJumpListCategories({
    recentLabel: 'Recent',
    newAgentLabel: 'New Session',
    sessions: [],
    execPath: 'C:\\Spirit.exe',
    iconPath: 'C:\\Spirit.ico',
  });
  assert.equal(categories.length, 1);
  assert.equal(categories[0]?.type, 'tasks');
  assert.equal(categories[0]?.items[0]?.title, 'New Session');
  assert.equal(categories[0]?.items[0]?.args, 'spirit://new-session');
});

test('buildWindowsJumpListCategories builds recent custom group before tasks', () => {
  const categories = buildWindowsJumpListCategories({
    recentLabel: '最近',
    newAgentLabel: '新会话',
    sessions: [session('s1', 'Chat One', 10), session('s2', 'Chat Two', 20)],
    execPath: 'C:\\Spirit.exe',
    iconPath: 'C:\\Spirit.ico',
    devMainScript: 'C:\\main.ts',
  });
  assert.equal(categories.length, 2);
  assert.equal(categories[0]?.type, 'custom');
  assert.equal(categories[0]?.name, '最近');
  assert.equal(categories[0]?.items.length, 2);
  assert.match(categories[0]?.items[0]?.args ?? '', /"C:\\main.ts"/);
  assert.match(categories[0]?.items[0]?.args ?? '', /open-session/);
  assert.equal(categories[1]?.type, 'tasks');
  assert.equal(categories[1]?.items[0]?.title, '新会话');
});

test('truncateJumpListTitle shortens long display names', () => {
  const long = 'x'.repeat(300);
  const truncated = truncateJumpListTitle(long, 20);
  assert.equal(truncated.length, 20);
  assert.match(truncated, /…$/u);
});
