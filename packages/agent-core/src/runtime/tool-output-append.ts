import { resolveHookSessionContext } from '../hooks/integration.js';
import { prepareToolOutputForAppend } from '../tool-output-truncation.js';

import type { AgentRuntimeOptions } from './types.js';

export async function prepareRuntimeToolResultContentForAppend<
  Config,
  State,
  ToolRequest,
  TrustTarget = string,
>(
  options: AgentRuntimeOptions<Config, State, ToolRequest, TrustTarget>,
  toolCallId: string,
  content: string,
): Promise<string> {
  const sessionId = resolveHookSessionContext(options).sessionId;
  return prepareToolOutputForAppend({
    content,
    toolCallId,
    ...(sessionId !== undefined ? { sessionId } : {}),
    ...(options.persistToolOutputArchive !== undefined
      ? { persistArchive: options.persistToolOutputArchive }
      : {}),
  });
}
