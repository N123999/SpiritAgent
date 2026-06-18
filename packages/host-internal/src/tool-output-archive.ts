import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  sanitizeSessionIdForFilename,
  sanitizeToolCallIdForFilename,
} from './spirit-filename-sanitize.js';
import { TOOL_OUTPUT_ARCHIVES_DIR_NAME } from './tool-output-archive-path.js';

export { isToolOutputArchivePath, TOOL_OUTPUT_ARCHIVES_DIR_NAME } from './tool-output-archive-path.js';

export interface PersistToolOutputArchiveInput {
  content: string;
  sessionId?: string;
  toolCallId?: string;
  messageIndex?: number;
}

export function resolveToolOutputArchivesDir(spiritDataDir: string): string {
  return path.join(spiritDataDir, TOOL_OUTPUT_ARCHIVES_DIR_NAME);
}

export function buildToolOutputArchiveFileName(
  toolCallId: string | undefined,
  messageIndex?: number,
): string {
  return `${sanitizeToolCallIdForFilename(toolCallId, messageIndex)}.txt`;
}

function buildToolOutputArchiveBody(
  input: PersistToolOutputArchiveInput,
  archivedAtUnixMs: number,
): string {
  const toolCallId = input.toolCallId?.trim() || sanitizeToolCallIdForFilename(undefined, input.messageIndex);
  return [
    '# spirit-tool-output-archive',
    `# tool_call_id: ${toolCallId}`,
    `# archived_at_unix_ms: ${archivedAtUnixMs}`,
    '---',
    input.content,
  ].join('\n');
}

export async function persistToolOutputArchive(
  spiritDataDir: string,
  input: PersistToolOutputArchiveInput,
): Promise<string> {
  const sessionKey = sanitizeSessionIdForFilename(input.sessionId);
  const archivesDir = path.join(resolveToolOutputArchivesDir(spiritDataDir), sessionKey);
  await mkdir(archivesDir, { recursive: true });

  const fileName = buildToolOutputArchiveFileName(input.toolCallId, input.messageIndex);
  const filePath = path.join(archivesDir, fileName);
  const archivedAtUnixMs = Date.now();
  await writeFile(filePath, buildToolOutputArchiveBody(input, archivedAtUnixMs), 'utf8');
  return filePath;
}
