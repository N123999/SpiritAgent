/** Renderer-safe agent mode types and labels. Do not import agent-core / host-internal here. */

export type DesktopAgentMode = 'agent' | 'plan' | 'ask' | 'debug';

export function resolveDesktopAgentMode(input?: {
  agentMode?: DesktopAgentMode | string;
  planMode?: boolean;
}): DesktopAgentMode {
  const mode = input?.agentMode;
  if (mode === 'agent' || mode === 'plan' || mode === 'ask' || mode === 'debug') {
    return mode;
  }
  return input?.planMode === true ? 'plan' : 'agent';
}

/** Cycle to the next agent mode: Agent → Plan → Ask → Debug → Agent (matches CLI Tab order). */
export function cycleAgentMode(current: DesktopAgentMode): DesktopAgentMode {
  switch (current) {
    case 'agent': return 'plan';
    case 'plan':  return 'ask';
    case 'ask':   return 'debug';
    case 'debug': return 'agent';
  }
}

export function runModeLabel(mode: DesktopAgentMode): string {
  switch (mode) {
    case 'plan':
      return 'Plan';
    case 'ask':
      return 'Ask';
    case 'debug':
      return 'Debug';
    default:
      return 'Agent';
  }
}
