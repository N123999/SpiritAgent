import { homedir } from 'node:os';
import { join } from 'node:path';
import type { AcpServerConfig } from './types.js';

/**
 * Reads ACP server configuration from environment variables.
 *
 * Required:
 *   SPIRIT_ACP_API_KEY — API key for the LLM provider
 *
 * Optional:
 *   SPIRIT_ACP_MODEL — model name (default: 'gpt-4.1-mini')
 *   SPIRIT_ACP_BASE_URL — custom LLM endpoint URL
 *   SPIRIT_ACP_WORKSPACE — workspace root path (default: process.cwd())
 */
export function configFromEnv(): AcpServerConfig {
  const apiKey = process.env['SPIRIT_ACP_API_KEY']?.trim();
  if (!apiKey) {
    throw new Error(
      'SPIRIT_ACP_API_KEY environment variable is required. '
      + 'Set it to your LLM provider API key.',
    );
  }

  const model = process.env['SPIRIT_ACP_MODEL']?.trim() || 'gpt-4.1-mini';
  const workspaceRoot = process.env['SPIRIT_ACP_WORKSPACE']?.trim() || process.cwd();

  // Use APPDATA/SpiritAgent on Windows, ~/.spirit-agent elsewhere
  const spiritDataDir = process.env['SPIRIT_ACP_DATA_DIR']?.trim()
    || (process.env['APPDATA']
      ? join(process.env['APPDATA'], 'SpiritAgent')
      : join(homedir(), '.spirit-agent'));

  const config: AcpServerConfig = {
    model,
    apiKey,
    workspaceRoot,
    spiritDataDir,
  };
  const baseUrl = process.env['SPIRIT_ACP_BASE_URL']?.trim();
  if (baseUrl) {
    config.baseUrl = baseUrl;
  }
  return config;
}
