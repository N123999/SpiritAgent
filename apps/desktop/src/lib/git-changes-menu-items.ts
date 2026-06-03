export type GitChangesMenuItemId = "push" | "merge";

export function buildGitChangesMenuItemIds(input: {
  needsPush: boolean;
  canMerge: boolean;
}): GitChangesMenuItemId[] {
  const items: GitChangesMenuItemId[] = [];
  if (input.needsPush) {
    items.push("push");
  }
  if (input.canMerge) {
    items.push("merge");
  }
  return items;
}
