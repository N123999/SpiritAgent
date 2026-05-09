import type { EvalComparison, EvalRunSpec, EvalScenario } from './types.js';

export function createExampleEvalScenario(): EvalScenario {
  return {
    id: 'website-ui-craft',
    title: 'Build a polished product website UI',
    description: 'A human-reviewable scenario for comparing prompt/runtime changes on frontend implementation quality.',
    userPrompt: '帮我写一个视觉完成度很高、可直接运行的产品网站，主题是个人知识库工具。',
    workspaceBrief: 'Host creates an isolated frontend workspace for each variant and runs the same setup steps.',
    expectedDeliverables: [
      'Runnable frontend implementation',
      'Responsive first screen and core interaction states',
      'Concise implementation summary',
    ],
    constraints: [
      'Do not reuse artifacts between variants',
      'Do not reveal which variant is baseline or candidate to the reviewer',
    ],
    rubric: {
      id: 'frontend-human-review-v1',
      title: 'Frontend human review rubric',
      criteria: [
        {
          id: 'visual-quality',
          label: 'Visual quality',
          description: 'Polish, layout, typography, spacing, and domain fit.',
          weight: 0.35,
          scale: { min: 1, max: 5 },
        },
        {
          id: 'task-completion',
          label: 'Task completion',
          description: 'Completeness of implementation relative to the prompt.',
          weight: 0.35,
          scale: { min: 1, max: 5 },
        },
        {
          id: 'engineering-fit',
          label: 'Engineering fit',
          description: 'Code organization, use of existing patterns, and runnable output.',
          weight: 0.3,
          scale: { min: 1, max: 5 },
        },
      ],
    },
  };
}

export function createExampleEvalRunSpec(): EvalRunSpec {
  const scenario = createExampleEvalScenario();
  return {
    id: 'dry-run-website-ui-craft',
    scenario,
    variants: [
      {
        id: 'baseline',
        role: 'baseline',
        label: 'Before prompt/runtime change',
      },
      {
        id: 'candidate',
        role: 'candidate',
        label: 'After prompt/runtime change',
      },
    ],
    isolation: {
      kind: 'host-provided-workspace',
      description: 'agent-core declares the contract only; host-internal/apps provide isolated execution.',
    },
    artifactPolicy: {
      collect: ['transcript', 'workspace-diff', 'screenshot', 'log', 'metadata'],
      redactionNotes: 'Host redacts secrets before persisting or presenting artifacts.',
    },
  };
}

export function createDryRunEvalComparison(): EvalComparison {
  const scenario = createExampleEvalScenario();
  return {
    id: 'dry-run-comparison',
    scenarioId: scenario.id,
    baselineVariantId: 'baseline',
    candidateVariantId: 'candidate',
    review: {
      reviewedAt: new Date(0).toISOString(),
      outcome: 'inconclusive',
      rationale: 'Dry run only validates comparison shape; no human preference is recorded.',
      criterionScores: scenario.rubric.criteria.map((criterion) => ({
        criterionId: criterion.id,
        notes: 'pending human review',
      })),
    },
  };
}
