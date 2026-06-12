import { GitFork, MoreHorizontal } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { MESSAGE_TURN_FORK_MENU_HIDDEN_CLASSES } from "@/lib/message-turn-actions-ui";
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

  if (!showContinueButton && !canFork) {
    return null;
  }

  return (
    <div className="ml-auto flex max-w-[min(72%,22rem)] items-center justify-end gap-1 pt-1">
      {showContinueButton && continueTarget ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 px-3 text-xs"
          onClick={() => onContinue(continueTarget)}
          disabled={continueBusy}
        >
          {t("app.continue")}
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
                !forkMenuAlwaysVisible
                  && !forkMenuHoverRevealed
                  && MESSAGE_TURN_FORK_MENU_HIDDEN_CLASSES,
              )}
              aria-label={t("app.messageActions")}
              disabled={forkBusy || !forkEnabled}
            >
              <MoreHorizontal className="size-3.5 text-muted-foreground" aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-40">
            <DropdownMenuItem
              disabled={forkBusy || !forkEnabled}
              onSelect={() => {
                onFork();
              }}
            >
              <GitFork className="size-3.5 text-muted-foreground" aria-hidden />
              {t("app.forkChat")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );
}
