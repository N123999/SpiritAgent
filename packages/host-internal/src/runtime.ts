import type { HostInstructionDiscovery } from './discovery.js';
import type { HostStateStorage } from './storage.js';
import type { HostBuiltinToolService } from './tools.js';

export interface HostRuntimeModules<
  Config,
  Session,
  Rule,
  Skill,
  PlanMetadata,
  ToolRequest,
  QuestionsRequest,
  QuestionsResult,
  McpStatus,
> {
  storage: HostStateStorage<Config, Session>;
  discovery: HostInstructionDiscovery<Rule, Skill, PlanMetadata>;
  tools: HostBuiltinToolService<ToolRequest, QuestionsRequest, QuestionsResult, McpStatus>;
}

export function defineHostRuntimeModules<
  Config,
  Session,
  Rule,
  Skill,
  PlanMetadata,
  ToolRequest,
  QuestionsRequest,
  QuestionsResult,
  McpStatus,
>(
  modules: HostRuntimeModules<
    Config,
    Session,
    Rule,
    Skill,
    PlanMetadata,
    ToolRequest,
    QuestionsRequest,
    QuestionsResult,
    McpStatus
  >,
): HostRuntimeModules<
  Config,
  Session,
  Rule,
  Skill,
  PlanMetadata,
  ToolRequest,
  QuestionsRequest,
  QuestionsResult,
  McpStatus
> {
  return modules;
}