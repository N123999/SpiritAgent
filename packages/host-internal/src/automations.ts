import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { ModelReasoningEffort } from './reasoning-effort.js';
import { normalizeApprovalLevel, type ApprovalLevel } from './tools.js';

export type HostAutomationWeekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export type HostAutomationSchedule =
  | { kind: 'hourly' }
  | { kind: 'daily'; hour: number; minute: number }
  | { kind: 'weekly'; weekday: HostAutomationWeekday; hour: number; minute: number };

export interface HostAutomationDefinition {
  id: string;
  title: string;
  overview: string;
  schedule: HostAutomationSchedule;
  workspaceRoot: string;
  modelName: string;
  reasoningEffort?: ModelReasoningEffort;
  approvalLevel: ApprovalLevel;
  enabled: boolean;
  createdAtUnixMs: number;
  updatedAtUnixMs: number;
  lastFiredAtUnixMs?: number;
}

export type HostAutomationRunStatus = 'running' | 'blocked' | 'completed' | 'failed';

export interface HostAutomationRun {
  id: string;
  automationId: string;
  sessionPath: string;
  status: HostAutomationRunStatus;
  startedAtUnixMs: number;
  completedAtUnixMs?: number;
  error?: string;
}

export interface HostAutomationListItem {
  id: string;
  title: string;
  scheduleLabel: string;
  enabled: boolean;
  lastRunAtUnixMs?: number;
  updatedAtUnixMs: number;
}

export interface HostAutomationCreateInput {
  title: string;
  overview: string;
  schedule: HostAutomationSchedule;
  workspaceRoot: string;
  modelName: string;
  reasoningEffort?: ModelReasoningEffort;
  approvalLevel: ApprovalLevel;
  enabled?: boolean;
}

export interface HostAutomationUpdateInput {
  title?: string;
  overview?: string;
  schedule?: HostAutomationSchedule;
  workspaceRoot?: string;
  modelName?: string;
  reasoningEffort?: ModelReasoningEffort;
  approvalLevel?: ApprovalLevel;
  enabled?: boolean;
}

interface HostAutomationFile {
  version: 1;
  definition: HostAutomationDefinition;
  runs: HostAutomationRun[];
}

const AUTOMATIONS_DIR_NAME = 'automations';

export function automationsDirPath(spiritDataDir: string): string {
  return path.join(spiritDataDir, AUTOMATIONS_DIR_NAME);
}

export function automationFilePath(spiritDataDir: string, automationId: string): string {
  return path.join(automationsDirPath(spiritDataDir), `${automationId}.json`);
}

export function createHostAutomationStore(spiritDataDir: string): HostAutomationStore {
  return new HostAutomationStore(spiritDataDir);
}

export function normalizeAutomationSchedule(value: unknown): HostAutomationSchedule | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  const schedule = value as Partial<HostAutomationSchedule>;
  if (schedule.kind === 'hourly') {
    return { kind: 'hourly' };
  }
  if (schedule.kind === 'daily') {
    const hour = normalizeHour(schedule.hour);
    const minute = normalizeMinute(schedule.minute);
    if (hour === undefined || minute === undefined) {
      return undefined;
    }
    return { kind: 'daily', hour, minute };
  }
  if (schedule.kind === 'weekly') {
    const weekday = normalizeWeekday(schedule.weekday);
    const hour = normalizeHour(schedule.hour);
    const minute = normalizeMinute(schedule.minute);
    if (weekday === undefined || hour === undefined || minute === undefined) {
      return undefined;
    }
    return { kind: 'weekly', weekday, hour, minute };
  }
  return undefined;
}

export function formatScheduleLabel(
  schedule: HostAutomationSchedule,
  labels?: Partial<ScheduleFormatLabels>,
): string {
  const l = { ...defaultScheduleFormatLabels(), ...labels };
  if (schedule.kind === 'hourly') {
    return l.hourly;
  }
  const time = formatTimeOfDay(schedule.hour, schedule.minute);
  if (schedule.kind === 'daily') {
    return `${l.dailyPrefix} ${time}`;
  }
  const weekday = l.weekdays[schedule.weekday] ?? String(schedule.weekday);
  return `每${weekday} ${time}`;
}

export interface ScheduleFormatLabels {
  hourly: string;
  dailyPrefix: string;
  weeklyPrefix: string;
  weekdays: readonly string[];
}

function defaultScheduleFormatLabels(): ScheduleFormatLabels {
  return {
    hourly: '每小时',
    dailyPrefix: '每天',
    weeklyPrefix: '每周',
    weekdays: ['周日', '周一', '周二', '周三', '周四', '周五', '周六'],
  };
}

