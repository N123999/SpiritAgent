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

test('getToolCallSummaryParts: run_shell_command prefixes reason and keeps command as detail', () => {
  assert.deepEqual(
    getToolCallSummaryParts({
      toolName: 'run_shell_command',
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
      toolName: 'run_shell_command',
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
      { headline: 'Viewed', detail: 'src/App.tsx' },
    );
    assert.deepEqual(
      getToolCallSummaryParts({
        toolName: 'read_file',
        phase: 'running',
        headline: 'View src/App.tsx',
        detailLines: [],
      }),
      { headline: 'Viewing', detail: 'src/App.tsx' },
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

test('getToolCallSummaryParts: run_shell_command default headline re-translates', async () => {
  // Host stored the Chinese default "运行命令" then user switched to English
  const tool = {
    toolName: 'run_shell_command',
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

test('getToolCallSummaryParts: legacy Chinese "查看" headline still parsed', () => {
  assert.deepEqual(
    getToolCallSummaryParts({
      toolName: 'read_file',
      phase: 'succeeded',
      headline: '查看 src/App.tsx',
      detailLines: [],
    }),
    { headline: '查看', detail: 'src/App.tsx' },
  );
});

test('getToolCallSummaryParts: shell verb uses tense in English', async () => {
  await i18n.changeLanguage('en');
  try {
    assert.deepEqual(
      getToolCallSummaryParts({
        toolName: 'run_shell_command',
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
        toolName: 'run_shell_command',
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
