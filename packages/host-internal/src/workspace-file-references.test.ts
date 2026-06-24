import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  classifyLocalFileComposerRoute,
  clearWorkspaceFileReferenceIndexCache,
  collectWorkspaceFileReferenceIndex,
  listCachedWorkspaceFileReferenceSuggestions,
  resolveWorkspaceFileReferenceAttachmentsFromInput,
} from './workspace-file-references.js';
import {
  computeWorkspaceFileReferenceSuggestions,
  currentWorkspaceFileReferenceQuery,
  deriveWorkspaceDirectoryPathsFromFiles,
  referencedWorkspaceFilePathsFromInput,
  replaceWorkspaceFileReferenceQuery,
} from './workspace-file-reference-query.js';

test('current query tracks token under cursor', () => {
  assert.deepEqual(
    currentWorkspaceFileReferenceQuery('@host_runtime.rs', Array.from('@host_runtime.rs').length),
    {
      start: 0,
      end: Array.from('@host_runtime.rs').length,
      raw: '@host_runtime.rs',
    },
  );

  assert.deepEqual(
    currentWorkspaceFileReferenceQuery('先看 @host_runtime.rs 再说', Array.from('先看 @host').length),
    {
      start: Array.from('先看 ').length,
      end: Array.from('先看 @host_runtime.rs').length,
      raw: '@host_runtime.rs',
    },
  );

  assert.equal(
    currentWorkspaceFileReferenceQuery('@host_runtime.rs ', Array.from('@host_runtime.rs ').length),
    undefined,
  );
});

test('replace query appends single space when confirmed', () => {
  const query = currentWorkspaceFileReferenceQuery('先看 @host', Array.from('先看 @host').length);
  assert.ok(query);
  assert.deepEqual(
    replaceWorkspaceFileReferenceQuery('先看 @host', query, 'src/host_runtime.rs', true),
    {
      text: '先看 @src/host_runtime.rs ',
      cursorChars: Array.from('先看 @src/host_runtime.rs ').length,
    },
  );
});

test('referenced paths collect multiple unique tokens', () => {
  assert.deepEqual(
    referencedWorkspaceFilePathsFromInput('@src/host_runtime.rs 请结合 @README.md 和 @src\\host_runtime.rs 看'),
    ['src/host_runtime.rs', 'README.md'],
  );
});

test('fuzzy suggestions prioritize exact basename match', () => {
  const files = [
    'src/host_runtime.rs',
    'src/runtime/host_runtime.rs',
    'src/runtime_handle.rs',
  ];

  assert.deepEqual(computeWorkspaceFileReferenceSuggestions('@host_runtime.rs', files), [
    'src/host_runtime.rs',
    'src/runtime/host_runtime.rs',
  ]);
});

test('fuzzy suggestions include directories and prioritize exact directory basename match', () => {
  const files = [
    'apps/desktop/src/lib/desktop-shell.ts',
    'apps/desktop/electron/main.ts',
    'packages/other/desktop-helper.ts',
  ];

  const suggestions = computeWorkspaceFileReferenceSuggestions('@Desktop', files);
  assert.equal(suggestions[0], 'apps/desktop/');
  assert.ok(suggestions.includes('apps/desktop/electron/main.ts'));
  assert.ok(suggestions.includes('packages/other/desktop-helper.ts'));
});

test('derive workspace directory paths from indexed files', () => {
  assert.deepEqual(
    deriveWorkspaceDirectoryPathsFromFiles(['apps/desktop/src/main.ts', 'README.md']),
    ['apps/', 'apps/desktop/', 'apps/desktop/src/'],
  );
});

