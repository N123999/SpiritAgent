import { finishTaskStreamingPreviewReady } from './finish-task-preview.js';
import type { JsonValue } from './ports.js';
import { isJsonObject } from './tool-agent.js';

const PARTIAL_PATH_PATTERN = /"path"\s*:\s*"((?:\\.|[^"\\])*)"/;
const PARTIAL_PLAN_NAME_PATTERN = /"name"\s*:\s*"((?:\\.|[^"\\])*)"/;
const PARTIAL_APPLY_PATCH_OPERATION_TYPE_PATTERN =
  /"type"\s*:\s*"(create_file|update_file|delete_file)"/;
const PARTIAL_POSITIVE_INT_FIELD_PATTERN = (key: string): RegExp =>
  new RegExp(`"${key}"\\s*:\\s*(\\d+)`);

export interface PartialReadFileToolFields {
  path?: string;
  start_line?: number;
  end_line?: number;
}

function tryExtractPartialPositiveInt(argumentsJson: string, key: string): number | undefined {
  const match = argumentsJson.match(PARTIAL_POSITIVE_INT_FIELD_PATTERN(key));
  if (!match?.[1]) {
    return undefined;
  }
  const value = Number(match[1]);
  return Number.isInteger(value) && value > 0 ? value : undefined;
}

/** Extract read_file fields tolerating incomplete JSON while arguments stream in. */
export function tryExtractPartialReadFileFields(argumentsJson: string): PartialReadFileToolFields {
  const path = tryExtractPartialToolPath(argumentsJson);
  const start_line = tryExtractPartialPositiveInt(argumentsJson, 'start_line');
  const end_line = tryExtractPartialPositiveInt(argumentsJson, 'end_line');
  return {
    ...(path ? { path } : {}),
    ...(start_line !== undefined ? { start_line } : {}),
    ...(end_line !== undefined ? { end_line } : {}),
  };
}

export function readFileStreamingPreviewSignature(argumentsJson: string): string | undefined {
  const fields = tryExtractPartialReadFileFields(argumentsJson);
  if (!fields.path) {
    return undefined;
  }
  return `${fields.path}\0${fields.start_line ?? ''}\0${fields.end_line ?? ''}`;
}

function decodePartialJsonString(match: string): string | undefined {
  try {
    return JSON.parse(`"${match}"`) as string;
  } catch {
    return match;
  }
}

/** Extract apply_patch `operation.path` from complete or in-flight JSON. */
export function tryExtractPartialApplyPatchPath(argumentsJson: string): string | undefined {
  const trimmed = argumentsJson.trim();
  if (!trimmed) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(trimmed) as JsonValue;
    if (isJsonObject(parsed) && isJsonObject(parsed.operation)) {
      const path = parsed.operation.path;
      if (typeof path === 'string' && path.trim()) {
        return path.trim();
      }
    }
  } catch {
    // Streaming JSON may be incomplete.
  }

  return tryExtractPartialToolPath(argumentsJson);
}

/** Extract `path` from complete or in-flight tool argument JSON. */
export function tryExtractPartialToolPath(argumentsJson: string): string | undefined {
  const trimmed = argumentsJson.trim();
  if (!trimmed) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(trimmed) as JsonValue;
    if (isJsonObject(parsed) && typeof parsed.path === 'string' && parsed.path.trim()) {
      return parsed.path.trim();
    }
  } catch {
    // Streaming JSON may be incomplete.
  }

  const match = trimmed.match(PARTIAL_PATH_PATTERN);
  if (!match?.[1]) {
    return undefined;
  }

  return decodePartialJsonString(match[1]);
}

/** Extract `name` (plan slug) from complete or in-flight create_plan argument JSON. */
export function tryExtractPartialPlanName(argumentsJson: string): string | undefined {
  const trimmed = argumentsJson.trim();
  if (!trimmed) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(trimmed) as JsonValue;
    if (isJsonObject(parsed) && typeof parsed.name === 'string' && parsed.name.trim()) {
      return parsed.name.trim();
    }
  } catch {
    // Streaming JSON may be incomplete.
  }

  const match = trimmed.match(PARTIAL_PLAN_NAME_PATTERN);
  if (!match?.[1]) {
    return undefined;
  }

  return decodePartialJsonString(match[1]);
}

