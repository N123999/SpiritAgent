#!/usr/bin/env node

/**
 * ACP Server stdio entry point.
 *
 * Launches the Spirit Agent ACP server using ndJSON over stdin/stdout.
 * All logging is redirected to stderr to avoid polluting the ndJSON stream.
 *
 * Usage:
 *   node dist/stdio-entry.js
 *
 * Environment variables:
 *   SPIRIT_ACP_API_KEY   — Required. LLM provider API key.
 *   SPIRIT_ACP_MODEL     — Optional. Model name (default: gpt-4.1-mini).
 *   SPIRIT_ACP_BASE_URL  — Optional. Custom LLM endpoint URL.
 *   SPIRIT_ACP_WORKSPACE — Optional. Workspace root (default: cwd).
 *
 * Editor configuration example (Zed settings.json):
 *   "agent_servers": {
 *     "Spirit Agent": {
 *       "command": "node",
 *       "args": ["path/to/packages/acp-server/dist/stdio-entry.js"],
 *       "env": { "SPIRIT_ACP_API_KEY": "sk-..." }
 *     }
 *   }
 */

import { Readable, Writable } from 'node:stream';
import * as acp from '@agentclientprotocol/sdk';
import { SpiritAcpAgent } from './acp-agent.js';
import { configFromEnv } from './config.js';

// Redirect console.log → stderr to prevent polluting the ndJSON stdout stream.
console.log = (...args: unknown[]) => {
  console.error(...args);
};

// Handle uncaught errors gracefully — write to stderr, never stdout
process.on('uncaughtException', (err) => {
  console.error('[acp-server] Uncaught exception:', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[acp-server] Unhandled rejection:', reason);
});

// Parse configuration from environment variables
const config = configFromEnv();

// Set up ndJSON stream over stdin/stdout
const output = Writable.toWeb(process.stdout);
const input = Readable.toWeb(process.stdin) as ReadableStream<Uint8Array>;
const stream = acp.ndJsonStream(output, input);

// Create the ACP agent connection
new acp.AgentSideConnection(
  (conn) => new SpiritAcpAgent(conn, config),
  stream,
);
