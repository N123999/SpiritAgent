import type { JsonValue, RuntimeApprovalDecision, RuntimePendingApproval } from '@spirit-agent/core';
import type { AgentSideConnection } from '@agentclientprotocol/sdk';
import type * as schema from '@agentclientprotocol/sdk';

/**
 * Handles a runtime approval request by asking the ACP client for permission.
 *
 * Converts agent-core's AuthorizationDecision into an ACP requestPermission call,
 * then maps the client's response back to a RuntimeApprovalDecision.
 *
 * Stub: to be fully implemented in Phase 4.
 */
export async function handleApprovalRequest(
  connection: AgentSideConnection,
  sessionId: string,
  approval: RuntimePendingApproval<JsonValue, JsonValue>,
): Promise<RuntimeApprovalDecision> {
  try {
    const response = await connection.requestPermission({
      sessionId,
      toolCall: {
        toolCallId: approval.toolCallId ?? `approval_${Date.now()}`,
        title: approval.toolName,
        kind: 'other',
        status: 'pending',
      },
      options: buildPermissionOptions(approval),
    });

    return mapPermissionResponse(response);
  } catch {
    // If permission request fails (e.g. connection closed), deny the operation
    return { kind: 'deny', resultText: 'Permission request failed.' };
  }
}

/**
 * Builds permission options based on whether the tool has a trust target.
 */
function buildPermissionOptions(
  approval: RuntimePendingApproval<JsonValue, JsonValue>,
): schema.PermissionOption[] {
  const options: schema.PermissionOption[] = [
    {
      optionId: 'allow',
      name: 'Allow',
      kind: 'allow_once',
    },
  ];

  // If there's a trust target, offer "always allow"
  if (approval.trustTarget !== undefined) {
    options.push({
      optionId: 'allow-always',
      name: 'Always Allow',
      kind: 'allow_always',
    });
  }

  options.push({
    optionId: 'reject',
    name: 'Reject',
    kind: 'reject_once',
  });

  return options;
}

/**
 * Maps an ACP permission response to a RuntimeApprovalDecision.
 */
function mapPermissionResponse(
  response: schema.RequestPermissionResponse,
): RuntimeApprovalDecision {
  const outcome = response.outcome;

  if (outcome.outcome === 'cancelled') {
    return { kind: 'deny', resultText: 'Operation cancelled.' };
  }

  switch (outcome.optionId) {
    case 'allow':
      return { kind: 'allow' };
    case 'allow-always':
      return { kind: 'allow', persistTrust: true };
    case 'reject':
      return { kind: 'deny', resultText: 'User rejected this operation.' };
    default:
      return { kind: 'deny', resultText: `Unknown permission option: ${outcome.optionId}` };
  }
}
