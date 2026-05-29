import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';

import {
  NodeHostToolService,
  type HostToolExecutionOutput,
} from './tools.js';

const ONE_PIXEL_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7Zp1cAAAAASUVORK5CYII=';

function createMockImageFetch(): typeof fetch {
  return (async () => {
    const bytes = Buffer.from(ONE_PIXEL_PNG_BASE64, 'base64');
    return {
      status: 200,
      url: 'https://example.com/final-image',
      headers: new Headers({
        'content-type': 'image/png',
      }),
      arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      text: async () => {
        throw new Error('image response should not be read as text');
      },
    } as unknown as Response;
  }) as typeof fetch;
}

test('read_file returns unsupported vision text without image part when model blocks vision', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'spirit-host-tools-vision-blocked-'));
  const spiritDataDir = join(workspaceRoot, '.spirit-data');
  const imagePath = join(workspaceRoot, 'blocked.png');

  try {
    await mkdir(spiritDataDir, { recursive: true });
    await writeFile(imagePath, Buffer.from(ONE_PIXEL_PNG_BASE64, 'base64'));

    const service = new NodeHostToolService(
      { workspaceRoot, spiritDataDir },
      {
        getModelCompatibilityProfile: () => ({
          hasExplicitCapabilities: true,
          capabilities: {},
        }),
      },
    );

    const output = await service.execute({
      name: 'read_file',
      path: imagePath,
    });
    assertHostToolExecutionOutput(output);
    assert.match(output.summaryText, /该模型不支持 Vision/u);
    assert.equal(output.content.some((part) => part.type === 'image'), false);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('read_file still returns image part when model explicitly supports vision', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'spirit-host-tools-vision-allowed-'));
  const spiritDataDir = join(workspaceRoot, '.spirit-data');
  const imagePath = join(workspaceRoot, 'allowed.png');

  try {
    await mkdir(spiritDataDir, { recursive: true });
    await writeFile(imagePath, Buffer.from(ONE_PIXEL_PNG_BASE64, 'base64'));

    const service = new NodeHostToolService(
      { workspaceRoot, spiritDataDir },
      {
        getModelCompatibilityProfile: () => ({
          hasExplicitCapabilities: true,
          capabilities: { vision: true },
        }),
      },
    );

    const output = await service.execute({
      name: 'read_file',
      path: imagePath,
    });
    assertHostToolExecutionOutput(output);
    assert.match(output.summaryText, /图像文件已作为图片输入返回/u);
    assert.equal(output.content.some((part) => part.type === 'image'), true);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('web_fetch returns image part for supported remote image responses', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'spirit-host-tools-web-fetch-image-'));
  const spiritDataDir = join(workspaceRoot, '.spirit-data');
  const originalFetch = globalThis.fetch;

  try {
    await mkdir(spiritDataDir, { recursive: true });
    globalThis.fetch = createMockImageFetch();

    const service = new NodeHostToolService(
      { workspaceRoot, spiritDataDir },
      {
        getModelCompatibilityProfile: () => ({
          hasExplicitCapabilities: true,
          capabilities: { vision: true },
        }),
      },
    );

    const output = await service.execute({
      name: 'web_fetch',
      url: 'https://example.com/source-image',
    });
    assertHostToolExecutionOutput(output);
    assert.match(output.summaryText, /^\[web image\]/u);
    assert.equal(output.content.some((part) => part.type === 'image'), true);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('web_fetch returns blocked-vision text without image part for remote image responses', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'spirit-host-tools-web-fetch-blocked-'));
  const spiritDataDir = join(workspaceRoot, '.spirit-data');
  const originalFetch = globalThis.fetch;

  try {
    await mkdir(spiritDataDir, { recursive: true });
    globalThis.fetch = createMockImageFetch();

    const service = new NodeHostToolService(
      { workspaceRoot, spiritDataDir },
      {
        getModelCompatibilityProfile: () => ({
          hasExplicitCapabilities: true,
          capabilities: {},
        }),
      },
    );

    const output = await service.execute({
      name: 'web_fetch',
      url: 'https://example.com/source-image',
    });
    assertHostToolExecutionOutput(output);
    assert.match(output.summaryText, /该模型不支持 Vision/u);
    assert.equal(output.content.some((part) => part.type === 'image'), false);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('saveGeneratedImage returns a managed markdown reference instead of a raw local path', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'spirit-host-tools-generated-image-ref-'));
  const spiritDataDir = join(workspaceRoot, '.spirit-data');

  try {
    await mkdir(spiritDataDir, { recursive: true });

    const service = new NodeHostToolService({ workspaceRoot, spiritDataDir });
    const saved = await service.saveGeneratedImage({
      data: Buffer.from(ONE_PIXEL_PNG_BASE64, 'base64'),
      mediaType: 'image/png',
      prompt: 'concept image',
      model: 'test-image-model',
    });

    assert.equal(dirname(saved.path), join(spiritDataDir, 'generated-images'));
    assert.equal(saved.markdownRef, `spirit-image://generated/${encodeURIComponent(basename(saved.path))}`);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('read_file accepts Spirit-managed generated image refs without leaking local paths', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'spirit-host-tools-managed-image-read-'));
  const spiritDataDir = join(workspaceRoot, '.spirit-data');

  try {
    await mkdir(spiritDataDir, { recursive: true });

    const service = new NodeHostToolService(
      { workspaceRoot, spiritDataDir },
      {
        getModelCompatibilityProfile: () => ({
          hasExplicitCapabilities: true,
          capabilities: { vision: true },
        }),
      },
    );

    const saved = await service.saveGeneratedImage({
      data: Buffer.from(ONE_PIXEL_PNG_BASE64, 'base64'),
      mediaType: 'image/png',
      prompt: 'concept image',
      model: 'test-image-model',
    });

    const authorization = await service.authorize({
      name: 'read_file',
      path: saved.markdownRef ?? '',
    });
    assert.deepEqual(authorization, { kind: 'allowed' });

    const output = await service.execute({
      name: 'read_file',
      path: saved.markdownRef ?? '',
    });
    assertHostToolExecutionOutput(output);
    assert.match(output.summaryText, /^\[read image\]/u);
    assert.match(output.summaryText, new RegExp(`path: ${escapeRegExp(saved.markdownRef ?? '')}`));
    assert.doesNotMatch(output.summaryText, new RegExp(escapeRegExp(saved.path)));
    assert.equal(output.content.some((part) => part.type === 'image'), true);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('read_file accepts Spirit-managed generated image refs with mixed-case URL scheme and host', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'spirit-host-tools-managed-image-read-case-'));
  const spiritDataDir = join(workspaceRoot, '.spirit-data');

  try {
    await mkdir(spiritDataDir, { recursive: true });

    const service = new NodeHostToolService(
      { workspaceRoot, spiritDataDir },
      {
        getModelCompatibilityProfile: () => ({
          hasExplicitCapabilities: true,
          capabilities: { vision: true },
        }),
      },
    );

    const saved = await service.saveGeneratedImage({
      data: Buffer.from(ONE_PIXEL_PNG_BASE64, 'base64'),
      mediaType: 'image/png',
      prompt: 'concept image',
      model: 'test-image-model',
    });
    const mixedCaseRef = saved.markdownRef.replace(
      'spirit-image://generated/',
      'SPIRIT-IMAGE://GENERATED/',
    );

    const authorization = await service.authorize({
      name: 'read_file',
      path: mixedCaseRef,
    });
    assert.deepEqual(authorization, { kind: 'allowed' });

    const output = await service.execute({
      name: 'read_file',
      path: mixedCaseRef,
    });
    assertHostToolExecutionOutput(output);
    assert.match(output.summaryText, new RegExp(`path: ${escapeRegExp(mixedCaseRef)}`));
    assert.equal(output.content.some((part) => part.type === 'image'), true);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('read_file missing Spirit-managed generated image ref reports sanitized error', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'spirit-host-tools-missing-managed-image-read-'));
  const spiritDataDir = join(workspaceRoot, '.spirit-data');
  const missingRef = 'spirit-image://generated/missing-image.png';
  const leakedLocalPath = join(spiritDataDir, 'generated-images', 'missing-image.png');

  try {
    await mkdir(spiritDataDir, { recursive: true });

    const service = new NodeHostToolService({ workspaceRoot, spiritDataDir });
    await assert.rejects(
      () =>
        service.execute({
          name: 'read_file',
          path: missingRef,
        }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, new RegExp(escapeRegExp(missingRef)));
        assert.doesNotMatch(error.message, new RegExp(escapeRegExp(leakedLocalPath)));
        return true;
      },
    );
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('read_file reports canonical path for non-managed files', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'spirit-host-tools-read-file-canonical-'));
  const spiritDataDir = join(workspaceRoot, '.spirit-data');
  const nestedDir = join(workspaceRoot, 'nested');
  const filePath = join(nestedDir, 'note.txt');

  try {
    await mkdir(nestedDir, { recursive: true });
    await mkdir(spiritDataDir, { recursive: true });
    await writeFile(filePath, 'alpha\nbeta\n');

    const service = new NodeHostToolService({ workspaceRoot, spiritDataDir });
    const output = await service.execute({
      name: 'read_file',
      path: './nested/../nested/note.txt',
      start_line: 1,
      end_line: 1,
    });

    assertHostToolExecutionOutput(output);
    assert.match(output.summaryText, new RegExp(`^\\[read\\]\\npath: ${escapeRegExp(filePath)}\\nrange: 1-1`, 'u'));
    assert.doesNotMatch(output.summaryText, /\.\/nested\/\.\.\/nested\/note\.txt/u);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('grep supports case-insensitive regular expression queries', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'spirit-host-tools-search-regexp-'));
  const spiritDataDir = join(workspaceRoot, '.spirit-data');

  try {
    await mkdir(spiritDataDir, { recursive: true });
    await writeFile(join(workspaceRoot, 'alpha.txt'), 'Runtime    parity\nsecond line\n');
    await writeFile(join(workspaceRoot, 'beta.txt'), 'no match here\n');

    const service = new NodeHostToolService({ workspaceRoot, spiritDataDir });
    const output = await service.execute({
      name: 'grep',
      query: 'runtime\\s+parity',
      is_regexp: true,
    });

    assertTextToolOutput(output);
    assert.match(output, /\[tool\] 搜索\(正则\): runtime\\s\+parity/u);
    assert.match(output, /alpha\.txt:1 \| Runtime    parity/u);
    assert.doesNotMatch(output, /beta\.txt/u);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('grep rejects invalid regular expressions with a clear error', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'spirit-host-tools-search-regexp-error-'));
  const spiritDataDir = join(workspaceRoot, '.spirit-data');

  try {
    await mkdir(spiritDataDir, { recursive: true });

    const service = new NodeHostToolService({ workspaceRoot, spiritDataDir });
    await assert.rejects(
      () =>
        service.execute({
          name: 'grep',
          query: '(',
          is_regexp: true,
        }),
      /无效正则/u,
    );
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('glob returns matching workspace files for a glob pattern', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'spirit-host-tools-glob-'));
  const spiritDataDir = join(workspaceRoot, '.spirit-data');

  try {
    await mkdir(join(workspaceRoot, 'src', 'nested'), { recursive: true });
    await mkdir(spiritDataDir, { recursive: true });
    await writeFile(join(workspaceRoot, 'src', 'app.ts'), 'export const app = 1;\n');
    await writeFile(join(workspaceRoot, 'src', 'nested', 'util.ts'), 'export const util = 1;\n');
    await writeFile(join(workspaceRoot, 'src', 'nested', 'note.md'), '# note\n');

    const service = new NodeHostToolService({ workspaceRoot, spiritDataDir });
    const output = await service.execute({
      name: 'glob',
      pattern: 'src/**/*.ts',
    });

    assertTextToolOutput(output);
    assert.match(output, /^\[glob\]\npattern: src\/\*\*\/\*\.ts\nmatches: 2\ntruncated: false/um);
    assert.match(output, /\nsrc\/app\.ts\n/u);
    assert.match(output, /\nsrc\/nested\/util\.ts\n/u);
    assert.doesNotMatch(output, /note\.md/u);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('glob rejects patterns that escape the workspace', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'spirit-host-tools-glob-escape-'));
  const spiritDataDir = join(workspaceRoot, '.spirit-data');

  try {
    await mkdir(spiritDataDir, { recursive: true });

    const service = new NodeHostToolService({ workspaceRoot, spiritDataDir });
    await assert.rejects(
      () =>
        service.execute({
          name: 'glob',
          pattern: '../**/*.ts',
        }),
      /glob pattern 不能跳出 workspace/u,
    );
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('requestFromFunctionCall parses glob pattern', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'spirit-host-tools-glob-parse-'));
  const spiritDataDir = join(workspaceRoot, '.spirit-data');

  try {
    await mkdir(spiritDataDir, { recursive: true });

    const service = new NodeHostToolService({ workspaceRoot, spiritDataDir });
    const request = await service.requestFromFunctionCall(
      'glob',
      '{"pattern":"src/**/*.ts"}',
    );

    assert.deepEqual(request, {
      name: 'glob',
      pattern: 'src/**/*.ts',
    });
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('requestFromFunctionCall parses grep is_regexp flag', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'spirit-host-tools-search-parse-'));
  const spiritDataDir = join(workspaceRoot, '.spirit-data');

  try {
    await mkdir(spiritDataDir, { recursive: true });

    const service = new NodeHostToolService({ workspaceRoot, spiritDataDir });
    const request = await service.requestFromFunctionCall(
      'grep',
      '{"query":"runtime\\\\s+parity","is_regexp":true}',
    );

    assert.deepEqual(request, {
      name: 'grep',
      query: 'runtime\\s+parity',
      is_regexp: true,
    });
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('authorize returns need-approval for shell commands under default approval level', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'spirit-host-tools-auth-default-'));
  const spiritDataDir = join(workspaceRoot, '.spirit-data');

  try {
    await mkdir(spiritDataDir, { recursive: true });

    const service = new NodeHostToolService(
      { workspaceRoot, spiritDataDir },
      { getApprovalLevel: () => 'default' },
    );
    const decision = await service.authorize({
      name: 'run_shell_command',
      command: 'echo hello',
      reason: 'test',
    });

    assert.equal(decision.kind, 'need-approval');
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('authorize allows shell commands under full-approval approval level', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'spirit-host-tools-auth-full-'));
  const spiritDataDir = join(workspaceRoot, '.spirit-data');

  try {
    await mkdir(spiritDataDir, { recursive: true });

    const service = new NodeHostToolService(
      { workspaceRoot, spiritDataDir },
      { getApprovalLevel: () => 'full-approval' },
    );
    const decision = await service.authorize({
      name: 'run_shell_command',
      command: 'echo hello',
      reason: 'test',
    });

    assert.deepEqual(decision, { kind: 'allowed' });
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('authorize still requires ask_questions under full-approval approval level', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'spirit-host-tools-auth-questions-'));
  const spiritDataDir = join(workspaceRoot, '.spirit-data');

  try {
    await mkdir(spiritDataDir, { recursive: true });

    const service = new NodeHostToolService(
      { workspaceRoot, spiritDataDir },
      { getApprovalLevel: () => 'full-approval' },
    );
    const decision = await service.authorize({
      name: 'ask_questions',
      questions: [{
        id: 'q1',
        title: 'Choose one',
        kind: 'single_select',
        required: true,
        options: [{ label: 'A' }],
        allowCustomInput: false,
      }],
    });

    assert.equal(decision.kind, 'need-questions');
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('requestFromFunctionCall accepts empty arguments for finish_task', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'spirit-host-tools-finish-task-parse-'));
  const spiritDataDir = join(workspaceRoot, '.spirit-data');

  try {
    await mkdir(spiritDataDir, { recursive: true });

    const service = new NodeHostToolService({ workspaceRoot, spiritDataDir });
    const request = await service.requestFromFunctionCall('finish_task', '   ');

    assert.deepEqual(request, {
      name: 'finish_task',
    });
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

function assertHostToolExecutionOutput(
  output: HostToolExecutionOutput | string,
): asserts output is HostToolExecutionOutput {
  assert.notEqual(typeof output, 'string');
}

function assertTextToolOutput(output: HostToolExecutionOutput | string): asserts output is string {
  assert.equal(typeof output, 'string');
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
