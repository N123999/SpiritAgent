import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getToolCallSummaryParts,
  toolHasExpandableContent,
} from '../../src/lib/tool-call-display.ts';
import { toolCallPhaseShowsShimmer } from '../../src/lib/tool-call-shimmer.ts';
import i18n from '../../src/lib/i18n.ts';

test('file diff tools are expandable during preview with streaming args only', () => {
  assert.equal(
    toolHasExpandableContent({
      toolName: 'create_file',
      phase: 'preview',
      headline: '创建',
      detailLines: [],
      streamingArgumentsJson: '{"path":"a.ts"}',
    }),
    true,
  );
});

test('toolHasExpandableContent: read_file is never expandable', () => {
  assert.equal(
    toolHasExpandableContent({
      toolName: 'read_file',
      phase: 'succeeded',
      headline: 'Read',
      headlineDetail: 'README.md',
      detailLines: ['line 1'],
      outputExcerpt: 'file body',
      argsExcerpt: '{"path":"README.md"}',
    }),
    false,
  );
});

test('getToolCallSummaryParts: shell prefixes reason and keeps command as detail', () => {
  assert.deepEqual(
    getToolCallSummaryParts({
      toolName: 'shell',
      phase: 'running',
      headline: '执行并发命令',
      headlineDetail: 'echo abc',
      detailLines: [],
    }),
    {
      headline: '运行 执行并发命令',
      shellSummary: { verb: '运行', reason: '执行并发命令' },
      detail: 'echo abc',
    },
  );
  assert.deepEqual(
    getToolCallSummaryParts({
      toolName: 'shell',
      phase: 'running',
      headline: i18n.t('tool.runCommand'),
      headlineDetail: 'npm install',
      detailLines: [],
    }),
    { headline: i18n.t('tool.runCommand'), detail: 'npm install' },
  );
});

test('toolCallPhaseShowsShimmer is active until terminal phases', () => {
  assert.equal(toolCallPhaseShowsShimmer('preview'), true);
  assert.equal(toolCallPhaseShowsShimmer('pending-approval'), true);
  assert.equal(toolCallPhaseShowsShimmer('running'), true);
  assert.equal(toolCallPhaseShowsShimmer('succeeded'), false);
  assert.equal(toolCallPhaseShowsShimmer('failed'), false);
});

test('getToolCallSummaryParts: legacy English "Viewing" headline parsed correctly', async () => {
  await i18n.changeLanguage('en');
  try {
    assert.deepEqual(
      getToolCallSummaryParts({
        toolName: 'read_file',
        phase: 'succeeded',
        headline: 'Viewing src/App.tsx',
        detailLines: [],
      }),
      { headline: 'Read', detail: 'src/App.tsx' },
    );
    assert.deepEqual(
      getToolCallSummaryParts({
        toolName: 'read_file',
        phase: 'running',
        headline: 'View src/App.tsx',
        detailLines: [],
      }),
      { headline: 'Reading', detail: 'src/App.tsx' },
    );
  } finally {
    await i18n.changeLanguage('zh-CN');
  }
});

test('getToolCallSummaryParts: dynamic re-translation on language switch', async () => {
  // Simulate a tool card created while Chinese was active (headline stored in Chinese)
  const tool = {
    toolName: 'create_file',
    phase: 'succeeded',
    headline: '创建', // stored by host while Chinese was active
    headlineDetail: 'App.tsx',
    detailLines: [],
  };

  // While still in Chinese, headline should remain Chinese
  assert.deepEqual(
    getToolCallSummaryParts(tool),
    { headline: '创建', detail: 'App.tsx' },
  );

  // Switch to English — same snapshot should now render in English
  await i18n.changeLanguage('en');
  try {
    assert.deepEqual(
      getToolCallSummaryParts(tool),
      { headline: 'Created', detail: 'App.tsx' },
    );
  } finally {
    await i18n.changeLanguage('zh-CN');
  }
});

