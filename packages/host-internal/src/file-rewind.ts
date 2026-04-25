import { existsSync } from 'node:fs';
import { lstat, mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

export type HostFileChangeKind = 'create_file' | 'edit_file' | 'delete_file';

export interface HostFileSnapshot {
  exists: boolean;
  file: boolean;
  content?: string;
  sha256?: string;
  mtimeMs?: number;
  size?: number;
}

export interface HostFileChangeRequestSummary {
  name: HostFileChangeKind;
  path: string;
  contentChars?: number;
  oldChars?: number;
  newChars?: number;
}

export interface HostToolRequestMetadata {
  toolCallId?: string;
  toolName?: string;
  subagentSessionId?: string;
  subagentTitle?: string;
}

export interface HostRecordedFileChange {
  id?: string;
  kind: HostFileChangeKind;
  path: string;
  resolvedPath: string;
  toolName: string;
  toolCallId?: string;
  subagentSessionId?: string;
  subagentTitle?: string;
  request: HostFileChangeRequestSummary;
  before: HostFileSnapshot;
  after: HostFileSnapshot;
  createdAtUnixMs: number;
}

export interface HostFileChangeObserver {
  recordFileChange(change: HostRecordedFileChange): Promise<void> | void;
}

export interface HostFileRewindWarning {
  changeId?: string;
  path: string;
  action: HostFileChangeKind;
  message: string;
}

export interface HostFileRewindResult {
  restored: number;
  skipped: number;
  warnings: HostFileRewindWarning[];
}

export async function readHostFileSnapshot(resolvedPath: string): Promise<HostFileSnapshot> {
  if (!existsSync(resolvedPath)) {
    return { exists: false, file: false };
  }

  const st = await lstat(resolvedPath);
  if (!st.isFile()) {
    return {
      exists: true,
      file: false,
      mtimeMs: st.mtimeMs,
      size: st.size,
    };
  }

  const content = await readFile(resolvedPath, 'utf8');
  return {
    exists: true,
    file: true,
    content,
    sha256: sha256Text(content),
    mtimeMs: st.mtimeMs,
    size: st.size,
  };
}

export async function restoreHostFileChanges(
  changes: readonly HostRecordedFileChange[],
): Promise<HostFileRewindResult> {
  const warnings: HostFileRewindWarning[] = [];
  let restored = 0;
  let skipped = 0;

  for (const change of [...changes].reverse()) {
    const result = await restoreHostFileChange(change);
    if (result.restored) {
      restored += 1;
      continue;
    }

    skipped += 1;
    warnings.push(result.warning);
  }

  return { restored, skipped, warnings };
}

async function restoreHostFileChange(
  change: HostRecordedFileChange,
): Promise<{ restored: true } | { restored: false; warning: HostFileRewindWarning }> {
  switch (change.kind) {
    case 'create_file':
      return restoreCreateFileChange(change);
    case 'edit_file':
      return restoreEditFileChange(change);
    case 'delete_file':
      return restoreDeleteFileChange(change);
  }
}

async function restoreCreateFileChange(
  change: HostRecordedFileChange,
): Promise<{ restored: true } | { restored: false; warning: HostFileRewindWarning }> {
  const current = await readHostFileSnapshot(change.resolvedPath);
  if (!current.exists) {
    return { restored: true };
  }
  if (!current.file) {
    return skipped(change, '目标路径已存在但不是文件，已跳过删除。');
  }
  if (current.content === change.after.content) {
    await unlink(change.resolvedPath);
    return { restored: true };
  }
  return skipped(change, '文件在创建后已被修改，已跳过删除以避免覆盖用户改动。');
}

async function restoreEditFileChange(
  change: HostRecordedFileChange,
): Promise<{ restored: true } | { restored: false; warning: HostFileRewindWarning }> {
  if (!change.before.file || change.before.content === undefined) {
    return skipped(change, '缺少编辑前文件快照，无法回溯。');
  }
  if (!change.after.file || change.after.content === undefined) {
    return skipped(change, '缺少编辑后文件快照，无法回溯。');
  }

  const current = await readHostFileSnapshot(change.resolvedPath);
  if (!current.exists) {
    return skipped(change, '目标文件已不存在，无法应用编辑回溯。');
  }
  if (!current.file || current.content === undefined) {
    return skipped(change, '目标路径已存在但不是文件，无法应用编辑回溯。');
  }
  if (current.content === change.before.content) {
    return { restored: true };
  }
  if (current.content === change.after.content) {
    await writeFile(change.resolvedPath, change.before.content, 'utf8');
    return { restored: true };
  }

  const hunk = buildSingleTextHunk(change.before.content, change.after.content);
  if (!hunk || !hunk.afterText) {
    return skipped(change, '无法定位唯一编辑片段，已跳过以避免覆盖用户改动。');
  }

  const hits = countSubstringOccurrences(current.content, hunk.afterText);
  if (hits !== 1) {
    return skipped(change, `编辑片段当前命中 ${hits} 处，已跳过以避免覆盖用户改动。`);
  }

  // Overlapping user edits are intentionally skipped; callers surface the warning instead of broad overwrites.
  await writeFile(
    change.resolvedPath,
    current.content.replace(hunk.afterText, hunk.beforeText),
    'utf8',
  );
  return { restored: true };
}

async function restoreDeleteFileChange(
  change: HostRecordedFileChange,
): Promise<{ restored: true } | { restored: false; warning: HostFileRewindWarning }> {
  if (!change.before.file || change.before.content === undefined) {
    return skipped(change, '缺少删除前文件快照，无法重建文件。');
  }

  const current = await readHostFileSnapshot(change.resolvedPath);
  if (current.exists) {
    return skipped(change, '目标路径已重新存在，已跳过重建以避免覆盖用户改动。');
  }

  await mkdir(path.dirname(change.resolvedPath), { recursive: true });
  await writeFile(change.resolvedPath, change.before.content, 'utf8');
  return { restored: true };
}

function skipped(
  change: HostRecordedFileChange,
  message: string,
): { restored: false; warning: HostFileRewindWarning } {
  return {
    restored: false,
    warning: {
      ...(change.id ? { changeId: change.id } : {}),
      path: change.resolvedPath,
      action: change.kind,
      message,
    },
  };
}

function buildSingleTextHunk(
  before: string,
  after: string,
): { beforeText: string; afterText: string } | undefined {
  if (before === after) {
    return { beforeText: '', afterText: '' };
  }

  let prefix = 0;
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) {
    prefix += 1;
  }

  let beforeEnd = before.length;
  let afterEnd = after.length;
  while (
    beforeEnd > prefix &&
    afterEnd > prefix &&
    before[beforeEnd - 1] === after[afterEnd - 1]
  ) {
    beforeEnd -= 1;
    afterEnd -= 1;
  }

  return {
    beforeText: before.slice(prefix, beforeEnd),
    afterText: after.slice(prefix, afterEnd),
  };
}

function countSubstringOccurrences(source: string, needle: string): number {
  if (!needle) {
    return 0;
  }

  let count = 0;
  let from = 0;
  while (true) {
    const at = source.indexOf(needle, from);
    if (at === -1) {
      return count;
    }
    count += 1;
    from = at + needle.length;
  }
}

function sha256Text(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}