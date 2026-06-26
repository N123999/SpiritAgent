import assert from 'node:assert/strict';
import { test } from 'node:test';

import { isSubagentStatusSurfaceText } from '../../dist-electron/src/lib/subagent-display.js';
import {
  assistantTurnHasPlainPrefixMessage,
  finishTaskNoticePreviewFromArguments,
  finishTaskSummaryFromStreamingArguments,
  shouldHideEmptyPendingAssistantSnapshot,
  stripRedundantThinkingFromMessageAux,
  toolCallSummaryCopyForRequest,
  toolCallSummaryForPhase,
  toolCallSummaryForStreamingPreview,
} from '../../dist-electron/src/host/message-ordering.js';
import i18n from '../../dist-electron/src/lib/i18n-host.js';

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

test('toolCallSummaryCopyForRequest: create_automation uses title and trigger detail', () => {
  assert.deepEqual(
    toolCallSummaryCopyForRequest('create_automation', {
      title: 'CI check',
      overview: 'Summarize CI failures.',
      trigger: { kind: 'time', schedule: { kind: 'weekly', weekday: 1, hour: 9, minute: 0 } },
    }),
    { headline: '创建自动化', headlineDetail: 'CI check · Weekly Mon 09:00' },
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

test('toolCallSummaryCopyForRequest: web_search uses web search headline + query detail', () => {
  assert.deepEqual(toolCallSummaryCopyForRequest('web_search', { query: 'latest news' }), {
    headline: '联网搜索',
    headlineDetail: 'latest news',
  });
  assert.deepEqual(
    toolCallSummaryCopyForRequest('web_search', {
      action: { type: 'search', query: 'DeepSeek V4' },
    }),
    {
      headline: '联网搜索',
      headlineDetail: 'DeepSeek V4',
    },
  );
  assert.deepEqual(
    toolCallSummaryCopyForRequest('web_search', {
      action: { type: 'search', query: 'Web search' },
    }),
    {
      headline: '联网搜索',
    },
  );
});

test('toolCallSummaryCopyForRequest: search tools use Chinese headline + detail', () => {
  assert.deepEqual(toolCallSummaryCopyForRequest('grep', { query: 'TODO' }), {
    headline: '搜索',
    headlineDetail: 'TODO',
  });
  assert.deepEqual(
    toolCallSummaryCopyForRequest('grep', {
      query: 'ratatui',
      glob: 'apps/cli/**/*.{rs,toml}',
    }),
    {
      headline: '搜索',
      headlineDetail: 'ratatui 于 apps/cli/**/*.{rs,toml}',
    },
  );
  assert.deepEqual(toolCallSummaryCopyForRequest('glob', { pattern: 'src/**/*.ts' }), {
    headline: '匹配',
    headlineDetail: 'src/**/*.ts',
  });
  assert.deepEqual(toolCallSummaryCopyForRequest('web_fetch', { url: 'https://example.com/' }), {
    headline: '抓取',
    headlineDetail: 'https://example.com/',
  });
});

test('toolCallSummaryForPhase: lazyToolGateway execution request preserves MCP detail', () => {
  const lazyRequest = {
    kind: 'lazyToolGateway',
    name: 'tool_call',
    argumentsJson: JSON.stringify({
      provider: 'mcp',
      server: 'microsoft-learn',
      tool: 'microsoft_docs_search',
      arguments: { query: 'WinUI 3' },
    }),
  };
  assert.deepEqual(toolCallSummaryForPhase('running', 'tool_call', lazyRequest), {
    headline: '调用工具',
    headlineDetail: 'mcp / microsoft-learn / microsoft_docs_search',
  });
  assert.deepEqual(toolCallSummaryForPhase('succeeded', 'tool_describe', {
    kind: 'lazyToolGateway',
    name: 'tool_describe',
    argumentsJson: JSON.stringify({
      provider: 'mcp',
      server: 'microsoft-learn',
      tool: 'microsoft_docs_fetch',
    }),
  }), {
    headline: '读取工具 schema',
    headlineDetail: 'mcp / microsoft-learn / microsoft_docs_fetch',
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

test('toolCallSummaryCopyForRequest: todo_write shows incremental delta detail', () => {
  assert.deepEqual(
    toolCallSummaryCopyForRequest(
      'todo_write',
      {
        todos: [
          { title: 'Create index.html', status: 'pending' },
          { title: 'Verify page renders', status: 'pending' },
        ],
      },
      'succeeded',
      {
        todosBeforeWrite: [{ title: 'Old task', status: 'pending' }],
      },
    ),
    { headline: '写入 TODO', headlineDetail: '增加 2 个，移除 1 个' },
  );
  assert.deepEqual(
    toolCallSummaryCopyForRequest(
      'todo_write',
      { todos: [] },
      'succeeded',
      {
        todosBeforeWrite: [{ title: 'Only one item', status: 'pending' }],
      },
    ),
    { headline: '写入 TODO', headlineDetail: '移除 1 个' },
  );
});

test('toolCallSummaryForPhase: todo_write succeeded uses before snapshot and output', () => {
  assert.deepEqual(
    toolCallSummaryForPhase(
      'succeeded',
      'todo_write',
      { todos: [{ title: 'Draft', status: 'completed' }] },
      {
        executionOutput: JSON.stringify({
          todos: [{ title: 'Draft', status: 'completed' }],
        }),
        todosBeforeWrite: [{ title: 'Draft', status: 'pending' }],
      },
    ),
    { headline: '写入 TODO', headlineDetail: '完成 1 个' },
  );
});

test('toolCallSummaryForPhase: read_file splits headline and path detail', () => {
  assert.deepEqual(
    toolCallSummaryForPhase('succeeded', 'read_file', {
      path: 'D:/proj/src/App.tsx',
      offset: 1,
      limit: 50,
    }),
    { headline: '读取', headlineDetail: 'App.tsx 1 - 50' },
  );
});

test('toolCallSummaryForPhase: read_file tool-output-archives uses tool output detail', () => {
  assert.deepEqual(
    toolCallSummaryForPhase('succeeded', 'read_file', {
      path: 'C:/Users/pc/AppData/Roaming/SpiritAgent/tool-output-archives/sess/call_1.txt',
      offset: 1,
      limit: 5,
    }),
    { headline: '读取', headlineDetail: '工具输出 1 - 5' },
  );
});

test('toolCallSummaryCopyForRequest: shell reason and command', () => {
  assert.deepEqual(
    toolCallSummaryCopyForRequest('shell', {
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

test('shouldHideEmptyPendingAssistantSnapshot hides ghost row when tool follows', () => {
  const messages = [
    { id: 0, role: 'user', content: 'hi', pending: false },
    {
      id: 1,
      role: 'assistant',
      content: '',
      pending: true,
    },
    {
      id: 2,
      role: 'assistant',
      content: '',
      pending: false,
      tool: {
        toolCallId: 't1',
        toolName: 'glob',
        phase: 'running',
        headline: 'Listed',
        detailLines: [],
      },
    },
  ];

  assert.equal(
    shouldHideEmptyPendingAssistantSnapshot(
      messages[1],
      { kind: 'thinking', statusText: '| Thinking...' },
      messages,
      1,
    ),
    true,
  );
});

test('shouldHideEmptyPendingAssistantSnapshot keeps pending row between tool batches', () => {
  const messages = [
    { id: 0, role: 'user', content: 'hi', pending: false },
    {
      id: 1,
      role: 'assistant',
      content: '',
      pending: false,
      tool: {
        toolCallId: 't1',
        toolName: 'glob',
        phase: 'succeeded',
        headline: 'Listed',
        detailLines: [],
      },
    },
    {
      id: 2,
      role: 'assistant',
      content: '',
      pending: true,
    },
  ];

  assert.equal(
    shouldHideEmptyPendingAssistantSnapshot(
      messages[2],
      { kind: 'thinking', statusText: '| Thinking...' },
      messages,
      2,
    ),
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

test('toolCallSummaryCopyForRequest: Chinese verbs unchanged across phases', () => {
  const running = toolCallSummaryCopyForRequest('create_file', { path: 'a.ts' }, 'running');
  const succeeded = toolCallSummaryCopyForRequest('create_file', { path: 'a.ts' }, 'succeeded');
  assert.equal(running.headline, '创建');
  assert.equal(succeeded.headline, '创建');

  const viewRunning = toolCallSummaryForPhase('running', 'read_file', { path: 'b.ts' });
  const viewDone = toolCallSummaryForPhase('succeeded', 'read_file', { path: 'b.ts' });
  assert.equal(viewRunning.headline, '读取');
  assert.equal(viewDone.headline, '读取');
});

test('toolCallSummaryCopyForRequest: English verbs use progressive in running phase', async () => {
  await i18n.changeLanguage('en');
  try {
    assert.deepEqual(
      toolCallSummaryCopyForRequest('create_file', { path: 'a.ts' }, 'running'),
      { headline: 'Creating', headlineDetail: 'a.ts' },
    );
    assert.deepEqual(
      toolCallSummaryCopyForRequest('edit_file', { path: 'b.ts' }, 'running'),
      { headline: 'Editing', headlineDetail: 'b.ts' },
    );
    assert.deepEqual(
      toolCallSummaryCopyForRequest('delete_file', { path: 'c.ts' }, 'running'),
      { headline: 'Deleting', headlineDetail: 'c.ts' },
    );
    assert.deepEqual(
      toolCallSummaryCopyForRequest('list_directory_files', { path: 'src/' }, 'running'),
      { headline: 'Listing', headlineDetail: 'src/' },
    );
    assert.deepEqual(
      toolCallSummaryCopyForRequest('grep', { query: 'TODO' }, 'running'),
      { headline: 'Searching', headlineDetail: 'TODO' },
    );
    assert.deepEqual(
      toolCallSummaryCopyForRequest(
        'grep',
        { query: 'ratatui', glob: 'apps/cli/**/*.{rs,toml}' },
        'running',
      ),
      { headline: 'Searching', headlineDetail: 'ratatui in apps/cli/**/*.{rs,toml}' },
    );
  } finally {
    await i18n.changeLanguage('zh-CN');
  }
});

test('toolCallSummaryCopyForRequest: English verbs use past tense in succeeded phase', async () => {
  await i18n.changeLanguage('en');
  try {
    assert.deepEqual(
      toolCallSummaryCopyForRequest('create_file', { path: 'a.ts' }, 'succeeded'),
      { headline: 'Created', headlineDetail: 'a.ts' },
    );
    assert.deepEqual(
      toolCallSummaryCopyForRequest('edit_file', { path: 'b.ts' }, 'succeeded'),
      { headline: 'Edited', headlineDetail: 'b.ts' },
    );
    assert.deepEqual(
      toolCallSummaryCopyForRequest('list_directory_files', { path: 'src/' }, 'succeeded'),
      { headline: 'Listed', headlineDetail: 'src/' },
    );
  } finally {
    await i18n.changeLanguage('zh-CN');
  }
});

test('toolCallSummaryCopyForRequest: list_directory_files uses relative path within workspace', () => {
  const workspaceRoot = '/Users/yu/proj';
  assert.deepEqual(
    toolCallSummaryCopyForRequest(
      'list_directory_files',
      { path: '/Users/yu/proj/apps/cli' },
      'succeeded',
      { workspaceRoot },
    ),
    { headline: '列出', headlineDetail: 'apps/cli' },
  );
  assert.deepEqual(
    toolCallSummaryCopyForRequest(
      'list_directory_files',
      { path: '/Users/yu/proj' },
      'running',
      { workspaceRoot },
    ),
    { headline: '列出', headlineDetail: '.' },
  );
  assert.deepEqual(
    toolCallSummaryCopyForRequest(
      'list_directory_files',
      { path: '/tmp/foo' },
      'succeeded',
      { workspaceRoot },
    ),
    { headline: '列出', headlineDetail: '/tmp/foo' },
  );
  assert.deepEqual(
    toolCallSummaryCopyForRequest(
      'list_directory_files',
      { path: '/Users/yu/proj/apps/' },
      'succeeded',
      { workspaceRoot },
    ),
    { headline: '列出', headlineDetail: 'apps/' },
  );
});

test('toolCallSummaryForStreamingPreview: list_directory_files uses relative path within workspace', () => {
  const workspaceRoot = '/Users/yu/proj';
  assert.deepEqual(
    toolCallSummaryForStreamingPreview(
      [],
      'tool-1',
      'list_directory_files',
      { path: '/Users/yu/proj/apps' },
      { workspaceRoot },
    ),
    { headline: '列出', headlineDetail: 'apps' },
  );
});

test('toolCallSummaryForPhase: get_diagnostics failed uses checking headline and basename', () => {
  assert.deepEqual(
    toolCallSummaryForPhase('failed', 'get_diagnostics', { paths: ['src/App.tsx'] }),
    { headline: '检查中', headlineDetail: 'App.tsx' },
  );
});

test('toolCallSummaryForPhase: read_file SKILL.md uses frontmatter name when output is available', () => {
  const skillMarkdown = `---
name: llm-debug
description: Developer debug access
---
# Body
`;
  assert.deepEqual(
    toolCallSummaryForPhase('succeeded', 'read_file', {
      path: 'skills/wrong-folder/SKILL.md',
    }, { executionOutput: skillMarkdown }),
    { headline: '使用', headlineDetail: 'llm-debug' },
  );
});

test('toolCallSummaryForPhase: read_file SKILL.md omits detail without frontmatter output', async () => {
  assert.deepEqual(
    toolCallSummaryForPhase('succeeded', 'read_file', {
      path: 'skills/git-commit/SKILL.md',
    }),
    { headline: '使用' },
  );

  await i18n.changeLanguage('en');
  try {
    assert.deepEqual(
      toolCallSummaryForPhase('running', 'read_file', {
        path: 'skills/git-commit/SKILL.md',
      }),
      { headline: 'Using' },
    );
    assert.deepEqual(
      toolCallSummaryForPhase('succeeded', 'read_file', {
        path: 'skills/git-commit/SKILL.md',
      }),
      { headline: 'Used' },
    );
  } finally {
    await i18n.changeLanguage('zh-CN');
  }
});

test('toolCallSummaryForPhase: English read_file uses Read in succeeded phase', async () => {
  await i18n.changeLanguage('en');
  try {
    assert.deepEqual(
      toolCallSummaryForPhase('succeeded', 'read_file', { path: '/proj/src/App.tsx' }),
      { headline: 'Read', headlineDetail: 'App.tsx' },
    );
    assert.deepEqual(
      toolCallSummaryForPhase('running', 'read_file', { path: '/proj/src/App.tsx' }),
      { headline: 'Reading', headlineDetail: 'App.tsx' },
    );
  } finally {
    await i18n.changeLanguage('zh-CN');
  }
});

test('assistantTurnHasPlainPrefixMessage treats trailing whitespace as the same prefix', () => {
  const messages = [
    { id: 1, role: 'user', content: 'read README', pending: false },
    {
      id: 2,
      role: 'assistant',
      content: '好的。\n\n',
      pending: false,
    },
    {
      id: 3,
      role: 'assistant',
      content: '',
      tool: { toolCallId: 'call-1', toolName: 'read_file', phase: 'succeeded', headline: 'Read' },
      pending: false,
    },
    {
      id: 4,
      role: 'assistant',
      content: 'Spirit Agent 是一个开源 AI 编码代理单体仓库。',
      pending: false,
    },
  ];

  assert.equal(assistantTurnHasPlainPrefixMessage(messages, '好的。'), true);
  assert.equal(
    assistantTurnHasPlainPrefixMessage(messages, 'Spirit Agent 是一个开源 AI 编码代理单体仓库。'),
    true,
  );
  assert.equal(assistantTurnHasPlainPrefixMessage(messages, '可以，同样的 prompt，我来生成视频：'), false);
});
