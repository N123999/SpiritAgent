import assert from 'node:assert/strict';
import test from 'node:test';

import {
  canPreviewComposerLocalFileAttachment,
  isPreviewableImagePath,
} from '../../src/lib/local-file-attachments.ts';

test('isPreviewableImagePath accepts common image extensions', () => {
  assert.equal(isPreviewableImagePath('/tmp/element-1739.png'), true);
  assert.equal(isPreviewableImagePath('paste-1739.jpeg'), true);
  assert.equal(isPreviewableImagePath('notes.txt'), false);
});

test('canPreviewComposerLocalFileAttachment requires image flag, extension, and preview data', () => {
  assert.equal(
    canPreviewComposerLocalFileAttachment({
      id: 'a',
      path: '/tmp/element-1.png',
      name: 'element-1.png',
      isImage: true,
      previewDataUrl: 'data:image/png;base64,abc',
    }),
    true,
  );
  assert.equal(
    canPreviewComposerLocalFileAttachment({
      id: 'b',
      path: '/tmp/element-1.png',
      name: 'element-1.png',
      isImage: true,
      previewDataUrl: null,
    }),
    false,
  );
  assert.equal(
    canPreviewComposerLocalFileAttachment({
      id: 'c',
      path: '/tmp/readme.md',
      name: 'readme.md',
      isImage: false,
      previewDataUrl: 'data:text/plain;base64,abc',
    }),
    false,
  );
});
