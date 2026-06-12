import assert from 'node:assert/strict';
import { chmod, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { runCommandHook } from './command-runner.js';

test('runCommandHook parses allow stdout', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'spirit-hook-cmd-'));
  const scriptPath = join(dir, 'allow.sh');
  await writeFile(
    scriptPath,
    `#!/bin/bash
cat > /dev/null
echo '{"permission":"allow"}'
`,
    'utf8',
  );
  await chmod(scriptPath, 0o755);

  const result = await runCommandHook({
    definition: {
      command: 'allow.sh',
      configDir: dir,
      scope: 'user',
      timeout: 5,
    },
    inputJson: '{"hookEventName":"preToolUse"}',
  });

  assert.equal(result.denied, false);
  assert.equal(result.effectiveOutput?.permission, 'allow');
  assert.equal(result.record.exitCode, 0);
});

test('runCommandHook parses ask stdout', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'spirit-hook-ask-'));
  const scriptPath = join(dir, 'ask.sh');
  await writeFile(
    scriptPath,
    `#!/bin/bash
cat > /dev/null
echo '{"permission":"ask","userMessage":"please confirm"}'
`,
    'utf8',
  );
  await chmod(scriptPath, 0o755);

  const result = await runCommandHook({
    definition: {
      command: 'ask.sh',
      configDir: dir,
      scope: 'user',
      timeout: 5,
    },
    inputJson: '{"hookEventName":"preToolUse"}',
  });

  assert.equal(result.denied, false);
  assert.equal(result.effectiveOutput?.permission, 'ask');
  assert.equal(result.effectiveOutput?.userMessage, 'please confirm');
});

test('runCommandHook treats exit code 2 as deny', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'spirit-hook-deny-'));
  const scriptPath = join(dir, 'deny.sh');
  await writeFile(
    scriptPath,
    `#!/bin/bash
cat > /dev/null
exit 2
`,
    'utf8',
  );
  await chmod(scriptPath, 0o755);

  const result = await runCommandHook({
    definition: {
      command: 'deny.sh',
      configDir: dir,
      scope: 'user',
      timeout: 5,
    },
    inputJson: '{}',
  });

  assert.equal(result.denied, true);
  assert.equal(result.record.exitCode, 2);
});

test('runCommandHook failClosed blocks on crash', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'spirit-hook-fail-'));
  const result = await runCommandHook({
    definition: {
      command: 'missing.sh',
      configDir: dir,
      scope: 'user',
      timeout: 5,
      failClosed: true,
    },
    inputJson: '{}',
  });

  assert.equal(result.denied, true);
  assert.equal(result.record.failed, true);
});

test('runCommandHook treats zero timeout as default duration', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'spirit-hook-timeout-zero-'));
  const scriptPath = join(dir, 'slow.sh');
  await writeFile(
    scriptPath,
    `#!/bin/bash
cat > /dev/null
sleep 0.05
echo '{}'
`,
    'utf8',
  );
  await chmod(scriptPath, 0o755);

  const result = await runCommandHook({
    definition: {
      command: 'slow.sh',
      configDir: dir,
      scope: 'user',
      timeout: 0,
    },
    inputJson: '{}',
  });

  assert.equal(result.record.timedOut, false);
  assert.equal(result.record.failed, false);
});

test('runCommandHook rejects escaped relative command paths when failClosed', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'spirit-hook-escape-'));
  const result = await runCommandHook({
    definition: {
      command: '../outside.sh',
      configDir: dir,
      scope: 'user',
      timeout: 5,
      failClosed: true,
    },
    inputJson: '{}',
  });

  assert.equal(result.denied, true);
  assert.match(result.record.stderr ?? '', /config directory/i);
});

test('runCommandHook failClosed blocks on invalid stdout json', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'spirit-hook-invalid-json-'));
  const scriptPath = join(dir, 'bad-json.sh');
  await writeFile(
    scriptPath,
    `#!/bin/bash
cat > /dev/null
echo 'not-json'
`,
    'utf8',
  );
  await chmod(scriptPath, 0o755);

  const result = await runCommandHook({
    definition: {
      command: 'bad-json.sh',
      configDir: dir,
      scope: 'user',
      timeout: 5,
      failClosed: true,
    },
    inputJson: '{}',
  });

  assert.equal(result.denied, true);
  assert.equal(result.effectiveOutput?.permission, 'deny');
});
