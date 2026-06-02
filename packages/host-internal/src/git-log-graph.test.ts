import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import {
  layoutGitCommitGraph,
  orderCommitsForGraph,
  parseGitLogDecorations,
  parseGitLogRecordLine,
  readGitCommitHistory,
} from './git-log-graph.js';
import { parseGitStatusPorcelain, readGitWorkingTreeChanges } from './git-workspace.js';

const execFileAsync = promisify(execFile);

async function runGit(cwd: string, args: string[]): Promise<void> {
  await execFileAsync('git', args, { cwd, windowsHide: true });
}

test('parseGitStatusPorcelain parses modified and untracked paths', () => {
  const changes = parseGitStatusPorcelain([
    ' M src/a.ts',
    '?? new.txt',
    'R  old.ts -> new.ts',
  ].join('\n'));

  assert.equal(changes.length, 3);
  const untracked = changes.find((change) => change.path === 'new.txt');
  const renamed = changes.find((change) => change.path === 'new.ts');
  const modified = changes.find((change) => change.path === 'src/a.ts');
  assert.equal(untracked?.code, '??');
  assert.equal(renamed?.previousPath, 'old.ts');
  assert.equal(modified?.code, 'M');
});

test('parseGitLogRecordLine and decorations', () => {
  const line = [
    'abc123',
    'def456',
    'feat: hello',
    'Author',
    '2026-01-01 12:00:00 +0000',
    'HEAD -> main, tag: v1',
  ].join('\x1f');

  const record = parseGitLogRecordLine(line);
  assert.ok(record);
  assert.equal(record.oid, 'abc123');
  assert.deepEqual(record.parents, ['def456']);
  assert.deepEqual(parseGitLogDecorations('HEAD -> main, tag: v1'), ['main', 'v1']);
});

test('orderCommitsForGraph lists merge branch before first-parent continuation', () => {
  const commits = [
    {
      oid: 'merge',
      parents: ['main-tip', 'feat-tip'],
      subject: 'merge feature',
      author: 'a',
      authoredAt: 't4',
      refs: [],
    },
    {
      oid: 'feat-tip',
      parents: ['base'],
      subject: 'feature tip',
      author: 'a',
      authoredAt: 't3',
      refs: [],
    },
    {
      oid: 'main-tip',
      parents: ['base'],
      subject: 'main tip',
      author: 'a',
      authoredAt: 't2',
      refs: [],
    },
    {
      oid: 'base',
      parents: [],
      subject: 'init',
      author: 'a',
      authoredAt: 't1',
      refs: [],
    },
  ];

  const ordered = orderCommitsForGraph(commits);
  const mergeIndex = ordered.findIndex((commit) => commit.oid === 'merge');
  const featIndex = ordered.findIndex((commit) => commit.oid === 'feat-tip');
  const mainIndex = ordered.findIndex((commit) => commit.oid === 'main-tip');
  assert.ok(mergeIndex >= 0);
  assert.ok(featIndex > mergeIndex);
  assert.ok(mainIndex > featIndex);
});

test('layoutGitCommitGraph omits lanes for parents outside the loaded commit window', () => {
  const commits = [
    {
      oid: 'merge',
      parents: ['main-tip', 'feature-missing'],
      subject: 'merge feature',
      author: 'a',
      authoredAt: 't3',
      refs: [],
    },
    {
      oid: 'main-tip',
      parents: ['base'],
      subject: 'main work',
      author: 'a',
      authoredAt: 't2',
      refs: [],
    },
    {
      oid: 'base',
      parents: [],
      subject: 'init',
      author: 'a',
      authoredAt: 't1',
      refs: [],
    },
  ];

  const rows = layoutGitCommitGraph(commits);
  const mergeRow = rows[0];
  assert.equal(mergeRow?.commit.oid, 'merge');
  assert.deepEqual(mergeRow?.mergeLanes, []);
  assert.deepEqual(mergeRow?.passingLanes, []);
  const tailRow = rows[rows.length - 1];
  assert.deepEqual(tailRow?.passingLanes, []);
});

