import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

import {
  buildRipgrepArgs,
  formatGrepToolOutput,
  normalizeSearchLine,
  runRipgrepSearch,
} from './ripgrep-search.js';

const execFileAsync = promisify(execFile);

async function withTempWorkspace(run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'spirit-ripgrep-search-'));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function initGitRepo(root: string): Promise<void> {
  await execFileAsync('git', ['init'], { cwd: root, windowsHide: true });
}

test('buildRipgrepArgs maps text query to fixed-string case-insensitive search', () => {
  const args = buildRipgrepArgs({
    workspaceRoot: '/workspace',
    query: 'needle',
    isRegexp: false,
  });

  assert.deepEqual(args, [
    '--json',
    '--no-heading',
    '--color=never',
    '--line-number',
    '--max-filesize',
    '1M',
    '-g',
    '!**/.git/**',
    '--hidden',
    '-F',
    '-i',
    'needle',
    '/workspace',
  ]);
});

test('buildRipgrepArgs maps case-sensitive whole-word text search', () => {
  const args = buildRipgrepArgs({
    workspaceRoot: '/workspace',
    query: 'Needle',
    isRegexp: false,
    caseSensitive: true,
    wholeWord: true,
  });

  assert.deepEqual(args, [
    '--json',
    '--no-heading',
    '--color=never',
    '--line-number',
    '--max-filesize',
    '1M',
    '-g',
    '!**/.git/**',
    '--hidden',
    '-w',
    '-F',
    'Needle',
    '/workspace',
  ]);
});

test('buildRipgrepArgs maps regexp query without --hidden when glob is set', () => {
  const args = buildRipgrepArgs({
    workspaceRoot: 'C:\\repo',
    query: 'runtime\\s+parity',
    isRegexp: true,
    globPattern: 'src/**/*.ts',
  });

  assert.deepEqual(args, [
    '--json',
    '--no-heading',
    '--color=never',
    '--line-number',
    '--max-filesize',
    '1M',
    '-g',
    '!**/.git/**',
    '-g',
    'src/**/*.ts',
    '-i',
    '--regexp',
    'runtime\\s+parity',
    'C:\\repo',
  ]);
});

test('runRipgrepSearch parses submatch column ranges', async () => {
  await withTempWorkspace(async (root) => {
    await writeFile(join(root, 'alpha.txt'), 'foo NEEDLE bar\n', 'utf8');

    const matches = await runRipgrepSearch({
      workspaceRoot: root,
      query: 'NEEDLE',
      isRegexp: false,
      caseSensitive: true,
    });

    assert.equal(matches.length, 1);
    assert.ok(matches[0]?.submatches.length);
    assert.equal(matches[0]?.submatches[0]?.start, 4);
    assert.equal(matches[0]?.submatches[0]?.end, 10);
  });
});

test('runRipgrepSearch finds case-insensitive text matches', async () => {
  await withTempWorkspace(async (root) => {
    await writeFile(join(root, 'alpha.txt'), 'NEEDLE here\n', 'utf8');

    const matches = await runRipgrepSearch({
      workspaceRoot: root,
      query: 'needle',
      isRegexp: false,
    });

    assert.equal(matches.length, 1);
    assert.equal(matches[0]?.relativePath, 'alpha.txt');
    assert.equal(matches[0]?.lineNumber, 1);
    assert.equal(matches[0]?.lineText, 'NEEDLE here');
  });
});

test('runRipgrepSearch supports case-insensitive regular expressions', async () => {
  await withTempWorkspace(async (root) => {
    await writeFile(join(root, 'alpha.txt'), 'Runtime    parity\n', 'utf8');
    await writeFile(join(root, 'beta.txt'), 'no match here\n', 'utf8');

    const matches = await runRipgrepSearch({
      workspaceRoot: root,
      query: 'runtime\\s+parity',
      isRegexp: true,
    });

    assert.equal(matches.length, 1);
    assert.equal(matches[0]?.relativePath, 'alpha.txt');
    assert.match(matches[0]?.lineText ?? '', /Runtime\s+parity/u);
  });
});

test('runRipgrepSearch limits search to glob pattern', async () => {
  await withTempWorkspace(async (root) => {
    await mkdir(join(root, 'src'), { recursive: true });
    await mkdir(join(root, 'docs'), { recursive: true });
    await writeFile(join(root, 'src', 'app.ts'), 'needle here\n', 'utf8');
    await writeFile(join(root, 'docs', 'readme.md'), 'needle here\n', 'utf8');

    const matches = await runRipgrepSearch({
      workspaceRoot: root,
      query: 'needle',
      globPattern: 'src/**/*.ts',
    });

    assert.equal(matches.length, 1);
    assert.equal(matches[0]?.relativePath, 'src/app.ts');
  });
});

