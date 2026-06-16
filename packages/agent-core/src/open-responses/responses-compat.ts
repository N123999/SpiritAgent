import type { JsonObject, JsonValue, SpiritAgentMode } from '../ports.js';
import type { LlmModelCapabilities } from '../llm-provider-shared.js';
import type {
  OpenAiImageGenerationConfig,
  OpenAiLlmVendor,
  OpenAiVideoGenerationConfig,
} from '../openai/openai-compat.js';
import { resolveOpenAiTransportReasoningEffortForContext } from '../reasoning-effort.js';
import { extractAzureResourceNameFromApiBase } from '../azure-resource.js';
import { cloneJsonValue } from '../tool-agent.js';

/** 底层 AI SDK provider：OpenAI 官方 Responses、Azure 官方 Responses 或 Open Responses 兼容 endpoint。 */
export type OpenResponsesSdkProvider = 'openai' | 'xai' | 'azure' | 'open-responses-compatible';

export type OpenResponsesPreviousResponseMode = 'disabled' | 'stored' | 'stateless';

export type OpenResponsesReasoningSummary = 'auto' | 'detailed' | 'off';

export interface OpenResponsesTransportConfig {
  transportKind: 'open-responses';
  apiKey: string;
  model: string;
  baseUrl?: string;
  organization?: string;
  project?: string;
  compactModel?: string;
  workspaceRoot?: string;
  /**
   * 与宿主 `ModelProfile.provider` 对齐；用于推断默认 `responsesProvider`。
   */
  llmVendor?: OpenAiLlmVendor;
  modelCapabilities?: LlmModelCapabilities;
  /**
   * 显式指定底层 SDK。缺省时：`openai` → OpenAI 官方、`xai` → `@ai-sdk/xai` 官方、
   * Gateway `openai/*` → `@ai-sdk/openai`、其余 Gateway 与其它厂商 → `open-responses-compatible`。
   */
  responsesProvider?: OpenResponsesSdkProvider;
  /** OpenAI 官方 Responses：是否由 OpenAI 服务端存储会话。默认 false。 */
  store?: boolean;
  previousResponseMode?: OpenResponsesPreviousResponseMode;
  reasoningEffort?: 'default' | 'minimal' | 'none' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  reasoningSummary?: OpenResponsesReasoningSummary;
  truncation?: 'disabled' | 'auto';
  /** Host run mode; Ask disables apply_patch injection. */
  spiritAgentMode?: SpiritAgentMode;
  /** Optional dedicated model role used by the `generate_image` tool. */
  imageGeneration?: OpenAiImageGenerationConfig;
  /** Optional dedicated model role used by the `generate_video` tool. */
  videoGeneration?: OpenAiVideoGenerationConfig;
  /**
   * Bedrock Mantle Open Responses：无静态 Bearer 时用 IAM 生成短期 token。
   * 静态 `apiKey` 优先；二者皆无则请求会在 SDK 层失败。
   */
  bedrockMantleIam?: {
    region: string;
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken?: string;
  };
  /** Azure 资源名；与 `@ai-sdk/azure` 的 `resourceName` 对齐。 */
  azureResourceName?: string;
}

export type OpenResponsesRequestTraceKind =
  | 'openai_sdk_responses'
  | 'xai_sdk_responses'
  | 'azure_sdk_responses'
  | 'open_responses_sdk_responses'
  | 'alibaba_open_responses';

export interface OpenResponsesRequestTrace extends JsonObject {
  kind: OpenResponsesRequestTraceKind;
  stepIndex: number;
  model: string;
  stream: boolean;
  input?: JsonValue;
  tools?: JsonValue[];
  store?: boolean;
  previousResponseId?: string;
  reasoning?: JsonValue;
  truncation?: string;
}

/**
 * Strips Gateway-style `openai/` routing prefix. Other vendor prefixes return undefined.
 */
export function normalizeGatewayOpenAiModelId(model: string): string | undefined {
  const trimmed = model.trim();
  const lower = trimmed.toLowerCase();
  const prefix = 'openai/';
  if (!lower.startsWith(prefix)) {
    return undefined;
  }

  return trimmed.slice(prefix.length).trim();
}

