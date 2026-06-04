import assert from 'node:assert/strict';
import test from 'node:test';

import { isLspDiagnosticsToolRequest, requestFromGetDiagnosticsFunctionCall } from './tool-request.js';

test('requestFromGetDiagnosticsFunctionCall parses path', () => {
  const request = requestFromGetDiagnosticsFunctionCall(
    'get_diagnostics',
    JSON.stringify({ path: 'src/index.ts' }),
  );
  assert.deepEqual(request, { name: 'get_diagnostics', path: 'src/index.ts' });
  assert.equal(isLspDiagnosticsToolRequest(request), true);
});

test('requestFromGetDiagnosticsFunctionCall rejects other tool names', () => {
  assert.equal(requestFromGetDiagnosticsFunctionCall('read_file', '{}'), undefined);
});
