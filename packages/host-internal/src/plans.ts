import path from 'node:path';

import { PLANS_DIR_NAME, type InstructionDiscoveryContext, resolveInstructionPaths } from './storage.js';

const PLAN_NAME_PATTERN = /^[a-zA-Z0-9_-]+$/;
const CREATE_PLAN_PATH_PATTERN = /\[plan\]\npath: ([^\n]+)/;

export function sanitizePlanName(rawName: string): string {
  const trimmed = rawName.trim();
  if (!trimmed) {
    throw new Error('Plan name cannot be empty.');
  }
  if (trimmed.includes('/') || trimmed.includes('\\') || trimmed.includes('..')) {
    throw new Error('Plan name must not contain path separators or "..".');
  }
  const stem = trimmed.endsWith('.md') ? trimmed.slice(0, -3) : trimmed;
  if (!stem || stem.includes('.') || stem.includes(' ')) {
    throw new Error('Plan name must be a single slug (letters, digits, hyphens, underscores).');
  }
  if (!PLAN_NAME_PATTERN.test(stem)) {
    throw new Error('Plan name must use only letters, digits, hyphens, and underscores.');
  }
  return stem;
}

export function resolvePlansDir(context: InstructionDiscoveryContext): string {
  return resolveInstructionPaths(context).plansDir;
}

export function resolvePlanFilePath(context: InstructionDiscoveryContext, rawName: string): string {
  const name = sanitizePlanName(rawName);
  return path.join(resolvePlansDir(context), `${name}.md`);
}

export function isPathUnderPlansDir(
  resolvedPath: string,
  context: InstructionDiscoveryContext,
): boolean {
  const plansDir = path.resolve(resolvePlansDir(context));
  const candidate = path.resolve(resolvedPath);
  const relative = path.relative(plansDir, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

export function parseCreatePlanPathFromToolOutput(output: string): string | undefined {
  const match = output.match(CREATE_PLAN_PATH_PATTERN);
  const trimmed = match?.[1]?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

function llmMessageTextContent(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }
  if (!Array.isArray(content)) {
    return '';
  }
  return content
    .map((part) => {
      if (typeof part !== 'object' || part === null) {
        return '';
      }
      const text = (part as { text?: unknown }).text;
      return typeof text === 'string' ? text : '';
    })
    .join('\n');
}

export function extractActivePlanPathFromLlmHistory(
  history: readonly { role?: string; content?: unknown }[],
): string | undefined {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const message = history[index];
    if (!message) {
      continue;
    }
    const role = typeof message.role === 'string' ? message.role : '';
    if (role !== 'tool' && role !== 'assistant') {
      continue;
    }
    const pathFromOutput = parseCreatePlanPathFromToolOutput(llmMessageTextContent(message.content));
    if (pathFromOutput) {
      return pathFromOutput;
    }
  }
  return undefined;
}
