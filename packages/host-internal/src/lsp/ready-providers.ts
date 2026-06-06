import type { LspReadyProviderSummary } from '@spirit-agent/core';

import type { LspOrchestrator } from './orchestrator.js';
import { LSP_PROVIDERS } from './providers.js';

export function readyProvidersForToolDefinitions(
  orchestrator: LspOrchestrator,
): import('@spirit-agent/core').LspReadyProviderSummary[] {
  const summaries: LspReadyProviderSummary[] = [];
  for (const provider of LSP_PROVIDERS) {
    const session = orchestrator.getSession(provider.id);
    if (!session?.enabled) {
      continue;
    }
    summaries.push({
      displayName: provider.displayName,
      languageLabels: [...provider.languageLabels],
      extensions: [...provider.extensions],
    });
  }
  return summaries;
}
