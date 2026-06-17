import { resolveSpiritDataDir } from './credentials/spirit-config.js';import type { AcpServerConfig } from './types.js';

const DEFAULT_MODEL = 'gpt-4.1-mini';

/**
 * Resolves the Spirit Agent data directory (shared with Desktop / CLI).
 * @deprecated Prefer {@link resolveSpiritDataDir} from credentials/spirit-config.
 */
export { resolveSpiritDataDir };

/**
 * Reads SPIRIT_ACP_API_KEY when set. Validates placeholder syntax.
 */
export function resolveEnvApiKey(): string | undefined {
  const apiKey = process.env['SPIRIT_ACP_API_KEY']?.trim();
  if (!apiKey) {
    return undefined;
  }
  if (apiKey.includes('${')) {
    throw new Error(
      'SPIRIT_ACP_API_KEY looks like an unexpanded placeholder (e.g. "${SPIRIT_ACP_API_KEY}"). '
      + 'Zed settings.json does not expand ${VAR} syntax. '
      + 'Either put the key directly in agent_servers.env, '
      + 'or remove SPIRIT_ACP_API_KEY from agent_servers.env and set it as a system/user environment variable.',
    );
  }
  return apiKey;
}

/**
 * Loads ACP server settings from environment variables.
 * API key is optional — Terminal Auth may supply credentials later.
 */
export function loadBaseConfig(): AcpServerConfig {
  const model = process.env['SPIRIT_ACP_MODEL']?.trim() || DEFAULT_MODEL;
  const workspaceRoot = process.env['SPIRIT_ACP_WORKSPACE']?.trim() || process.cwd();
  const spiritDataDir = resolveSpiritDataDir();
  const apiKey = resolveEnvApiKey();

  const config: AcpServerConfig = {
    model,
    workspaceRoot,
    spiritDataDir,
  };
  if (apiKey !== undefined) {
    config.apiKey = apiKey;
  }
  const baseUrl = process.env['SPIRIT_ACP_BASE_URL']?.trim();
  if (baseUrl) {
    config.baseUrl = baseUrl;
  }
  return config;
}

/**
 * @deprecated Prefer {@link loadBaseConfig}. Kept for callers that require an API key.
 */
export function configFromEnv(): AcpServerConfig {
  const config = loadBaseConfig();
  if (!config.apiKey) {
    throw new Error(
      'SPIRIT_ACP_API_KEY environment variable is required. '
      + 'Set it to your LLM provider API key.',
    );
  }
  return config;
}
