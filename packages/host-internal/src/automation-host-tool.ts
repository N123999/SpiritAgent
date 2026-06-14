import {
  buildContributedHostToolDefinitions,
  type ContributedHostToolDefinition,
  type JsonObject,
  type JsonValue,
} from '@spirit-agent/core';

import type { HostAutomationSchedule, HostAutomationTrigger } from './automations.js';
import { normalizeAutomationSchedule, normalizeAutomationTrigger } from './automations.js';

export type CreateAutomationApprovalLevel = 'default' | 'full-approval';

export const CREATE_AUTOMATION_TOOL_NAME = 'create_automation';

const AUTOMATION_TITLE_MAX_CHARS = 80;

export function deriveAutomationTitle(overview: string, explicitTitle?: string): string {
  const trimmedExplicit = explicitTitle?.trim();
  if (trimmedExplicit) {
    return trimmedExplicit;
  }
  const firstLine = overview.trim().split(/\r?\n/u)[0]?.trim() ?? '';
  if (!firstLine) {
    throw new Error('create_automation 需要非空的 overview 或 title。');
  }
  return [...firstLine].length > AUTOMATION_TITLE_MAX_CHARS
    ? [...firstLine].slice(0, AUTOMATION_TITLE_MAX_CHARS).join('')
    : firstLine;
}

export function parseCreateAutomationApprovalLevel(value: unknown): CreateAutomationApprovalLevel {
  if (value === undefined) {
    return 'default';
  }
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('Invalid approval_level for create_automation.');
  }
  const trimmed = value.trim();
  if (trimmed === 'full-approval' || trimmed === 'full-access') {
    return 'full-approval';
  }
  return 'default';
}

export function formatCreateAutomationApprovalLabel(level: CreateAutomationApprovalLevel): string {
  return level === 'full-approval' ? '跳过审批' : '默认审批';
}

export function parseCreateAutomationSchedule(value: unknown): HostAutomationSchedule {
  const schedule = normalizeAutomationSchedule(value);
  if (!schedule) {
    throw new Error('Invalid automation schedule.');
  }
  return schedule;
}

export function parseCreateAutomationTrigger(value: unknown): HostAutomationTrigger {
  const trigger = normalizeAutomationTrigger(value);
  if (!trigger) {
    throw new Error('Invalid automation trigger.');
  }
  return trigger;
}

export function parseCreateAutomationTriggerInput(parsed: Record<string, unknown>): HostAutomationTrigger {
  if (parsed.trigger !== undefined) {
    return parseCreateAutomationTrigger(parsed.trigger);
  }
  const scheduleValue = parsed.schedule;
  if (scheduleValue === undefined) {
    throw new Error('create_automation 缺少 trigger 或 schedule。');
  }
  return parseCreateAutomationTrigger({ kind: 'time', schedule: parseCreateAutomationSchedule(scheduleValue) });
}

export const CREATE_AUTOMATION_CONTRIBUTED_TOOL: ContributedHostToolDefinition = {
  name: CREATE_AUTOMATION_TOOL_NAME,
  excludeFromAskMode: true,
  agentModeExposure: 'agent',
  description:
    'Create a Desktop automation that runs an agent turn with your prompt on the current workspace. ' +
    'Triggers may be time-based (hourly/daily/weekly local time) or GitHub repository events (new pull request or issue). ' +
    'Use when the user asks to automate recurring work or react to GitHub activity.',
  inputSchema: {
    type: 'object',
    properties: {
      overview: {
        type: 'string',
        description:
          'Agent prompt executed on each run. Write a self-contained instruction the automation agent can follow without extra context.',
      },
      title: {
        type: 'string',
        description:
          'Short list title shown in the Automations UI. Optional; defaults to the first line of overview (max 80 characters).',
      },
      approval_level: {
        type: 'string',
        enum: ['default', 'full-approval'],
        description:
          'Approval policy when the automation runs. default: normal tool approval prompts; full-approval: skip high-risk approval prompts for that automation run. Omit to use default.',
      },
      trigger: {
        type: 'object',
        description:
          'Preferred trigger definition. kind=time uses schedule; kind=github listens for new pull requests or issues in a repository.',
        properties: {
          kind: {
            type: 'string',
            enum: ['time', 'github'],
          },
          schedule: {
            type: 'object',
            description: 'Required when kind=time.',
            properties: {
              kind: { type: 'string', enum: ['hourly', 'daily', 'weekly'] },
              hour: { type: 'integer', minimum: 0, maximum: 23 },
              minute: { type: 'integer', minimum: 0, maximum: 59 },
              weekday: { type: 'integer', minimum: 0, maximum: 6 },
            },
            required: ['kind'],
            additionalProperties: false,
          },
          owner: { type: 'string', description: 'GitHub owner/org. Required when kind=github.' },
          repo: { type: 'string', description: 'GitHub repository name. Required when kind=github.' },
          event: {
            type: 'string',
            enum: ['pull_request_created', 'issue_created'],
            description: 'GitHub event to watch when kind=github.',
          },
        },
        required: ['kind'],
        additionalProperties: false,
      },
      schedule: {
        type: 'object',
        description:
          'Legacy time-only trigger. Prefer trigger instead. When provided alone, treated as { kind: "time", schedule }.',
        properties: {
          kind: {
            type: 'string',
            enum: ['hourly', 'daily', 'weekly'],
            description: 'hourly: every hour on the hour; daily: once per day; weekly: once per week on a weekday.',
          },
          hour: {
            type: 'integer',
            minimum: 0,
            maximum: 23,
            description: 'Hour of day (0-23). Required for daily and weekly.',
          },
          minute: {
            type: 'integer',
            minimum: 0,
            maximum: 59,
            description: 'Minute of hour (0-59). Required for daily and weekly.',
          },
          weekday: {
            type: 'integer',
            minimum: 0,
            maximum: 6,
            description: 'Day of week for weekly schedules: 0=Sunday through 6=Saturday.',
          },
        },
        required: ['kind'],
        additionalProperties: false,
      },
    },
    required: ['overview'],
    additionalProperties: false,
  } satisfies JsonObject,
};

export function buildAutomationHostToolDefinitions(): JsonValue[] {
  return buildContributedHostToolDefinitions([CREATE_AUTOMATION_CONTRIBUTED_TOOL]);
}
