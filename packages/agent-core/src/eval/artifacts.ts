import type { JsonValue } from '../ports.js';

import { assertEvalScenario } from './validation.js';

export interface EvalRunArtifactCandidate {
  id: string;
  label: string;
  sourceRef: string;
  patchFingerprint?: string;
  modelConfigFingerprint: string;
  systemPromptFingerprint: string;
  toolSchemaFingerprint: string;
  workspaceIsolationId: string;
  outputText: string;
  artifactPaths: string[];
  traceSummary: {
    toolCallCount: number;
    approvalRequestCount: number;
    backgroundToolCount: number;
    compactionCount: number;
    streamingEventCount: number;
    warnings: string[];
  };
  metadata?: Record<string, JsonValue>;
}

export interface EvalRunArtifact {
  schemaVersion: 1;
  runId: string;
  createdAtUnixMs: number;
  scenario: unknown;
  baselineRef: string;
  stagedDiffFingerprint: string;
  workspaceSource?: string;
  candidates: EvalRunArtifactCandidate[];
  humanReview: {
    status: 'pending-human-review' | 'completed';
    [key: string]: JsonValue;
  };
}

export function validateEvalRunArtifact(value: unknown): asserts value is EvalRunArtifact {
  if (!isRecord(value)) {
    throw new Error('Eval run artifact must be an object.');
  }

  if (value.schemaVersion !== 1) {
    throw new Error('Eval run artifact schemaVersion must be 1.');
  }

  requireNonEmptyString(value, 'runId');
  requireNonEmptyString(value, 'baselineRef');
  requireNonEmptyString(value, 'stagedDiffFingerprint');

  if (typeof value.createdAtUnixMs !== 'number' || !Number.isFinite(value.createdAtUnixMs)) {
    throw new Error('Eval run artifact createdAtUnixMs must be a finite number.');
  }

  assertEvalScenario(value.scenario);

  if (!Array.isArray(value.candidates) || value.candidates.length !== 2) {
    throw new Error('Eval run artifact candidates must contain exactly baseline and candidate records.');
  }

  for (const candidate of value.candidates) {
    validateCandidate(candidate);
  }

  if (!isRecord(value.humanReview) || typeof value.humanReview.status !== 'string') {
    throw new Error('Eval run artifact humanReview.status is required.');
  }
}

function validateCandidate(value: unknown): void {
  if (!isRecord(value)) {
    throw new Error('Eval run candidate must be an object.');
  }

  for (const field of [
    'id',
    'label',
    'sourceRef',
    'modelConfigFingerprint',
    'systemPromptFingerprint',
    'toolSchemaFingerprint',
    'workspaceIsolationId',
    'outputText',
  ]) {
    requireNonEmptyString(value, field);
  }

  if (
    !Array.isArray(value.artifactPaths) ||
    value.artifactPaths.length === 0 ||
    value.artifactPaths.some((entry) => typeof entry !== 'string' || !entry.trim())
  ) {
    throw new Error(`Eval run candidate ${String(value.id)} artifactPaths must be a non-empty string array.`);
  }

  if (!isRecord(value.traceSummary)) {
    throw new Error(`Eval run candidate ${String(value.id)} traceSummary is required.`);
  }

  for (const field of [
    'toolCallCount',
    'approvalRequestCount',
    'backgroundToolCount',
    'compactionCount',
    'streamingEventCount',
  ]) {
    if (typeof value.traceSummary[field] !== 'number' || !Number.isFinite(value.traceSummary[field])) {
      throw new Error(`Eval run candidate ${String(value.id)} traceSummary.${field} must be a number.`);
    }
  }

  if (!Array.isArray(value.traceSummary.warnings)) {
    throw new Error(`Eval run candidate ${String(value.id)} traceSummary.warnings must be an array.`);
  }
}

function requireNonEmptyString(value: Record<string, unknown>, field: string): void {
  if (typeof value[field] !== 'string' || !value[field].trim()) {
    throw new Error(`Eval run artifact ${field} must be a non-empty string.`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
