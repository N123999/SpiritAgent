import type { HostAutomationDefinition, HostAutomationTrigger } from '../automations.js';
import {
  fetchRepositoryMaxIssueNumber,
  filterNewGitHubAutomationEvents,
  githubAutomationRepoKey,
  listRepositoryIssuesForAutomation,
  type GitHubAutomationIssueItem,
} from './automation-events.js';

export interface GitHubAutomationPollMatch {
  automationId: string;
  definition: HostAutomationDefinition;
  item: GitHubAutomationIssueItem;
  nextLastSeenNumber: number;
}

export interface GitHubAutomationRepoPollGroup {
  repoKey: string;
  owner: string;
  repo: string;
  automations: HostAutomationDefinition[];
}

export function groupGitHubAutomationsByRepo(
  definitions: HostAutomationDefinition[],
): GitHubAutomationRepoPollGroup[] {
  const groups = new Map<string, GitHubAutomationRepoPollGroup>();
  for (const definition of definitions) {
    if (definition.trigger.kind !== 'github') {
      continue;
    }
    const { owner, repo } = definition.trigger;
    const repoKey = githubAutomationRepoKey(owner, repo);
    const existing = groups.get(repoKey);
    if (existing) {
      existing.automations.push(definition);
      continue;
    }
    groups.set(repoKey, {
      repoKey,
      owner,
      repo,
      automations: [definition],
    });
  }
  return [...groups.values()];
}

export function githubTriggerNeedsBaseline(trigger: HostAutomationTrigger): boolean {
  return trigger.kind === 'github' && trigger.poll?.lastSeenNumber === undefined;
}

export function resolveGitHubPollWatermark(trigger: Extract<HostAutomationTrigger, { kind: 'github' }>): number {
  return trigger.poll?.lastSeenNumber ?? 0;
}

export function computeGitHubPollMatchesForAutomation(
  definition: HostAutomationDefinition,
  items: GitHubAutomationIssueItem[],
): GitHubAutomationPollMatch[] {
  if (definition.trigger.kind !== 'github') {
    return [];
  }
  const trigger = definition.trigger;
  const watermark = resolveGitHubPollWatermark(trigger);
  const matches = filterNewGitHubAutomationEvents(items, trigger.event, watermark);
  if (matches.length === 0) {
    return [];
  }
  const nextLastSeenNumber = Math.max(...matches.map((item) => item.number));
  return matches.map((item) => ({
    automationId: definition.id,
    definition,
    item,
    nextLastSeenNumber,
  }));
}

export function computeGitHubPollMatchesForRepoGroup(
  group: GitHubAutomationRepoPollGroup,
  items: GitHubAutomationIssueItem[],
): GitHubAutomationPollMatch[] {
  const allMatches: GitHubAutomationPollMatch[] = [];
  for (const definition of group.automations) {
    allMatches.push(...computeGitHubPollMatchesForAutomation(definition, items));
  }
  return allMatches.sort((left, right) => left.item.number - right.item.number);
}

export async function fetchGitHubAutomationRepoItems(
  accessToken: string,
  owner: string,
  repo: string,
  options?: { sinceNumber?: number },
): Promise<GitHubAutomationIssueItem[]> {
  return listRepositoryIssuesForAutomation(accessToken, owner, repo, options);
}

export async function baselineGitHubAutomationWatermark(
  accessToken: string,
  owner: string,
  repo: string,
): Promise<number> {
  return fetchRepositoryMaxIssueNumber(accessToken, owner, repo);
}

export function mergeGitHubPollWatermarkUpdates(
  matches: GitHubAutomationPollMatch[],
): Map<string, number> {
  const updates = new Map<string, number>();
  for (const match of matches) {
    const current = updates.get(match.automationId);
    if (current === undefined || match.nextLastSeenNumber > current) {
      updates.set(match.automationId, match.nextLastSeenNumber);
    }
  }
  return updates;
}
