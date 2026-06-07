import assert from 'node:assert/strict';
import test from 'node:test';

import { listCdpTargets, snapshotViaCdp } from '../electron/win-computer-use-cdp.ts';
import { isCdpComputerUseRef } from '../src/lib/computer-use-tree.ts';

async function isDebugPortOpen(port = 9222) {
  try {
    await listCdpTargets(port);
    return true;
  } catch {
    return false;
  }
}

function findFirstCdpRef(node) {
  if (!node || typeof node !== 'object') {
    return null;
  }
  if (typeof node.ref === 'string' && isCdpComputerUseRef(node.ref)) {
    return node;
  }
  for (const child of node.children ?? []) {
    const found = findFirstCdpRef(child);
    if (found) {
      return found;
    }
  }
  return null;
}

test('CDP snapshot returns transport=cdp when localhost debug port is open', { skip: process.platform !== 'win32' }, async (t) => {
  const port = 9222;
  if (!(await isDebugPortOpen(port))) {
    t.skip('No process listening on localhost:9222');
    return;
  }

  const targets = await listCdpTargets(port);
  assert.ok(targets.length > 0);

  const pageTarget = targets.find((target) => target.type === 'page' || target.type === 'webview') ?? targets[0];
  const snapshot = await snapshotViaCdp({
    debug_port: port,
    window_title: pageTarget.title,
  });

  assert.equal(snapshot.ok, true, JSON.stringify(snapshot.error));
  assert.equal(snapshot.data?.transport, 'cdp');
  assert.equal(snapshot.data?.fallback_reason, 'cef_host');
  assert.ok(snapshot.data?.tree);
  const refNode = findFirstCdpRef(snapshot.data.tree);
  assert.ok(refNode, 'expected at least one CDP ref in AX tree');
});
