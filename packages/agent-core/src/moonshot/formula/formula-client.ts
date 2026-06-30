import { getLlmFetch } from '../../llm-fetch.js';
import { normalizeMoonshotApiBase } from '../../openai/moonshot-files.js';
import type { JsonObject } from '../../ports.js';
import { isJsonObject } from '../../tool-agent.js';
import type {
  FormulaFiberInvokeResult,
  FormulaFiberResponse,
  FormulaToolDefinition,
  FormulaToolsListResponse,
  FormulaUri,
} from './formula-types.js';

export type FormulaClientConfig = {
  apiKey: string;
  baseUrl?: string;
};

function buildFormulaAuthorizationHeader(apiKey: string): string {
  return `Bearer ${apiKey.trim()}`;
}

function buildFormulaApiUrl(baseUrl: string | undefined, path: string): string {
  const apiBase = normalizeMoonshotApiBase(baseUrl);
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${apiBase}${normalizedPath}`;
}

function readFiberError(fiber: FormulaFiberResponse): string | undefined {
  if (typeof fiber.error === 'string' && fiber.error.trim()) {
    return fiber.error.trim();
  }

  const context = fiber.context;
  if (!context) {
    return undefined;
  }

  if (typeof context.error === 'string' && context.error.trim()) {
    return context.error.trim();
  }

  if (
    typeof context.output === 'string'
    && context.output.trim()
    && fiber.status !== 'succeeded'
  ) {
    return context.output.trim();
  }

  return undefined;
}

function readFiberSucceededContent(fiber: FormulaFiberResponse): string | undefined {
  const context = fiber.context;
  if (!context) {
    return undefined;
  }

  const encrypted = typeof context.encrypted_output === 'string'
    ? context.encrypted_output
    : undefined;
  if (encrypted && encrypted.length > 0) {
    return encrypted;
  }

  const output = typeof context.output === 'string' ? context.output : undefined;
  if (output && output.length > 0) {
    return output;
  }

  return undefined;
}

export async function fetchFormulaTools(
  config: FormulaClientConfig,
  formulaUri: FormulaUri,
  fetchImpl: typeof fetch = getLlmFetch(),
): Promise<FormulaToolDefinition[]> {
  const response = await fetchImpl(
    buildFormulaApiUrl(config.baseUrl, `/formulas/${formulaUri}/tools`),
    {
      method: 'GET',
      headers: {
        Authorization: buildFormulaAuthorizationHeader(config.apiKey),
      },
    },
  );

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(
      `Moonshot Formula tools request failed (${response.status}): ${body.trim() || response.statusText}`,
    );
  }

  const payload = await response.json() as FormulaToolsListResponse;
  const tools = Array.isArray(payload.tools) ? payload.tools : [];
  return tools.filter(isFormulaToolDefinition);
}

export async function invokeFormulaFiber(
  config: FormulaClientConfig,
  formulaUri: FormulaUri,
  functionName: string,
  argumentsJson: string,
  fetchImpl: typeof fetch = getLlmFetch(),
): Promise<FormulaFiberInvokeResult> {
  const response = await fetchImpl(
    buildFormulaApiUrl(config.baseUrl, `/formulas/${formulaUri}/fibers`),
    {
      method: 'POST',
      headers: {
        Authorization: buildFormulaAuthorizationHeader(config.apiKey),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: functionName,
        arguments: argumentsJson,
      }),
    },
  );

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    return {
      kind: 'failed',
      error: `Moonshot Formula fiber request failed (${response.status}): ${body.trim() || response.statusText}`,
    };
  }

  const fiber = await response.json() as FormulaFiberResponse;
  const status = typeof fiber.status === 'string' ? fiber.status.trim().toLowerCase() : '';

  if (status === 'succeeded') {
    const content = readFiberSucceededContent(fiber);
    if (content !== undefined) {
      return { kind: 'succeeded', content };
    }
    return { kind: 'failed', error: 'Moonshot Formula fiber succeeded without output.' };
  }

  const error = readFiberError(fiber) ?? `Moonshot Formula fiber failed (status=${status || 'unknown'}).`;
  return { kind: 'failed', error };
}

function isFormulaToolDefinition(value: unknown): value is FormulaToolDefinition {
  if (!isJsonObject(value as JsonObject)) {
    return false;
  }

  const record = value as JsonObject;
  if (record.type !== 'function' || !isJsonObject(record.function as JsonObject)) {
    return false;
  }

  const fn = record.function as JsonObject;
  return typeof fn.name === 'string' && fn.name.trim().length > 0;
}
