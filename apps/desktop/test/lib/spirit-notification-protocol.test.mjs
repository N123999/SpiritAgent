import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildNewSessionProtocolUrl,
  buildNotificationApprovalProtocolUrl,
  buildOpenSessionProtocolUrl,
  dispatchSpiritNotificationProtocolUrl,
  findSpiritNotificationProtocolUrl,
  handleSpiritNotificationProtocolArgv,
  parseSpiritNotificationProtocolUrl,
} from '../../src/lib/spirit-notification-protocol.ts';

test('buildNotificationApprovalProtocolUrl encodes decision', () => {
  assert.equal(
    buildNotificationApprovalProtocolUrl('allow', 'spirit-approval'),
    'spirit://notification-approval?decision=allow&tag=spirit-approval',
  );
});

test('parseSpiritNotificationProtocolUrl reads approval decision', () => {
  assert.deepEqual(
    parseSpiritNotificationProtocolUrl(
      'spirit://notification-approval?decision=deny&tag=spirit-approval',
    ),
    { kind: 'approval', decision: 'deny' },
  );
});

test('findSpiritNotificationProtocolUrl scans argv', () => {
  assert.equal(
    findSpiritNotificationProtocolUrl([
      'electron.exe',
      'spirit://notification-approval?decision=allow',
    ]),
    'spirit://notification-approval?decision=allow',
  );
});

test('buildNewSessionProtocolUrl returns stable host', () => {
  assert.equal(buildNewSessionProtocolUrl(), 'spirit://new-session');
});

test('buildOpenSessionProtocolUrl encodes session path', () => {
  assert.equal(
    buildOpenSessionProtocolUrl('C:\\Users\\me\\session.json'),
    'spirit://open-session?path=C%3A%5CUsers%5Cme%5Csession.json',
  );
});

test('parseSpiritNotificationProtocolUrl reads new-session', () => {
  assert.deepEqual(parseSpiritNotificationProtocolUrl('spirit://new-session'), {
    kind: 'new-session',
  });
});

test('parseSpiritNotificationProtocolUrl reads open-session path', () => {
  assert.deepEqual(
    parseSpiritNotificationProtocolUrl('spirit://open-session?path=C%3A%5Csessions%5Ca.json'),
    { kind: 'open-session', path: 'C:\\sessions\\a.json' },
  );
});

test('parseSpiritNotificationProtocolUrl rejects open-session without path', () => {
  assert.equal(parseSpiritNotificationProtocolUrl('spirit://open-session'), null);
  assert.equal(parseSpiritNotificationProtocolUrl('spirit://open-session?path='), null);
});

test('handleSpiritNotificationProtocolArgv returns false when open-session path is missing', () => {
  let focusCount = 0;
  const handlers = {
    onApproval: () => {},
    onFocus: () => {
      focusCount += 1;
    },
  };
  assert.equal(
    handleSpiritNotificationProtocolArgv(['spirit.exe', 'spirit://open-session'], handlers),
    false,
  );
  assert.equal(focusCount, 0);
});

test('handleSpiritNotificationProtocolArgv returns true when new-session dispatches', () => {
  let newSessionCount = 0;
  const handlers = {
    onApproval: () => {},
    onNewSession: () => {
      newSessionCount += 1;
    },
  };
  assert.equal(
    handleSpiritNotificationProtocolArgv(['spirit.exe', 'spirit://new-session'], handlers),
    true,
  );
  assert.equal(newSessionCount, 1);
});

test('dispatchSpiritNotificationProtocolUrl returns false without handlers', () => {
  assert.equal(dispatchSpiritNotificationProtocolUrl('spirit://new-session', undefined), false);
});
