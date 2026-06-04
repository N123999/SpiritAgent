import { APPLY_PATCH_HOST_TOOL_NAME } from '../open-responses/apply-patch-eligibility.js';

export const GET_DIAGNOSTICS_TOOL_NAME = 'get_diagnostics';

export const TYPESCRIPT_LANGUAGE_SERVER_COMMAND = 'typescript-language-server';

export const TYPESCRIPT_JS_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
]);

export const HOST_WRITE_TOOL_NAMES = new Set<string>([
  'create_file',
  'edit_file',
  'delete_file',
  APPLY_PATCH_HOST_TOOL_NAME,
]);

/** MVP: always append diagnostics after successful writes when LSP is enabled. */
export const APPEND_DIAGNOSTICS_AFTER_WRITES = true;

export const DEFAULT_DIAGNOSTICS_MAX_ITEMS = 8;
export const DEFAULT_DIAGNOSTICS_MESSAGE_MAX_CHARS = 240;
export const DEFAULT_DIAGNOSTICS_WAIT_MS = 4_000;
export const DEFAULT_WRITE_APPEND_DIAGNOSTICS_WAIT_MS = 4_000;
export const DEFAULT_SYNC_DEBOUNCE_MS = 300;
