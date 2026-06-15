import {
  readSpiritAgentModeFromTransportConfig,
  type JsonObject,
  type JsonValue,
  type SpiritAgentMode,
} from '../ports.js';
import type { OpenAiLlmVendor } from '../openai/openai-compat.js';
import {
  isAggregatedOpenAiRoutedVendor,
  normalizeGatewayOpenAiModelId,
  resolveOpenResponsesSdkProvider,
  type OpenResponsesTransportConfig,
} from './responses-compat.js';

export { normalizeGatewayOpenAiModelId } from './responses-compat.js';

const LEGACY_FILE_TOOL_NAMES = new Set(['create_file', 'edit_file', 'delete_file']);

export const APPLY_PATCH_HOST_TOOL_NAME = 'apply_patch';

/** OpenAI Responses apply_patch operation types (API names, not host function tools). */
export type ApplyPatchOperationType = 'create_file' | 'update_file' | 'delete_file';

export interface ApplyPatchOperation {
  type: ApplyPatchOperationType;
  path: string;
  diff?: string;
}

/**
 * Parses `gpt-{major}.{minor}` from a model id after optional vendor routing normalization.
 * Returns undefined when the id is not an OpenAI GPT versioned model.
 */
export function parseOpenAiGptModelVersion(modelId: string): { major: number; minor: number } | undefined {
  const trimmed = modelId.trim().toLowerCase();
  const bedrockMantle = /^openai\.(gpt-\d+(?:\.\d+)?)/.exec(trimmed);
  if (bedrockMantle?.[1]) {
    return parseOpenAiGptModelVersion(bedrockMantle[1]);
  }

  const versioned = /^gpt-(\d+)\.(\d+)/.exec(trimmed);
  if (versioned) {
    return {
      major: Number.parseInt(versioned[1] ?? '', 10),
      minor: Number.parseInt(versioned[2] ?? '', 10),
    };
  }

  const majorOnly = /^gpt-(\d+)(?:$|[-_])/.exec(trimmed);
  if (majorOnly) {
    return {
      major: Number.parseInt(majorOnly[1] ?? '', 10),
      minor: 0,
    };
  }

  return undefined;
}

export function isOpenAiGptModelAtLeast51(modelId: string): boolean {
  const version = parseOpenAiGptModelVersion(modelId);
  if (!version) {
    return false;
  }

  if (version.major > 5) {
    return true;
  }

  if (version.major === 5 && version.minor >= 1) {
    return true;
  }

  return false;
}

function isEligibleOpenAiRoutedModel(model: string, llmVendor: OpenAiLlmVendor | undefined): boolean {
  if (isAggregatedOpenAiRoutedVendor(llmVendor)) {
    const routed = normalizeGatewayOpenAiModelId(model);
    if (!routed) {
      return false;
    }
    return isOpenAiGptModelAtLeast51(routed);
  }

  if (llmVendor === 'openai') {
    return isOpenAiGptModelAtLeast51(model);
  }

  return false;
}

function isEligibleResponsesProvider(
  config: Pick<OpenResponsesTransportConfig, 'llmVendor' | 'responsesProvider' | 'model'>,
): boolean {
  const provider = resolveOpenResponsesSdkProvider(config);
  if (provider === 'openai') {
    return (
      config.llmVendor === 'openai'
      || (config.llmVendor === 'vercel-ai-gateway'
        && normalizeGatewayOpenAiModelId(config.model) !== undefined)
    );
  }

  // Gateway：function apply_patch；OpenRouter：built-in apply_patch（均走 open-responses-compatible）。
  return config.llmVendor === 'vercel-ai-gateway' || config.llmVendor === 'openrouter';
}

function isEligibleOpenRouterBuiltInApplyPatchModel(
  config: Pick<OpenResponsesTransportConfig, 'model'>,
): boolean {
  const routed = normalizeGatewayOpenAiModelId(config.model);
  return routed !== undefined && isOpenAiGptModelAtLeast51(routed);
}

/** OpenAI / OpenRouter 官方形态：apply_patch_call/output；Vercel AI Gateway 用 function_call 对。 */
export function shouldUseBuiltInApplyPatchRequestItems(
  config: Pick<OpenResponsesTransportConfig, 'llmVendor' | 'responsesProvider' | 'model'>,
): boolean {
  if (config.llmVendor === 'openai') {
    return true;
  }

  if (config.llmVendor === 'openrouter') {
    return isEligibleOpenRouterBuiltInApplyPatchModel(config);
  }

  return false;
}

/**
 * Vercel AI Gateway 不支持 built-in `type: apply_patch`，须在 tools 中注册 flat function 工具。
 * OpenRouter 走 built-in，不得落入此路径。
 */
export function shouldUseApplyPatchFunctionTool(
  config: Pick<
    OpenResponsesTransportConfig,
    'transportKind' | 'model' | 'llmVendor' | 'responsesProvider'
  >,
): boolean {
  return (
    shouldUseApplyPatchFileTools(config)
    && !shouldUseOpenAiSdkApplyPatchTool(config)
    && config.llmVendor === 'vercel-ai-gateway'
  );
}

