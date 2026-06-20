import { sameWorkspaceRoot } from './service-utils.js';
import type { SessionBundle } from './session-bundle.js';

export interface HostWorkspaceRootState {
  workspaceRoot: string;
}

export function resolveEffectiveWorkspaceRoot(
  bundle: Pick<SessionBundle, 'workspaceRoot'>,
  state: HostWorkspaceRootState,
): string {
  const fromBundle = bundle.workspaceRoot?.trim();
  if (fromBundle) {
    return fromBundle;
  }
  return state.workspaceRoot;
}

export function needsHostWorkspaceRootSync(
  bundle: Pick<SessionBundle, 'workspaceRoot'>,
  state: HostWorkspaceRootState,
): boolean {
  const effective = resolveEffectiveWorkspaceRoot(bundle, state);
  return !sameWorkspaceRoot(state.workspaceRoot, effective);
}