test('collect workspace file index respects root gitignore and default ignored dirs', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'spirit-host-internal-file-ref-'));
  try {
    await mkdir(join(workspaceRoot, 'src'), { recursive: true });
    await mkdir(join(workspaceRoot, 'node_modules', 'pkg'), { recursive: true });
    await mkdir(join(workspaceRoot, 'ignored-dir'), { recursive: true });
    await writeFile(join(workspaceRoot, '.gitignore'), 'ignored-dir/\n');
    await writeFile(join(workspaceRoot, 'README.md'), '# hello\n');
    await writeFile(join(workspaceRoot, 'src', 'main.ts'), 'console.log(1);\n');
    await writeFile(join(workspaceRoot, 'node_modules', 'pkg', 'index.js'), 'module.exports = {};\n');
    await writeFile(join(workspaceRoot, 'ignored-dir', 'secret.txt'), 'hidden\n');

    await clearWorkspaceFileReferenceIndexCache(workspaceRoot);
    const files = await collectWorkspaceFileReferenceIndex(workspaceRoot);
    assert.deepEqual(files, ['.gitignore', 'README.md', 'src/main.ts']);
  } finally {
    await clearWorkspaceFileReferenceIndexCache(workspaceRoot);
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('collect workspace file index respects nested gitignore without git', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'spirit-host-internal-file-ref-nested-'));
  try {
    await mkdir(join(workspaceRoot, 'src', 'pkg'), { recursive: true });
    await writeFile(join(workspaceRoot, 'src', '.gitignore'), 'pkg/\n');
    await writeFile(join(workspaceRoot, 'src', 'main.ts'), 'console.log(1);\n');
    await writeFile(join(workspaceRoot, 'src', 'pkg', 'ignored.ts'), 'export {};\n');

    await clearWorkspaceFileReferenceIndexCache(workspaceRoot);
    const files = await collectWorkspaceFileReferenceIndex(workspaceRoot);
    assert.deepEqual(files, ['src/.gitignore', 'src/main.ts']);
  } finally {
    await clearWorkspaceFileReferenceIndexCache(workspaceRoot);
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('cached workspace file suggestions do not block on cold index', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'spirit-host-internal-file-ref-cached-'));
  try {
    await writeFile(join(workspaceRoot, 'README.md'), '# hello\n');

    await clearWorkspaceFileReferenceIndexCache(workspaceRoot);
    const cold = await listCachedWorkspaceFileReferenceSuggestions(
      workspaceRoot,
      '@README',
      Array.from('@README').length,
    );
    assert.deepEqual(cold?.suggestions, []);
    assert.equal(cold?.indexReady, false);

    await collectWorkspaceFileReferenceIndex(workspaceRoot);
    const warm = await listCachedWorkspaceFileReferenceSuggestions(
      workspaceRoot,
      '@README',
      Array.from('@README').length,
    );
    assert.deepEqual(warm?.suggestions, ['README.md']);
    assert.equal(warm?.indexReady, true);
  } finally {
    await clearWorkspaceFileReferenceIndexCache(workspaceRoot);
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('resolve workspace file attachments truncates oversized content and ignores invalid references', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'spirit-host-internal-file-attachment-'));
  try {
    const oversizedText = 'a'.repeat(24_010);
    await writeFile(join(workspaceRoot, 'README.md'), oversizedText);

    const attachments = await resolveWorkspaceFileReferenceAttachmentsFromInput(
      workspaceRoot,
      '@README.md @missing.txt',
    );
    assert.equal(attachments.length, 1);
    assert.equal(attachments[0]?.kind, 'text');
    assert.equal(attachments[0]?.path, 'README.md');
    if (!attachments[0] || attachments[0].kind !== 'text') {
      throw new Error('README.md 应返回 text 附件。');
    }
    assert.equal(attachments[0].totalChars, oversizedText.length);
    assert.equal(attachments[0].truncated, true);
    assert.match(attachments[0].content, /文件内容已截断/u);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

const MINIMAL_MP4_HEADER = Buffer.from([
  0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d,
]);

test('resolve workspace file attachments keeps validated videos and ignores fake video extensions', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'spirit-host-internal-video-attachment-'));
  try {
    await writeFile(join(workspaceRoot, 'clip.mp4'), MINIMAL_MP4_HEADER);
    await writeFile(join(workspaceRoot, 'fake.mp4'), 'not really a video');

    const attachments = await resolveWorkspaceFileReferenceAttachmentsFromInput(
      workspaceRoot,
      '@clip.mp4 @fake.mp4',
    );
    assert.equal(attachments.length, 1);
    assert.equal(attachments[0]?.kind, 'video');
    assert.equal(attachments[0]?.path, 'clip.mp4');
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('resolve workspace file attachments keeps validated images and ignores fake image extensions', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'spirit-host-internal-image-attachment-'));
  try {
    await writeFile(
      join(workspaceRoot, 'diagram.png'),
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7Zp1cAAAAASUVORK5CYII=',
        'base64',
      ),
    );
    await writeFile(join(workspaceRoot, 'fake.webp'), 'not really a webp');

    const attachments = await resolveWorkspaceFileReferenceAttachmentsFromInput(
      workspaceRoot,
      '@diagram.png @fake.webp',
    );
    assert.equal(attachments.length, 1);
    assert.equal(attachments[0]?.kind, 'image');
    assert.equal(attachments[0]?.path, 'diagram.png');
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('resolve workspace file attachments resolves absolute external text paths', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'spirit-host-internal-ws-'));
  const externalRoot = await mkdtemp(join(tmpdir(), 'spirit-host-internal-ext-'));
  try {
    await writeFile(join(workspaceRoot, 'README.md'), '# workspace\n');
    const externalFile = join(externalRoot, 'notes.txt');
    await writeFile(externalFile, 'external note content\n');
    const externalRef = externalFile.replace(/\\/gu, '/');

    const attachments = await resolveWorkspaceFileReferenceAttachmentsFromInput(
      workspaceRoot,
      `@${externalRef}`,
    );
    assert.equal(attachments.length, 1);
    assert.equal(attachments[0]?.kind, 'text');
    assert.equal(attachments[0]?.path, externalRef);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
    await rm(externalRoot, { recursive: true, force: true });
  }
});