/** OpenAI 官方：`@ai-sdk/openai` 3.x `openai.tools.applyPatch`；Gateway 走 fetch function_call。 */
export function shouldUseOpenAiSdkApplyPatchTool(
  config: Pick<
    OpenResponsesTransportConfig,
    'transportKind' | 'model' | 'llmVendor' | 'responsesProvider'
  >,
): boolean {
  return shouldUseApplyPatchFileTools(config) && config.llmVendor === 'openai';
}

export function shouldUseApplyPatchFileTools(
  config: Pick<
    OpenResponsesTransportConfig,
    'transportKind' | 'model' | 'llmVendor' | 'responsesProvider' | 'spiritAgentMode'
  >,
  options?: { agentMode?: SpiritAgentMode },
): boolean {
  const agentMode = options?.agentMode ?? readSpiritAgentModeFromTransportConfig(config);
  if (agentMode === 'ask') {
    return false;
  }

  if (config.transportKind !== 'open-responses') {
    return false;
  }

  if (!isEligibleResponsesProvider(config)) {
    return false;
  }

  return isEligibleOpenAiRoutedModel(config.model, config.llmVendor);
}

/** @deprecated Use {@link shouldUseApplyPatchFileTools}. */
export const shouldUseOpenAiApplyPatchTool = shouldUseApplyPatchFileTools;

export function isLegacyHostFileToolName(name: string): boolean {
  return LEGACY_FILE_TOOL_NAMES.has(name);
}

export function filterLegacyHostFileToolDefinitions(definitions: readonly JsonValue[]): JsonValue[] {
  return definitions.filter((definition) => {
    const name = readFunctionToolName(definition);
    return name === undefined || !LEGACY_FILE_TOOL_NAMES.has(name);
  });
}

/** @deprecated Use {@link filterLegacyHostFileToolDefinitions}. */
export const filterBuiltinFileToolsForApplyPatch = filterLegacyHostFileToolDefinitions;

const APPLY_PATCH_OPERATION_SCHEMA: JsonObject = {
  type: 'object',
  properties: {
    type: {
      type: 'string',
      enum: ['create_file', 'update_file', 'delete_file'],
      description: 'Patch operation kind.',
    },
    path: {
      type: 'string',
      description: 'Workspace-relative or absolute file path to create, update, or delete.',
    },
    diff: {
      type: 'string',
      description: 'Headerless V4A unified diff for create_file or update_file.',
    },
  },
  required: ['type', 'path'],
  additionalProperties: false,
};

/** Chat Completions `tools[]` shape (trace export / legacy). */
export function buildApplyPatchFunctionToolDefinition(): JsonObject {
  return {
    type: 'function',
    function: {
      name: APPLY_PATCH_HOST_TOOL_NAME,
      description: applyPatchFunctionToolDescription(),
      parameters: applyPatchFunctionToolParameters(),
    },
  };
}

/** OpenAI Responses `tools[]` flat function entry (Gateway / `@ai-sdk/openai`). */
export function buildApplyPatchResponsesFunctionToolDefinition(): JsonObject {
  return {
    type: 'function',
    name: APPLY_PATCH_HOST_TOOL_NAME,
    description: applyPatchFunctionToolDescription(),
    parameters: applyPatchFunctionToolParameters(),
  };
}

export function isApplyPatchFunctionToolDefinition(tool: unknown): boolean {
  return readFunctionToolName(tool as JsonValue) === APPLY_PATCH_HOST_TOOL_NAME;
}

export function hasApplyPatchToolInResponsesTools(tools: unknown): boolean {
  if (!Array.isArray(tools)) {
    return false;
  }

  for (const tool of tools) {
    if (typeof tool !== 'object' || tool === null || Array.isArray(tool)) {
      continue;
    }
    const record = tool as JsonObject;
    if (record.type === 'apply_patch') {
      return true;
    }
    if (record.type === 'function' && record.name === APPLY_PATCH_HOST_TOOL_NAME) {
      return true;
    }
    if (isApplyPatchFunctionToolDefinition(record)) {
      return true;
    }
  }

  return false;
}

function applyPatchFunctionToolDescription(): string {
  return (
    'Apply a headerless V4A unified diff to create, update, or delete a file. '
    + 'Provide operation.type, operation.path, and operation.diff for create/update.'
  );
}

function applyPatchFunctionToolParameters(): JsonObject {
  return {
    type: 'object',
    properties: {
      operation: APPLY_PATCH_OPERATION_SCHEMA,
    },
    required: ['operation'],
    additionalProperties: false,
  };
}

/** Model-visible guidance when legacy file tools are hidden in favor of apply_patch. */
export function buildApplyPatchFileToolsPromptSection(): string {
  return 'File edits on this transport: use apply_patch with headerless V4A unified diffs only.';
}

function readFunctionToolName(definition: JsonValue): string | undefined {
  if (typeof definition !== 'object' || definition === null || Array.isArray(definition)) {
    return undefined;
  }

  const fn = definition.function;
  if (typeof fn !== 'object' || fn === null || Array.isArray(fn)) {
    return undefined;
  }

  return typeof fn.name === 'string' ? fn.name : undefined;
}
