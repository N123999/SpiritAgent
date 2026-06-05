import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { LspDocumentStore } from './document-store.js';

test('LspDocumentStore tracks versions on open and replace', () => {
  const workspaceRoot = path.join(os.tmpdir(), 'spirit-lsp-test');
  const resolvedPath = path.join(workspaceRoot, 'src', 'a.ts');
  const store = new LspDocumentStore();
  const first = store.open({ workspaceRoot, resolvedPath, text: 'a' });
  assert.equal(first.version, 1);
  const second = store.replaceText(first.uri, 'ab');
  assert.equal(second?.version, 2);
  assert.equal(second?.text, 'ab');
});
