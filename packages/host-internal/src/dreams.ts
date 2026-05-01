import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const DREAM_RETENTION_MS = 5 * 24 * 60 * 60 * 1000;

const DREAMS_DIR_NAME = 'dreams';
const DREAM_LOGS_DIR_NAME = 'dream-logs';

export interface HostDreamScope {
  workspaceRoot: string;
  gitBranch: string;
}

export type HostDreamRecordStatus = 'active' | 'superseded' | 'deleted';

export interface HostDreamSourceSessionRef {
  path: string;
  displayName?: string;
  savedAtUnixMs?: number;
}

export interface HostDreamRecord {
  id: string;
  scope: HostDreamScope;
  title: string;
  summary: string;
  details?: string;
  tags?: string[];
  status: HostDreamRecordStatus;
  createdAtUnixMs: number;
  updatedAtUnixMs: number;
  expiresAtUnixMs: number;
  sourceSessions: HostDreamSourceSessionRef[];
}

export interface HostDreamListOptions {
  includeDeleted?: boolean;
  includeExpired?: boolean;
  nowUnixMs?: number;
}

export interface HostDreamRecordInput {
  title: string;
  summary: string;
  details?: string;
  tags?: string[];
  sourceSession?: HostDreamSourceSessionRef;
}

export interface HostDreamUpdateInput {
  id: string;
  title?: string;
  summary?: string;
  details?: string;
  tags?: string[];
}

interface HostDreamFile {
  version: 1;
  scope: HostDreamScope;
  records: HostDreamRecord[];
}

export function dreamsDirPath(spiritDataDir: string): string {
  return path.join(spiritDataDir, DREAMS_DIR_NAME);
}

export function dreamLogsDirPath(spiritDataDir: string): string {
  return path.join(spiritDataDir, DREAM_LOGS_DIR_NAME);
}

export function createHostDreamStore(input: {
  spiritDataDir: string;
  scope: HostDreamScope;
}): HostDreamStore {
  return new HostDreamStore(input.spiritDataDir, normalizeDreamScope(input.scope));
}

export class HostDreamStore {
  private readonly filePath: string;

  constructor(
    private readonly spiritDataDir: string,
    private readonly scope: HostDreamScope,
  ) {
    this.filePath = path.join(dreamsDirPath(spiritDataDir), `${dreamScopeKey(scope)}.json`);
  }

  async list(options: HostDreamListOptions = {}): Promise<HostDreamRecord[]> {
    const file = await this.loadFile();
    const now = options.nowUnixMs ?? Date.now();
    return file.records
      .filter((record) => {
        if (!options.includeDeleted && record.status === 'deleted') {
          return false;
        }
        if (!options.includeExpired && record.expiresAtUnixMs <= now) {
          return false;
        }
        return true;
      })
      .sort((left, right) => right.updatedAtUnixMs - left.updatedAtUnixMs);
  }

  async read(id: string): Promise<HostDreamRecord | undefined> {
    const file = await this.loadFile();
    return file.records.find((record) => record.id === id);
  }

  async record(input: HostDreamRecordInput): Promise<HostDreamRecord> {
    const file = await this.loadFile();
    const now = Date.now();
    const details = normalizeOptionalText(input.details);
    const tags = normalizeTags(input.tags ?? []);
    const record: HostDreamRecord = {
      id: randomUUID(),
      scope: this.scope,
      title: normalizeNonEmpty(input.title, 'title'),
      summary: normalizeNonEmpty(input.summary, 'summary'),
      ...(details ? { details } : {}),
      ...(tags.length > 0 ? { tags } : {}),
      status: 'active',
      createdAtUnixMs: now,
      updatedAtUnixMs: now,
      expiresAtUnixMs: now + DREAM_RETENTION_MS,
      sourceSessions: input.sourceSession ? [input.sourceSession] : [],
    };
    file.records.push(record);
    await this.saveFile(file);
    return record;
  }

  async update(input: HostDreamUpdateInput): Promise<HostDreamRecord> {
    const file = await this.loadFile();
    const index = file.records.findIndex((record) => record.id === input.id);
    if (index < 0) {
      throw new Error(`梦境不存在: ${input.id}`);
    }

    const now = Date.now();
    const current = file.records[index]!;
    const next: HostDreamRecord = {
      ...current,
      ...(input.title !== undefined ? { title: normalizeNonEmpty(input.title, 'title') } : {}),
      ...(input.summary !== undefined ? { summary: normalizeNonEmpty(input.summary, 'summary') } : {}),
      status: current.status === 'deleted' ? 'active' : current.status,
      updatedAtUnixMs: now,
      expiresAtUnixMs: now + DREAM_RETENTION_MS,
    };
    if (input.details !== undefined) {
      const details = normalizeOptionalText(input.details);
      if (details) {
        next.details = details;
      } else {
        delete next.details;
      }
    }
    if (input.tags !== undefined) {
      const tags = normalizeTags(input.tags);
      if (tags.length > 0) {
        next.tags = tags;
      } else {
        delete next.tags;
      }
    }
    file.records[index] = stripUndefinedRecordFields(next);
    await this.saveFile(file);
    return file.records[index]!;
  }

