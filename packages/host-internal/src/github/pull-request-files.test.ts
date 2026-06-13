import test from 'node:test';
import assert from 'node:assert/strict';

import { mapPullRequestChangedFile, mapPullRequestChangedFiles } from './pull-request-files.js';
import { githubHasNextPage } from './github-api.js';

test('mapPullRequestChangedFile maps GitHub API payload', () => {
  const file = mapPullRequestChangedFile({
    filename: 'src/auth/session.ts',
    status: 'modified',
    additions: 2,
    deletions: 1,
    changes: 3,
    patch: '@@ -10,3 +10,4 @@\n context\n-old\n+new',
    blob_url: 'https://github.com/octocat/Hello-World/blob/abc/src/auth/session.ts',
    raw_url: 'https://raw.githubusercontent.com/octocat/Hello-World/abc/src/auth/session.ts',
  });

  assert.deepEqual(file, {
    filename: 'src/auth/session.ts',
    status: 'modified',
    additions: 2,
    deletions: 1,
    changes: 3,
    patch: '@@ -10,3 +10,4 @@\n context\n-old\n+new',
    blobUrl: 'https://github.com/octocat/Hello-World/blob/abc/src/auth/session.ts',
    rawUrl: 'https://raw.githubusercontent.com/octocat/Hello-World/abc/src/auth/session.ts',
  });
});

test('mapPullRequestChangedFile maps renamed file with previous filename', () => {
  const file = mapPullRequestChangedFile({
    filename: 'src/new-name.ts',
    status: 'renamed',
    previous_filename: 'src/old-name.ts',
    additions: 0,
    deletions: 0,
    changes: 0,
  });

  assert.equal(file?.status, 'renamed');
  assert.equal(file?.previousFilename, 'src/old-name.ts');
});

test('mapPullRequestChangedFile omits empty patch', () => {
  const file = mapPullRequestChangedFile({
    filename: 'assets/logo.png',
    status: 'added',
    additions: 0,
    deletions: 0,
    changes: 0,
    patch: '   ',
  });

  assert.equal(file?.filename, 'assets/logo.png');
  assert.equal('patch' in (file ?? {}), false);
});

test('mapPullRequestChangedFiles skips invalid entries', () => {
  const files = mapPullRequestChangedFiles([
    { filename: 'valid.ts', status: 'modified', additions: 1, deletions: 0, changes: 1 },
    { filename: '  ', status: 'added', additions: 1, deletions: 0, changes: 1 },
  ]);

  assert.equal(files.length, 1);
  assert.equal(files[0]?.filename, 'valid.ts');
});

test('githubHasNextPage detects next page link header', () => {
  const withNext = new Response(null, {
    headers: {
      link: '<https://api.github.com/repos/o/r/pulls/1/files?page=2>; rel="next", <https://api.github.com/repos/o/r/pulls/1/files?page=5>; rel="last"',
    },
  });
  const withoutNext = new Response(null, {
    headers: {
      link: '<https://api.github.com/repos/o/r/pulls/1/files?page=1>; rel="prev", <https://api.github.com/repos/o/r/pulls/1/files?page=3>; rel="last"',
    },
  });

  assert.equal(githubHasNextPage(withNext), true);
  assert.equal(githubHasNextPage(withoutNext), false);
});
