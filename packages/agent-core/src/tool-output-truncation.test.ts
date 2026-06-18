import assert from 'node:assert/strict';
import test from 'node:test';

import { createLlmMessageContentFromText, llmMessageTextContent } from './ports.js';
import {
  TOOL_OUTPUT_ARCHIVE_READ_FILE_GUIDANCE,
  TOOL_OUTPUT_TRUNCATION_LABEL,
  buildContextRetryExcerpt,
} from './tool-agent.js';
import { prepareToolOutputForAppend, prepareToolOutputTruncationForHistory } from './tool-output-truncation.js';

test('buildContextRetryExcerpt includes archive path guidance when provided', () => {
  const longText = 'line\n'.repeat(8_000);
  const excerpt = buildContextRetryExcerpt(longText, '/tmp/archive/call_1.txt');

  assert.ok(excerpt);
  assert.match(excerpt!, new RegExp(TOOL_OUTPUT_TRUNCATION_LABEL.replace(/[[\]]/g, '\\$&')));
  assert.match(excerpt!, /Full output archived at: \/tmp\/archive\/call_1\.txt/u);
  assert.match(excerpt!, new RegExp(TOOL_OUTPUT_ARCHIVE_READ_FILE_GUIDANCE.replace(/[[\]]/g, '\\$&')));
  assert.ok(excerpt!.length < longText.length);
});

test('prepareToolOutputTruncationForHistory persists full output and injects archive path', async () => {
  const longToolOutput = 'x'.repeat(20_000);
  let persistedContent = '';
  const history = [
    { role: 'user' as const, content: createLlmMessageContentFromText('hello') },
    {
      role: 'tool' as const,
      toolCallId: 'call_abc',
      content: createLlmMessageContentFromText(longToolOutput),
    },
  ];

  const prepared = await prepareToolOutputTruncationForHistory(history, {
    sessionId: 'sess-1',
    persistArchive: async ({ content }) => {
      persistedContent = content;
      return '/SpiritAgent/tool-output-archives/sess-1/call_abc.txt';
    },
  });

  assert.equal(prepared.changed, true);
  assert.equal(persistedContent, longToolOutput);
  const toolMessage = prepared.history[1];
  assert.ok(toolMessage);
  const toolText = llmMessageTextContent(toolMessage.content);
  assert.match(toolText, /Full output archived at: \/SpiritAgent\/tool-output-archives\/sess-1\/call_abc\.txt/u);
  assert.ok(toolText.length < longToolOutput.length);
});

test('prepareToolOutputForAppend persists and truncates large tool output on append', async () => {
  const longToolOutput = 'y'.repeat(20_000);
  let persistedContent = '';
  const prepared = await prepareToolOutputForAppend({
    content: longToolOutput,
    toolCallId: 'call_append_1',
    sessionId: 'session_1',
    persistArchive: async ({ content }) => {
      persistedContent = content;
      return '/tmp/archive/call_append_1.txt';
    },
  });

  assert.equal(persistedContent, longToolOutput);
  assert.match(prepared, /Full output archived at: \/tmp\/archive\/call_append_1\.txt/u);
  assert.match(prepared, new RegExp(TOOL_OUTPUT_TRUNCATION_LABEL.replace(/[[\]]/g, '\\$&')));
  assert.ok(prepared.length < longToolOutput.length);
});

test('prepareToolOutputForAppend leaves short tool output unchanged', async () => {
  const shortOutput = 'ok';
  const prepared = await prepareToolOutputForAppend({ content: shortOutput });
  assert.equal(prepared, shortOutput);
});

test('prepareToolOutputTruncationForHistory still truncates when archive persist fails', async () => {
  const longToolOutput = 'y'.repeat(20_000);
  const prepared = await prepareToolOutputTruncationForHistory(
    [{
      role: 'tool',
      toolCallId: 'call_fail',
      content: createLlmMessageContentFromText(longToolOutput),
    }],
    {
      persistArchive: async () => {
        throw new Error('disk full');
      },
    },
  );

  assert.equal(prepared.changed, true);
  const toolMessage = prepared.history[0];
  assert.ok(toolMessage);
  const toolText = llmMessageTextContent(toolMessage.content);
  assert.match(toolText, new RegExp(TOOL_OUTPUT_TRUNCATION_LABEL.replace(/[[\]]/g, '\\$&')));
  assert.doesNotMatch(toolText, /Full output archived at:/u);
});
