import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildLoopModeSystemMessage,
  buildToolAgentMessages,
  hasLoopModeSystemMessage,
} from './tool-agent.js';

test('buildLoopModeSystemMessage returns undefined when Loop is off', () => {
  assert.equal(buildLoopModeSystemMessage(false), undefined);
  assert.equal(buildLoopModeSystemMessage(undefined), undefined);
});

test('buildLoopModeSystemMessage embeds loop_mode guidance when Loop is on', () => {
  const message = buildLoopModeSystemMessage(true);
  assert.ok(message?.includes('<loop_mode>'));
  assert.ok(message?.includes('Loop mode is enabled.'));
  assert.ok(message?.includes('Do not end the conversation until you are confident'));
  assert.ok(message?.includes('Ordinary assistant replies do not stop the loop'));
  assert.ok(message?.includes('Call `finish_task` only when no further work is needed.'));
});

test('buildToolAgentMessages omits loop_mode when Loop is off', () => {
  const messages = buildToolAgentMessages({
    historyMessages: [],
    model: 'test-model',
    loopEnabled: false,
  });
  const content = readSystemContent(messages[0]);
  assert.ok(!hasLoopModeSystemMessage(content));
});

test('buildToolAgentMessages embeds loop_mode when Loop is on', () => {
  const messages = buildToolAgentMessages({
    historyMessages: [],
    model: 'test-model',
    loopEnabled: true,
  });
  const content = readSystemContent(messages[0]);
  assert.ok(hasLoopModeSystemMessage(content));
  assert.ok(content.includes('Call `finish_task` only when no further work is needed.'));
});

function readSystemContent(message: unknown): string {
  if (typeof message !== 'object' || message === null || Array.isArray(message)) {
    return '';
  }
  const content = (message as { content?: unknown }).content;
  return typeof content === 'string' ? content : '';
}
