import assert from 'node:assert/strict';
import test from 'node:test';

import {
  finishTaskNoticePreviewFromArguments,
  finishTaskStreamingPreviewReady,
  finishTaskSummaryFromStreamingArguments,
} from './finish-task-preview.js';

test('finishTaskStreamingPreviewReady accepts partial summary JSON', () => {
  assert.equal(finishTaskStreamingPreviewReady('finish_task', '{"summary":"确认'), true);
  assert.equal(finishTaskStreamingPreviewReady('finish_task', '{}'), false);
  assert.equal(finishTaskStreamingPreviewReady('read_file', '{"path":"/tmp/a"}'), false);
});

test('finishTaskSummaryFromStreamingArguments extracts partial summary', () => {
  assert.equal(
    finishTaskSummaryFromStreamingArguments('{"summary":"确认每条'),
    '确认每条',
  );
});

test('finishTaskNoticePreviewFromArguments builds streaming notice text', () => {
  assert.equal(
    finishTaskNoticePreviewFromArguments('{"summary":"确认每条'),
    '任务因 确认每条',
  );
  assert.equal(
    finishTaskNoticePreviewFromArguments('{"summary":"确认每条消息。"}'),
    '任务因 确认每条消息。 完成。',
  );
});