export function isGatewayOpenAiRoutedModel(model: string): boolean {
  return normalizeGatewayOpenAiModelId(model) !== undefined;
}

/**
 * 聚合商统一 `openai/*` 模型 id 剥离（`resolveOpenResponsesLanguageModelId` 等）。
 * 勿用于 apply_patch 形态决策：Gateway 用 function tool，OpenRouter 用 built-in（见 apply-patch-eligibility）。
 */
export function isAggregatedOpenAiRoutedVendor(
  llmVendor: OpenAiLlmVendor | undefined,
): llmVendor is 'vercel-ai-gateway' | 'openrouter' {
  return llmVendor === 'vercel-ai-gateway' || llmVendor === 'openrouter';
}

/**
 * Model id passed to `@ai-sdk/openai` / `@ai-sdk/xai` language model factories.
 * Gateway OpenAI routes use the stripped id (e.g. `gpt-5.1` from `openai/gpt-5.1`).
 */
export function resolveOpenResponsesLanguageModelId(
  config: Pick<OpenResponsesTransportConfig, 'model' | 'llmVendor'>,
): string {
  if (isAggregatedOpenAiRoutedVendor(config.llmVendor)) {
    const routed = normalizeGatewayOpenAiModelId(config.model);
    if (routed) {
      return routed;
    }
  }

  return config.model;
}

/** Bedrock Mantle Open Responses（如 openai.gpt-5.5 @ bedrock-mantle.*.api.aws/openai/v1）。 */
export function isBedrockMantleOpenResponsesConfig(
  config: Pick<OpenResponsesTransportConfig, 'baseUrl' | 'model'>,
): boolean {
  const baseUrl = config.baseUrl?.trim().toLowerCase() ?? '';
  if (baseUrl.includes('bedrock-mantle.') && baseUrl.includes('/openai/')) {
    return true;
  }

  return /^openai\.gpt-/i.test(config.model.trim());
}

export function resolveOpenResponsesSdkProvider(
  config: Pick<OpenResponsesTransportConfig, 'llmVendor' | 'responsesProvider' | 'model'>,
): OpenResponsesSdkProvider {
  // Honor an explicit choice (including `openai`) when the caller sets one.
  if (config.responsesProvider !== undefined) {
    return config.responsesProvider;
  }

  if (config.llmVendor === 'openai') {
    return 'openai';
  }

  if (config.llmVendor === 'xai') {
    return 'xai';
  }

  if (config.llmVendor === 'azure') {
    return 'azure';
  }

  // Gateway-routed OpenAI models (e.g. `openai/gpt-5.4`) MUST use the generic
  // `@ai-sdk/open-responses` provider, not `@ai-sdk/openai`. The latter assumes a
  // direct OpenAI endpoint: it strips the `openai/` routing prefix and injects
  // direct-only request shaping, which makes the Vercel AI Gateway silently stop
  // streaming reasoning summaries. apply_patch stays available via the flat
  // function-tool path (shouldUseApplyPatchFunctionTool).
  return 'open-responses-compatible';
}

export function openResponsesReasoningEffort(
  config: Pick<OpenResponsesTransportConfig, 'llmVendor' | 'model' | 'reasoningEffort'>,
): string | undefined {
  return resolveOpenAiTransportReasoningEffortForContext(config.reasoningEffort, {
    ...(config.llmVendor ? { provider: config.llmVendor } : {}),
    model: config.model,
    transportKind: 'open-responses',
  });
}

/**
 * 解析是否向 Responses 请求 reasoning summary。
 * 未显式配置时：reasoningEffort 为 none 则关闭，否则默认 auto（便于 UI 展示思考摘要）。
 */
