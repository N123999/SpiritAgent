import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildSubagentConversationSnapshots,
  resolveSubagentPromptFromTaskFields,
} from '@spirit-agent/host-internal';

test('buildSubagentConversationSnapshots maps user, assistant text, and tool results', () => {
  const messages = buildSubagentConversationSnapshots(
    [
      { role: 'user', content: 'Inspect the repo layout' },
      {
        role: 'assistant',
        content: 'I will read README first.',
        toolCalls: [
          {
            id: 'call_read_1',
            name: 'read_file',
            argumentsJson: '{"path":"README.md"}',
          },
        ],
      },
      {
        role: 'tool',
        toolCallId: 'call_read_1',
        content: '# Spirit Agent',
      },
      { role: 'assistant', content: 'README mentions Desktop host.' },
    ],
    { sessionStatus: 'completed' },
  );

  assert.equal(messages.length, 4);
  assert.equal(messages[0]?.role, 'user');
  assert.equal(messages[0]?.content, 'Inspect the repo layout');
  assert.equal(messages[1]?.role, 'assistant');
  assert.equal(messages[1]?.content, 'I will read README first.');
  assert.equal(messages[2]?.tool?.toolName, 'read_file');
  assert.equal(messages[2]?.tool?.phase, 'succeeded');
  assert.match(messages[2]?.tool?.outputExcerpt ?? '', /Spirit Agent/);
  assert.equal(messages[3]?.content, 'README mentions Desktop host.');
});

test('buildSubagentConversationSnapshots marks unresolved tools as running while session runs', () => {
  const messages = buildSubagentConversationSnapshots(
    [
      { role: 'user', content: 'Run shell check' },
      {
        role: 'assistant',
        content: '',
        toolCalls: [
          {
            id: 'call_shell_1',
            name: 'run_shell_command',
            argumentsJson: '{"command":"git status"}',
          },
        ],
      },
    ],
    { sessionStatus: 'running' },
  );

  assert.equal(messages.length, 2);
  assert.equal(messages[1]?.tool?.phase, 'running');
  assert.equal(messages[1]?.pending, true);
});

test('buildSubagentConversationSnapshots marks last unresolved tool as pending-approval when blocked', () => {
  const messages = buildSubagentConversationSnapshots(
    [
      { role: 'user', content: 'Delete temp file' },
      {
        role: 'assistant',
        content: '',
        toolCalls: [
          {
            id: 'call_delete_1',
            name: 'delete_file',
            argumentsJson: '{"path":"tmp.txt"}',
          },
        ],
      },
    ],
    { sessionStatus: 'blocked' },
  );

  assert.equal(messages[1]?.tool?.phase, 'pending-approval');
});

test('resolveSubagentPromptFromTaskFields prefers task then context summary', () => {
  assert.equal(
    resolveSubagentPromptFromTaskFields({
      task: '  Run tests  ',
      contextSummary: 'fallback',
      title: 'title',
    }),
    'Run tests',
  );
  assert.equal(
    resolveSubagentPromptFromTaskFields({
      contextSummary: 'Need grep',
      title: 'title',
    }),
    'Need grep',
  );
});
