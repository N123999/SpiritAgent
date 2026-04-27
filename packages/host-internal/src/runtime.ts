import type { HostInstructionDiscovery } from './discovery.js';
import type { HostExtensionManager } from './extensions.js';
import type { HostStateStorage } from './storage.js';
import type { HostBuiltinToolService } from './tools.js';

export interface HostRuntimeModules<
  Config,
  Session,
  Rule,
  Skill,
  PlanMetadata,
  QuestionSpec,
> {
  storage: HostStateStorage<Config, Session>;
  discovery: HostInstructionDiscovery<Rule, Skill, PlanMetadata>;
  tools: HostBuiltinToolService<QuestionSpec>;
  extensions?: HostExtensionManager;
}

export function defineHostRuntimeModules<
  Config,
  Session,
  Rule,
  Skill,
  PlanMetadata,
  QuestionSpec,
>(
  modules: HostRuntimeModules<
    Config,
    Session,
    Rule,
    Skill,
    PlanMetadata,
    QuestionSpec
  >,
): HostRuntimeModules<
  Config,
  Session,
  Rule,
  Skill,
  PlanMetadata,
  QuestionSpec
> {
  return modules;
}