#!/usr/bin/env node

/**
 * ACP Server stdio entry point.
 *
 * Launches the Spirit Agent ACP server using ndJSON over stdin/stdout.
 * All logging is redirected to stderr to avoid polluting the ndJSON stream.
 *
 * Usage:
 *   node dist/stdio-entry.js              — ACP ndJSON server
 *   node dist/stdio-entry.js --setup      — interactive provider setup (Terminal Auth)
 *
 * Environment variables:
 *   SPIRIT_ACP_API_KEY   — Optional. LLM provider API key (pre-authenticates when set).
 *   SPIRIT_ACP_MODEL     — Optional. Model name (default: gpt-4.1-mini).
 *   SPIRIT_ACP_BASE_URL  — Optional. Custom LLM endpoint URL.
 *   SPIRIT_ACP_WORKSPACE — Optional. Workspace root (default: cwd).
 */

import { Readable, Writable } from 'node:stream';
import * as acp from '@agentclientprotocol/sdk';
import { createAuthState } from './auth/auth-state.js';
import { SpiritAcpAgent } from './acp-agent.js';
import { loadBaseConfig, resolveEnvApiKey } from './config.js';

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

async function main(): Promise<void> {
  if (process.argv.includes('--setup')) {
    const { runSetup } = await import('./setup/run-setup.js');
    await runSetup();
    return;
  }

  const config = loadBaseConfig();
  const authState = createAuthState(resolveEnvApiKey() !== undefined);

  const output = Writable.toWeb(process.stdout);
  const input = Readable.toWeb(process.stdin) as ReadableStream<Uint8Array>;
  const stream = acp.ndJsonStream(output, input);

  new acp.AgentSideConnection(
    (conn) => new SpiritAcpAgent(conn, config, authState),
    stream,
  );
}

main().catch((err) => {
  console.error('[acp-server] Fatal error:', err);
  process.exitCode = 1;
});
