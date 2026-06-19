import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const HOST_TODO_MAX_ITEMS = 20;

export interface HostTodoScope {
  sessionKey: string;
}

export type HostTodoStatus = 'pending' | 'in_progress' | 'completed';

/** Model-visible todo item (tool list/write payloads). */
export interface HostTodoItem {
  title: string;
  status: HostTodoStatus;
}

/** Persisted todo record (host storage, rewind, UI). */
export interface HostTodoRecord {
  id: string;
  title: string;
  status: HostTodoStatus;
  createdAtUnixMs: number;
  updatedAtUnixMs: number;
  completedAtUnixMs?: number;
}

export interface HostTodoListOptions {
  includeCompleted?: boolean;
}

interface HostTodoFile {
  version: 1;
  scope: HostTodoScope;
  records: HostTodoRecord[];
}

export function todosDirPath(spiritDataDir: string): string {
  return path.join(spiritDataDir, 'todos');
}

export function createHostTodoStore(input: {
  spiritDataDir: string;
  scope: HostTodoScope;
}): HostTodoStore {
  return new HostTodoStore(input.spiritDataDir, normalizeTodoScope(input.scope));
}

export function hostTodoItemsFromRecords(records: HostTodoRecord[]): HostTodoItem[] {
  return records.map(({ title, status }) => ({ title, status }));
}

export class HostTodoStore {
  private readonly filePath: string;

  constructor(
    private readonly spiritDataDir: string,
    private readonly scope: HostTodoScope,
  ) {
    this.filePath = path.join(todosDirPath(spiritDataDir), `${todoScopeKey(scope)}.json`);
  }

  async list(options: HostTodoListOptions = {}): Promise<HostTodoRecord[]> {
    const file = await this.loadFile();
    const includeCompleted = options.includeCompleted !== false;
    return file.records
      .filter((record) => includeCompleted || record.status !== 'completed')
      .sort((left, right) => left.createdAtUnixMs - right.createdAtUnixMs);
  }

  async listItems(options: HostTodoListOptions = {}): Promise<HostTodoItem[]> {
    return hostTodoItemsFromRecords(await this.list(options));
  }

  async write(items: HostTodoItem[]): Promise<HostTodoItem[]> {
    if (items.length > HOST_TODO_MAX_ITEMS) {
      throw new Error(`会话 TODO 数量不能超过 ${HOST_TODO_MAX_ITEMS} 条。`);
    }

    const now = Date.now();
    const records: HostTodoRecord[] = items.map((item) => {
      const status: HostTodoStatus =
        item.status === 'completed'
          ? 'completed'
          : item.status === 'in_progress'
            ? 'in_progress'
            : 'pending';
      const record: HostTodoRecord = {
        id: randomUUID().slice(0, 8),
        title: normalizeNonEmpty(item.title, 'title'),
        status,
        createdAtUnixMs: now,
        updatedAtUnixMs: now,
      };
      if (status === 'completed') {
        record.completedAtUnixMs = now;
      }
      return record;
    });
    await this.replaceAll(records);
    return hostTodoItemsFromRecords(records);
  }

  async replaceAll(records: HostTodoRecord[]): Promise<HostTodoRecord[]> {
    const normalized = records
      .map((record) => normalizeTodoRecord(record))
      .filter((record): record is HostTodoRecord => record !== undefined);
    if (normalized.length === 0) {
      await this.purge();
      return [];
    }

    const file: HostTodoFile = {
      version: 1,
      scope: this.scope,
      records: normalized,
    };
    await this.saveFile(file);
    return [...normalized];
  }

  async purge(): Promise<void> {
    if (existsSync(this.filePath)) {
      await unlink(this.filePath);
    }
  }

  private async loadFile(): Promise<HostTodoFile> {
    if (!existsSync(this.filePath)) {
      return { version: 1, scope: this.scope, records: [] };
    }

    const raw = await readFile(this.filePath, 'utf8');
    let parsed: Partial<HostTodoFile>;
    try {
      parsed = JSON.parse(raw) as Partial<HostTodoFile>;
    } catch {
      return { version: 1, scope: this.scope, records: [] };
    }

    return {
      version: 1,
      scope: normalizeTodoScope(parsed.scope ?? this.scope),
      records: Array.isArray(parsed.records)
        ? parsed.records
            .map((record) => normalizeTodoRecord(record))
            .filter((record): record is HostTodoRecord => record !== undefined)
        : [],
    };
  }

  private async saveFile(file: HostTodoFile): Promise<void> {
    if (file.records.length === 0) {
      await this.purge();
      return;
    }
    await mkdir(path.dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, `${JSON.stringify(file, null, 2)}\n`, 'utf8');
  }
}

function todoScopeKey(scope: HostTodoScope): string {
  return createHash('sha256').update(scope.sessionKey).digest('hex').slice(0, 32);
}

function normalizeTodoScope(scope: HostTodoScope): HostTodoScope {
  const sessionKey = scope.sessionKey.trim();
  if (!sessionKey) {
    throw new Error('sessionKey is required for todo scope.');
  }
  // Opaque draft scope keys must not be passed through path.resolve (cwd-relative on Windows).
  if (sessionKey.startsWith('todo-scope:')) {
    return { sessionKey };
  }
  return { sessionKey: path.resolve(sessionKey) };
}

function normalizeNonEmpty(value: string, field: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${field} must be a non-empty string.`);
  }
  return trimmed;
}

function normalizeTodoRecord(value: unknown): HostTodoRecord | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Partial<HostTodoRecord>;
  if (typeof record.id !== 'string' || !record.id.trim()) {
    return undefined;
  }
  if (typeof record.title !== 'string' || !record.title.trim()) {
    return undefined;
  }
  const status: HostTodoStatus =
    record.status === 'completed'
      ? 'completed'
      : record.status === 'in_progress'
        ? 'in_progress'
        : 'pending';
  const createdAtUnixMs =
    typeof record.createdAtUnixMs === 'number' ? record.createdAtUnixMs : Date.now();
  const updatedAtUnixMs =
    typeof record.updatedAtUnixMs === 'number' ? record.updatedAtUnixMs : createdAtUnixMs;
  const normalized: HostTodoRecord = {
    id: record.id.trim(),
    title: record.title.trim(),
    status,
    createdAtUnixMs,
    updatedAtUnixMs,
  };
  if (status === 'completed') {
    normalized.completedAtUnixMs =
      typeof record.completedAtUnixMs === 'number' ? record.completedAtUnixMs : updatedAtUnixMs;
  }
  return normalized;
}