export function computeNextRunAt(schedule: HostAutomationSchedule, afterMs: number): number {
  const after = new Date(afterMs);
  if (schedule.kind === 'hourly') {
    const next = new Date(after);
    next.setSeconds(0, 0);
    next.setMinutes(0);
    next.setHours(next.getHours() + 1);
    return next.getTime();
  }
  if (schedule.kind === 'daily') {
    return nextDailyOrWeeklyRun(after, schedule.hour, schedule.minute, undefined);
  }
  return nextDailyOrWeeklyRun(after, schedule.hour, schedule.minute, schedule.weekday);
}

export function shouldFireNow(
  schedule: HostAutomationSchedule,
  lastFiredMs: number | undefined,
  nowMs: number,
): boolean {
  const now = new Date(nowMs);
  const minuteBucket = floorToMinute(nowMs);
  if (lastFiredMs !== undefined && floorToMinute(lastFiredMs) >= minuteBucket) {
    return false;
  }

  if (schedule.kind === 'hourly') {
    return now.getMinutes() === 0;
  }
  if (now.getHours() !== schedule.hour || now.getMinutes() !== schedule.minute) {
    return false;
  }
  if (schedule.kind === 'daily') {
    return true;
  }
  return now.getDay() === schedule.weekday;
}

export class HostAutomationStore {
  constructor(private readonly spiritDataDir: string) {}

  async listSummaries(): Promise<HostAutomationListItem[]> {
    const files = await this.listAutomationFiles();
    const summaries: HostAutomationListItem[] = [];
    for (const filePath of files) {
      const file = await this.loadFileAt(filePath);
      if (!file) {
        continue;
      }
      const lastRun = file.runs
        .slice()
        .sort((left, right) => right.startedAtUnixMs - left.startedAtUnixMs)[0];
      summaries.push({
        id: file.definition.id,
        title: file.definition.title,
        scheduleLabel: formatScheduleLabel(file.definition.schedule),
        enabled: file.definition.enabled,
        ...(lastRun ? { lastRunAtUnixMs: lastRun.startedAtUnixMs } : {}),
        updatedAtUnixMs: file.definition.updatedAtUnixMs,
      });
    }
    return summaries.sort((left, right) => right.updatedAtUnixMs - left.updatedAtUnixMs);
  }

  async get(automationId: string): Promise<{ definition: HostAutomationDefinition; runs: HostAutomationRun[] } | undefined> {
    const file = await this.loadFile(automationId);
    if (!file) {
      return undefined;
    }
    return {
      definition: { ...file.definition },
      runs: [...file.runs],
    };
  }

  async create(input: HostAutomationCreateInput): Promise<HostAutomationDefinition> {
    const now = Date.now();
    const schedule = normalizeAutomationSchedule(input.schedule);
    if (!schedule) {
      throw new Error('Invalid automation schedule.');
    }
    const definition: HostAutomationDefinition = {
      id: randomUUID(),
      title: normalizeNonEmpty(input.title, 'title'),
      overview: normalizeNonEmpty(input.overview, 'overview'),
      schedule,
      workspaceRoot: path.resolve(normalizeNonEmpty(input.workspaceRoot, 'workspaceRoot')),
      modelName: normalizeNonEmpty(input.modelName, 'modelName'),
      ...(input.reasoningEffort ? { reasoningEffort: input.reasoningEffort } : {}),
      approvalLevel: normalizeApprovalLevel(input.approvalLevel),
      enabled: input.enabled !== false,
      createdAtUnixMs: now,
      updatedAtUnixMs: now,
    };
    const file: HostAutomationFile = { version: 1, definition, runs: [] };
    await this.saveFile(definition.id, file);
    return { ...definition };
  }

  async update(automationId: string, patch: HostAutomationUpdateInput): Promise<HostAutomationDefinition> {
    const file = await this.requireFile(automationId);
    const now = Date.now();
    if (patch.title !== undefined) {
      file.definition.title = normalizeNonEmpty(patch.title, 'title');
    }
    if (patch.overview !== undefined) {
      file.definition.overview = normalizeNonEmpty(patch.overview, 'overview');
    }
    if (patch.schedule !== undefined) {
      const schedule = normalizeAutomationSchedule(patch.schedule);
      if (!schedule) {
        throw new Error('Invalid automation schedule.');
      }
      file.definition.schedule = schedule;
    }
    if (patch.workspaceRoot !== undefined) {
      file.definition.workspaceRoot = path.resolve(normalizeNonEmpty(patch.workspaceRoot, 'workspaceRoot'));
    }
    if (patch.modelName !== undefined) {
      file.definition.modelName = normalizeNonEmpty(patch.modelName, 'modelName');
    }
    if (patch.reasoningEffort !== undefined) {
      file.definition.reasoningEffort = patch.reasoningEffort;
    }
    if (patch.approvalLevel !== undefined) {
      file.definition.approvalLevel = normalizeApprovalLevel(patch.approvalLevel);
    }
    if (patch.enabled !== undefined) {
      file.definition.enabled = patch.enabled;
    }
    file.definition.updatedAtUnixMs = now;
    await this.saveFile(automationId, file);
    return { ...file.definition };
  }

