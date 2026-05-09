import type { JsonValue, LlmMessage } from '../ports.js';

export type EvalVariantRole = 'baseline' | 'candidate' | 'reference';

export type EvalArtifactKind =
  | 'transcript'
  | 'workspace-diff'
  | 'file'
  | 'screenshot'
  | 'log'
  | 'metadata';

export type EvalReviewOutcome = 'baseline' | 'candidate' | 'tie' | 'inconclusive';

export interface EvalRubricCriterion {
  id: string;
  label: string;
  description: string;
  weight: number;
  scale: {
    min: number;
    max: number;
  };
}

export interface EvalRubric {
  id: string;
  title: string;
  criteria: EvalRubricCriterion[];
}

export interface EvalScenario {
  id: string;
  title: string;
  description?: string;
  userPrompt: string;
  systemPrompt?: string;
  initialMessages?: LlmMessage[];
  workspaceBrief?: string;
  expectedDeliverables?: string[];
  constraints?: string[];
  rubric: EvalRubric;
  metadata?: Record<string, JsonValue>;
}

export interface EvalVariant {
  id: string;
  role: EvalVariantRole;
  label: string;
  description?: string;
  promptSnapshot?: string;
  codeRevision?: string;
  model?: string;
  metadata?: Record<string, JsonValue>;
}

export interface EvalRunSpec {
  id: string;
  scenario: EvalScenario;
  variants: EvalVariant[];
  isolation: {
    kind: 'host-provided-workspace';
    description?: string;
  };
  artifactPolicy: {
    collect: EvalArtifactKind[];
    redactionNotes?: string;
  };
  metadata?: Record<string, JsonValue>;
}

export interface EvalArtifactEntry {
  id: string;
  kind: EvalArtifactKind;
  label: string;
  relativePath?: string;
  sha256?: string;
  summary?: string;
  metadata?: Record<string, JsonValue>;
}

export interface EvalArtifactManifest {
  id: string;
  runId: string;
  scenarioId: string;
  variantId: string;
  createdAt: string;
  artifacts: EvalArtifactEntry[];
  metadata?: Record<string, JsonValue>;
}

export interface EvalCriterionScore {
  criterionId: string;
  baselineScore?: number;
  candidateScore?: number;
  notes?: string;
}

export interface HumanReview {
  reviewerId?: string;
  reviewedAt: string;
  outcome: EvalReviewOutcome;
  rationale: string;
  criterionScores: EvalCriterionScore[];
  notes?: string;
}

export interface EvalComparison {
  id: string;
  scenarioId: string;
  baselineVariantId: string;
  candidateVariantId: string;
  baselineManifestId?: string;
  candidateManifestId?: string;
  review: HumanReview;
  metadata?: Record<string, JsonValue>;
}
