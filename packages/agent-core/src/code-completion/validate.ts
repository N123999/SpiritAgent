import { isJsonObject } from '../tool-agent.js';
import type { JsonValue } from '../ports.js';

import type { CodeCompletionOperation, CodeCompletionResult } from './types.js';

function isPositiveInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1;
}

function parseOperation(value: JsonValue | undefined): CodeCompletionOperation | undefined {
  if (!isJsonObject(value)) {
    return undefined;
  }

  const kind = value.kind;
  if (kind !== 'insert' && kind !== 'replace' && kind !== 'delete') {
    return undefined;
  }

  const startLine = value.startLine;
  const startColumn = value.startColumn;
  const endLine = value.endLine;
  const endColumn = value.endColumn;
  if (
    !isPositiveInt(startLine) ||
    !isPositiveInt(startColumn) ||
    !isPositiveInt(endLine) ||
    !isPositiveInt(endColumn)
  ) {
    return undefined;
  }

  if (startLine > endLine || (startLine === endLine && startColumn > endColumn)) {
    return undefined;
  }

  const text = value.text;
  if (text !== undefined && typeof text !== 'string') {
    return undefined;
  }

  if (kind === 'insert') {
    if (startLine !== endLine || startColumn !== endColumn) {
      return undefined;
    }
    if (typeof text !== 'string') {
      return undefined;
    }
  }

  if (kind === 'replace') {
    if (startLine === endLine && startColumn === endColumn) {
      return undefined;
    }
    if (typeof text !== 'string') {
      return undefined;
    }
  }

  if (kind === 'delete') {
    if (startLine === endLine && startColumn === endColumn) {
      return undefined;
    }
  }

  return {
    kind,
    startLine,
    startColumn,
    endLine,
    endColumn,
    ...(typeof text === 'string' ? { text } : {}),
  };
}

export function validateCodeCompletionOutput(output: JsonValue): CodeCompletionResult | undefined {
  if (!isJsonObject(output)) {
    return undefined;
  }

  const operationsRaw = output.operations;
  if (!Array.isArray(operationsRaw)) {
    return undefined;
  }

  const operations: CodeCompletionOperation[] = [];
  for (const item of operationsRaw) {
    const parsed = parseOperation(item);
    if (!parsed) {
      return undefined;
    }
    operations.push(parsed);
  }

  return { operations };
}
