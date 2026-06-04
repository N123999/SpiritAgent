import type { JsonValue } from '../ports.js';
import { GET_DIAGNOSTICS_TOOL_NAME } from './constants.js';
import type { LspDiagnosticsToolRequest } from './types.js';

export function isLspDiagnosticsToolRequest(value: JsonValue): value is LspDiagnosticsToolRequest {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return record.name === GET_DIAGNOSTICS_TOOL_NAME && typeof record.path === 'string';
}

export function requestFromGetDiagnosticsFunctionCall(
  name: string,
  argumentsJson: string,
): LspDiagnosticsToolRequest | undefined {
  if (name.trim() !== GET_DIAGNOSTICS_TOOL_NAME) {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(argumentsJson) as unknown;
  } catch {
    throw new Error('get_diagnostics arguments must be valid JSON');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('get_diagnostics arguments must be an object');
  }
  const path = (parsed as Record<string, unknown>).path;
  if (typeof path !== 'string' || path.trim().length === 0) {
    throw new Error('get_diagnostics requires a non-empty path');
  }
  return { name: GET_DIAGNOSTICS_TOOL_NAME, path: path.trim() };
}
