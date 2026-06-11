import type { ToolBlockSnapshot } from '../types.js';

/**
 * Map tool phase to i18next context suffix for verb tense.
 * - preview / running / pending-approval → 'running' (progressive in English)
 * - succeeded → 'succeeded' (past tense in English)
 * - failed / unknown → undefined (fallback to base key)
 *
 * Chinese locale does not define context-suffixed keys, so i18next
 * automatically falls back to the base key (verbs stay unchanged).
 */
export function phaseToVerbContext(
  phase: ToolBlockSnapshot['phase'],
): string | undefined {
  switch (phase) {
    case 'preview':
    case 'running':
    case 'pending-approval':
      return 'running';
    case 'succeeded':
      return 'succeeded';
    case 'failed':
    default:
      return undefined;
  }
}
