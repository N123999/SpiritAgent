import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import {
  readHostTextFile,
  statHostTextFile,
  writeHostTextFile,
} from '../../dist-electron/src/host/host-text-file.js';

test('readHostTextFile reads an absolute path outside any workspace root', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'spirit-host-text-'));
  const filePath = path.join(dir, 'sample.txt');
  await writeFile(filePath, 'hello host file', 'utf8');

  try {
    const stat = await statHostTextFile(filePath);
    assert.equal(stat.exists, true);
    assert.equal(stat.isFile, true);

    const read = await readHostTextFile(filePath);
    assert.equal(read.text, 'hello host file');

    await writeHostTextFile(filePath, 'updated host file');
    const reread = await readHostTextFile(filePath);
    assert.equal(reread.text, 'updated host file');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('statHostTextFile returns false for missing paths', async () => {
  const stat = await statHostTextFile(path.join(os.tmpdir(), 'spirit-missing-file.txt'));
  assert.equal(stat.exists, false);
  assert.equal(stat.isFile, false);
});
