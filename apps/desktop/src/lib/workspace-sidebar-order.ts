export type WorkspaceGroupOrderEntry = {
  id: string;
  latestModifiedAtUnixMs: number;
};

export function sortWorkspaceGroupsByModifiedDesc<T extends WorkspaceGroupOrderEntry>(
  groups: readonly T[],
): T[] {
  return [...groups].sort(
    (left, right) => right.latestModifiedAtUnixMs - left.latestModifiedAtUnixMs,
  );
}

export function applyWorkspaceGroupOrder<T extends WorkspaceGroupOrderEntry>(
  groups: readonly T[],
  savedOrder: readonly string[],
): T[] {
  if (groups.length === 0) {
    return [];
  }
  if (savedOrder.length === 0) {
    return sortWorkspaceGroupsByModifiedDesc(groups);
  }

  const byId = new Map(groups.map((group) => [group.id, group]));
  const ordered: T[] = [];
  const seen = new Set<string>();

  for (const id of savedOrder) {
    const group = byId.get(id);
    if (!group || seen.has(id)) {
      continue;
    }
    ordered.push(group);
    seen.add(id);
  }

  const appended = groups.filter((group) => !seen.has(group.id));
  appended.sort((left, right) => right.latestModifiedAtUnixMs - left.latestModifiedAtUnixMs);
  return [...ordered, ...appended];
}

export function workspaceGroupIdsInOrder<T extends { id: string }>(
  groups: readonly T[],
): string[] {
  return groups.map((group) => group.id);
}