export function hostToolArgumentsReadyForEarlyStreamingPreview(
  name: string,
  argumentsJson: string,
): boolean {
  switch (name) {
    case 'apply_patch':
      return tryExtractPartialApplyPatchPath(argumentsJson) !== undefined;
    case 'edit_file':
    case 'create_file':
      return tryExtractPartialToolPath(argumentsJson) !== undefined;
    case 'create_plan':
      return tryExtractPartialPlanName(argumentsJson) !== undefined;
    case 'read_file':
    case 'list_directory_files':
    case 'delete_file':
      return tryExtractPartialToolPath(argumentsJson) !== undefined;
    case 'glob':
    case 'grep':
    case 'run_shell_command':
    case 'web_fetch':
    case 'run_subagent':
      return hostToolArgumentsReadyForPreview(name, argumentsJson);
    default:
      return false;
  }
}

export function hostToolArgumentsReadyForPreview(name: string, argumentsJson: string): boolean {
  if (name === 'finish_task') {
    return finishTaskStreamingPreviewReady(name, argumentsJson);
  }

  const trimmed = argumentsJson.trim();
  if (!trimmed) {
    return false;
  }

  let parsed: JsonValue;
  try {
    parsed = JSON.parse(trimmed) as JsonValue;
  } catch {
    return false;
  }

  if (!isJsonObject(parsed)) {
    return false;
  }

  const nonEmpty = (key: string): boolean => {
    const value = parsed[key];
    return typeof value === 'string' && value.trim().length > 0;
  };

  switch (name) {
    case 'run_shell_command':
      return nonEmpty('command');
    case 'web_fetch':
      return nonEmpty('url');
    case 'list_directory_files':
      return nonEmpty('path');
    case 'read_file':
      return nonEmpty('path');
    case 'glob':
      return nonEmpty('pattern');
    case 'grep':
      return nonEmpty('query');
    case 'run_subagent':
      return nonEmpty('task');
    case 'apply_patch': {
      const operation = parsed.operation;
      if (!isJsonObject(operation)) {
        return false;
      }
      const opType = operation.type;
      const opPath = operation.path;
      if (typeof opType !== 'string' || typeof opPath !== 'string' || !opPath.trim()) {
        return false;
      }
      if (opType === 'delete_file') {
        return true;
      }
      return typeof operation.diff === 'string' && operation.diff.length > 0;
    }
    case 'create_file':
      return nonEmpty('path') && nonEmpty('content');
    case 'create_plan':
      return nonEmpty('name') && nonEmpty('content');
    case 'edit_file':
      return nonEmpty('path') && nonEmpty('old_text') && nonEmpty('new_text');
    case 'delete_file':
      return nonEmpty('path');
    case 'ask_questions':
      return Array.isArray(parsed.questions) && parsed.questions.length > 0;
    default:
      return Object.values(parsed).some(
        (value) => typeof value === 'string' && value.trim().length > 0,
      );
  }
}

const STREAMING_PREVIEW_UPDATE_MIN_DELTA_CHARS = 400;

export function shouldRepeatStreamingToolPreview(
  toolName: string,
  previousArgsLen: number,
  nextArgsLen: number,
  options?: {
    previousDetailSignature?: string;
    nextArgumentsJson?: string;
  },
): boolean {
  if (toolName === 'read_file') {
    const nextSignature = options?.nextArgumentsJson
      ? readFileStreamingPreviewSignature(options.nextArgumentsJson)
      : undefined;
    if (!nextSignature) {
      return false;
    }
    return options?.previousDetailSignature !== nextSignature;
  }
  if (
    toolName !== 'edit_file'
    && toolName !== 'create_file'
    && toolName !== 'create_plan'
    && toolName !== 'apply_patch'
  ) {
    return false;
  }
  return nextArgsLen >= previousArgsLen + STREAMING_PREVIEW_UPDATE_MIN_DELTA_CHARS;
}

/** Whether partial `read_file` args are safe to execute before the JSON object closes. */
export function readFilePartialAllowsEarlyExecution(argumentsJson: string): boolean {
  if (hostToolArgumentsReadyForPreview('read_file', argumentsJson)) {
    return true;
  }
  const fields = tryExtractPartialReadFileFields(argumentsJson);
  if (!fields.path) {
    return false;
  }
  const hasStartKey = /"start_line"\s*:/.test(argumentsJson);
  const hasEndKey = /"end_line"\s*:/.test(argumentsJson);
  if (!hasStartKey && !hasEndKey) {
    return true;
  }
  if (hasStartKey && fields.start_line === undefined) {
    return false;
  }
  if (hasEndKey && fields.end_line === undefined) {
    return false;
  }
  return true;
}

