import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const helperExe = path.join(
  __dirname,
  '../native/win-uia-helper/bin/Release/net8.0-windows/spirit-win-uia.exe',
);

function sendHelperCommands(commands) {
  return new Promise((resolve, reject) => {
    if (process.platform !== 'win32') {
      resolve({ skipped: true });
      return;
    }

    const child = spawn(helperExe, [], { stdio: ['pipe', 'pipe', 'pipe'] });
    const stdoutChunks = [];
    const stderrChunks = [];

    child.stdout.on('data', (chunk) => stdoutChunks.push(chunk));
    child.stderr.on('data', (chunk) => stderrChunks.push(chunk));
    child.on('error', reject);
    child.on('close', (code) => {
      const stdout = Buffer.concat(stdoutChunks).toString('utf8');
      const stderr = Buffer.concat(stderrChunks).toString('utf8');
      if (code !== 0) {
        reject(new Error(`helper exited ${code}: ${stderr || stdout}`));
        return;
      }

      const lines = stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
      resolve({ lines, stderr });
    });

    for (const command of commands) {
      child.stdin.write(`${JSON.stringify(command)}\n`);
    }
    child.stdin.end();
  });
}

test('spirit-win-uia preserves UTF-8 Chinese in JSON stdin', async (t) => {
  if (process.platform !== 'win32') {
    t.skip('Windows only');
    return;
  }

  const sample = '你好，我是 DeepSeek';
  const { lines } = await sendHelperCommands([
    { cmd: 'echo_text', text: sample },
    { cmd: 'shutdown' },
  ]);
  const echoed = JSON.parse(lines[0]);
  assert.equal(echoed.ok, true);
  assert.equal(echoed.data.text, sample);
});

test('spirit-win-uia ping returns pong', async (t) => {
  if (process.platform !== 'win32') {
    t.skip('Windows only');
    return;
  }

  const { lines } = await sendHelperCommands([{ cmd: 'ping' }, { cmd: 'shutdown' }]);
  assert.equal(lines.length, 2);
  const ping = JSON.parse(lines[0]);
  assert.equal(ping.ok, true);
  assert.equal(ping.data.pong, true);
});

test('spirit-win-uia snapshot requires target window', async (t) => {
  if (process.platform !== 'win32') {
    t.skip('Windows only');
    return;
  }

  const { lines } = await sendHelperCommands([{ cmd: 'snapshot' }, { cmd: 'shutdown' }]);
  const snapshot = JSON.parse(lines[0]);
  assert.equal(snapshot.ok, false);
  assert.equal(snapshot.error.code, 'process_name, window_title, or surface is required.');
});

test('spirit-win-uia action rejects unknown ref', async (t) => {
  if (process.platform !== 'win32') {
    t.skip('Windows only');
    return;
  }

  const { lines } = await sendHelperCommands([
    { cmd: 'action', ref: 'wdeadbeefn1', action: 'invoke' },
    { cmd: 'shutdown' },
  ]);
  const action = JSON.parse(lines[0]);
  assert.equal(action.ok, false);
  assert.equal(action.error.code, 'ref_not_found');
});

test('spirit-win-uia snapshot notepad reports host_kind native', async (t) => {
  if (process.platform !== 'win32') {
    t.skip('Windows only');
    return;
  }

  const { lines } = await sendHelperCommands([
    { cmd: 'snapshot', process_name: 'notepad.exe', max_depth: 4, max_nodes: 80 },
    { cmd: 'shutdown' },
  ]);
  const snapshot = JSON.parse(lines[0]);
  if (!snapshot.ok) {
    t.skip(`notepad not available: ${snapshot.error?.code ?? 'unknown'}`);
    return;
  }
  assert.equal(snapshot.data.host_kind, 'native');
});

test('spirit-win-uia snapshot cloudmusic reports host_kind cef when running', async (t) => {
  if (process.platform !== 'win32') {
    t.skip('Windows only');
    return;
  }

  const { lines } = await sendHelperCommands([
    { cmd: 'snapshot', process_name: 'cloudmusic.exe', max_depth: 4, max_nodes: 80 },
    { cmd: 'shutdown' },
  ]);
  const snapshot = JSON.parse(lines[0]);
  if (!snapshot.ok) {
    t.skip(`cloudmusic not available: ${snapshot.error?.code ?? 'unknown'}`);
    return;
  }
  assert.equal(snapshot.data.host_kind, 'cef');
});

test('spirit-win-uia list_windows includes taskbar shell surface', async (t) => {
  if (process.platform !== 'win32') {
    t.skip('Windows only');
    return;
  }

  const { lines } = await sendHelperCommands([{ cmd: 'list_windows' }, { cmd: 'shutdown' }]);
  const listed = JSON.parse(lines[0]);
  assert.equal(listed.ok, true);
  const taskbar = listed.data.windows.find((window) => window.surface === 'taskbar');
  assert.ok(taskbar, 'expected taskbar surface in list_windows');
  assert.equal(taskbar.class_name, 'Shell_TrayWnd');
  assert.ok(taskbar.hwnd > 0);
});

test('spirit-win-uia snapshot taskbar surface returns UIA tree', async (t) => {
  if (process.platform !== 'win32') {
    t.skip('Windows only');
    return;
  }

  const { lines } = await sendHelperCommands([
    { cmd: 'snapshot', surface: 'taskbar', max_depth: 6, max_nodes: 120 },
    { cmd: 'shutdown' },
  ]);
  const snapshot = JSON.parse(lines[0]);
  assert.equal(snapshot.ok, true);
  assert.equal(snapshot.data.host_kind, 'native');
  assert.equal(snapshot.data.window.surface, 'taskbar');
  assert.ok(snapshot.data.nodes_returned > 1);
});

test('spirit-win-uia list_windows returns array', async (t) => {
  if (process.platform !== 'win32') {
    t.skip('Windows only');
    return;
  }

  const { lines } = await sendHelperCommands([{ cmd: 'list_windows' }, { cmd: 'shutdown' }]);
  assert.equal(lines.length, 2);
  const listed = JSON.parse(lines[0]);
  assert.equal(listed.ok, true);
  assert.ok(Array.isArray(listed.data.windows));
});
