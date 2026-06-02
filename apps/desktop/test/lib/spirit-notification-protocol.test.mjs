import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildNotificationApprovalProtocolUrl,
  findSpiritNotificationProtocolUrl,
  parseSpiritNotificationProtocolUrl,
} from '../../src/lib/spirit-notification-protocol.ts';

test('buildNotificationApprovalProtocolUrl encodes decision', () => {
  assert.equal(
    buildNotificationApprovalProtocolUrl('allow', 'spirit-approval'),
    'spirit-agent://notification-approval?decision=allow&tag=spirit-approval',
  );
});

test('parseSpiritNotificationProtocolUrl reads approval decision', () => {
  assert.deepEqual(
    parseSpiritNotificationProtocolUrl(
      'spirit-agent://notification-approval?decision=deny&tag=spirit-approval',
    ),
    { kind: 'approval', decision: 'deny' },
  );
});

test('findSpiritNotificationProtocolUrl scans argv', () => {
  assert.equal(
    findSpiritNotificationProtocolUrl([
      'electron.exe',
      'spirit-agent://notification-approval?decision=allow',
    ]),
    'spirit-agent://notification-approval?decision=allow',
  );
});
