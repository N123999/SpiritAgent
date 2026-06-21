import { GitFork, LoaderCircle, MoreHorizontal, Play } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MESSAGE_TURN_FORK_MENU_HIDDEN_CLASSES } from "@/lib/message-turn-actions-ui";
import { cn } from "@/lib/utils";
import type { ConversationMessageSnapshot } from "@/types";

export function MessageTurnActions({
  showContinueButton,
  continueTarget,
  continueBusy,
  onContinue,
  canFork,
  forkBusy,
  forkEnabled,
  forkMenuAlwaysVisible,
  forkMenuHoverRevealed = false,
  onFork,
}: {
  showContinueButton: boolean;
  continueTarget?: ConversationMessageSnapshot;
  continueBusy: boolean;
  onContinue: (message: ConversationMessageSnapshot) => void;
  canFork: boolean;
  forkBusy: boolean;
  forkEnabled: boolean;
  forkMenuAlwaysVisible: boolean;
  forkMenuHoverRevealed?: boolean;
  onFork: () => void;
}) {
  const { t } = useTranslation();

  const forkMenuHidden =
    !forkMenuAlwaysVisible && !forkMenuHoverRevealed;

  if (!showContinueButton && !canFork) {
    return null;
  }

  return (
    <div className="ml-auto flex max-w-[min(72%,22rem)] items-center justify-end gap-1 pt-1">
      {showContinueButton && continueTarget ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7 shrink-0 text-muted-foreground"
          aria-label={t("app.continue")}
          onClick={() => onContinue(continueTarget)}
          disabled={continueBusy}
        >
          {continueBusy ? (
            <LoaderCircle className="size-3.5 animate-spin text-muted-foreground" aria-hidden />
          ) : (
            <Play className="size-3.5 text-muted-foreground" aria-hidden />
          )}
        </Button>
      ) : null}
      {canFork ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className={cn(
                "size-7 shrink-0 text-muted-foreground",
                forkMenuHidden && MESSAGE_TURN_FORK_MENU_HIDDEN_CLASSES,
              )}
              aria-label={t("app.messageActions")}
              disabled={forkBusy || !forkEnabled}
            >
              <MoreHorizontal className="size-3.5 text-muted-foreground" aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-40 p-0">
            <div className="p-1">
              <DropdownMenuItem
                disabled={forkBusy || !forkEnabled}
                className="gap-2"
                onSelect={() => {
                  onFork();
                }}
              >
                <GitFork className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                <span>{t("app.forkChat")}</span>
              </DropdownMenuItem>
            </div>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );
}
