import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  hasAssistantToolLaterInTurn,
  shouldShowAssistantThinkingCollapsible,
  shouldStripThinkingAuxNearToolCard,
} from '../dist-electron/src/lib/conversation-thinking-ui.js';

test('shouldShowAssistantThinkingCollapsible hides finalized Thought when live Thinking is adjacent', () => {
  const messages = [
    { id: 1, role: 'user', content: 'hi', pending: false },
    {
      id: 2,
      role: 'assistant',
      content: '',
      pending: false,
      tool: {
        toolCallId: 't1',
        toolName: 'read_file',
        phase: 'running',
        headline: 'read_file',
        detailLines: [],
      },
    },
    {
      id: 3,
      role: 'assistant',
      content: '',
      pending: false,
      aux: { thinking: 'Planning which lines to read.' },
    },
    {
      id: 4,
      role: 'assistant',
      content: '',
      pending: true,
      aux: { thinking: 'Reading the rest of the file now.' },
    },
  ];

  assert.equal(
    shouldShowAssistantThinkingCollapsible(messages[2], undefined, messages, 2),
    false,
  );
  assert.equal(
    shouldShowAssistantThinkingCollapsible(messages[3], undefined, messages, 3),
    true,
  );
});

test('shouldShowAssistantThinkingCollapsible keeps finalized Thought when a tool follows later in the turn', () => {
  const messages = [
    { id: 1, role: 'user', content: 'hi', pending: false },
    {
      id: 2,
      role: 'assistant',
      content: '',
      pending: false,
      aux: { thinking: 'Plan to read the file end first.' },
    },
    {
      id: 3,
      role: 'assistant',
      content: '先看看文件。',
      pending: false,
    },
    {
      id: 4,
      role: 'assistant',
      content: '',
      pending: false,
      tool: {
        toolCallId: 't1',
        toolName: 'read_file',
        phase: 'preview',
        headline: 'read_file',
        detailLines: [],
      },
    },
    {
      id: 5,
      role: 'assistant',
      content: '',
      pending: true,
      aux: { thinking: 'Reading the tail now.' },
    },
  ];

  assert.equal(
    shouldShowAssistantThinkingCollapsible(messages[1], undefined, messages, 1),
    true,
  );
});

test('shouldShowAssistantThinkingCollapsible keeps pre-tool Thought when tool is next row', () => {
  const messages = [
    { id: 1, role: 'user', content: 'hi', pending: false },
    {
      id: 2,
      role: 'assistant',
      content: '',
      pending: false,
      aux: { thinking: 'Plan to read the file silently.' },
    },
    {
      id: 3,
      role: 'assistant',
      content: '',
      pending: false,
      tool: {
        toolCallId: 't1',
        toolName: 'read_file',
        phase: 'running',
        headline: 'read_file',
        detailLines: [],
      },
    },
    {
      id: 4,
      role: 'assistant',
      content: '',
      pending: true,
      aux: { thinking: 'Finished reading.' },
    },
  ];

  assert.equal(
    shouldShowAssistantThinkingCollapsible(messages[1], undefined, messages, 1),
    true,
  );
  assert.equal(
    shouldShowAssistantThinkingCollapsible(messages[3], undefined, messages, 3),
    true,
  );
});

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

test('shouldShowAssistantThinkingCollapsible keeps substantive thinking when tool follows and row has body text', () => {
  const messages = [
    { id: 1, role: 'user', content: 'hi', pending: false },
    {
      id: 2,
      role: 'assistant',
      content: 'Let me read the referenced docs.',
      pending: false,
      aux: { thinking: 'I will read copilot-instructions and boundary docs in parallel.' },
    },
    {
      id: 3,
      role: 'assistant',
      content: '',
      pending: false,
      tool: {
        toolCallId: 't1',
        toolName: 'read_file',
        phase: 'running',
        headline: '调用中: read_file',
        detailLines: [],
      },
    },
  ];

  assert.equal(
    shouldShowAssistantThinkingCollapsible(messages[1], undefined, messages, 1),
    true,
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

test('shouldShowAssistantThinkingCollapsible keeps Thought visible when thinking + body share one row', () => {
  const messages = [
    { id: 1, role: 'user', content: 'hi', pending: false },
    {
      id: 2,
      role: 'assistant',
      content: 'Hello there',
      pending: false,
      aux: { thinking: 'Planning the reply.' },
    },
  ];

  assert.equal(
    shouldShowAssistantThinkingCollapsible(messages[1], undefined, messages, 1),
    true,
  );
});
