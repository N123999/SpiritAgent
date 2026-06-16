import assert from 'node:assert/strict';
import test from 'node:test';

import {
  patchBasicInfoWorkspaceRootInMessages,
  patchBasicInfoWorkspaceRootInSystemText,
} from './tool-agent.js';

test('patchBasicInfoWorkspaceRootInMessages rewrites Current workspace line', () => {
  const messages = [
    {
      role: 'system',
      content: [
        '[SPIRIT_BASIC_INFO]',
        'Basic information',
        '',
        'Current workspace:',
        '- D:\\\\SpiritAgent',
        '',
        'Current terminal:',
        '- powershell',
      ].join('\n'),
    },
  ];

  const patched = patchBasicInfoWorkspaceRootInMessages(
    messages,
    'D:\\SpiritAgent.worktrees\\spirit-read-readme',
  );

  assert.match(
    String((patched[0] as { content: string }).content),
    /Current workspace:\n- D:\\SpiritAgent\.worktrees\\spirit-read-readme/,
  );
});

test('patchBasicInfoWorkspaceRootInSystemText handles CRLF workspace lines', () => {
  const content = [
    '[SPIRIT_BASIC_INFO]',
    'Basic information',
    '',
    'Current workspace:',
    '- D:\\SpiritAgent',
  ].join('\r\n');
  const patched = patchBasicInfoWorkspaceRootInSystemText(
    content,
    'D:\\SpiritAgent.worktrees\\spirit-read-readme',
  );
  assert.match(patched, /Current workspace:\r?\n- D:\\SpiritAgent\.worktrees\\spirit-read-readme/);
});
