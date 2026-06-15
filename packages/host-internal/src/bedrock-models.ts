/**
 * Amazon Bedrock 模型目录：AWS SDK `ListFoundationModels`（控制面 API）。
 * ListFoundationModels 不返回 context length，故 ProviderListedModelEntry.contextLength 留空。
 */

import {
  BedrockClient,
  ListFoundationModelsCommand,
  type FoundationModelSummary,
} from '@aws-sdk/client-bedrock';

import type { ProviderListedModelEntry } from './openai-models.js';
import { normalizeAwsRegion } from './bedrock-region.js';

export { bedrockApiBaseFromRegion, normalizeAwsRegion } from './bedrock-region.js';

export interface ListBedrockModelsOptions {
  region: string;
  apiKey?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  sessionToken?: string;
  signal?: AbortSignal;
}

function bedrockSupportsReasoning(modelId: string): boolean {
  const normalized = modelId.trim().toLowerCase();
  return (
    normalized.includes('anthropic.claude')
    || normalized.includes('.anthropic.claude')
    || normalized.includes('deepseek.r1')
    || normalized.includes('amazon.nova')
    || normalized.includes('us.amazon.nova')
  );
}

function isDeprecatedBedrockModel(summary: FoundationModelSummary): boolean {
  const status = summary.modelLifecycle?.status?.trim().toLowerCase();
  return status === 'deprecated' || status === 'legacy';
}

function isConversationalTextModel(summary: FoundationModelSummary): boolean {
  const outputModalities = summary.outputModalities ?? [];
  if (!outputModalities.includes('TEXT')) {
    return false;
  }
  if (isDeprecatedBedrockModel(summary)) {
    return false;
  }
  return typeof summary.modelId === 'string' && summary.modelId.trim().length > 0;
}

export function parseBedrockFoundationModelSummaries(
  summaries: readonly FoundationModelSummary[],
): ProviderListedModelEntry[] {
  const entries: ProviderListedModelEntry[] = [];

  for (const summary of summaries) {
    if (!isConversationalTextModel(summary)) {
      continue;
    }

    const id = summary.modelId!.trim();
    const displayName =
      typeof summary.modelName === 'string' && summary.modelName.trim().length > 0
        ? summary.modelName.trim()
        : id;
    const inputModalities = summary.inputModalities ?? [];

    entries.push({
      id,
      displayName,
      ...(typeof summary.providerName === 'string' && summary.providerName.trim().length > 0
        ? { description: summary.providerName.trim() }
        : {}),
      supportsImageInput: inputModalities.includes('IMAGE'),
      supportsReasoning: bedrockSupportsReasoning(id),
    });
  }

  return entries.sort((a, b) => a.id.localeCompare(b.id));
}

function resolveBedrockClientConfig(options: ListBedrockModelsOptions): { region: string; credentials?: { accessKeyId: string; secretAccessKey: string; sessionToken?: string } } {
  const region = normalizeAwsRegion(options.region);
  if (!region) {
    throw new Error('AWS 区域不能为空。');
  }

  const accessKeyId = options.accessKeyId?.trim();
  const secretAccessKey = options.secretAccessKey?.trim();
  if (accessKeyId && secretAccessKey) {
    return {
      region,
      credentials: {
        accessKeyId,
        secretAccessKey,
        ...(options.sessionToken?.trim() ? { sessionToken: options.sessionToken.trim() } : {}),
      },
    };
  }

  // Bearer API Key 仅用于 inference（@ai-sdk/amazon-bedrock）；ListFoundationModels 不支持 Bearer。
  if (options.apiKey?.trim()) {
    throw new Error(
      'Bearer API Key cannot list Bedrock models. Provide IAM Access Key ID and Secret Access Key.',
    );
  }

  throw new Error(
    'ListFoundationModels requires IAM Access Key ID and Secret Access Key.',
  );
}

export async function listBedrockModels(
  options: ListBedrockModelsOptions,
): Promise<ProviderListedModelEntry[]> {
  const region = normalizeAwsRegion(options.region);
  if (!region) {
    throw new Error('AWS 区域不能为空。');
  }

  const client = new BedrockClient(resolveBedrockClientConfig(options));
  const response = await client.send(
    new ListFoundationModelsCommand({
      byOutputModality: 'TEXT',
    }),
    options.signal ? { abortSignal: options.signal } : undefined,
  );

  return parseBedrockFoundationModelSummaries(response.modelSummaries ?? []);
}
