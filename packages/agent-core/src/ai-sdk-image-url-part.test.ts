import assert from 'node:assert/strict';
import test from 'node:test';

import { buildAiSdkUserImageFilePartFromUrl } from './ai-sdk-image-url-part.js';

test('buildAiSdkUserImageFilePartFromUrl uses AI SDK 7 file part shape', () => {
  assert.deepEqual(
    buildAiSdkUserImageFilePartFromUrl('https://example.com/photo.png'),
    {
      type: 'file',
      mediaType: 'image/*',
      data: {
        type: 'url',
        url: 'https://example.com/photo.png',
      },
    },
  );
});
