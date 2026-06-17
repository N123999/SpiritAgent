import { resolveSpiritDataDir } from '../credentials/spirit-config.js';
import { saveProviderSetup } from '../credentials/index.js';
import { runProviderWizard } from './run-interactive-setup.js';

/**
 * Terminal Auth setup entry (`--setup`).
 * Writes provider credentials to the shared Spirit keyring and config.json.
 */
export async function runSetup(): Promise<void> {
  console.error('Spirit Agent — provider setup\n');
  try {
    const setup = await runProviderWizard();
    await saveProviderSetup(resolveSpiritDataDir(), setup);
    console.error(`\nSetup complete. Active model: ${setup.profile.name}`);
    console.error('Return to your ACP client to authenticate and create a session.');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message !== 'Setup cancelled.') {
      console.error(`Setup failed: ${message}`);
    } else {
      console.error(message);
    }
    process.exitCode = 1;
  }
}