test('runRipgrepSearch returns no matches for missing query hits', async () => {
  await withTempWorkspace(async (root) => {
    await writeFile(join(root, 'alpha.txt'), 'nothing here\n', 'utf8');

    const matches = await runRipgrepSearch({
      workspaceRoot: root,
      query: 'needle',
    });

    assert.deepEqual(matches, []);
  });
});

test('runRipgrepSearch rejects invalid regular expressions', async () => {
  await withTempWorkspace(async (root) => {
    await writeFile(join(root, 'alpha.txt'), 'value\n', 'utf8');

    await assert.rejects(
      () =>
        runRipgrepSearch({
          workspaceRoot: root,
          query: '(',
          isRegexp: true,
        }),
      /无效正则/u,
    );
  });
});

test('runRipgrepSearch skips files matched by .gitignore', async () => {
  await withTempWorkspace(async (root) => {
    await initGitRepo(root);
    await writeFile(join(root, '.gitignore'), 'ignored.txt\n', 'utf8');
    await writeFile(join(root, 'ignored.txt'), 'needle here\n', 'utf8');
    await writeFile(join(root, 'tracked.txt'), 'needle here\n', 'utf8');

    const matches = await runRipgrepSearch({
      workspaceRoot: root,
      query: 'needle',
    });

    assert.equal(matches.length, 1);
    assert.equal(matches[0]?.relativePath, 'tracked.txt');
  });
});

test('runRipgrepSearch searches hidden directories in full-workspace mode', async () => {
  await withTempWorkspace(async (root) => {
    await mkdir(join(root, '.cursor'), { recursive: true });
    await writeFile(join(root, '.cursor', 'rules.md'), 'needle in hidden dir\n', 'utf8');

    const matches = await runRipgrepSearch({
      workspaceRoot: root,
      query: 'needle',
    });

    assert.equal(matches.length, 1);
    assert.equal(matches[0]?.relativePath, '.cursor/rules.md');
  });
});

test('runRipgrepSearch excludes .git directory at any path', async () => {
  await withTempWorkspace(async (root) => {
    await initGitRepo(root);
    await writeFile(join(root, 'tracked.txt'), 'needle in tracked file\n', 'utf8');
    await writeFile(join(root, '.git', 'spirit-test-needle'), 'needle in git dir\n', 'utf8');

    const matches = await runRipgrepSearch({
      workspaceRoot: root,
      query: 'needle',
    });

    assert.equal(matches.length, 1);
    assert.equal(matches[0]?.relativePath, 'tracked.txt');
  });
});

test('formatGrepToolOutput preserves grep tool summary shape', () => {
  const output = formatGrepToolOutput({
    query: 'needle',
    isRegexp: false,
    globPattern: 'src/**/*.ts',
    matches: [
      {
        relativePath: 'src/app.ts',
        lineNumber: 1,
        lineText: 'needle here',
        submatches: [{ start: 0, end: 6 }],
      },
    ],
  });

  assert.match(output, /^\[tool\] 搜索\(文本\): needle\n/u);
  assert.match(output, /glob: src\/\*\*\/\*\.ts/u);
  assert.match(output, /命中片段\nsrc\/app\.ts:1 \| needle here\n/u);
  assert.match(output, /涉及文件\nsrc\/app\.ts\n/u);
});

test('normalizeSearchLine strips trailing newline but keeps leading indent', () => {
  assert.equal(normalizeSearchLine('  needle here\n'), '  needle here');
});

test('runRipgrepSearch keeps submatch byte offsets aligned for indented CJK lines', async () => {
  await withTempWorkspace(async (root) => {
    await writeFile(
      join(root, 'sample.rs'),
      "    timeline.beginUserTurn('你好啊');\n",
      'utf8',
    );

    const matches = await runRipgrepSearch({
      workspaceRoot: root,
      query: '你好',
    });

    assert.equal(matches.length, 1);
    const match = matches[0]!;
    assert.ok(match.lineText.startsWith('    '));
    const submatch = match.submatches[0];
    assert.ok(submatch);
    const bytes = Buffer.from(match.lineText, 'utf8');
    assert.equal(bytes.subarray(submatch.start, submatch.end).toString('utf8'), '你好');
  });
});

test('runRipgrepSearch supports single-character text queries', async () => {
  await withTempWorkspace(async (root) => {
    await writeFile(join(root, 'alpha.txt'), 'alphabet\n', 'utf8');
    await writeFile(join(root, 'noise.bin'), Buffer.from([0x00, 0x61, 0x62, 0x00]));

    const matches = await runRipgrepSearch({
      workspaceRoot: root,
      query: 'a',
    });

    assert.equal(matches.length, 1);
    assert.equal(matches[0]?.relativePath, 'alpha.txt');
    assert.equal(matches[0]?.lineText, 'alphabet');
  });
});

test('formatGrepToolOutput reports empty results', () => {
  const output = formatGrepToolOutput({
    query: 'needle',
    isRegexp: true,
    globPattern: null,
    matches: [],
  });

  assert.equal(output, '[tool] 搜索(正则): needle\n未搜索到文件');
});