test('resolve workspace file attachments resolves absolute external image and video paths', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'spirit-host-internal-ws-abs-media-'));
  const externalRoot = await mkdtemp(join(tmpdir(), 'spirit-host-internal-ext-media-'));
  try {
    await writeFile(join(workspaceRoot, 'README.md'), '# workspace\n');
    const pngPath = join(externalRoot, 'diagram.png');
    const mp4Path = join(externalRoot, 'clip.mp4');
    await writeFile(
      pngPath,
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7Zp1cAAAAASUVORK5CYII=',
        'base64',
      ),
    );
    await writeFile(mp4Path, MINIMAL_MP4_HEADER);
    const pngRef = pngPath.replace(/\\/gu, '/');
    const mp4Ref = mp4Path.replace(/\\/gu, '/');

    const attachments = await resolveWorkspaceFileReferenceAttachmentsFromInput(
      workspaceRoot,
      `@${pngRef} @${mp4Ref}`,
    );
    assert.equal(attachments.length, 2);
    const kinds = attachments.map((item) => item.kind).sort();
    assert.deepEqual(kinds, ['image', 'video']);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
    await rm(externalRoot, { recursive: true, force: true });
  }
});

test('classifyLocalFileComposerRoute routes validated media and reference files', async () => {
  const externalRoot = await mkdtemp(join(tmpdir(), 'spirit-host-internal-classify-'));
  try {
    const textPath = join(externalRoot, 'notes.txt');
    const pngPath = join(externalRoot, 'diagram.png');
    const mp4Path = join(externalRoot, 'clip.mp4');
    const fakePngPath = join(externalRoot, 'fake.png');
    await writeFile(textPath, 'hello\n');
    await writeFile(
      pngPath,
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7Zp1cAAAAASUVORK5CYII=',
        'base64',
      ),
    );
    await writeFile(mp4Path, MINIMAL_MP4_HEADER);
    await writeFile(fakePngPath, 'not a png');

    assert.equal(await classifyLocalFileComposerRoute(textPath), 'reference');
    assert.equal(await classifyLocalFileComposerRoute(pngPath), 'media');
    assert.equal(await classifyLocalFileComposerRoute(mp4Path), 'media');
    assert.equal(await classifyLocalFileComposerRoute(fakePngPath), 'reference');
  } finally {
    await rm(externalRoot, { recursive: true, force: true });
  }
});
