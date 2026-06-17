import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { NodeHostToolService } from './tools.js';
import { createHostTodoStore } from './todos.js';

test('todo tools create list update complete and purge when all done', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'spirit-host-todos-'));
  const spiritDataDir = join(workspaceRoot, '.spirit-data');
  const sessionKey = join(workspaceRoot, 'session-a.json');

  try {
    const service = new NodeHostToolService(
      { workspaceRoot, spiritDataDir },
      { todoScope: { sessionKey } },
    );

    const created = JSON.parse(
      await service.execute({
        name: 'todo_create',
        items: [{ title: 'First' }, { title: 'Second' }],
      }) as string,
    ) as { todos: Array<{ id: string; title: string; status: string }> };
    assert.equal(created.todos.length, 2);
    const firstId = created.todos[0]!.id;

    const listed = JSON.parse(
      await service.execute({ name: 'todo_list', include_completed: true }) as string,
    ) as { todos: unknown[] };
    assert.equal(listed.todos.length, 2);

    const updated = JSON.parse(
      await service.execute({
        name: 'todo_update',
        id: firstId,
        title: 'First renamed',
      }) as string,
    ) as { todo: { title: string } };
    assert.equal(updated.todo.title, 'First renamed');

    const completeFirst = JSON.parse(
      await service.execute({ name: 'todo_complete', id: firstId }) as string,
    ) as { allCompleted: boolean };
    assert.equal(completeFirst.allCompleted, false);

    const secondId = created.todos[1]!.id;
    const completeSecond = JSON.parse(
      await service.execute({ name: 'todo_complete', id: secondId }) as string,
    ) as { allCompleted: boolean; todos: unknown[] };
    assert.equal(completeSecond.allCompleted, true);
    assert.equal(completeSecond.todos.length, 2);

    const store = createHostTodoStore({ spiritDataDir, scope: { sessionKey } });
    await store.purge();
    const afterPurge = await store.list();
    assert.equal(afterPurge.length, 0);
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
    await store.create([{ title: 'Alpha' }]);
    const snapshot = await store.list();
    await store.create([{ title: 'Beta' }]);
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
      name: 'todo_create',
      items: [{ title: 'Only A' }],
    });

    service.setTodoScope({ sessionKey: sessionKeyB });
    await service.execute({
      name: 'todo_create',
      items: [{ title: 'Only B' }],
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
      name: 'todo_create',
      items: [{ title: 'Only A' }],
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
    await store.create([{ title: 'Draft task' }]);
    const listed = await store.list({ includeCompleted: true });
    assert.equal(listed.length, 1);
    assert.equal(listed[0]?.title, 'Draft task');
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});
