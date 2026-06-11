import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SKILL_FILE_NAME,
  isSkillMarkdownPath,
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
