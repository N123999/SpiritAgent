import assert from 'node:assert/strict';
import { test } from 'node:test';

import { isSubagentStatusSurfaceText } from '../../dist-electron/src/lib/subagent-display.js';
import {
  toolCallSummaryCopyForRequest,
  toolCallSummaryForPhase,
} from '../../dist-electron/src/host/message-ordering.js';

test('toolCallSummaryCopyForRequest: write tools use basename', () => {
  assert.deepEqual(
    toolCallSummaryCopyForRequest('edit_file', { path: 'D:/proj/src/foo.ts' }),
    { headline: '编辑 foo.ts' },
  );
  assert.deepEqual(
    toolCallSummaryCopyForRequest('create_file', { path: 'notes/readme.md' }),
    { headline: '创建 readme.md' },
  );
  assert.deepEqual(
    toolCallSummaryCopyForRequest('delete_file', { path: '/tmp/old.txt' }),
    { headline: '删除 old.txt' },
  );
});

test('toolCallSummaryCopyForRequest: search tools use Chinese headline + detail', () => {
  assert.deepEqual(toolCallSummaryCopyForRequest('grep', { query: 'TODO' }), {
    headline: '搜索',
    headlineDetail: 'TODO',
  });
  assert.deepEqual(toolCallSummaryCopyForRequest('glob', { pattern: 'src/**/*.ts' }), {
    headline: '匹配',
    headlineDetail: 'src/**/*.ts',
  });
  assert.deepEqual(toolCallSummaryCopyForRequest('web_fetch', { url: 'https://example.com/' }), {
    headline: '抓取',
    headlineDetail: 'https://example.com/',
  });
});

test('isSubagentStatusSurfaceText detects runtime status lines', () => {
  assert.equal(
    isSubagentStatusSurfaceText('输出 "Spirit 牛逼" 这句话，不要做任何其他事情。: 运行中'),
    true,
  );
  assert.equal(
    isSubagentStatusSurfaceText('请输出"Spirit 牛逼"这句话。: The'),
    true,
  );
  assert.equal(
    isSubagentStatusSurfaceText('请输出"Spirit 牛逼"这句话。: Sp'),
    true,
  );
  assert.equal(
    isSubagentStatusSurfaceText(
      '输出 "Spirit 牛逼" 这句话。: The user wants me to output "Spirit 牛逼" — that\'s all.',
    ),
    true,
  );
  assert.equal(isSubagentStatusSurfaceText('Spirit 牛逼'), false);
  assert.equal(
    isSubagentStatusSurfaceText('子智能体已完成，输出如下：**Spirit 牛逼**'),
    false,
  );
  assert.equal(
    isSubagentStatusSurfaceText('子智能体已完成，输出如下：\n\n**Spirit 牛逼**'),
    false,
  );
  assert.equal(
    isSubagentStatusSurfaceText('好的，又来一遍 :) 有什么需要我接着搞的？'),
    false,
  );
});

test('toolCallSummaryCopyForRequest: ask_questions and subagent', () => {
  assert.deepEqual(
    toolCallSummaryCopyForRequest('ask_questions', {
      questions: [{ id: 'q1' }, { id: 'q2' }],
    }),
    { headline: '询问', headlineDetail: '2 个问题' },
  );
  assert.deepEqual(toolCallSummaryCopyForRequest('run_subagent', { task: 'Review auth module' }), {
    headline: '子智能体',
    headlineDetail: 'Review auth module',
  });
});

test('toolCallSummaryForPhase: read_file splits headline and path detail', () => {
  assert.deepEqual(
    toolCallSummaryForPhase('succeeded', 'read_file', {
      path: 'D:/proj/src/App.tsx',
      start_line: 1,
      end_line: 50,
    }),
    { headline: '查看', headlineDetail: 'App.tsx 1 - 50' },
  );
});

test('toolCallSummaryCopyForRequest: shell reason and command', () => {
  assert.deepEqual(
    toolCallSummaryCopyForRequest('run_shell_command', {
      reason: 'Install dependencies',
      command: 'npm install',
    }),
    { headline: 'Install dependencies', headlineDetail: 'npm install' },
  );
});
