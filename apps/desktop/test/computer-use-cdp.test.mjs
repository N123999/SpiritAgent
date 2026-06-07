import assert from 'node:assert/strict';
import test from 'node:test';

import { listCdpTargets } from '../electron/win-computer-use-cdp.ts';

test('listCdpTargets connects when localhost debug port is open', { skip: process.platform !== 'win32' }, async () => {
  let targets;
  try {
    targets = await listCdpTargets(9222);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('cdp_unreachable')) {
      test.skip('No process listening on localhost:9222');
      return;
    }
    throw error;
  }
  assert.ok(Array.isArray(targets));
});
