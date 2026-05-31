import { createOpenAI } from '@ai-sdk/openai';
import { createOpenResponses } from '@ai-sdk/open-responses';

import type { JsonObject } from '../ports.js';
import {
  openResponsesPostUrl,
  openResponsesReasoningEffort,
  resolveOpenResponsesSdkProvider,
  type OpenResponsesTransportConfig,
} from './responses-compat.js';

export function createResponsesLanguageModel(config: OpenResponsesTransportConfig): unknown {
  if (resolveOpenResponsesSdkProvider(config) === 'openai') {
    const openai = createOpenAI({
      apiKey: config.apiKey,
      ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
      ...(config.organization ? { organization: config.organization } : {}),
      ...(config.project ? { project: config.project } : {}),
    });
    return openai.responses(config.model);
  }

  const openResponses = createOpenResponses({
    name: config.llmVendor ?? 'spirit-agent',
    url: openResponsesPostUrl(config.baseUrl),
    apiKey: config.apiKey,
  });
  return openResponses(config.model);
}

export function buildResponsesProviderOptions(
  config: OpenResponsesTransportConfig,
  previousResponseId?: string,
): Record<string, JsonObject> {
  if (resolveOpenResponsesSdkProvider(config) !== 'openai') {
    const effort = openResponsesReasoningEffort(config);
    if (effort === undefined) {
      return {};
    }

    return {
      [config.llmVendor ?? 'open-responses']: {
        reasoningEffort: effort,
      } as JsonObject,
    };
  }

  const openaiOptions: JsonObject = {
    store: config.store ?? false,
    ...(config.truncation === 'auto' ? { truncation: 'auto' } : { truncation: 'disabled' }),
  };

  const reasoningEffort = openResponsesReasoningEffort(config);
  if (reasoningEffort !== undefined) {
    openaiOptions.reasoningEffort = reasoningEffort;
  }

  if (config.reasoningSummary && config.reasoningSummary !== 'off') {
    openaiOptions.reasoningSummary = config.reasoningSummary;
  }

  if (previousResponseId && shouldAttachPreviousResponseId(config)) {
    openaiOptions.previousResponseId = previousResponseId;
  }

  return { openai: openaiOptions };
}

function shouldAttachPreviousResponseId(config: OpenResponsesTransportConfig): boolean {
  const mode = config.previousResponseMode ?? 'disabled';
  if (mode === 'disabled') {
    return false;
  }

  if (mode === 'stored') {
    return config.store === true;
  }

  return mode === 'stateless';
}
