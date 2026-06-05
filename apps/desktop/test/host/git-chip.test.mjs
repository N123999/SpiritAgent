import assert from 'node:assert/strict';
import test from 'node:test';

import { gitChipActionToSkillName } from '../../src/host/builtin-skills.ts';

test('gitChipActionToSkillName maps host actions to builtin skills', () => {
  assert.equal(gitChipActionToSkillName('commit'), 'git-commit');
  assert.equal(gitChipActionToSkillName('push'), 'git-push');
  assert.equal(gitChipActionToSkillName('merge'), 'git-merge');
});
