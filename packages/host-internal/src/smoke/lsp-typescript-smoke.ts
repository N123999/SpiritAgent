import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { LspService } from '../lsp/service.js';
import { resolveTypescriptLanguageServerOnPath } from '../lsp/resolve-server.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(here, '../../../..');
const sampleFile = path.join(workspaceRoot, 'packages/agent-core/src/lsp/constants.ts');

async function main(): Promise<void> {
  const resolved = await resolveTypescriptLanguageServerOnPath();
  if (!resolved) {
    console.log('skip: no typescript-language-server on PATH');
    return;
  }

  const lsp = new LspService(workspaceRoot);
  await lsp.probe();
  if (!lsp.enabled) {
    console.log('skip: LSP probe disabled');
    return;
  }

  const relativePath = path.relative(workspaceRoot, sampleFile).replace(/\\/g, '/');
  const result = await lsp.getDiagnosticsForPath(relativePath, 8_000);
  if (!result.formatted || result.formatted.length === 0) {
    throw new Error('expected formatted diagnostics text');
  }
  console.log(`ok: diagnostics for ${relativePath} (${result.diagnostics.length} items)`);
  await lsp.dispose();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
