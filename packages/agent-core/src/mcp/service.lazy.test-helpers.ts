import { McpRegistry } from './registry.js';
import type {
  McpToolIndexEntry,
  ResolvedMcpServerConfig,
  ToolAgentMcpToolCatalogSnapshot,
} from './types.js';

const MCP_CATALOG_TOOL_LIMIT = 128;

export function buildMcpToolCatalogSnapshotForTest(
  indexEntries: McpToolIndexEntry[],
  registry: McpRegistry,
  resolvedServers: Record<string, ResolvedMcpServerConfig>,
): ToolAgentMcpToolCatalogSnapshot {
  const grouped = new Map<string, McpToolIndexEntry[]>();
  for (const entry of indexEntries) {
    const current = grouped.get(entry.server) ?? [];
    current.push(entry);
    grouped.set(entry.server, current);
  }

  const totalToolCount = indexEntries.length;
  const truncated = totalToolCount > MCP_CATALOG_TOOL_LIMIT;
  let remaining = MCP_CATALOG_TOOL_LIMIT;
  const servers = Object.values(resolvedServers)
    .filter((server) => server.enabled)
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((server) => {
      const status = registry.get(server.name);
      const toolsForServer = grouped.get(server.name) ?? [];
      const visibleTools = remaining > 0 ? toolsForServer.slice(0, remaining) : [];
      remaining -= visibleTools.length;
      return {
        name: server.name,
        displayName: server.displayName,
        state: status?.state ?? 'idle',
        ...(status?.lastError === undefined ? {} : { lastError: status.lastError }),
        tools: visibleTools.map((tool) => ({
          name: tool.toolName,
          description: tool.description,
        })),
      };
    })
    .filter((server) => server.tools.length > 0 || server.state === 'error');

  return {
    servers,
    truncated,
    totalToolCount,
  };
}