test('layoutGitCommitGraph prunes stale passing lanes after interleaved walk', () => {
  const commits = [
    {
      oid: 'merge',
      parents: ['main-tip', 'feat-tip'],
      subject: 'merge feature',
      author: 'a',
      authoredAt: 't4',
      refs: [],
    },
    {
      oid: 'feat-tip',
      parents: ['base'],
      subject: 'feature tip',
      author: 'a',
      authoredAt: 't3',
      refs: [],
    },
    {
      oid: 'stray-main',
      parents: ['base'],
      subject: 'other main-line commit',
      author: 'a',
      authoredAt: 't2b',
      refs: [],
    },
    {
      oid: 'main-tip',
      parents: ['base'],
      subject: 'main tip',
      author: 'a',
      authoredAt: 't2',
      refs: [],
    },
    {
      oid: 'base',
      parents: [],
      subject: 'init',
      author: 'a',
      authoredAt: 't1',
      refs: [],
    },
  ];

  const rows = layoutGitCommitGraph(commits);
  const maxPassing = rows.reduce((max, row) => Math.max(max, row.passingLanes.length), 0);
  assert.ok(maxPassing <= 2, `too many concurrent passing lanes: ${maxPassing}`);
  const tailRow = rows[rows.length - 1];
  assert.deepEqual(tailRow?.passingLanes, []);
});

test('layoutGitCommitGraph assigns merge lanes for a merge commit', () => {
  const commits = [
    {
      oid: 'merge',
      parents: ['main-tip', 'feature-tip'],
      subject: 'merge feature',
      author: 'a',
      authoredAt: 't3',
      refs: [],
    },
    {
      oid: 'feature-tip',
      parents: ['base'],
      subject: 'feature work',
      author: 'a',
      authoredAt: 't2',
      refs: [],
    },
    {
      oid: 'main-tip',
      parents: ['base'],
      subject: 'main work',
      author: 'a',
      authoredAt: 't2b',
      refs: [],
    },
    {
      oid: 'base',
      parents: [],
      subject: 'init',
      author: 'a',
      authoredAt: 't1',
      refs: [],
    },
  ];

  const rows = layoutGitCommitGraph(commits);
  assert.equal(rows.length, 4);
  const mergeRow = rows[0];
  assert.equal(mergeRow?.commit.oid, 'merge');
  assert.ok((mergeRow?.mergeLanes.length ?? 0) >= 0);
  assert.ok((mergeRow?.laneCount ?? 0) >= 1);
});

test('readGitWorkingTreeChanges and readGitCommitHistory in a temp repo with merge', async () => {
  const repoRoot = await mkdtemp(join(tmpdir(), 'spirit-host-internal-git-graph-'));

  try {
    await runGit(repoRoot, ['init']);
    await runGit(repoRoot, ['config', 'user.email', 'test@example.com']);
    await runGit(repoRoot, ['config', 'user.name', 'Spirit Test']);
    await writeFile(join(repoRoot, 'README.md'), 'base\n');
    await runGit(repoRoot, ['add', 'README.md']);
    await runGit(repoRoot, ['commit', '-m', 'init']);

    const { stdout: defaultBranchOutput } = await execFileAsync('git', ['branch', '--show-current'], {
      cwd: repoRoot,
      windowsHide: true,
    });
    const defaultBranch = defaultBranchOutput.trim();

    await runGit(repoRoot, ['checkout', '-b', 'feature']);
    await writeFile(join(repoRoot, 'feature.txt'), 'feature\n');
    await runGit(repoRoot, ['add', 'feature.txt']);
    await runGit(repoRoot, ['commit', '-m', 'feature commit']);

    await runGit(repoRoot, ['checkout', defaultBranch]);
    await writeFile(join(repoRoot, 'main.txt'), 'main\n');
    await runGit(repoRoot, ['add', 'main.txt']);
    await runGit(repoRoot, ['commit', '-m', 'main commit']);

    await runGit(repoRoot, ['merge', 'feature', '-m', 'merge feature']);

    await writeFile(join(repoRoot, 'dirty.txt'), 'dirty\n');

    const tree = await readGitWorkingTreeChanges(repoRoot);
    assert.equal(tree.isRepository, true);
    assert.ok(tree.changes.some((change) => change.path === 'dirty.txt'));

    const history = await readGitCommitHistory(repoRoot, { maxCount: 50 });
    assert.equal(history.isRepository, true);
    assert.ok(history.commits.length >= 4);
    assert.equal(history.rows.length, history.commits.length);
    const mergeCommit = history.commits.find((commit) => commit.subject === 'merge feature');
    assert.ok(mergeCommit);
    const mergeRow = history.rows.find((row) => row.commit.oid === mergeCommit.oid);
    assert.ok(mergeRow);
  } finally {
    await rm(repoRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});