export function resolveOpenResponsesReasoningSummary(
  config: Pick<
    OpenResponsesTransportConfig,
    'baseUrl' | 'llmVendor' | 'model' | 'reasoningEffort' | 'reasoningSummary'
  >,
): OpenResponsesReasoningSummary | undefined {
  if (isBedrockMantleOpenResponsesConfig(config)) {
    return undefined;
  }

  if (config.reasoningSummary === 'off' || config.reasoningEffort === 'none') {
    return undefined;
  }

  if (config.reasoningSummary === 'auto' || config.reasoningSummary === 'detailed') {
    return config.reasoningSummary;
  }

  return 'auto';
}

export function openResponsesReasoningTrace(
  config: Pick<
    OpenResponsesTransportConfig,
    'llmVendor' | 'model' | 'reasoningEffort' | 'reasoningSummary'
  >,
): JsonObject | undefined {
  const effort = openResponsesReasoningEffort(config);
  const summary = resolveOpenResponsesReasoningSummary(config);
  if (effort === undefined && summary === undefined) {
    return undefined;
  }

  return {
    ...(effort !== undefined ? { effort } : {}),
    ...(summary !== undefined ? { summary } : {}),
  };
}

export function buildOpenResponsesTraceExtras(
  config: OpenResponsesTransportConfig,
  previousResponseId?: string,
): Pick<OpenResponsesRequestTrace, 'store' | 'previousResponseId' | 'reasoning' | 'truncation'> {
  const reasoning = openResponsesReasoningTrace(config);

  return {
    ...(config.store !== undefined ? { store: config.store } : {}),
    ...(previousResponseId ? { previousResponseId } : {}),
    ...(config.truncation ? { truncation: config.truncation } : {}),
    ...(reasoning ? { reasoning } : {}),
  };
}

export function buildOpenResponsesRequestTrace(
  config: OpenResponsesTransportConfig,
  stepIndex: number,
  input: readonly JsonValue[],
  tools: readonly unknown[],
  stream = false,
  extras?: Pick<OpenResponsesRequestTrace, 'store' | 'previousResponseId' | 'reasoning' | 'truncation'>,
): JsonValue[] {
  const provider = resolveOpenResponsesSdkProvider(config);
  const kind: OpenResponsesRequestTraceKind =
    config.llmVendor === 'alibaba' && provider === 'open-responses-compatible'
      ? 'alibaba_open_responses'
      : provider === 'openai'
        ? 'openai_sdk_responses'
        : provider === 'xai'
          ? 'xai_sdk_responses'
          : provider === 'azure'
            ? 'azure_sdk_responses'
            : 'open_responses_sdk_responses';

  const trace: OpenResponsesRequestTrace = {
    kind,
    stepIndex,
    model: config.model,
    stream,
    input: input.map((item) => cloneJsonValue(item)),
    ...(tools.length > 0
      ? { tools: tools.map((tool) => cloneJsonValue(tool as JsonValue)) }
      : {}),
    ...(extras?.store !== undefined ? { store: extras.store } : {}),
    ...(extras?.previousResponseId ? { previousResponseId: extras.previousResponseId } : {}),
    ...(extras?.reasoning !== undefined ? { reasoning: extras.reasoning } : {}),
    ...(extras?.truncation ? { truncation: extras.truncation } : {}),
  };

  return [trace];
}

export function normalizeOpenResponsesApiBase(baseUrl: string | undefined): string {
  const trimmed = (baseUrl ?? 'https://api.openai.com/v1').trim().replace(/\/+$/, '');
  return trimmed.length > 0 ? trimmed : 'https://api.openai.com/v1';
}

export function openResponsesPostUrl(baseUrl: string | undefined): string {
  const normalized = normalizeOpenResponsesApiBase(baseUrl);
  return normalized.endsWith('/responses') ? normalized : `${normalized}/responses`;
}

export function resolveAzureResourceName(
  config: Pick<OpenResponsesTransportConfig, 'azureResourceName' | 'baseUrl'>,
): string {
  const explicit = config.azureResourceName?.trim();
  if (explicit) {
    return explicit;
  }

  const fromBase = extractAzureResourceNameFromApiBase(config.baseUrl ?? '');
  if (fromBase) {
    return fromBase;
  }

  throw new Error('Azure 缺少 azureResourceName 配置。');
}