  async delete(id: string, reason: string): Promise<HostDreamRecord> {
    const file = await this.loadFile();
    const index = file.records.findIndex((record) => record.id === id);
    if (index < 0) {
      throw new Error(`梦境不存在: ${id}`);
    }
    const now = Date.now();
    file.records[index] = {
      ...file.records[index]!,
      status: 'deleted',
      details: appendDetails(file.records[index]!.details, `Deleted: ${normalizeNonEmpty(reason, 'reason')}`),
      updatedAtUnixMs: now,
      expiresAtUnixMs: now + DREAM_RETENTION_MS,
    };
    await this.saveFile(file);
    return file.records[index]!;
  }

  async pruneExpired(nowUnixMs = Date.now()): Promise<number> {
    const file = await this.loadFile();
    const before = file.records.length;
    file.records = file.records.filter((record) => record.expiresAtUnixMs > nowUnixMs);
    if (file.records.length !== before) {
      await this.saveFile(file);
    }
    return before - file.records.length;
  }

  private async loadFile(): Promise<HostDreamFile> {
    if (!existsSync(this.filePath)) {
      return { version: 1, scope: this.scope, records: [] };
    }

    const raw = await readFile(this.filePath, 'utf8');
    const parsed = JSON.parse(raw) as Partial<HostDreamFile>;
    return {
      version: 1,
      scope: normalizeDreamScope(parsed.scope ?? this.scope),
      records: Array.isArray(parsed.records)
        ? parsed.records.map((record) => normalizeDreamRecord(record, this.scope))
        : [],
    };
  }

  private async saveFile(file: HostDreamFile): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, `${JSON.stringify(file, null, 2)}\n`, 'utf8');
  }
}

function normalizeDreamScope(scope: Partial<HostDreamScope>): HostDreamScope {
  return {
    workspaceRoot: normalizeNonEmpty(scope.workspaceRoot, 'workspaceRoot'),
    gitBranch: normalizeNonEmpty(scope.gitBranch, 'gitBranch'),
  };
}

function dreamScopeKey(scope: HostDreamScope): string {
  return createHash('sha256')
    .update(`${scope.workspaceRoot}\0${scope.gitBranch}`)
    .digest('hex')
    .slice(0, 32);
}

function normalizeDreamRecord(value: unknown, fallbackScope: HostDreamScope): HostDreamRecord {
  const record = typeof value === 'object' && value !== null ? value as Partial<HostDreamRecord> : {};
  const now = Date.now();
  const details = normalizeOptionalText(record.details);
  const tags = Array.isArray(record.tags) ? normalizeTags(record.tags) : [];
  return {
    id: normalizeOptionalText(record.id) ?? randomUUID(),
    scope: normalizeDreamScope(record.scope ?? fallbackScope),
    title: normalizeOptionalText(record.title) ?? 'Untitled dream',
    summary: normalizeOptionalText(record.summary) ?? '',
    ...(details ? { details } : {}),
    ...(tags.length > 0 ? { tags } : {}),
    status: record.status === 'superseded' || record.status === 'deleted' ? record.status : 'active',
    createdAtUnixMs: normalizeUnixMs(record.createdAtUnixMs) ?? now,
    updatedAtUnixMs: normalizeUnixMs(record.updatedAtUnixMs) ?? now,
    expiresAtUnixMs: normalizeUnixMs(record.expiresAtUnixMs) ?? now + DREAM_RETENTION_MS,
    sourceSessions: Array.isArray(record.sourceSessions)
      ? record.sourceSessions.map(normalizeSourceSession).filter((entry): entry is HostDreamSourceSessionRef => entry !== undefined)
      : [],
  };
}

function normalizeSourceSession(value: unknown): HostDreamSourceSessionRef | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  const source = value as Partial<HostDreamSourceSessionRef>;
  const sourcePath = normalizeOptionalText(source.path);
  if (!sourcePath) {
    return undefined;
  }
  const displayName = normalizeOptionalText(source.displayName);
  const savedAtUnixMs = normalizeUnixMs(source.savedAtUnixMs);
  return {
    path: sourcePath,
    ...(displayName ? { displayName } : {}),
    ...(savedAtUnixMs !== undefined ? { savedAtUnixMs } : {}),
  };
}

function normalizeTags(tags: string[]): string[] {
  return [...new Set(tags.map((tag) => tag.trim()).filter((tag) => tag.length > 0))].slice(0, 12);
}

function normalizeNonEmpty(value: unknown, field: string): string {
  const normalized = normalizeOptionalText(value);
  if (!normalized) {
    throw new Error(`${field} 不能为空`);
  }
  return normalized;
}

function normalizeOptionalText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function normalizeUnixMs(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : undefined;
}

function appendDetails(existing: string | undefined, addition: string): string {
  return [existing?.trim(), addition.trim()].filter(Boolean).join('\n');
}

function stripUndefinedRecordFields(record: HostDreamRecord): HostDreamRecord {
  return JSON.parse(JSON.stringify(record)) as HostDreamRecord;
}