test('getToolCallSummaryParts: grep detail re-translates on language switch', async () => {
  const tool = {
    toolName: 'grep',
    phase: 'succeeded',
    headline: 'Searched',
    headlineDetail: 'ratatui in apps/cli/**/*.{rs,toml}',
    argsExcerpt: JSON.stringify({
      query: 'ratatui',
      glob: 'apps/cli/**/*.{rs,toml}',
    }),
    detailLines: [],
  };

  await i18n.changeLanguage('en');
  try {
    assert.deepEqual(getToolCallSummaryParts(tool), {
      headline: 'Searched',
      detail: 'ratatui in apps/cli/**/*.{rs,toml}',
    });
  } finally {
    await i18n.changeLanguage('zh-CN');
  }

  assert.deepEqual(getToolCallSummaryParts(tool), {
    headline: '搜索',
    detail: 'ratatui 于 apps/cli/**/*.{rs,toml}',
  });
});

test('getToolCallSummaryParts: apply_patch headline re-translates across locales', async () => {
  const tool = {
    toolName: 'apply_patch',
    phase: 'running',
    headline: '编辑', // stored by host while Chinese was active
    headlineDetail: 'main.rs',
    detailLines: [],
  };

  await i18n.changeLanguage('en');
  try {
    assert.deepEqual(
      getToolCallSummaryParts(tool),
      { headline: 'Editing', detail: 'main.rs' },
    );
  } finally {
    await i18n.changeLanguage('zh-CN');
  }
});

test('getToolCallSummaryParts: shell default headline re-translates', async () => {
  // Host stored the Chinese default "运行命令" then user switched to English
  const tool = {
    toolName: 'shell',
    phase: 'succeeded',
    headline: '运行命令', // zh-CN default
    headlineDetail: 'ls -la',
    detailLines: [],
  };

  await i18n.changeLanguage('en');
  try {
    assert.deepEqual(
      getToolCallSummaryParts(tool),
      { headline: 'Ran command', detail: 'ls -la' },
    );
  } finally {
    await i18n.changeLanguage('zh-CN');
  }
});

test('getToolCallSummaryParts: read_file SKILL.md prefers frontmatter name from output', async () => {
  await i18n.changeLanguage('en');
  try {
    assert.deepEqual(
      getToolCallSummaryParts({
        toolName: 'read_file',
        phase: 'succeeded',
        headline: 'Used',
        headlineDetail: 'wrong-folder',
        argsExcerpt: '{"path":"skills/wrong-folder/SKILL.md"}',
        outputExcerpt: '---\nname: llm-debug\ndescription: Developer debug access\n---\n# Body',
        detailLines: [],
      }),
      { headline: 'Used', detail: 'llm-debug' },
    );
  } finally {
    await i18n.changeLanguage('zh-CN');
  }
});

test('getToolCallSummaryParts: read_file SKILL.md omits detail until frontmatter output is available', async () => {
  await i18n.changeLanguage('en');
  try {
    assert.deepEqual(
      getToolCallSummaryParts({
        toolName: 'read_file',
        phase: 'running',
        headline: '使用',
        headlineDetail: 'foo',
        argsExcerpt: '{"path":"skills/foo/SKILL.md"}',
        detailLines: [],
      }),
      { headline: 'Using' },
    );
    assert.deepEqual(
      getToolCallSummaryParts({
        toolName: 'read_file',
        phase: 'succeeded',
        headline: '使用',
        headlineDetail: 'git-commit',
        argsExcerpt: '{"path":"skills/git-commit/SKILL.md"}',
        detailLines: [],
      }),
      { headline: 'Used' },
    );
  } finally {
    await i18n.changeLanguage('zh-CN');
  }
});

