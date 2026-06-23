export type ComposerChangesCardGitSnapshot = {
  isRepository: boolean;
  hasChanges: boolean;
  workingTreeLineDelta?: { added: number; removed: number };
};

export function shouldShowComposerChangesCard(git: ComposerChangesCardGitSnapshot | undefined): boolean {
  if (!git?.isRepository || !git.hasChanges || !git.workingTreeLineDelta) {
    return false;
  }
  const { added, removed } = git.workingTreeLineDelta;
  return added > 0 || removed > 0;
}
