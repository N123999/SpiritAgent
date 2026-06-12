import type { DesktopSnapshot } from "@/types";

export type ComposerBranchCheckoutGateInput = {
  isEmptySession: boolean;
  git: DesktopSnapshot["git"] | undefined;
};

/** Whether sending should open the branch-checkout dialog instead of sending immediately. */
export function shouldPromptGitBranchCheckoutBeforeSend({
  isEmptySession,
  git,
}: ComposerBranchCheckoutGateInput): boolean {
  if (!isEmptySession || !git?.isRepository || git.workLocation !== "local") {
    return false;
  }
  const selectedBranch = git.selectedBranch ?? git.branch;
  return Boolean(selectedBranch && git.branch && selectedBranch !== git.branch);
}
