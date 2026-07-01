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

test('readHostTextFile returns image metadata for validated gif files', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'spirit-host-binary-'));
  const filePath = path.join(dir, 'anim.gif');
  const gifHeader = Buffer.from('GIF89a', 'ascii');
  await writeFile(filePath, gifHeader);

  try {
    const read = await readHostTextFile(filePath);
    assert.equal(read.image?.mimeType, 'image/gif');
    assert.equal(read.binary, undefined);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('readHostTextFile returns image metadata for validated png files', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'spirit-host-binary-'));
  const filePath = path.join(dir, 'icon.png');
  const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff, 0xff]);
  await writeFile(filePath, pngHeader);

  try {
    const read = await readHostTextFile(filePath);
    assert.equal(read.image?.mimeType, 'image/png');
    assert.equal(read.binary, undefined);
    assert.equal(read.text, '');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('readHostTextFile returns binary for image extension with invalid signature', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'spirit-host-binary-'));
  const filePath = path.join(dir, 'fake.png');
  await writeFile(filePath, 'not a real png', 'utf8');

  try {
    const read = await readHostTextFile(filePath);
    assert.equal(read.binary, true);
    assert.equal(read.image, undefined);
    assert.equal(read.text, '');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('readHostTextFile returns image metadata for validated ico files', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'spirit-host-binary-'));
  const filePath = path.join(dir, 'favicon.ico');
  const icoHeader = Buffer.from([0x00, 0x00, 0x01, 0x00, 0x01, 0x00]);
  await writeFile(filePath, icoHeader);

  try {
    const read = await readHostTextFile(filePath);
    assert.equal(read.image?.mimeType, 'image/x-icon');
    assert.equal(read.binary, undefined);
    assert.equal(read.text, '');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('statHostTextFile returns false for missing paths', async () => {
  const stat = await statHostTextFile(path.join(os.tmpdir(), 'spirit-missing-file.txt'));
  assert.equal(stat.exists, false);
  assert.equal(stat.isFile, false);
});
