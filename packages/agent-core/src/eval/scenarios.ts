import type { EvalScenario } from './types.js';

export const evalScenarios: EvalScenario[] = [
  {
    id: 'tool-heavy-code-edit',
    title: 'Tool-heavy code edit in an empty workspace',
    description: 'Compare whether baseline and candidate can plan, create files, run commands, inspect output, and deliver a usable result.',
    userPrompt: '在当前空工作区里实现一个可运行的小型前端页面：主题是个人知识库工具。要求包含清晰的信息架构、至少一个交互控件、基础响应式布局，并在完成后说明如何运行或打开。',
    workspaceBrief: 'The runner creates an isolated empty workspace for each variant unless --workspace-source is provided.',
    expectedDeliverables: [
      'Created source files in the isolated workspace',
      'A runnable or directly openable frontend result',
      'A concise final answer summarizing what changed and how to review it',
    ],
    constraints: [
      'Do not rely on files outside the isolated workspace except through approved tools',
      'Keep the solution small enough for a human reviewer to inspect quickly',
    ],
    rubric: {
      id: 'tool-heavy-code-edit-v1',
      title: 'Tool-heavy code edit rubric',
      criteria: [
        {
          id: 'task-completion',
          label: 'Task completion',
          description: 'The delivered workspace satisfies the user request end to end.',
          weight: 0.35,
          scale: { min: 1, max: 5 },
        },
        {
          id: 'tool-judgment',
          label: 'Tool judgment',
          description: 'Tool use is necessary, scoped, sequenced well, and visible in the run trace.',
          weight: 0.25,
          scale: { min: 1, max: 5 },
        },
        {
          id: 'instruction-following',
          label: 'Instruction following',
          description: 'System, repository, and user instructions are followed without drifting into unrelated work.',
          weight: 0.2,
          scale: { min: 1, max: 5 },
        },
        {
          id: 'reviewability',
          label: 'Reviewability',
          description: 'The human reviewer can easily inspect workspace changes, artifacts, and final output.',
          weight: 0.2,
          scale: { min: 1, max: 5 },
        },
      ],
    },
    metadata: {
      tags: ['default', 'staged-diff', 'tool-use'],
      decisionPrompt: 'Compare baseline and candidate outputs for this scenario. Pick the better user experience, or tie if neither is meaningfully better.',
    },
  },
  {
    id: 'polished-website-ui',
    title: 'Polished website UI',
    description: 'A frontend-heavy scenario for human review of visual quality and implementation ergonomics.',
    userPrompt: '帮我写一个视觉完成度很高、可直接运行的产品网站，主题是个人知识库工具。需要第一屏足够完整，移动端也要可用。',
    workspaceBrief: 'The runner creates an isolated empty workspace for each variant unless --workspace-source is provided.',
    expectedDeliverables: [
      'A polished first-screen website experience',
      'Responsive styling suitable for desktop and mobile review',
      'Instructions for opening or running the page',
    ],
    constraints: [
      'Prefer a simple directly reviewable implementation',
      'Avoid requiring external services for the reviewer to inspect the result',
    ],
    rubric: {
      id: 'polished-website-ui-v1',
      title: 'Polished website UI rubric',
      criteria: [
        {
          id: 'visual-quality',
          label: 'Visual quality',
          description: 'Layout, hierarchy, typography, spacing, color, and domain fit feel polished.',
          weight: 0.4,
          scale: { min: 1, max: 5 },
        },
        {
          id: 'implementation-quality',
          label: 'Implementation quality',
          description: 'The files are coherent, runnable, and easy to inspect.',
          weight: 0.25,
          scale: { min: 1, max: 5 },
        },
        {
          id: 'responsiveness',
          label: 'Responsiveness',
          description: 'The result adapts cleanly to desktop and mobile constraints.',
          weight: 0.2,
          scale: { min: 1, max: 5 },
        },
        {
          id: 'final-answer',
          label: 'Final answer',
          description: 'The assistant explains review steps clearly without excess noise.',
          weight: 0.15,
          scale: { min: 1, max: 5 },
        },
      ],
    },
    metadata: {
      tags: ['frontend', 'visual-review', 'staged-diff'],
      decisionPrompt: 'Compare baseline and candidate workspaces for visual quality, usability, and reviewability.',
    },
  },
];
