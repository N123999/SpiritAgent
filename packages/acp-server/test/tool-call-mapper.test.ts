import assert from 'node:assert/strict';
import test from 'node:test';

import {
  mapToolNameToKind,
  buildToolCallTitle,
  extractToolCallLocations,
} from '../src/tool-call-mapper.js';

// --- mapToolNameToKind ---

test('mapToolNameToKind: read_file → read', () => {
  assert.equal(mapToolNameToKind('read_file'), 'read');
});

test('mapToolNameToKind: list_directory_files → read', () => {
  assert.equal(mapToolNameToKind('list_directory_files'), 'read');
});

test('mapToolNameToKind: glob → search', () => {
  assert.equal(mapToolNameToKind('glob'), 'search');
});

test('mapToolNameToKind: grep → search', () => {
  assert.equal(mapToolNameToKind('grep'), 'search');
});

test('mapToolNameToKind: create_file → edit', () => {
  assert.equal(mapToolNameToKind('create_file'), 'edit');
});

test('mapToolNameToKind: edit_file → edit', () => {
  assert.equal(mapToolNameToKind('edit_file'), 'edit');
});

test('mapToolNameToKind: apply_patch → edit', () => {
  assert.equal(mapToolNameToKind('apply_patch'), 'edit');
});

test('mapToolNameToKind: delete_file → delete', () => {
  assert.equal(mapToolNameToKind('delete_file'), 'delete');
});

test('mapToolNameToKind: shell → execute', () => {
  assert.equal(mapToolNameToKind('shell'), 'execute');
});

test('mapToolNameToKind: web_fetch → fetch', () => {
  assert.equal(mapToolNameToKind('web_fetch'), 'fetch');
});

test('mapToolNameToKind: web_search → fetch', () => {
  assert.equal(mapToolNameToKind('web_search'), 'fetch');
});

test('mapToolNameToKind: create_plan → think', () => {
  assert.equal(mapToolNameToKind('create_plan'), 'think');
});

test('mapToolNameToKind: unknown tool → other', () => {
  assert.equal(mapToolNameToKind('generate_image'), 'other');
  assert.equal(mapToolNameToKind('mcp_tool'), 'other');
  assert.equal(mapToolNameToKind('finish_task'), 'other');
});

// --- buildToolCallTitle ---

test('buildToolCallTitle: read_file with path', () => {
  const title = buildToolCallTitle('read_file', JSON.stringify({ path: '/home/user/main.ts' }));
  assert.equal(title, 'Reading main.ts');
});

test('buildToolCallTitle: shell with command', () => {
  const title = buildToolCallTitle('shell', JSON.stringify({ command: 'npm install' }));
  assert.equal(title, 'Running: npm install');
});

test('buildToolCallTitle: shell truncates long commands', () => {
  const longCmd = 'a'.repeat(100);
  const title = buildToolCallTitle('shell', JSON.stringify({ command: longCmd }));
  assert.ok(title.length < 80);
  assert.ok(title.endsWith('…'));
});

test('buildToolCallTitle: glob with pattern', () => {
  const title = buildToolCallTitle('glob', JSON.stringify({ pattern: '*.ts' }));
  assert.equal(title, 'Searching files: *.ts');
});

test('buildToolCallTitle: unknown tool returns tool name', () => {
  const title = buildToolCallTitle('mcp_server_tool', '{}');
  assert.equal(title, 'mcp_server_tool');
});

test('buildToolCallTitle: invalid JSON returns tool name', () => {
  const title = buildToolCallTitle('read_file', 'invalid-json');
  assert.equal(title, 'read_file');
});

// --- extractToolCallLocations ---

test('extractToolCallLocations: extracts path from arguments', () => {
  const locations = extractToolCallLocations(JSON.stringify({ path: '/home/user/file.ts' }));
  assert.deepEqual(locations, [{ path: '/home/user/file.ts' }]);
});

test('extractToolCallLocations: extracts file_path', () => {
  const locations = extractToolCallLocations(JSON.stringify({ file_path: '/test.ts' }));
  assert.deepEqual(locations, [{ path: '/test.ts' }]);
});

test('extractToolCallLocations: empty for no path', () => {
  const locations = extractToolCallLocations(JSON.stringify({ command: 'ls' }));
  assert.deepEqual(locations, []);
});

test('extractToolCallLocations: empty for invalid JSON', () => {
  const locations = extractToolCallLocations('not-json');
  assert.deepEqual(locations, []);
});
