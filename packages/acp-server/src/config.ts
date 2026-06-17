import { resolveSpiritDataDir } from './credentials/spirit-config.js';
import type { AcpServerConfig } from './types.js';

/**
 * Resolves the Spirit Agent data directory (shared with Desktop / CLI).
 * @deprecated Prefer {@link resolveSpiritDataDir} from credentials/spirit-config.
 */
export { resolveSpiritDataDir };

/**
 * Loads ACP server runtime paths. LLM credentials and models come from shared
 * Spirit config + keyring (Terminal Auth / `--setup`), not environment variables.
 */
export function loadBaseConfig(): AcpServerConfig {
  const workspaceRoot = process.env['SPIRIT_ACP_WORKSPACE']?.trim() || process.cwd();
  const spiritDataDir = resolveSpiritDataDir();

  return {
    workspaceRoot,
    spiritDataDir,
  };
}