/**
 * Build minimal parseable tool-call JSON from in-flight arguments so preview-time early
 * execution can start before the model finishes the object.
 */
export function buildEarlyExecutableArgumentsJson(
  name: string,
  argumentsJson: string,
): string | undefined {
  if (!hostToolArgumentsReadyForEarlyStreamingPreview(name, argumentsJson)) {
    return undefined;
  }

  switch (name) {
    case 'read_file':
      if (!readFilePartialAllowsEarlyExecution(argumentsJson)) {
        return undefined;
      }
      break;
    case 'list_directory_files':
    case 'delete_file':
      break;
    default:
      return undefined;
  }

  if (name === 'read_file') {
    const fields = tryExtractPartialReadFileFields(argumentsJson);
    if (!fields.path) {
      return undefined;
    }
    return JSON.stringify({
      path: fields.path,
      ...(fields.start_line !== undefined ? { start_line: fields.start_line } : {}),
      ...(fields.end_line !== undefined ? { end_line: fields.end_line } : {}),
    });
  }

  const path = tryExtractPartialToolPath(argumentsJson);
  if (!path) {
    return undefined;
  }

  return JSON.stringify({ path });
}

/** Parse preview args for UI; tolerates incomplete JSON when `path` is already streamed. */
export function previewRequestFromStreamingArguments(
  toolName: string,
  argumentsJson: string,
): unknown {
  const trimmed = argumentsJson.trim();
  if (!trimmed) {
    return undefined;
  }

  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    if (toolName === 'read_file') {
      const fields = tryExtractPartialReadFileFields(argumentsJson);
      return fields.path ? fields : undefined;
    }
    if (
      toolName === 'list_directory_files'
      || toolName === 'delete_file'
      || toolName === 'create_file'
      || toolName === 'edit_file'
    ) {
      const path = tryExtractPartialToolPath(argumentsJson);
      return path ? { path } : undefined;
    }
    if (toolName === 'apply_patch') {
      const path = tryExtractPartialApplyPatchPath(argumentsJson);
      if (!path) {
        return undefined;
      }
      const typeMatch = trimmed.match(PARTIAL_APPLY_PATCH_OPERATION_TYPE_PATTERN);
      const operation: Record<string, string> = { path };
      if (typeMatch?.[1]) {
        operation.type = typeMatch[1];
      }
      return { operation };
    }
    if (toolName === 'create_plan') {
      const name = tryExtractPartialPlanName(argumentsJson);
      return name ? { name } : undefined;
    }
    return undefined;
  }
}

export interface StreamingToolPreviewEmitState {
  readyPreviewEmitted: boolean;
  lastPreviewArgsLen?: number;
  lastPreviewDetailSignature?: string;
}

export function resolveStreamingToolPreviewEmit(
  toolName: string,
  argumentsJson: string,
  state: StreamingToolPreviewEmitState,
): { emit: boolean; nextState: StreamingToolPreviewEmitState } {
  const argsLen = argumentsJson.length;
  const earlyReady = hostToolArgumentsReadyForEarlyStreamingPreview(toolName, argumentsJson);
  const fullReady = hostToolArgumentsReadyForPreview(toolName, argumentsJson);
  const ready = earlyReady || fullReady;

  if (!ready) {
    return { emit: false, nextState: state };
  }

  const nextDetailSignature = toolName === 'read_file'
    ? readFileStreamingPreviewSignature(argumentsJson)
    : undefined;

  const emit =
    !state.readyPreviewEmitted ||
    shouldRepeatStreamingToolPreview(toolName, state.lastPreviewArgsLen ?? 0, argsLen, {
      ...(state.lastPreviewDetailSignature === undefined
        ? {}
        : { previousDetailSignature: state.lastPreviewDetailSignature }),
      nextArgumentsJson: argumentsJson,
    });

  if (!emit) {
    return { emit: false, nextState: state };
  }

  return {
    emit: true,
    nextState: {
      readyPreviewEmitted: true,
      lastPreviewArgsLen: argsLen,
      ...(nextDetailSignature ? { lastPreviewDetailSignature: nextDetailSignature } : {}),
    },
  };
}
