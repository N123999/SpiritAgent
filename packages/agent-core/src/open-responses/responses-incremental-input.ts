import { AsyncLocalStorage } from 'node:async_hooks';

import type { JsonValue } from '../ports.js';
import { cloneJsonValue, isJsonObject } from '../tool-agent.js';
import {
  findAnchorIndexForResponseId,
  findPreviousResponseId,
} from './provider-state.js';
import {
  resolveOpenResponsesSdkProvider,
  type OpenResponsesTransportConfig,
} from './responses-compat.js';

export type ResponsesRoundInputMode = 'full' | 'incremental';

export interface ResponsesRoundInput {
  apiMessages: JsonValue[];
  previousResponseId?: string;
  mode: ResponsesRoundInputMode;
}

const storedStateRequestStore = new AsyncLocalStorage<{ previousResponseId?: string }>();

/** 官方 OpenAI/Azure SDK，以及百炼 Responses（经 fetch 注入 store / previous_response_id）。 */
export function responsesUsesStoredState(config: OpenResponsesTransportConfig): boolean {
  if (config.llmVendor === 'alibaba') {
    return true;
  }

  const provider = resolveOpenResponsesSdkProvider(config);
  return provider === 'openai' || provider === 'azure';
}

let roundStoredStatePreviousResponseId: string | undefined;

export function beginResponsesStoredStateRound(previousResponseId?: string): void {
  roundStoredStatePreviousResponseId = previousResponseId;
}

export function endResponsesStoredStateRound(): void {
  roundStoredStatePreviousResponseId = undefined;
}

/** 供 Alibaba fetch 等 compatible 路径读取本轮 previous_response_id。 */
export function readResponsesStoredStateRequestPreviousResponseId(): string | undefined {
  return storedStateRequestStore.getStore()?.previousResponseId ?? roundStoredStatePreviousResponseId;
}

export async function runWithResponsesStoredStateRequestContext<T>(
  previousResponseId: string | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  const store = previousResponseId !== undefined ? { previousResponseId } : {};
  return storedStateRequestStore.run(store, async () => {
    beginResponsesStoredStateRound(previousResponseId);
    try {
      return await fn();
    } finally {
      endResponsesStoredStateRound();
    }
  });
}

export function buildResponsesRoundInput(
  requestMessages: readonly JsonValue[],
  config: OpenResponsesTransportConfig,
  stepIndex: number,
): ResponsesRoundInput {
  const cloned = requestMessages.map((message) => cloneJsonValue(message));

  if (!responsesUsesStoredState(config)) {
    return { apiMessages: cloned, mode: 'full' };
  }

  const previousResponseId = findPreviousResponseId(requestMessages);
  if (!previousResponseId) {
    return { apiMessages: cloned, mode: 'full' };
  }

  const anchorIndex = findAnchorIndexForResponseId(requestMessages, previousResponseId);
  if (anchorIndex < 0) {
    return { apiMessages: cloned, mode: 'full' };
  }

  let delta = requestMessages.slice(anchorIndex + 1).map((message) => cloneJsonValue(message));

  if (stepIndex === 1) {
    const systemMessage = requestMessages.find(
      (message) => isJsonObject(message) && message.role === 'system',
    );
    const deltaHasSystem = delta.some(
      (message) => isJsonObject(message) && message.role === 'system',
    );
    if (systemMessage && !deltaHasSystem) {
      delta = [cloneJsonValue(systemMessage), ...delta];
    }
  }

  return {
    apiMessages: delta,
    previousResponseId,
    mode: 'incremental',
  };
}
