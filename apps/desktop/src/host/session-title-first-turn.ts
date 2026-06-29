import type { SessionBundle } from './session-bundle.js';
import { deriveDisplayNameFromSeed } from './sessions.js';

export function countUserMessages(bundle: SessionBundle): number {
  return bundle.messageTimeline
    .toMessages()
    .filter((message) => message.role === 'user')
    .length;
}

/** Rewind/resubmit of the first user turn should re-run LLM title generation. */
export function prepareSessionTitleForFirstUserTurn(
  bundle: SessionBundle,
  displayText: string,
): boolean {
  if (countUserMessages(bundle) !== 0) {
    return false;
  }

  bundle.sessionTitleSource = 'seed';
  if (bundle.activeSession) {
    bundle.activeSession.displayName = deriveDisplayNameFromSeed(displayText);
  }
  return true;
}
