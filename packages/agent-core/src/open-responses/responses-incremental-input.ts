import { AsyncLocalStorage } from 'node:async_hooks';

import type { JsonValue } from '../ports.js';
import { cloneJsonValue, isJsonObject } from '../tool-agent.js';
import {
  findAnchorIndexForResponseId,
  findPreviousResponseId,
} from './provider-state.js';
import {
  isBedrockMantleOpenResponsesConfig,
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

function responsesStoredStateRequestStore(
  previousResponseId: string | undefined,
): { previousResponseId?: string } {
  return previousResponseId !== undefined ? { previousResponseId } : {};
}

/** 官方 OpenAI/Azure SDK，以及百炼/火山方舟 Responses（经 fetch 注入 store / previous_response_id）。 */
export function responsesUsesStoredState(config: OpenResponsesTransportConfig): boolean {
  // Bedrock Mantle 虽走 responsesProvider: openai，但不支持 OpenAI 式远端 store 链。
  if (isBedrockMantleOpenResponsesConfig(config)) {
    return false;
  }

  if (config.llmVendor === 'alibaba' || config.llmVendor === 'volcengine') {
    return true;
  }

  const provider = resolveOpenResponsesSdkProvider(config);
  return provider === 'openai' || provider === 'azure';
}

/** 供百炼/火山方舟等 compatible fetch 路径读取本轮 previous_response_id。 */
export function readResponsesStoredStateRequestPreviousResponseId(): string | undefined {
  return storedStateRequestStore.getStore()?.previousResponseId;
}

export async function runWithResponsesStoredStateRequestContext<T>(
  previousResponseId: string | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  return storedStateRequestStore.run(
    responsesStoredStateRequestStore(previousResponseId),
    fn,
  );
}

export function runInResponsesStoredStateRequestContextSync<T>(
  previousResponseId: string | undefined,
  fn: () => T,
): T {
  return storedStateRequestStore.run(
    responsesStoredStateRequestStore(previousResponseId),
    fn,
  );
}

/** 流式 Responses 在迭代 chunk 时触发 fetch，须逐次进入 ALS 以免串链。 */
export function bindResponsesStoredStateRequestContextAsyncIterable<T>(
  previousResponseId: string | undefined,
  iterable: AsyncIterable<T>,
): AsyncIterable<T> {
  const store = responsesStoredStateRequestStore(previousResponseId);
  return {
    [Symbol.asyncIterator]() {
      const inner = iterable[Symbol.asyncIterator]();
      return {
        next() {
          return storedStateRequestStore.run(store, () => inner.next());
        },
        return(value?: T | PromiseLike<T>) {
          return storedStateRequestStore.run(store, () => inner.return?.(value) ?? Promise.resolve({
            done: true,
            value: undefined,
          }));
        },
        throw(error?: unknown) {
          return storedStateRequestStore.run(store, () => inner.throw?.(error) ?? Promise.reject(error));
        },
      };
    },
  };
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
