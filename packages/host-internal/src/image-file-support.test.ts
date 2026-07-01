import assert from 'node:assert/strict';
import test from 'node:test';

import {
  detectSupportedImageFile,
  hasSupportedImageExtension,
} from './image-file-support.js';

const PNG_HEADER = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

const GIF_HEADER = Uint8Array.from(
  Array.from('GIF89a', (char) => char.charCodeAt(0)),
);

const WEBP_HEADER = Uint8Array.from([
  ...Array.from('RIFF', (char) => char.charCodeAt(0)),
  0x00, 0x00, 0x00, 0x00,
  ...Array.from('WEBP', (char) => char.charCodeAt(0)),
]);

test('hasSupportedImageExtension recognizes read_file image extensions', () => {
  assert.equal(hasSupportedImageExtension('assets/icon.png'), true);
  assert.equal(hasSupportedImageExtension('photo.JPG'), true);
  assert.equal(hasSupportedImageExtension('public/favicon.ico'), true);
  assert.equal(hasSupportedImageExtension('notes.txt'), false);
  assert.equal(hasSupportedImageExtension('vector.svg'), false);
});

test('detectSupportedImageFile validates png signature', () => {
  assert.deepEqual(detectSupportedImageFile('icon.png', PNG_HEADER), {
    extension: '.png',
    mimeType: 'image/png',
  });
});

test('detectSupportedImageFile validates gif and webp signatures', () => {
  assert.deepEqual(detectSupportedImageFile('anim.gif', GIF_HEADER), {
    extension: '.gif',
    mimeType: 'image/gif',
  });
  assert.deepEqual(detectSupportedImageFile('photo.webp', WEBP_HEADER), {
    extension: '.webp',
    mimeType: 'image/webp',
  });
});

test('detectSupportedImageFile validates ico signature', () => {
  const icoHeader = Uint8Array.from([0x00, 0x00, 0x01, 0x00, 0x01, 0x00]);
  assert.deepEqual(detectSupportedImageFile('favicon.ico', icoHeader), {
    extension: '.ico',
    mimeType: 'image/x-icon',
  });
});

test('detectSupportedImageFile rejects mismatched extension and signature', () => {
  assert.equal(detectSupportedImageFile('icon.png', Uint8Array.from([0, 1, 2, 3])), undefined);
  assert.equal(detectSupportedImageFile('notes.txt', PNG_HEADER), undefined);
});
