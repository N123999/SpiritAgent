import assert from 'node:assert/strict';
import test from 'node:test';

import { isToolOutputArchivePath } from './tool-output-archive-path.js';

test('isToolOutputArchivePath matches SpiritAgent tool-output-archives paths', () => {
  assert.equal(
    isToolOutputArchivePath(
      'C:\\Users\\pc\\AppData\\Roaming\\SpiritAgent\\tool-output-archives\\sess\\call_1.txt',
    ),
    true,
  );
  assert.equal(isToolOutputArchivePath('/tmp/tool-output-archives/sess/call_1.txt'), true);
  assert.equal(isToolOutputArchivePath('src/App.tsx'), false);
});
