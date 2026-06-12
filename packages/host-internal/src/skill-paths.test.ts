import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SKILL_FILE_NAME,
  isSkillMarkdownPath,
  listDirectoryToolDisplayPath,
  readFileToolDisplayBase,
  skillFolderBasename,
} from './skill-paths.js';

test('isSkillMarkdownPath matches SKILL_FILE_NAME case-sensitively', () => {
  assert.equal(isSkillMarkdownPath('skills/git-commit/SKILL.md'), true);
  assert.equal(isSkillMarkdownPath('skills/git-commit/skill.md'), false);
  assert.equal(isSkillMarkdownPath('App.tsx'), false);
});

test('skillFolderBasename returns parent directory of SKILL.md', () => {
  assert.equal(skillFolderBasename('skills/git-commit/SKILL.md'), 'git-commit');
  assert.equal(skillFolderBasename(SKILL_FILE_NAME), SKILL_FILE_NAME);
});

test('listDirectoryToolDisplayPath relativizes paths within workspace root', () => {
  const root = '/Users/yu/SpiritAgent';
  assert.equal(
    listDirectoryToolDisplayPath('/Users/yu/SpiritAgent/apps', root, 'Directory'),
    'apps',
  );
  assert.equal(
    listDirectoryToolDisplayPath('/Users/yu/SpiritAgent/apps/', root, 'Directory'),
    'apps/',
  );
  assert.equal(
    listDirectoryToolDisplayPath('/Users/yu/SpiritAgent/apps/cli/src', root, 'Directory'),
    'apps/cli/src',
  );
  assert.equal(listDirectoryToolDisplayPath('/Users/yu/SpiritAgent', root, 'Directory'), '.');
  assert.equal(listDirectoryToolDisplayPath('/Users/yu/SpiritAgent/', root, 'Directory'), '.');
});

test('listDirectoryToolDisplayPath keeps absolute paths outside workspace', () => {
  const root = '/Users/yu/SpiritAgent';
  assert.equal(
    listDirectoryToolDisplayPath('/tmp/foo', root, 'Directory'),
    '/tmp/foo',
  );
  assert.equal(listDirectoryToolDisplayPath('', root, 'Directory'), 'Directory');
});

test('listDirectoryToolDisplayPath without workspace root keeps absolute path', () => {
  assert.equal(
    listDirectoryToolDisplayPath('/Users/yu/SpiritAgent/apps', undefined, 'Directory'),
    '/Users/yu/SpiritAgent/apps',
  );
});

test('listDirectoryToolDisplayPath normalizes Windows-style paths', () => {
  assert.equal(
    listDirectoryToolDisplayPath('D:\\proj\\apps', 'D:\\proj', 'Directory'),
    'apps',
  );
});

test('readFileToolDisplayBase uses skill folder for SKILL.md paths', () => {
  assert.equal(
    readFileToolDisplayBase('skills/foo/SKILL.md', 'File'),
    'foo',
  );
  assert.equal(
    readFileToolDisplayBase('/proj/src/App.tsx', 'File'),
    'App.tsx',
  );
  assert.equal(readFileToolDisplayBase('src/App.tsx', 'File'), 'src/App.tsx');
});
