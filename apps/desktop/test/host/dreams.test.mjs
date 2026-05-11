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

    assert.match(dreamsContextText, /1\. Route dream summaries into the main agent/);
    assert.match(dreamsContextText, /summary: Reuse desktop dream summaries as system-message continuity for the primary agent\./);

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
    assert.match(systemMessage, /Dream summaries/);
    assert.match(systemMessage, /Route dream summaries into the main agent/);
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
    path: 'D:/SpiritAgent/PLAN.md',
    exists: true,
    planMode: true,
    planModeHostInstructions: '确定此方案后，请输入"/start-implementing" 或手动切换至 Agent 模式后要求开始实现。',
  });

  assert.equal(collectorPlanMetadata.planMode, false);
  assert.equal(collectorPlanMetadata.planModeHostInstructions, undefined);

  const planSystemMessage = buildPlanSystemMessage(collectorPlanMetadata);
  assert.equal(typeof planSystemMessage, 'string');
  assert.match(planSystemMessage, /<plan path="D:\/SpiritAgent\/PLAN\.md" \/>/);
  assert.doesNotMatch(planSystemMessage, /start-implementing/);
  assert.doesNotMatch(planSystemMessage, /Agent 模式/);
});