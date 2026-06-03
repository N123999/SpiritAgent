import assert from 'node:assert/strict';
import { test } from 'node:test';

import { isSubagentStatusSurfaceText } from '../../dist-electron/src/lib/subagent-display.js';
import {
  finishTaskNoticePreviewFromArguments,
  finishTaskSummaryFromStreamingArguments,
  shouldHideEmptyPendingAssistantSnapshot,
  stripRedundantThinkingFromMessageAux,
  toolCallSummaryCopyForRequest,
  toolCallSummaryForPhase,
} from '../../dist-electron/src/host/message-ordering.js';

test('toolCallSummaryCopyForRequest: write tools use verb headline + basename detail', () => {
  assert.deepEqual(
    toolCallSummaryCopyForRequest('edit_file', { path: 'D:/proj/src/foo.ts' }),
    { headline: '编辑', headlineDetail: 'foo.ts' },
  );
  assert.deepEqual(
    toolCallSummaryCopyForRequest('create_file', { path: 'notes/readme.md' }),
    { headline: '创建', headlineDetail: 'readme.md' },
  );
  assert.deepEqual(
    toolCallSummaryCopyForRequest('delete_file', { path: '/tmp/old.txt' }),
    { headline: '删除', headlineDetail: 'old.txt' },
  );
});

test('toolCallSummaryCopyForRequest: create_plan uses plan slug not tool name', () => {
  assert.deepEqual(
    toolCallSummaryCopyForRequest('create_plan', {
      name: 'create_plan',
      plan_name: 'multilingual-cat',
      content: '# Plan',
    }),
    { headline: '创建', headlineDetail: 'multilingual-cat.md' },
  );
  assert.deepEqual(
    toolCallSummaryCopyForRequest('create_plan', { name: 'demo-plan', content: '# Plan' }),
    { headline: '创建', headlineDetail: 'demo-plan.md' },
  );
});

test('toolCallSummaryCopyForRequest: apply_patch uses verb headline + basename detail', () => {
  assert.deepEqual(
    toolCallSummaryCopyForRequest('apply_patch', {
      operation: { type: 'update_file', path: 'README.md' },
    }),
    { headline: '编辑', headlineDetail: 'README.md' },
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
  assert.equal(isSubagentStatusSurfaceText('你是想让我：删除目录'), false);
  assert.equal(
    isSubagentStatusSurfaceText(
      '在 VS Code 里通常分为「暂存」「更改」「未跟踪」。你是想让我：\n* 删除目录',
    ),
    false,
  );
});

test('stripRedundantThinkingFromMessageAux removes duplicate or leaked reasoning', () => {
  assert.deepEqual(
    stripRedundantThinkingFromMessageAux('正文', { thinking: '正文' }),
    undefined,
  );
  assert.deepEqual(
    stripRedundantThinkingFromMessageAux('正文后半', { thinking: '正文' }),
    undefined,
  );
  assert.deepEqual(
    stripRedundantThinkingFromMessageAux('正文', { thinking: '独立推理' }),
    { thinking: '独立推理' },
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

test('shouldHideEmptyPendingAssistantSnapshot keeps live thinking rows visible', () => {
  const emptyPending = {
    id: 1,
    role: 'assistant',
    content: '',
    pending: true,
  };

  assert.equal(shouldHideEmptyPendingAssistantSnapshot(emptyPending), true);
  assert.equal(
    shouldHideEmptyPendingAssistantSnapshot(emptyPending, {
      kind: 'thinking',
      statusText: '| Thinking...',
    }),
    false,
  );
});

test('finishTaskNoticePreviewFromArguments streams partial summary text', () => {
  assert.equal(
    finishTaskSummaryFromStreamingArguments('{"summary":"确认每条'),
    '确认每条',
  );
  assert.equal(
    finishTaskNoticePreviewFromArguments('{"summary":"确认每条'),
    '任务以 确认每条',
  );
  assert.equal(
    finishTaskNoticePreviewFromArguments(
      '{"summary":"确认每条消息输出完毕后调用 finish_task。"}',
    ),
    '任务以 确认每条消息输出完毕后调用 finish_task。 完成。',
  );
});