  async delete(automationId: string): Promise<void> {
    const filePath = automationFilePath(this.spiritDataDir, automationId);
    if (existsSync(filePath)) {
      await unlink(filePath);
    }
  }

  async setEnabled(automationId: string, enabled: boolean): Promise<HostAutomationDefinition> {
    return this.update(automationId, { enabled });
  }

  async listEnabledDefinitions(): Promise<HostAutomationDefinition[]> {
    const files = await this.listAutomationFiles();
    const definitions: HostAutomationDefinition[] = [];
    for (const filePath of files) {
      const file = await this.loadFileAt(filePath);
      if (file?.definition.enabled) {
        definitions.push({ ...file.definition });
      }
    }
    return definitions;
  }

  async markFired(automationId: string, firedAtUnixMs: number): Promise<void> {
    const file = await this.requireFile(automationId);
    file.definition.lastFiredAtUnixMs = firedAtUnixMs;
    file.definition.updatedAtUnixMs = firedAtUnixMs;
    await this.saveFile(automationId, file);
  }

  async addRun(automationId: string, run: HostAutomationRun): Promise<HostAutomationRun> {
    const file = await this.requireFile(automationId);
    const normalized = normalizeAutomationRun(run);
    if (!normalized) {
      throw new Error('Invalid automation run.');
    }
    file.runs.push(normalized);
    file.definition.updatedAtUnixMs = Date.now();
    await this.saveFile(automationId, file);
    return { ...normalized };
  }

  async updateRun(
    automationId: string,
    runId: string,
    patch: Partial<Pick<HostAutomationRun, 'status' | 'completedAtUnixMs' | 'error' | 'sessionPath'>>,
  ): Promise<HostAutomationRun> {
    const file = await this.requireFile(automationId);
    const index = file.runs.findIndex((run) => run.id === runId);
    if (index < 0) {
      throw new Error(`Automation run not found: ${runId}`);
    }
    const current = file.runs[index]!;
    const next: HostAutomationRun = {
      ...current,
      ...(patch.sessionPath !== undefined ? { sessionPath: patch.sessionPath } : {}),
      ...(patch.status !== undefined ? { status: patch.status } : {}),
      ...(patch.completedAtUnixMs !== undefined ? { completedAtUnixMs: patch.completedAtUnixMs } : {}),
      ...(patch.error !== undefined ? { error: patch.error } : {}),
    };
    file.runs[index] = next;
    file.definition.updatedAtUnixMs = Date.now();
    await this.saveFile(automationId, file);
    return { ...next };
  }

  async getActiveRun(automationId: string): Promise<HostAutomationRun | undefined> {
    const file = await this.loadFile(automationId);
    if (!file) {
      return undefined;
    }
    return file.runs.find((run) => run.status === 'running');
  }

  private async listAutomationFiles(): Promise<string[]> {
    const dirPath = automationsDirPath(this.spiritDataDir);
    if (!existsSync(dirPath)) {
      return [];
    }
    const entries = await readdir(dirPath, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .map((entry) => path.join(dirPath, entry.name));
  }

  private async loadFile(automationId: string): Promise<HostAutomationFile | undefined> {
    return this.loadFileAt(automationFilePath(this.spiritDataDir, automationId));
  }

  private async requireFile(automationId: string): Promise<HostAutomationFile> {
    const file = await this.loadFile(automationId);
    if (!file) {
      throw new Error(`Automation not found: ${automationId}`);
    }
    return file;
  }

  private async loadFileAt(filePath: string): Promise<HostAutomationFile | undefined> {
    if (!existsSync(filePath)) {
      return undefined;
    }
    const raw = await readFile(filePath, 'utf8');
    let parsed: Partial<HostAutomationFile>;
    try {
      parsed = JSON.parse(raw) as Partial<HostAutomationFile>;
    } catch {
      return undefined;
    }
    const definition = normalizeAutomationDefinition(parsed.definition);
    if (!definition) {
      return undefined;
    }
    return {
      version: 1,
      definition,
      runs: Array.isArray(parsed.runs)
        ? parsed.runs
            .map((run) => normalizeAutomationRun(run))
            .filter((run): run is HostAutomationRun => run !== undefined)
        : [],
    };
  }

  private async saveFile(automationId: string, file: HostAutomationFile): Promise<void> {
    const filePath = automationFilePath(this.spiritDataDir, automationId);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, `${JSON.stringify(file, null, 2)}\n`, 'utf8');
  }
}

