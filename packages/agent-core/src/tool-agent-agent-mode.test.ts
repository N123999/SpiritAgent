import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildAgentModeSystemMessage,
  buildToolAgentMessages,
  hasAgentModeSystemMessage,
} from './tool-agent.js';

test('buildAgentModeSystemMessage: Agent mode guidance', () => {
  const message = buildAgentModeSystemMessage({ path: '', exists: false, planMode: false });
  assert.ok(message.includes('[SPIRIT_AGENT_MODE]'));
  assert.ok(message.includes('You are in Agent mode.'));
  assert.ok(message.includes('efficiently, professionally, and carefully'));
  assert.ok(!message.includes('Start implementing'));
});

test('buildAgentModeSystemMessage: Plan mode guidance', () => {
  const message = buildAgentModeSystemMessage({ path: '/plans/foo.md', exists: true, planMode: true });
  assert.ok(message.includes('You are in Plan mode.'));
  assert.ok(message.includes('create_plan'));
  assert.ok(message.includes('Start implementing'));
  assert.ok(message.includes('switch to Agent mode'));
});

test('buildAgentModeSystemMessage: defaults to Agent when planMetadata omitted', () => {
  const message = buildAgentModeSystemMessage();
  assert.ok(message.includes('You are in Agent mode.'));
});

test('buildToolAgentMessages embeds SPIRIT_AGENT_MODE in system message', () => {
  const messages = buildToolAgentMessages({
    historyMessages: [],
    model: 'test-model',
    planMetadata: { path: '', exists: false, planMode: true },
  });
  const system = messages[0];
  assert.equal(typeof system === 'object' && system !== null && !Array.isArray(system) ? system.role : '', 'system');
  const content =
    typeof system === 'object' && system !== null && !Array.isArray(system) && typeof system.content === 'string'
      ? system.content
      : '';
  assert.ok(hasAgentModeSystemMessage(content));
  assert.ok(content.includes('You are in Plan mode.'));
});
