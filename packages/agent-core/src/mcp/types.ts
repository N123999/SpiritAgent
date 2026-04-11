export interface McpCapabilityToggles {
  tools: boolean;
  resources: boolean;
  prompts: boolean;
}

export interface McpStdioTransportConfig {
  type: 'stdio';
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  timeoutMs?: number;
  stderr?: 'inherit' | 'pipe';
}

export interface McpHttpTransportConfig {
  type: 'http';
  url: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
}

export type McpTransportConfig = McpStdioTransportConfig | McpHttpTransportConfig;

export interface McpServerConfig {
  displayName?: string;
  enabled?: boolean;
  capabilities?: Partial<McpCapabilityToggles>;
  transport: McpTransportConfig;
}

export interface McpConfigFile {
  servers: Record<string, McpServerConfig>;
}

export interface ResolvedMcpStdioTransportConfig {
  type: 'stdio';
  command: string;
  args: string[];
  env: Record<string, string>;
  stderr: 'inherit' | 'pipe';
  cwd?: string;
  timeoutMs?: number;
}

export interface ResolvedMcpHttpTransportConfig {
  type: 'http';
  url: string;
  headers: Record<string, string>;
  timeoutMs?: number;
}

export type ResolvedMcpTransportConfig =
  | ResolvedMcpStdioTransportConfig
  | ResolvedMcpHttpTransportConfig;

export interface ResolvedMcpServerConfig {
  name: string;
  displayName: string;
  enabled: boolean;
  capabilities: McpCapabilityToggles;
  transport: ResolvedMcpTransportConfig;
}

export type McpServerRuntimeState = 'disabled' | 'idle' | 'loading' | 'ready' | 'error';
export type McpRegistryRuntimeState = 'idle' | 'loading' | 'ready' | 'error';

export interface McpServerStatus {
  name: string;
  displayName: string;
  enabled: boolean;
  state: McpServerRuntimeState;
  transportSummary: string;
  capabilitySummary: string;
  cachedTools: number;
  lastError?: string;
}

export interface McpRegistrySnapshot {
  revision: number;
  state: McpRegistryRuntimeState;
  configuredServers: number;
  loadedServers: number;
  cachedTools: number;
  lastError?: string;
}

export interface McpClientInfo {
  name: string;
  version: string;
}