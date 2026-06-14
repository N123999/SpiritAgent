import { Check, CornerDownLeft, MessageSquareText, ShieldCheck, X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import {
  DESKTOP_FORM_INPUT_SHELL,
  DESKTOP_FORM_TEXTAREA_INNER,
} from "@/lib/desktop-chrome";
import { cn } from "@/lib/utils";
import type { PendingToolApprovalSnapshot } from "@/types";

type PendingApprovalCardProps = {
  pendingApproval: PendingToolApprovalSnapshot;
  approvalGuidance: string;
  approveBusy: boolean;
  onApprovalGuidanceChange(value: string): void;
  onSubmitApproval(decision: {
    kind: "allow" | "deny" | "guidance";
    persistTrust?: boolean;
    userMessage?: string;
  }): void;
};

export function PendingApprovalCard({
  pendingApproval,
  approvalGuidance,
  approveBusy,
  onApprovalGuidanceChange,
  onSubmitApproval,
}: PendingApprovalCardProps) {
  const { t } = useTranslation();

  return (
    <Card className="border-border/50 bg-background/55 text-sm shadow-sm backdrop-blur-xl dark:border-white/12 supports-[backdrop-filter]:bg-background/40">
      <CardHeader className="space-y-1.5 px-3 py-2.5">
        <CardTitle className="min-w-0 truncate text-sm leading-tight">
          {pendingApproval.toolName}
        </CardTitle>
        <CardDescription className="text-xs leading-relaxed">
          <ScrollArea
            type="always"
            className="pr-3 [&>[data-radix-scroll-area-viewport]]:max-h-24 [&>[data-radix-scroll-area-viewport]]:overscroll-contain"
          >
            <div className="whitespace-pre-wrap">{pendingApproval.prompt}</div>
          </ScrollArea>
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-2 px-3 pb-3 pt-0">
        <div className="grid gap-1.5">
          <Button
            size="sm"
            className="h-8 w-full justify-start px-2.5"
            onClick={() => onSubmitApproval({ kind: "allow" })}
            disabled={approveBusy}
          >
            <Check data-icon="inline-start" />
            {t("app.allow")}
            <CornerDownLeft className="ml-auto size-3.5 shrink-0 opacity-70" aria-hidden />
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-8 w-full justify-start px-2.5"
            onClick={() => onSubmitApproval({ kind: "allow", persistTrust: true })}
            disabled={approveBusy || !pendingApproval.trustTarget}
          >
            <ShieldCheck data-icon="inline-start" />
            {t("app.alwaysTrust")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-8 w-full justify-start px-2.5"
            onClick={() => onSubmitApproval({ kind: "deny" })}
            disabled={approveBusy}
          >
            <X data-icon="inline-start" />
            {t("app.deny")}
          </Button>
        </div>
        <div className={cn("flex min-h-9 items-stretch", DESKTOP_FORM_INPUT_SHELL)}>
          <Textarea
            value={approvalGuidance}
            onChange={(event) => onApprovalGuidanceChange(event.target.value)}
            placeholder={t("app.approvalGuidancePlaceholder")}
            className={DESKTOP_FORM_TEXTAREA_INNER}
          />
          <Button
            size="icon-sm"
            variant="outline"
            className="h-auto w-9 self-stretch rounded-none border-0 border-l border-border/60 bg-transparent text-muted-foreground shadow-none hover:bg-muted/35 hover:text-foreground disabled:bg-transparent"
            onClick={() =>
              onSubmitApproval({
                kind: "guidance",
                userMessage: approvalGuidance,
              })
            }
            disabled={approveBusy || approvalGuidance.trim().length === 0}
          >
            <MessageSquareText />
            <span className="sr-only">{t("app.sendGuidance")}</span>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
