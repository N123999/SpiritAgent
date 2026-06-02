import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildWindowsToastXml,
  escapeToastXml,
  parseWindowsToastActivation,
  resolveNotificationActionIndex,
  shouldUseWindowsToastXml,
} from '../../src/lib/windows-toast-xml.ts';

test('escapeToastXml escapes reserved characters', () => {
  assert.equal(escapeToastXml(`a&b<c>d"e`), 'a&amp;b&lt;c&gt;d&quot;e');
});

test('buildWindowsToastXml includes foreground action buttons', () => {
  const xml = buildWindowsToastXml({
    title: '[Session] Pending',
    body: 'line one\nline two',
    tag: 'spirit-approval',
    actions: [
      { type: 'button', text: 'Allow' },
      { type: 'button', text: 'Deny' },
    ],
  });
  assert.match(xml, /<action content="Allow"/);
  assert.match(xml, /spirit-agent:\/\/notification-approval\?decision=allow/);
  assert.match(xml, /<action content="Deny"/);
  assert.match(xml, /spirit-agent:\/\/notification-approval\?decision=deny/);
  assert.match(xml, /activationType="protocol"/);
});

test('shouldUseWindowsToastXml when actions present', () => {
  assert.equal(shouldUseWindowsToastXml({ title: 't', actions: [{ type: 'button', text: 'OK' }] }), true);
  assert.equal(shouldUseWindowsToastXml({ title: 't' }), false);
});

test('parseWindowsToastActivation reads action index from activation details', () => {
  assert.deepEqual(
    parseWindowsToastActivation({ type: 'action', actionIndex: 0 }),
    { kind: 'action', actionIndex: 0 },
  );
});

test('parseWindowsToastActivation reads action index from arguments', () => {
  assert.deepEqual(
    parseWindowsToastActivation({
      type: 'click',
      arguments: 'type=action&actionIndex=1',
    }),
    { kind: 'action', actionIndex: 1 },
  );
});

test('resolveNotificationActionIndex prefers event.actionIndex', () => {
  assert.equal(resolveNotificationActionIndex({ actionIndex: 0 }, 1), 0);
  assert.equal(resolveNotificationActionIndex({}, 1), 1);
});
