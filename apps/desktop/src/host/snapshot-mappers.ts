import type {
  PendingAssistantAux,
  PendingMcpResource,
  PendingToolApprovalSnapshot,
} from '../types.js';
import type { DesktopToolRequest } from './contracts.js';
import {
  displayTitleForTool,
  stripReasonLineFromShellPrompt,
} from './message-ordering.js';

export function mapPendingMcpResources(
  resources: readonly PendingMcpResource[],
): PendingMcpResource[] {
  return resources.map((resource) => ({
    server: resource.server,
    displayName: resource.displayName,
    uri: resource.uri,
    ...(resource.mimeType ? { mimeType: resource.mimeType } : {}),
    readAtUnixMs: resource.readAtUnixMs,
    content: resource.content,
  }));
}

export function mapPendingAuxState(
  pendingAux: PendingAssistantAux | undefined,
): PendingAssistantAux | undefined {
  if (!pendingAux) {
    return undefined;
  }
  return {
    kind: pendingAux.kind,
    statusText: pendingAux.statusText,
    ...(pendingAux.detailText ? { detailText: pendingAux.detailText } : {}),
  };
}

export function mapPendingToolApproval(input: {
  toolName: string;
  request: DesktopToolRequest;
  prompt: string;
  trustTarget?: unknown;
  subagentSessionId?: string;
}): PendingToolApprovalSnapshot {
  return {
    toolName: displayTitleForTool(
      input.toolName,
      input.request,
    ),
    prompt: stripReasonLineFromShellPrompt(
      input.toolName,
      input.prompt,
    ),
    ...(typeof input.trustTarget === 'string'
      ? { trustTarget: input.trustTarget }
      : {}),
    ...(typeof input.subagentSessionId === 'string' && input.subagentSessionId.trim()
      ? { subagentSessionId: input.subagentSessionId.trim() }
      : {}),
  };
}
