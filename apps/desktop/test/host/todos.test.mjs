import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import {
  buildTodosSystemMessage,
  startOpenAiToolAgentState,
} from '@spirit-agent/agent-core';
import { createHostTodoStore } from '@spirit-agent/host-internal';

import {
  buildSessionTodosContextText,
  listSessionTodos,
  replaceSessionTodos,
} from '../../dist-electron/src/host/todos.js';
import { spiritAgentDataDir } from '../../dist-electron/src/host/storage.js';
import { DesktopToolExecutor } from '../../dist-electron/src/host/tool-executor.js';

function functionToolNames(definitions) {
  return Array.isArray(definitions)
    ? definitions.flatMap((entry) => {
        if (!entry || typeof entry !== 'object') {
          return [];
        }
        const tool = entry.function;
        return tool && typeof tool === 'object' && typeof tool.name === 'string'
          ? [tool.name]
          : [];
      })
    : [];
}

test('desktop todo tools are exposed on the main agent executor', () => {
  const executor = new DesktopToolExecutor(process.cwd(), {
    todoScope: { sessionKey: path.join(process.cwd(), 'session-a.json') },
  });
  const names = functionToolNames(executor.toolDefinitionsJson());
  assert.ok(names.includes('todo_create'));
  assert.ok(names.includes('todo_list'));
  assert.ok(names.includes('todo_update'));
  assert.ok(names.includes('todo_complete'));
});

test('desktop todos context is injected into the main agent system message', async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'spirit-agent-todos-'));
  const previousAppData = process.env.APPDATA;
  const sessionKey = path.join(tempRoot, 'session-todos.json');

  try {
    process.env.APPDATA = tempRoot;

    const store = createHostTodoStore({
      spiritDataDir: spiritAgentDataDir(),
      scope: { sessionKey },
    });
    await store.create([{ title: 'Add session todo tools' }]);

    const todosContextText = await buildSessionTodosContextText(sessionKey);
    assert.match(todosContextText, /pending \| Add session todo tools/);

    const state = startOpenAiToolAgentState(
      [],
      'Continue the desktop work.',
      process.cwd(),
      [],
      [],
      [],
      'gpt-5.4',
      undefined,
      [],
      undefined,
      todosContextText,
    );

    const systemMessage = state.messages[0]?.content;
    assert.equal(typeof systemMessage, 'string');
    assert.match(systemMessage, /\[SPIRIT_TODOS\]/);
    assert.match(systemMessage, /todo_list/);
    assert.ok(systemMessage.includes(buildTodosSystemMessage(todosContextText)));
  } finally {
    if (previousAppData === undefined) {
      delete process.env.APPDATA;
    } else {
      process.env.APPDATA = previousAppData;
    }
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('replaceAll restores rewind todo snapshot per session', async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'spirit-agent-todos-rewind-'));
  const previousAppData = process.env.APPDATA;
  const sessionKey = path.join(tempRoot, 'session-rewind.json');

  try {
    process.env.APPDATA = tempRoot;
    const store = createHostTodoStore({
      spiritDataDir: spiritAgentDataDir(),
      scope: { sessionKey },
    });
    await store.create([{ title: 'Before rewind' }]);
    const snapshot = await listSessionTodos(sessionKey);
    await store.create([{ title: 'After more work' }]);
    assert.equal((await listSessionTodos(sessionKey)).length, 2);

    await replaceSessionTodos(sessionKey, snapshot);
    const restored = await listSessionTodos(sessionKey);
    assert.equal(restored.length, 1);
    assert.equal(restored[0]?.title, 'Before rewind');
  } finally {
    if (previousAppData === undefined) {
      delete process.env.APPDATA;
    } else {
      process.env.APPDATA = previousAppData;
    }
    await rm(tempRoot, { recursive: true, force: true });
  }
});
