import { finishTaskStreamingPreviewReady } from './finish-task-preview.js';
import type { JsonValue } from './ports.js';
import { isJsonObject } from './tool-agent.js';

const PARTIAL_PATH_PATTERN = /"path"\s*:\s*"((?:\\.|[^"\\])*)"/;

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

  try {
    return JSON.parse(`"${match[1]}"`) as string;
  } catch {
    return match[1];
  }
}

export function hostToolArgumentsReadyForEarlyStreamingPreview(
  name: string,
  argumentsJson: string,
): boolean {
  switch (name) {
    case 'edit_file':
    case 'create_file':
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
    case 'create_file':
      return nonEmpty('path') && nonEmpty('content');
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
): boolean {
  if (toolName !== 'edit_file' && toolName !== 'create_file') {
    return false;
  }
  return nextArgsLen >= previousArgsLen + STREAMING_PREVIEW_UPDATE_MIN_DELTA_CHARS;
}

export interface StreamingToolPreviewEmitState {
  readyPreviewEmitted: boolean;
  lastPreviewArgsLen?: number;
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

  const emit =
    !state.readyPreviewEmitted ||
    shouldRepeatStreamingToolPreview(toolName, state.lastPreviewArgsLen ?? 0, argsLen);

  if (!emit) {
    return { emit: false, nextState: state };
  }

  return {
    emit: true,
    nextState: {
      readyPreviewEmitted: true,
      lastPreviewArgsLen: argsLen,
    },
  };
}
