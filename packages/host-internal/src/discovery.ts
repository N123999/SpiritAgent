export interface HostToggleState {
  enabledOverrides?: Record<string, boolean>;
}

export interface HostDiscoverySnapshot<Item> {
  discovered: number;
  enabled: number;
  enabledItems: readonly Item[];
}

export interface HostInstructionDiscovery<Rule, Skill, PlanMetadata> {
  loadRules(): Promise<HostDiscoverySnapshot<Rule>>;
  loadSkills(): Promise<HostDiscoverySnapshot<Skill>>;
  loadPlanMetadata(): Promise<PlanMetadata>;
}