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
