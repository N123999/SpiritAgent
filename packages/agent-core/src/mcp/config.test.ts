import assert from 'node:assert/strict';
import { join } from 'node:path';
import test from 'node:test';

import {
  findMcpServerNameConflict,
  mcpServerScopesFromFiles,
  mcpWorkspaceConfigPath,
  mergeMcpConfigFiles,
} from './config.js';
import type { McpConfigFile } from './types.js';

const stdioServer = {
  transport: { type: 'stdio' as const, command: 'echo' },
};

test('mcpWorkspaceConfigPath resolves under .spirit directory', () => {
  assert.equal(
    mcpWorkspaceConfigPath('/tmp/project'),
    join('/tmp/project', '.spirit', 'mcp.json'),
  );
});

test('mergeMcpConfigFiles combines user and workspace servers', () => {
  const user: McpConfigFile = {
    servers: { github: stdioServer },
  };
  const workspace: McpConfigFile = {
    servers: { local: stdioServer },
  };

  const merged = mergeMcpConfigFiles(user, workspace);
  assert.deepEqual(Object.keys(merged.servers).sort(), ['github', 'local']);
});

test('mergeMcpConfigFiles lets workspace override same-named user server', () => {
  const user: McpConfigFile = {
    servers: {
      shared: { transport: { type: 'stdio', command: 'user-cmd' } },
    },
  };
  const workspace: McpConfigFile = {
    servers: {
      shared: { transport: { type: 'stdio', command: 'workspace-cmd' } },
    },
  };

  const merged = mergeMcpConfigFiles(user, workspace);
  const transport = merged.servers.shared?.transport;
  assert.equal(transport?.type, 'stdio');
  if (transport?.type === 'stdio') {
    assert.equal(transport.command, 'workspace-cmd');
  }
});

test('mcpServerScopesFromFiles labels each server by source file', () => {
  const user: McpConfigFile = { servers: { github: stdioServer } };
  const workspace: McpConfigFile = { servers: { local: stdioServer } };

  assert.deepEqual(mcpServerScopesFromFiles(user, workspace), {
    github: 'user',
    local: 'workspace',
  });
});

test('findMcpServerNameConflict detects existing names in either scope', () => {
  const user: McpConfigFile = { servers: { github: stdioServer } };
  const workspace: McpConfigFile = { servers: { local: stdioServer } };

  assert.equal(findMcpServerNameConflict(user, workspace, 'github'), 'user');
  assert.equal(findMcpServerNameConflict(user, workspace, 'local'), 'workspace');
  assert.equal(findMcpServerNameConflict(user, workspace, 'missing'), undefined);
});

test('mergeMcpConfigFiles with empty workspace yields user-only servers', () => {
  const user: McpConfigFile = { servers: { github: stdioServer } };
  const workspace: McpConfigFile = { servers: { local: stdioServer } };

  const merged = mergeMcpConfigFiles(user, { servers: {} });
  assert.deepEqual(Object.keys(merged.servers), ['github']);
  assert.deepEqual(mcpServerScopesFromFiles(user, { servers: {} }), { github: 'user' });
});