function normalizeAutomationDefinition(value: unknown): HostAutomationDefinition | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Partial<HostAutomationDefinition>;
  if (typeof record.id !== 'string' || !record.id.trim()) {
    return undefined;
  }
  const schedule = normalizeAutomationSchedule(record.schedule);
  if (!schedule) {
    return undefined;
  }
  if (typeof record.title !== 'string' || !record.title.trim()) {
    return undefined;
  }
  if (typeof record.overview !== 'string' || !record.overview.trim()) {
    return undefined;
  }
  if (typeof record.workspaceRoot !== 'string' || !record.workspaceRoot.trim()) {
    return undefined;
  }
  if (typeof record.modelName !== 'string' || !record.modelName.trim()) {
    return undefined;
  }
  const createdAtUnixMs =
    typeof record.createdAtUnixMs === 'number' ? record.createdAtUnixMs : Date.now();
  const updatedAtUnixMs =
    typeof record.updatedAtUnixMs === 'number' ? record.updatedAtUnixMs : createdAtUnixMs;
  return {
    id: record.id.trim(),
    title: record.title.trim(),
    overview: record.overview.trim(),
    schedule,
    workspaceRoot: path.resolve(record.workspaceRoot.trim()),
    modelName: record.modelName.trim(),
    ...(record.reasoningEffort ? { reasoningEffort: record.reasoningEffort } : {}),
    approvalLevel: normalizeApprovalLevel(record.approvalLevel),
    enabled: record.enabled !== false,
    createdAtUnixMs,
    updatedAtUnixMs,
    ...(typeof record.lastFiredAtUnixMs === 'number'
      ? { lastFiredAtUnixMs: record.lastFiredAtUnixMs }
      : {}),
  };
}

function normalizeAutomationRun(value: unknown): HostAutomationRun | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Partial<HostAutomationRun>;
  if (typeof record.id !== 'string' || !record.id.trim()) {
    return undefined;
  }
  if (typeof record.automationId !== 'string' || !record.automationId.trim()) {
    return undefined;
  }
  if (typeof record.sessionPath !== 'string' || !record.sessionPath.trim()) {
    return undefined;
  }
  const status =
    record.status === 'running'
    || record.status === 'blocked'
    || record.status === 'completed'
    || record.status === 'failed'
      ? record.status
      : undefined;
  if (!status) {
    return undefined;
  }
  if (typeof record.startedAtUnixMs !== 'number') {
    return undefined;
  }
  return {
    id: record.id.trim(),
    automationId: record.automationId.trim(),
    sessionPath: record.sessionPath.trim(),
    status,
    startedAtUnixMs: record.startedAtUnixMs,
    ...(typeof record.completedAtUnixMs === 'number'
      ? { completedAtUnixMs: record.completedAtUnixMs }
      : {}),
    ...(typeof record.error === 'string' && record.error.trim()
      ? { error: record.error.trim() }
      : {}),
  };
}

function normalizeNonEmpty(value: string, field: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${field} must be a non-empty string.`);
  }
  return trimmed;
}

function normalizeHour(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 23) {
    return undefined;
  }
  return value;
}

function normalizeMinute(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 59) {
    return undefined;
  }
  return value;
}

function normalizeWeekday(value: unknown): HostAutomationWeekday | undefined {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 6) {
    return undefined;
  }
  return value as HostAutomationWeekday;
}

function formatTimeOfDay(hour: number, minute: number): string {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function floorToMinute(ms: number): number {
  const date = new Date(ms);
  date.setSeconds(0, 0);
  return date.getTime();
}

function nextDailyOrWeeklyRun(
  after: Date,
  hour: number,
  minute: number,
  weekday: HostAutomationWeekday | undefined,
): number {
  const candidate = new Date(after);
  candidate.setSeconds(0, 0);
  candidate.setMilliseconds(0);
  candidate.setHours(hour, minute, 0, 0);

  if (weekday === undefined) {
    if (candidate.getTime() <= after.getTime()) {
      candidate.setDate(candidate.getDate() + 1);
    }
    return candidate.getTime();
  }

  const dayDelta = (weekday - candidate.getDay() + 7) % 7;
  candidate.setDate(candidate.getDate() + dayDelta);
  if (candidate.getTime() <= after.getTime()) {
    candidate.setDate(candidate.getDate() + 7);
  }
  return candidate.getTime();
}