test('getToolCallSummaryParts: read_file SKILL.md re-translates from stored Chinese headline', async () => {
  const tool = {
    toolName: 'read_file',
    phase: 'running',
    headline: '使用',
    headlineDetail: 'git-commit',
    detailLines: [],
  };

  await i18n.changeLanguage('en');
  try {
    assert.deepEqual(getToolCallSummaryParts(tool), {
      headline: 'Using',
      detail: 'git-commit',
    });
  } finally {
    await i18n.changeLanguage('zh-CN');
  }
});

test('getToolCallSummaryParts: read_file tool-output-archives uses tool output detail', async () => {
  await i18n.changeLanguage('en');
  try {
    assert.deepEqual(
      getToolCallSummaryParts({
        toolName: 'read_file',
        phase: 'succeeded',
        headline: 'Read',
        headlineDetail: 'call_1.txt',
        argsExcerpt: JSON.stringify({
          path: 'C:/Users/pc/AppData/Roaming/SpiritAgent/tool-output-archives/sess/call_1.txt',
          offset: 1,
          limit: 5,
        }),
        detailLines: [],
      }),
      { headline: 'Read', detail: 'tool output 1 - 5' },
    );
  } finally {
    await i18n.changeLanguage('zh-CN');
  }
});

test('getToolCallSummaryParts: legacy Chinese "查看" headline still parsed and re-translated', () => {
  assert.deepEqual(
    getToolCallSummaryParts({
      toolName: 'read_file',
      phase: 'succeeded',
      headline: '查看 src/App.tsx',
      detailLines: [],
    }),
    { headline: '读取', detail: 'src/App.tsx' },
  );
});

test('getToolCallSummaryParts: get_diagnostics failed uses checking headline not tool.failed passthrough', () => {
  assert.deepEqual(
    getToolCallSummaryParts({
      toolName: 'get_diagnostics',
      phase: 'failed',
      headline: '工具执行失败: get_diagnostics',
      headlineDetail: 'App.tsx',
      detailLines: [],
    }),
    { headline: '检查中', detail: 'App.tsx' },
  );
});

test('getToolCallSummaryParts: get_diagnostics sums issues across multiple files', () => {
  const output = [
    'No errors or warnings reported for src/a.ts.',
    '',
    'Diagnostics for src/b.ts (2 shown):',
    'error src/b.ts:1:1: Type mismatch',
    'warning src/b.ts:2:3: Unused variable',
    '',
    'Diagnostics for src/c.ts (3 shown, 1 more omitted):',
    'error src/c.ts:4:1: Missing return',
  ].join('\n');
  assert.deepEqual(
    getToolCallSummaryParts({
      toolName: 'get_diagnostics',
      phase: 'succeeded',
      headline: '检查完成',
      headlineDetail: 'a.ts +2',
      outputExcerpt: output,
      detailLines: [],
    }),
    { headline: '6 个问题', detail: 'a.ts +2' },
  );
});

test('getToolCallSummaryParts: get_diagnostics all-clean multi-file shows no issues', () => {
  const output = [
    'No errors or warnings reported for src/a.ts.',
    '',
    'No errors or warnings reported for src/b.ts.',
  ].join('\n');
  assert.deepEqual(
    getToolCallSummaryParts({
      toolName: 'get_diagnostics',
      phase: 'succeeded',
      headline: '检查完成',
      headlineDetail: 'a.ts, b.ts',
      outputExcerpt: output,
      detailLines: [],
    }),
    { headline: '没有问题', detail: 'a.ts, b.ts' },
  );
});

test('getToolCallSummaryParts: todo_write recomputes incremental detail from snapshot', () => {
  assert.deepEqual(
    getToolCallSummaryParts({
      toolName: 'todo_write',
      phase: 'succeeded',
      headline: '写入 TODO',
      headlineDetail: '完成 1 个',
      outputExcerpt: JSON.stringify({
        todos: [{ title: 'Inject haiku into main.rs', status: 'completed' }],
      }),
      todoWriteBeforeTodos: [{ title: 'Inject haiku into main.rs', status: 'pending' }],
      detailLines: [],
    }),
    { headline: '写入 TODO', detail: '完成 1 个' },
  );
});

