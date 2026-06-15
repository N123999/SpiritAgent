export function normalizeWorkspaceEntryRel(relativePath: string): string {
  return relativePath.replace(/\\/g, "/");
}

/** 候选路径是否等于 prefix，或位于 prefix 目录之下。 */
export function isUnderWorkspaceEntryPath(prefixRel: string, candidateRel: string): boolean {
  const prefix = normalizeWorkspaceEntryRel(prefixRel);
  const candidate = normalizeWorkspaceEntryRel(candidateRel);
  if (prefix === candidate) {
    return true;
  }
  if (prefix === "") {
    return false;
  }
  return candidate.startsWith(`${prefix}/`);
}

/** 将 currentPath 在 oldPrefix 下的相对位置映射到 newPrefix；无关联时返回 null。 */
export function remapWorkspaceEntryPath(
  oldPrefix: string,
  newPrefix: string,
  currentPath: string,
): string | null {
  const current = normalizeWorkspaceEntryRel(currentPath);
  const oldP = normalizeWorkspaceEntryRel(oldPrefix);
  const newP = normalizeWorkspaceEntryRel(newPrefix);
  if (current === oldP) {
    return newP;
  }
  if (!isUnderWorkspaceEntryPath(oldP, current)) {
    return null;
  }
  const suffix = current.slice(oldP.length);
  return `${newP}${suffix}`;
}
