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

test('read_file returns unsupported image text without image part when model blocks image input', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'spirit-host-tools-image-blocked-'));
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
    assert.match(output.summaryText, /该模型不支持 Image 输入/u);
    assert.equal(output.content.some((part) => part.type === 'image'), false);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

const MINIMAL_MP4_HEADER = Buffer.from([
  0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d,
]);

test('read_file returns unsupported video text without video part when model blocks video input', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'spirit-host-tools-video-blocked-'));
  const spiritDataDir = join(workspaceRoot, '.spirit-data');
  const videoPath = join(workspaceRoot, 'blocked.mp4');

  try {
    await mkdir(spiritDataDir, { recursive: true });
    await writeFile(videoPath, MINIMAL_MP4_HEADER);

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
      path: videoPath,
    });
    assertHostToolExecutionOutput(output);
    assert.match(output.summaryText, /该模型不支持视频输入/u);
    assert.equal(output.content.some((part) => part.type === 'video'), false);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('read_file still returns video part when model explicitly supports video input', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'spirit-host-tools-video-allowed-'));
  const spiritDataDir = join(workspaceRoot, '.spirit-data');
  const videoPath = join(workspaceRoot, 'allowed.mp4');

  try {
    await mkdir(spiritDataDir, { recursive: true });
    await writeFile(videoPath, MINIMAL_MP4_HEADER);

    const service = new NodeHostToolService(
      { workspaceRoot, spiritDataDir },
      {
        getModelCompatibilityProfile: () => ({
          hasExplicitCapabilities: true,
          capabilities: { videoInput: true },
        }),
      },
    );

    const output = await service.execute({
      name: 'read_file',
      path: videoPath,
    });
    assertHostToolExecutionOutput(output);
    assert.match(output.summaryText, /视频文件已作为视频输入返回/u);
    assert.equal(output.content.some((part) => part.type === 'video'), true);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('read_file still returns image part when model explicitly supports image input', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'spirit-host-tools-image-allowed-'));
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
          capabilities: { imageInput: true },
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
          capabilities: { imageInput: true },
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

test('web_fetch returns blocked-image text without image part for remote image responses', async () => {
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
    assert.match(output.summaryText, /该模型不支持 Image 输入/u);
    assert.equal(output.content.some((part) => part.type === 'image'), false);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

const MINIMAL_MP4_BYTES = Buffer.from([
  0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
]);

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
    assert.equal(saved.markdownRef, `spirit-agent://generated/image/${encodeURIComponent(basename(saved.path))}`);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('saveGeneratedVideo returns a managed markdown reference instead of a raw local path', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'spirit-host-tools-generated-video-ref-'));
  const spiritDataDir = join(workspaceRoot, '.spirit-data');

  try {
    await mkdir(spiritDataDir, { recursive: true });

    const service = new NodeHostToolService({ workspaceRoot, spiritDataDir });
    const saved = await service.saveGeneratedVideo({
      data: MINIMAL_MP4_BYTES,
      mediaType: 'video/mp4',
      prompt: 'concept video',
      model: 'test-video-model',
    });

    assert.equal(dirname(saved.path), join(spiritDataDir, 'generated-videos'));
    assert.equal(saved.markdownRef, `spirit-agent://generated/video/${encodeURIComponent(basename(saved.path))}`);
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
          capabilities: { imageInput: true },
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
          capabilities: { imageInput: true },
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
      'spirit-agent://generated/image/',
      'SPIRIT-AGENT://GENERATED/image/',
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
  const missingRef = 'spirit-agent://generated/image/missing-image.png';
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

test('create_plan writes plans/{name}.md and rejects duplicate names', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'spirit-host-tools-create-plan-'));
  const spiritDataDir = join(workspaceRoot, '.spirit-data');

  try {
    await mkdir(spiritDataDir, { recursive: true });

    const service = new NodeHostToolService({ workspaceRoot, spiritDataDir });
    const request = await service.requestFromFunctionCall(
      'create_plan',
      JSON.stringify({ name: 'demo-plan', content: '# Demo\n\n- [ ] ship it' }),
    );

    assert.deepEqual(request, {
      name: 'create_plan',
      plan_name: 'demo-plan',
      content: '# Demo\n\n- [ ] ship it',
    });

    const output = await service.execute(request);
    assert.match(String(output), /\[plan\]\npath: .*plans[\\/]+demo-plan\.md/);

    await assert.rejects(
      () =>
        service.execute({
          name: 'create_plan',
          plan_name: 'demo-plan',
          content: '# Again',
        }),
      /已存在/,
    );
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('create_automation writes automation file when defaults are provided', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'spirit-host-tools-create-automation-'));
  const spiritDataDir = join(workspaceRoot, '.spirit-data');
  let createdId: string | undefined;

  try {
    await mkdir(spiritDataDir, { recursive: true });

    const service = new NodeHostToolService(
      { workspaceRoot, spiritDataDir },
      {
        getAutomationCreateDefaults: () => ({
          workspaceRoot,
          modelName: 'test-model',
        }),
        onAutomationCreated: (definition) => {
          createdId = definition.id;
        },
      },
    );
    const request = await service.requestFromFunctionCall(
      'create_automation',
      JSON.stringify({
        overview: 'Check CI status and summarize failures.',
        schedule: { kind: 'weekly', weekday: 1, hour: 9, minute: 0 },
      }),
    );

    assert.equal(request.name, 'create_automation');
    assert.equal(request.title, 'Check CI status and summarize failures.');
    assert.deepEqual(request.schedule, { kind: 'weekly', weekday: 1, hour: 9, minute: 0 });
    assert.equal(request.approval_level, 'default');

    const output = await service.execute(request);
    assert.match(String(output), /\[automation\]\naction: create_automation\nid: /);
    assert.ok(createdId);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('create_file is rejected for new files under plans/', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'spirit-host-tools-plans-whitelist-'));
  const spiritDataDir = join(workspaceRoot, '.spirit-data');

  try {
    await mkdir(join(spiritDataDir, 'plans'), { recursive: true });

    const service = new NodeHostToolService({ workspaceRoot, spiritDataDir });
    await assert.rejects(
      () =>
        service.execute({
          name: 'create_file',
          path: join(spiritDataDir, 'plans', 'blocked.md'),
          content: 'nope',
        }),
      /create_plan/,
    );
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