test('getToolCallSummaryParts: todo_write keeps snapshot detail when before snapshot missing', () => {
  assert.deepEqual(
    getToolCallSummaryParts({
      toolName: 'todo_write',
      phase: 'succeeded',
      headline: '写入 TODO',
      headlineDetail: '完成 5 个',
      outputExcerpt: JSON.stringify({
        todos: [
          { title: '任务 01', status: 'completed' },
          { title: '任务 02', status: 'completed' },
          { title: '任务 03', status: 'completed' },
          { title: '任务 04', status: 'completed' },
          { title: '任务 05', status: 'completed' },
        ],
      }),
      detailLines: [],
    }),
    { headline: '写入 TODO', detail: '完成 5 个' },
  );
});

test('getToolCallSummaryParts: todo_write preview prefers snapshot over unreliable args recompute', () => {
  assert.deepEqual(
    getToolCallSummaryParts({
      toolName: 'todo_write',
      phase: 'preview',
      headline: '写入 TODO',
      headlineDetail: '完成 5 个',
      argsExcerpt: '{"todos":[{"title":"任务 01","status":"completed"',
      todoWriteBeforeTodos: [
        { title: '任务 01', status: 'pending' },
        { title: '任务 02', status: 'pending' },
        { title: '任务 03', status: 'pending' },
        { title: '任务 04', status: 'pending' },
        { title: '任务 05', status: 'pending' },
      ],
      detailLines: [],
    }),
    { headline: '写入 TODO', detail: '完成 5 个' },
  );
});

test('getToolCallSummaryParts: lazy gateway tools re-translate on language switch', async () => {
  const describeTool = {
    toolName: 'tool_describe',
    phase: 'succeeded',
    headline: '读取工具 schema',
    headlineDetail: 'mcp / microsoft-learn / microsoft_docs_search',
    detailLines: [],
  };
  const callTool = {
    toolName: 'tool_call',
    phase: 'running',
    headline: '调用工具',
    headlineDetail: 'mcp / microsoft-learn / microsoft_docs_search',
    detailLines: [],
  };

  assert.deepEqual(getToolCallSummaryParts(describeTool), {
    headline: '读取工具 schema',
    detail: 'mcp / microsoft-learn / microsoft_docs_search',
  });
  assert.deepEqual(getToolCallSummaryParts(callTool), {
    headline: '调用工具',
    detail: 'mcp / microsoft-learn / microsoft_docs_search',
  });

  await i18n.changeLanguage('en');
  try {
    assert.deepEqual(getToolCallSummaryParts(describeTool), {
      headline: 'Described tool schema',
      detail: 'mcp / microsoft-learn / microsoft_docs_search',
    });
    assert.deepEqual(getToolCallSummaryParts(callTool), {
      headline: 'Calling tool',
      detail: 'mcp / microsoft-learn / microsoft_docs_search',
    });
  } finally {
    await i18n.changeLanguage('zh-CN');
  }
});

test('getToolCallSummaryParts: shell verb uses tense in English', async () => {
  await i18n.changeLanguage('en');
  try {
    assert.deepEqual(
      getToolCallSummaryParts({
        toolName: 'shell',
        phase: 'running',
        headline: 'Install deps',
        headlineDetail: 'npm install',
        detailLines: [],
      }),
      {
        headline: 'Running Install deps',
        shellSummary: { verb: 'Running', reason: 'Install deps' },
        detail: 'npm install',
      },
    );
    assert.deepEqual(
      getToolCallSummaryParts({
        toolName: 'shell',
        phase: 'succeeded',
        headline: 'Install deps',
        headlineDetail: 'npm install',
        detailLines: [],
      }),
      {
        headline: 'Ran Install deps',
        shellSummary: { verb: 'Ran', reason: 'Install deps' },
        detail: 'npm install',
      },
    );
  } finally {
    await i18n.changeLanguage('zh-CN');
  }
});
