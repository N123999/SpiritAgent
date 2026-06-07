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

class HelperSession {
  #child;
  #buffer = '';
  #waiters = [];

  constructor() {
    this.#child = spawn(helperExe, [], { stdio: ['pipe', 'pipe', 'pipe'] });
    this.#child.stdout.setEncoding('utf8');
    this.#child.stdout.on('data', (chunk) => {
      this.#buffer += chunk;
      this.#flush();
    });
    this.#child.on('error', (error) => {
      for (const waiter of this.#waiters.splice(0)) {
        waiter.reject(error);
      }
    });
    this.#child.on('close', (code) => {
      if (code !== 0 && this.#waiters.length > 0) {
        const error = new Error(`helper exited ${code}`);
        for (const waiter of this.#waiters.splice(0)) {
          waiter.reject(error);
        }
      }
    });
  }

  #flush() {
    let newlineIndex = this.#buffer.indexOf('\n');
    while (newlineIndex >= 0) {
      const line = this.#buffer.slice(0, newlineIndex).trim();
      this.#buffer = this.#buffer.slice(newlineIndex + 1);
      if (line.length > 0) {
        const waiter = this.#waiters.shift();
        if (waiter) {
          try {
            waiter.resolve(JSON.parse(line));
          } catch (error) {
            waiter.reject(error);
          }
        }
      }
      newlineIndex = this.#buffer.indexOf('\n');
    }
  }

  send(command) {
    return new Promise((resolve, reject) => {
      this.#waiters.push({ resolve, reject });
      this.#child.stdin.write(`${JSON.stringify(command)}\n`);
    });
  }

  close() {
    this.#child.stdin.end();
  }
}

function findFirstPatternNode(node, patternName) {
  if (!node || typeof node !== 'object') {
    return null;
  }
  if (Array.isArray(node.patterns) && node.patterns.includes(patternName)) {
    return node;
  }
  for (const child of node.children ?? []) {
    const found = findFirstPatternNode(child, patternName);
    if (found) {
      return found;
    }
  }
  return null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test('computer use e2e: notepad set_value via UIA tree', async (t) => {
  if (process.platform !== 'win32') {
    t.skip('Windows only');
    return;
  }

  spawn('taskkill', ['/IM', 'notepad.exe', '/F'], { stdio: 'ignore', windowsHide: true });
  await sleep(300);

  const notepad = spawn('notepad.exe', [], { detached: true, stdio: 'ignore', windowsHide: false });
  notepad.unref();

  const session = new HelperSession();
  try {
    await sleep(2500);

    const snapshot = await session.send({
      cmd: 'snapshot',
      process_name: 'Notepad.exe',
      max_depth: 10,
      max_nodes: 500,
    });
    assert.equal(snapshot.ok, true);
    const editNode = findFirstPatternNode(snapshot.data.tree, 'set_value');
    assert.ok(editNode, 'expected a set_value-capable editor node in Notepad tree');

    const action = await session.send({
      cmd: 'action',
      ref: editNode.ref,
      action: 'set_value',
      text: 'Spirit Agent Computer Use',
    });
    assert.equal(action.ok, true);
    assert.equal(action.data.action, 'set_value');

    await session.send({ cmd: 'shutdown' });
  } finally {
    session.close();
    spawn('taskkill', ['/IM', 'notepad.exe', '/F'], { stdio: 'ignore', windowsHide: true });
  }
});

test('computer use e2e: calculator invoke button', async (t) => {
  if (process.platform !== 'win32') {
    t.skip('Windows only');
    return;
  }

  spawn('taskkill', ['/IM', 'CalculatorApp.exe', '/F'], { stdio: 'ignore', windowsHide: true });
  await sleep(300);

  const calc = spawn('calc.exe', [], { detached: true, stdio: 'ignore', windowsHide: false });
  calc.unref();

  const session = new HelperSession();
  try {
    await sleep(3000);

    let snapshot = await session.send({
      cmd: 'snapshot',
      process_name: 'CalculatorApp.exe',
      max_depth: 12,
      max_nodes: 800,
    });
    if (!snapshot.ok) {
      snapshot = await session.send({
        cmd: 'snapshot',
        window_title: 'Calculator',
        max_depth: 12,
        max_nodes: 800,
      });
    }

    if (!snapshot.ok) {
      t.skip(`Calculator window not found in this environment: ${snapshot.error?.code}`);
      return;
    }

    const buttonNode = findFirstPatternNode(snapshot.data.tree, 'invoke');
    assert.ok(buttonNode, 'expected an invoke-capable button in Calculator tree');

    const action = await session.send({
      cmd: 'action',
      ref: buttonNode.ref,
      action: 'invoke',
    });
    assert.equal(action.ok, true);
    assert.equal(action.data.action, 'invoke');

    await session.send({ cmd: 'shutdown' });
  } finally {
    session.close();
    spawn('taskkill', ['/IM', 'CalculatorApp.exe', '/F'], { stdio: 'ignore', windowsHide: true });
  }
});
