import { createLlmMessageContentFromTextAndImages, type LlmMessage } from '../ports.js';
import {
  appendHookAdditionalContexts,
  runSubmitPromptHook,
} from '../hooks/integration.js';

import {
  formatPendingMcpResourceContext,
  formatPendingWorkspaceFileContext,
  repairMissingToolResultsInHistory,
} from './helpers.js';
import { formatUserMessageContentForLlm } from './user-turn-timestamp.js';
import type {
  AgentRuntimeOptions,
  PendingMcpResource,
  PendingWorkspaceFile,
} from './types.js';

type ContextMessageRole = 'system' | 'user' | 'assistant';

export interface ContextRuntime<
  Config,
  State,
  ToolRequest,
  TrustTarget = string,
> {
  options: AgentRuntimeOptions<Config, State, ToolRequest, TrustTarget>;
  historyStore: LlmMessage[];
  pendingUserTurnStore: string | undefined;
  takePendingImages(): string[];
  takePendingMcpResources(): PendingMcpResource[];
  recordContextMessage(role: ContextMessageRole, content: string): void;
}

export async function prepareSubmittedUserTurn<
  Config,
  State,
  ToolRequest,
  TrustTarget = string,
>(
  runtime: ContextRuntime<Config, State, ToolRequest, TrustTarget>,
  userInput: string,
  explicitImages: string[],
  explicitWorkspaceFiles: PendingWorkspaceFile[] = [],
): Promise<State> {
  const images = explicitImages.length > 0 ? [...explicitImages] : runtime.takePendingImages();
  const workspaceFiles: PendingWorkspaceFile[] = [
    ...explicitWorkspaceFiles,
    ...(runtime.options.resolveWorkspaceFilesFromInput
      ? await runtime.options.resolveWorkspaceFilesFromInput(userInput)
      : []),
  ];
  const resources = runtime.takePendingMcpResources();
  const imagePaths = new Set(images);
  const videoPaths = new Set<string>();

  for (const file of workspaceFiles) {
    if (file.kind === 'image') {
      imagePaths.add(file.path);
      continue;
    }

    if (file.kind === 'video') {
      videoPaths.add(file.path);
      continue;
    }

    runtime.recordContextMessage('system', formatPendingWorkspaceFileContext(file));
  }
  for (const resource of resources) {
    runtime.recordContextMessage('system', formatPendingMcpResourceContext(resource));
  }

  const submitHookResult = await runSubmitPromptHook(
    runtime.options,
    userInput,
  );
  appendHookAdditionalContexts(
    (role, content) => runtime.recordContextMessage(role, content),
    submitHookResult.additionalContexts,
  );

  runtime.historyStore = repairMissingToolResultsInHistory(runtime.historyStore);
  const contentForLlm = formatUserMessageContentForLlm(userInput);
  runtime.historyStore.push({
    role: 'user',
    content: createLlmMessageContentFromTextAndImages(contentForLlm, [...imagePaths], [...videoPaths]),
  });
  runtime.pendingUserTurnStore = userInput;
  return runtime.options.createToolAgentState(runtime.historyStore, userInput);
}