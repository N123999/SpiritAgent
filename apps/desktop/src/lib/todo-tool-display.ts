export type TodoDisplayItem = {
  title: string;
  status: 'pending' | 'in_progress' | 'completed';
};

export type TodoWriteDelta = {
  added: number;
  completed: number;
  removed: number;
};

export function parseTodoItemsFromPayload(payload: unknown): TodoDisplayItem[] | undefined {
  if (payload === undefined || payload === null) {
    return undefined;
  }

  let parsed = payload;
  if (typeof payload === 'string') {
    const trimmed = payload.trim();
    if (!trimmed || !trimmed.startsWith('{')) {
      return undefined;
    }
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      // 流式 argsExcerpt 常不完整；与明确的 todos:[] 区分，避免误算「移除 N 个」
      return undefined;
    }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return undefined;
  }
  const todos = (parsed as Record<string, unknown>).todos;
  if (!Array.isArray(todos)) {
    return undefined;
  }

  const items: TodoDisplayItem[] = [];
  for (const entry of todos) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      continue;
    }
    const record = entry as Record<string, unknown>;
    const title = typeof record.title === 'string' ? record.title.trim() : '';
    if (!title) {
      continue;
    }
    items.push({
      title,
      status:
        record.status === 'completed'
          ? 'completed'
          : record.status === 'in_progress'
            ? 'in_progress'
            : 'pending',
    });
  }
  return items;
}

export function computeTodoWriteDelta(
  before: ReadonlyArray<TodoDisplayItem>,
  after: ReadonlyArray<TodoDisplayItem>,
): TodoWriteDelta {
  const beforeByTitle = new Map<string, TodoDisplayItem>();
  for (const item of before) {
    beforeByTitle.set(item.title, item);
  }
  const afterByTitle = new Map<string, TodoDisplayItem>();
  for (const item of after) {
    afterByTitle.set(item.title, item);
  }

  let added = 0;
  let completed = 0;
  let removed = 0;

  for (const [title, afterItem] of afterByTitle) {
    const beforeItem = beforeByTitle.get(title);
    if (!beforeItem) {
      added += 1;
      continue;
    }
    if (beforeItem.status !== 'completed' && afterItem.status === 'completed') {
      completed += 1;
    }
  }

  for (const title of beforeByTitle.keys()) {
    if (!afterByTitle.has(title)) {
      removed += 1;
    }
  }

  return { added, completed, removed };
}

export function formatTodoWriteDeltaDetail(
  delta: TodoWriteDelta,
  t: (key: string, options?: { count: number }) => string,
  separator: string,
): string | undefined {
  const parts: string[] = [];
  if (delta.added > 0) {
    parts.push(t('tool.todoWriteAdded', { count: delta.added }));
  }
  if (delta.completed > 0) {
    parts.push(t('tool.todoWriteCompleted', { count: delta.completed }));
  }
  if (delta.removed > 0) {
    parts.push(t('tool.todoWriteRemoved', { count: delta.removed }));
  }
  if (parts.length === 0) {
    return undefined;
  }
  return parts.join(separator);
}

export function todoWriteSummaryDetail(input: {
  before: ReadonlyArray<TodoDisplayItem>;
  afterPayload: unknown;
  t: (key: string, options?: { count: number }) => string;
  separator: string;
}): string | undefined {
  const after = parseTodoItemsFromPayload(input.afterPayload);
  if (after === undefined) {
    return undefined;
  }
  const delta = computeTodoWriteDelta(input.before, after);
  return formatTodoWriteDeltaDetail(delta, input.t, input.separator);
}

/** 执行前 TODO：优先用工具卡已固化的快照，避免 turn 收尾二次 integrate 读到变更后的 live cache。 */
export function resolveTodoWriteBeforeSnapshot(
  existing: ReadonlyArray<TodoDisplayItem> | undefined,
  liveBefore: ReadonlyArray<TodoDisplayItem>,
): ReadonlyArray<TodoDisplayItem> {
  if (existing !== undefined && existing.length > 0) {
    return [...existing];
  }
  return [...liveBefore];
}
