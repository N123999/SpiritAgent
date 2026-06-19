import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { NodeHostToolService } from './tools.js';
import { createHostTodoStore } from './todos.js';

test('todo_list and todo_write replace the full session list', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'spirit-host-todos-'));
  const spiritDataDir = join(workspaceRoot, '.spirit-data');
  const sessionKey = join(workspaceRoot, 'session-a.json');

  try {
    const service = new NodeHostToolService(
      { workspaceRoot, spiritDataDir },
      { todoScope: { sessionKey } },
    );

    const written = JSON.parse(
      await service.execute({
        name: 'todo_write',
        todos: [
          { title: 'First', status: 'pending' },
          { title: 'Second', status: 'pending' },
        ],
      }) as string,
    ) as { todos: Array<{ title: string; status: string }> };
    assert.deepEqual(written.todos, [
      { title: 'First', status: 'pending' },
      { title: 'Second', status: 'pending' },
    ]);
    assert.equal(Object.keys(written.todos[0]!).sort().join(','), 'status,title');

    const listed = JSON.parse(
      await service.execute({ name: 'todo_list', include_completed: true }) as string,
    ) as { todos: Array<{ title: string; status: string }> };
    assert.deepEqual(listed.todos, written.todos);

    const replaced = JSON.parse(
      await service.execute({
        name: 'todo_write',
        todos: [
          { title: 'First renamed', status: 'completed' },
          { title: 'Second', status: 'pending' },
        ],
      }) as string,
    ) as { todos: Array<{ title: string; status: string }> };
    assert.equal(replaced.todos.length, 2);
    assert.equal(replaced.todos[0]?.title, 'First renamed');
    assert.equal(replaced.todos[0]?.status, 'completed');

    const cleared = JSON.parse(
      await service.execute({ name: 'todo_write', todos: [] }) as string,
    ) as { todos: unknown[] };
    assert.deepEqual(cleared.todos, []);

    const afterClear = JSON.parse(
      await service.execute({ name: 'todo_list', include_completed: true }) as string,
    ) as { todos: unknown[] };
    assert.deepEqual(afterClear.todos, []);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('todo_write stores in_progress status and lists it when include_completed is false', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'spirit-host-todos-inprogress-'));
  const spiritDataDir = join(workspaceRoot, '.spirit-data');
  const sessionKey = join(workspaceRoot, 'session-c.json');

  try {
    const store = createHostTodoStore({ spiritDataDir, scope: { sessionKey } });
    await store.write([
      { title: 'Pending task', status: 'pending' },
      { title: 'Active task', status: 'in_progress' },
      { title: 'Done task', status: 'completed' },
    ]);

    const all = await store.listItems({ includeCompleted: true });
    assert.deepEqual(all, [
      { title: 'Pending task', status: 'pending' },
      { title: 'Active task', status: 'in_progress' },
      { title: 'Done task', status: 'completed' },
    ]);

    const withoutCompleted = await store.listItems({ includeCompleted: false });
    assert.deepEqual(withoutCompleted, [
      { title: 'Pending task', status: 'pending' },
      { title: 'Active task', status: 'in_progress' },
    ]);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('todo store replaceAll restores rewind snapshot', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'spirit-host-todos-rewind-'));
  const spiritDataDir = join(workspaceRoot, '.spirit-data');
  const sessionKey = join(workspaceRoot, 'session-b.json');

  try {
    const store = createHostTodoStore({ spiritDataDir, scope: { sessionKey } });
    await store.write([{ title: 'Alpha', status: 'pending' }]);
    const snapshot = await store.list();
    await store.write([
      { title: 'Alpha', status: 'pending' },
      { title: 'Beta', status: 'pending' },
    ]);
    assert.equal((await store.list()).length, 2);

    await store.replaceAll(snapshot);
    const restored = await store.list();
    assert.equal(restored.length, 1);
    assert.equal(restored[0]?.title, 'Alpha');
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('setTodoScope swaps todo store without rebuilding service', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'spirit-host-todos-swap-'));
  const spiritDataDir = join(workspaceRoot, '.spirit-data');
  const sessionKeyA = join(workspaceRoot, 'a.json');
  const sessionKeyB = join(workspaceRoot, 'b.json');

  try {
    const service = new NodeHostToolService(
      { workspaceRoot, spiritDataDir },
      { todoScope: { sessionKey: sessionKeyA } },
    );

    await service.execute({
      name: 'todo_write',
      todos: [{ title: 'Only A', status: 'pending' }],
    });

    service.setTodoScope({ sessionKey: sessionKeyB });
    await service.execute({
      name: 'todo_write',
      todos: [{ title: 'Only B', status: 'pending' }],
    });

    service.setTodoScope({ sessionKey: sessionKeyA });
    const listA = JSON.parse(
      await service.execute({ name: 'todo_list', include_completed: true }) as string,
    ) as { todos: Array<{ title: string }> };
    assert.equal(listA.todos.length, 1);
    assert.equal(listA.todos[0]?.title, 'Only A');

    service.setTodoScope({ sessionKey: sessionKeyB });
    const listB = JSON.parse(
      await service.execute({ name: 'todo_list', include_completed: true }) as string,
    ) as { todos: Array<{ title: string }> };
    assert.equal(listB.todos.length, 1);
    assert.equal(listB.todos[0]?.title, 'Only B');
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('todo scopes are isolated per sessionKey', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'spirit-host-todos-scope-'));
  const spiritDataDir = join(workspaceRoot, '.spirit-data');

  try {
    const serviceA = new NodeHostToolService(
      { workspaceRoot, spiritDataDir },
      { todoScope: { sessionKey: join(workspaceRoot, 'a.json') } },
    );
    const serviceB = new NodeHostToolService(
      { workspaceRoot, spiritDataDir },
      { todoScope: { sessionKey: join(workspaceRoot, 'b.json') } },
    );

    await serviceA.execute({
      name: 'todo_write',
      todos: [{ title: 'Only A', status: 'pending' }],
    });

    const listB = JSON.parse(
      await serviceB.execute({ name: 'todo_list', include_completed: true }) as string,
    ) as { todos: unknown[] };
    assert.equal(listB.todos.length, 0);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('todo-scope draft keys are not rewritten by path.resolve', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'spirit-host-todos-scope-'));
  const spiritDataDir = join(workspaceRoot, '.spirit-data');
  const scopeKey = 'todo-scope:11111111-2222-4333-8444-555555555555';

  try {
    const store = createHostTodoStore({ spiritDataDir, scope: { sessionKey: scopeKey } });
    await store.write([{ title: 'Draft task', status: 'pending' }]);
    const listed = await store.listItems({ includeCompleted: true });
    assert.equal(listed.length, 1);
    assert.equal(listed[0]?.title, 'Draft task');
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});
