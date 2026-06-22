import assert from 'node:assert/strict';
import test from 'node:test';

import { McpRegistry } from './registry.js';
import type { McpToolIndexEntry, ResolvedMcpServerConfig } from './types.js';

test('McpService catalog snapshot truncates tool metadata at 128 entries', async () => {
  const { buildMcpToolCatalogSnapshotForTest } = await import('./service.lazy.test-helpers.js');
  const indexEntries: McpToolIndexEntry[] = [];
  for (let index = 0; index < 130; index += 1) {
    indexEntries.push({
      server: 'demo',
      displayName: 'Demo',
      toolName: `tool_${index}`,
      description: `Tool ${index}`,
      inputSchema: { type: 'object' },
    });
  }

  const registry = new McpRegistry();
  registry.replaceConfig({
    servers: {
      demo: {
        enabled: true,
        transport: { type: 'stdio', command: 'echo' },
      },
    },
  });
  registry.setServerState('demo', 'ready', { cachedTools: 130 });

  const resolved: Record<string, ResolvedMcpServerConfig> = {
    demo: {
      name: 'demo',
      displayName: 'Demo',
      enabled: true,
      capabilities: { tools: true, resources: false, prompts: false },
      transport: { type: 'stdio', command: 'echo', args: [], env: {}, stderr: 'pipe' },
    },
  };

  const snapshot = buildMcpToolCatalogSnapshotForTest(indexEntries, registry, resolved);
  assert.equal(snapshot.totalToolCount, 130);
  assert.equal(snapshot.truncated, true);
  assert.equal(snapshot.servers[0]?.tools.length, 128);
});

test('McpService toolDefinitionsJson returns gateway tools only when index is non-empty', async () => {
  const { McpService } = await import('./service.js');
  const service = new McpService(process.cwd());
  assert.deepEqual(service.toolDefinitionsJson(), []);

  (service as unknown as { toolIndexStore: McpToolIndexEntry[] }).toolIndexStore = [
    {
      server: 'demo',
      displayName: 'Demo',
      toolName: 'ping',
      description: 'Ping',
      inputSchema: { type: 'object' },
    },
  ];

  const definitions = service.toolDefinitionsJson();
  assert.equal(definitions.length, 2);
  const names = definitions.map((entry) => {
    const fn = (entry as { function?: { name?: string } }).function;
    return fn?.name;
  });
  assert.deepEqual(names, ['tool_describe', 'tool_call']);
});
