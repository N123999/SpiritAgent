import { createOpenAI } from '@ai-sdk/openai';
import { createOpenResponses } from '@ai-sdk/open-responses';

import type { JsonObject } from '../ports.js';
import {
  openResponsesPostUrl,
  openResponsesReasoningEffort,
  resolveOpenResponsesReasoningSummary,
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
  const reasoningEffort = openResponsesReasoningEffort(config);
  const reasoningSummary = resolveOpenResponsesReasoningSummary(config);

  if (resolveOpenResponsesSdkProvider(config) !== 'openai') {
    const providerOptions: JsonObject = {
      ...(reasoningEffort !== undefined ? { reasoningEffort } : {}),
      ...(reasoningSummary !== undefined ? { reasoningSummary } : {}),
    };
    if (Object.keys(providerOptions).length === 0) {
      return {};
    }

    return {
      [config.llmVendor ?? 'open-responses']: providerOptions,
    };
  }

  const openaiOptions: JsonObject = {
    store: config.store ?? false,
    ...(config.truncation === 'auto' ? { truncation: 'auto' } : { truncation: 'disabled' }),
  };

  if (reasoningEffort !== undefined) {
    openaiOptions.reasoningEffort = reasoningEffort;
  }

  if (reasoningSummary !== undefined) {
    openaiOptions.reasoningSummary = reasoningSummary;
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
