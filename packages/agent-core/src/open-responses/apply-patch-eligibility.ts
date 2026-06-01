import type { JsonValue } from '../ports.js';
import type { OpenAiLlmVendor } from '../openai/openai-compat.js';
import {
  resolveOpenResponsesSdkProvider,
  type OpenResponsesTransportConfig,
} from './responses-compat.js';

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

function isEligibleOpenAiRoutedModel(model: string, llmVendor: OpenAiLlmVendor | undefined): boolean {
  if (llmVendor === 'vercel-ai-gateway') {
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
  config: Pick<OpenResponsesTransportConfig, 'llmVendor' | 'responsesProvider'>,
): boolean {
  const provider = resolveOpenResponsesSdkProvider(config);
  if (provider === 'openai') {
    return config.llmVendor === 'openai';
  }

  return config.llmVendor === 'vercel-ai-gateway';
}

export function shouldUseApplyPatchFileTools(
  config: Pick<
    OpenResponsesTransportConfig,
    'transportKind' | 'model' | 'llmVendor' | 'responsesProvider'
  >,
): boolean {
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
