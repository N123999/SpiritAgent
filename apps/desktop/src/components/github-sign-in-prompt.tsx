import { useTranslation } from "react-i18next";

import { cn } from "@/lib/utils";

export type GitHubSignInPromptProps = {
  onSignIn: () => void;
  className?: string;
  linkClassName?: string;
};

export function GitHubSignInPrompt({
  onSignIn,
  className,
  linkClassName,
}: GitHubSignInPromptProps) {
  const { t } = useTranslation();

  return (
    <p className={cn("text-sm text-muted-foreground", className)}>
      {t("workspace.prGitHubConnectPromptBefore")}
      <button
        type="button"
        className={cn(
          "text-foreground underline underline-offset-2 hover:text-foreground/80",
          linkClassName,
        )}
        onClick={onSignIn}
      >
        {t("workspace.prGitHubConnectLink")}
      </button>
    </p>
  );
}

export type GitHubConnectTooltipContentProps = {
  onSignIn: () => void;
};

export function GitHubConnectTooltipContent({ onSignIn }: GitHubConnectTooltipContentProps) {
  const { t } = useTranslation();

  return (
    <span className="inline-flex max-w-[16rem] flex-wrap items-center gap-0.5 text-left leading-snug">
      {t("workspace.prGitHubConnectTooltipBefore")}
      <button
        type="button"
        className="text-popover-foreground underline underline-offset-2 hover:text-popover-foreground/80"
        onClick={onSignIn}
      >
        {t("workspace.prGitHubConnectLink")}
      </button>
    </span>
  );
}
