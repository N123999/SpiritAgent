import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  hasAssistantToolLaterInTurn,
  shouldShowAssistantThinkingCollapsible,
  shouldStripThinkingAuxNearToolCard,
} from '../dist-electron/src/lib/conversation-thinking-ui.js';

test('shouldStripThinkingAuxNearToolCard removes MCP status near tool row', () => {
  const messages = [
    { id: 1, role: 'user', content: 'hi', pending: false },
    {
      id: 2,
      role: 'assistant',
      content: '',
      pending: false,
      aux: { thinking: 'MCP 工具执行中: MicrosoftLearn / microsoft_docs_search' },
    },
    {
      id: 3,
      role: 'assistant',
      content: '',
      pending: false,
      tool: {
        toolCallId: 't1',
        toolName: 'mcp__microsoftlearn__microsoft_docs_search__746c96b5',
        phase: 'running',
        headline: '调用中: mcp__microsoftlearn__microsoft_docs_search__746c96b5',
        detailLines: [],
      },
    },
  ];

  assert.equal(
    shouldStripThinkingAuxNearToolCard(messages[1], messages, 1),
    true,
  );
});

test('shouldShowAssistantThinkingCollapsible hides placeholder when tool follows', () => {
  const messages = [
    { id: 1, role: 'user', content: 'hi', pending: false },
    {
      id: 2,
      role: 'assistant',
      content: '',
      pending: true,
      aux: { thinking: 'real reasoning' },
    },
    {
      id: 3,
      role: 'assistant',
      content: '',
      pending: false,
      tool: {
        toolCallId: 't1',
        toolName: 'mcp__test',
        phase: 'succeeded',
        headline: '工具执行完成: mcp__test',
        detailLines: [],
      },
    },
  ];

  assert.equal(
    shouldShowAssistantThinkingCollapsible(messages[1], {
      kind: 'thinking',
      statusText: '| Thinking...',
    }, messages, 1),
    false,
  );
});

test('shouldShowAssistantThinkingCollapsible keeps substantive standalone thinking', () => {
  const messages = [
    { id: 1, role: 'user', content: 'hi', pending: false },
    {
      id: 2,
      role: 'assistant',
      content: '',
      pending: false,
      aux: { thinking: 'I will search Microsoft docs for Azure Functions.' },
    },
    {
      id: 3,
      role: 'assistant',
      content: '',
      pending: false,
      tool: {
        toolCallId: 't1',
        toolName: 'mcp__test',
        phase: 'succeeded',
        headline: '工具执行完成: mcp__test',
        detailLines: [],
      },
    },
  ];

  assert.equal(
    shouldShowAssistantThinkingCollapsible(messages[1], undefined, messages, 1),
    true,
  );
  assert.equal(hasAssistantToolLaterInTurn(messages, 1), true);
});
