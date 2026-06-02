import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import {
  buildPlanSystemMessage,
  startOpenAiToolAgentState,
} from '@spirit-agent/agent-core';
import { createHostDreamStore } from '@spirit-agent/host-internal';

import {
  buildDreamCollectorPlanMetadata,
  buildDreamContextText,
} from '../../dist-electron/src/host/dreams.js';
import { spiritAgentDataDir } from '../../dist-electron/src/host/storage.js';
import { DesktopToolExecutor } from '../../dist-electron/src/host/tool-executor.js';

function functionToolNames(definitions) {
  return Array.isArray(definitions)
    ? definitions.flatMap((entry) => {
        if (!entry || typeof entry !== 'object') {
          return [];
        }
        const tool = entry.function;
        return tool && typeof tool === 'object' && typeof tool.name === 'string'
          ? [tool.name]
          : [];
      })
    : [];
}

test('desktop dreams context is injected into the main agent system message', async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'spirit-agent-dreams-'));
  const previousAppData = process.env.APPDATA;

  try {
    process.env.APPDATA = tempRoot;

    const dreamStore = createHostDreamStore({
      spiritDataDir: spiritAgentDataDir(),
      scope: {
        workspaceRoot: 'D:/SpiritAgent',
        gitBranch: 'main',
      },
    });

    await dreamStore.record({
      title: 'Route dream summaries into the main agent',
      summary: 'Reuse desktop dream summaries as system-message continuity for the primary agent.',
      details: 'Keep the summaries as background continuity rather than authoritative state.',
      tags: ['dreams', 'system-message'],
    });

    const dreamsContextText = await buildDreamContextText({
      workspaceRoot: 'D:/SpiritAgent',
      gitBranch: 'main',
    });

    assert.match(dreamsContextText, /1\. \[id=.*\] Route dream summaries into the main agent/);
    assert.match(dreamsContextText, /summary: Reuse desktop dream summaries as system-message continuity for the primary agent\./);
    assert.doesNotMatch(dreamsContextText, /details: Keep the summaries as background continuity rather than authoritative state\./);

    const state = startOpenAiToolAgentState(
      [],
      'Continue the desktop work.',
      process.cwd(),
      [],
      [],
      [],
      'gpt-5.4',
      undefined,
      [],
      dreamsContextText,
    );

    const systemMessage = state.messages[0]?.content;
    assert.equal(typeof systemMessage, 'string');
    assert.match(systemMessage, /\[SPIRIT_DREAMS\]/);
    assert.match(systemMessage, /Dream catalog/);
    assert.match(systemMessage, /Route dream summaries into the main agent/);
    assert.match(systemMessage, /dream_list/);
    assert.match(systemMessage, /dream_read/);
    assert.doesNotMatch(systemMessage, /Keep the summaries as background continuity rather than authoritative state\./);
  } finally {
    if (previousAppData === undefined) {
      delete process.env.APPDATA;
    } else {
      process.env.APPDATA = previousAppData;
    }
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('dream collector plan metadata is always normalized to agent mode', () => {
  const collectorPlanMetadata = buildDreamCollectorPlanMetadata({
    path: 'D:/SpiritAgent/plans/demo-plan.md',
    exists: true,
    planMode: true,
  });

  assert.equal(collectorPlanMetadata.planMode, false);

  const planSystemMessage = buildPlanSystemMessage(collectorPlanMetadata);
  assert.equal(planSystemMessage, undefined);
});

test('desktop runtime exposes Dreams as read-only tools', async () => {
  const toolExecutor = new DesktopToolExecutor(process.cwd(), {
    dreamScope: {
      workspaceRoot: 'D:/SpiritAgent',
      gitBranch: 'main',
    },
    dreamToolMode: 'read-only',
  });

  const toolNames = functionToolNames(toolExecutor.toolDefinitionsJson());
  assert.ok(toolNames.includes('dream_list'));
  assert.ok(toolNames.includes('dream_read'));
  assert.ok(!toolNames.includes('dream_record'));
  assert.ok(!toolNames.includes('dream_update'));
  assert.ok(!toolNames.includes('dream_delete'));

  await assert.rejects(
    () => toolExecutor.requestFromFunctionCall(
      'dream_record',
      JSON.stringify({ title: 'bad', summary: 'should not be writable' }),
    ),
    /read-only mode/,
  );
});