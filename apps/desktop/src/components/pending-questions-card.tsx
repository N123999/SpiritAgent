import { ChevronLeft, ChevronRight, LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { QuestionDraft } from "@/hooks/useDesktopRuntime";
import {
  DESKTOP_CHROME_TOGGLE_ICON_BTN,
  instantHoverMotionClass,
} from "@/lib/desktop-chrome";
import { cn } from "@/lib/utils";
import type { PendingQuestionsSnapshot } from "@/types";

const questionRowBleedClass = "-mx-2 box-border w-[calc(100%+1rem)] px-2";

const questionOptionSurfaceClass =
  "rounded-lg border-0 bg-transparent py-1.5 hover:bg-foreground/[0.06] dark:hover:bg-foreground/10";

const questionRowIndexClass = "text-muted-foreground [font-variant-numeric:lining-nums]";

const questionRowLayoutClass =
  "grid grid-cols-[1.125rem_minmax(0,1fr)] items-start gap-x-1";

const questionRowTextClass = "text-foreground/80";

const questionOptionClass = cn(
  questionRowLayoutClass,
  "text-left outline-none transition-none leading-snug",
  questionRowBleedClass,
  questionOptionSurfaceClass,
  instantHoverMotionClass,
  "active:!translate-y-0",
);

const questionInputRowClass = cn(
  "grid grid-cols-[1.125rem_minmax(0,1fr)] items-center gap-x-1",
  questionRowBleedClass,
);

const questionInputInnerClass = cn(
  "h-7 min-h-7 min-w-0 flex-1 border-0 bg-transparent px-0 py-0 text-sm shadow-none dark:!bg-transparent",
  questionRowTextClass,
  "placeholder:text-muted-foreground focus-visible:border-transparent focus-visible:ring-0",
  "hover:bg-transparent focus-visible:bg-transparent",
);

type PendingQuestionsCardProps = {
  pendingQuestions: PendingQuestionsSnapshot;
  questionDrafts: Record<string, QuestionDraft>;
  questionsBusy: boolean;
  onUpdateDraft(
    questionId: string,
    updater: (draft: QuestionDraft) => QuestionDraft,
  ): void;
  onSubmitQuestions(): void;
  onSkipQuestions(): void;
};

function emptyQuestionDraft(): QuestionDraft {
  return {
    selectedOptionIds: [],
    customText: "",
  };
}

export function PendingQuestionsCard({
  pendingQuestions,
  questionDrafts,
  questionsBusy,
  onUpdateDraft,
  onSubmitQuestions,
  onSkipQuestions,
}: PendingQuestionsCardProps) {
  const { t } = useTranslation();
  const questions = pendingQuestions.request.questions;
  const [currentIndex, setCurrentIndex] = useState(0);

  useEffect(() => {
    setCurrentIndex(0);
  }, [pendingQuestions.toolCallId]);

  const question = questions[currentIndex];
  if (!question) {
    return null;
  }

  const draft = questionDrafts[question.id] ?? emptyQuestionDraft();
  const isLastQuestion = currentIndex >= questions.length - 1;

  const handleContinue = () => {
    if (!isLastQuestion) {
      setCurrentIndex((index) => Math.min(index + 1, questions.length - 1));
      return;
    }
    onSubmitQuestions();
  };

  const handleSingleSelect = (optionId: string) => {
    onUpdateDraft(question.id, (current) => ({
      ...current,
      selectedOptionIds: [optionId],
    }));

    if (!isLastQuestion) {
      setCurrentIndex((current) => Math.min(current + 1, questions.length - 1));
    }
  };

  const handleMultiSelectToggle = (optionId: string) => {
    onUpdateDraft(question.id, (current) => {
      const selected = current.selectedOptionIds.includes(optionId);
      const next = selected
        ? current.selectedOptionIds.filter((item) => item !== optionId)
        : [...current.selectedOptionIds, optionId];
      return {
        ...current,
        selectedOptionIds: Array.from(new Set(next)),
      };
    });
  };

  return (
    <Card className="gap-0 border-border/50 bg-background/55 py-0 text-sm shadow-sm backdrop-blur-xl dark:border-white/12 supports-[backdrop-filter]:bg-background/40">
      <CardHeader className="px-3 py-2.5">
        <div className="flex items-center gap-2">
          <CardTitle className="min-w-0 flex-1 truncate text-sm leading-tight">
            {question.title}
          </CardTitle>
          <div className="flex shrink-0 items-center gap-0.5">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className={cn(DESKTOP_CHROME_TOGGLE_ICON_BTN, "text-muted-foreground")}
              disabled={questionsBusy || currentIndex <= 0}
              onClick={() => setCurrentIndex((index) => Math.max(index - 1, 0))}
            >
              <ChevronLeft />
              <span className="sr-only">{t("app.previousQuestion")}</span>
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className={cn(DESKTOP_CHROME_TOGGLE_ICON_BTN, "text-muted-foreground")}
              disabled={questionsBusy || currentIndex >= questions.length - 1}
              onClick={() =>
                setCurrentIndex((index) => Math.min(index + 1, questions.length - 1))
              }
            >
              <ChevronRight />
              <span className="sr-only">{t("app.nextQuestion")}</span>
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="grid gap-1 px-3 pb-2 pt-0">
        {question.options.length > 0 ? (
          <div className="grid gap-1">
            {question.options.map((option, optionIndex) => {
              const selected = question.allowMultiple
                ? draft.selectedOptionIds.includes(option.id)
                : draft.selectedOptionIds[0] === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  className={cn(
                    questionOptionClass,
                    selected && "bg-primary/8",
                  )}
                  disabled={questionsBusy}
                  onClick={() =>
                    question.allowMultiple
                      ? handleMultiSelectToggle(option.id)
                      : handleSingleSelect(option.id)
                  }
                >
                  <span className={questionRowIndexClass}>{optionIndex + 1}.</span>
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <span
                      className={cn(
                        "font-medium",
                        selected ? "text-foreground/90" : questionRowTextClass,
                      )}
                    >
                      {option.label}
                    </span>
                    {option.summary ? (
                      <p className="text-xs leading-relaxed text-muted-foreground">
                        {option.summary}
                      </p>
                    ) : null}
                  </div>
                </button>
              );
            })}
          </div>
        ) : null}

        <div
          className={cn(
            questionInputRowClass,
            question.options.length > 0 && "mt-0",
          )}
        >
          <span className={questionRowIndexClass}>{question.options.length + 1}.</span>
          <Input
            id={`${question.id}-custom`}
            value={draft.customText}
            onChange={(event) =>
              onUpdateDraft(question.id, (current) => ({
                ...current,
                customText: event.target.value,
              }))
            }
            placeholder={t("app.customAnswerPlaceholder")}
            className={questionInputInnerClass}
            disabled={questionsBusy}
          />
        </div>

        <div className="mt-4 flex items-center justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className={cn(
              "px-2 text-muted-foreground hover:bg-foreground/[0.06] dark:hover:bg-foreground/10",
              instantHoverMotionClass,
              "active:!translate-y-0",
            )}
            disabled={questionsBusy}
            onClick={() => onSkipQuestions()}
          >
            {t("app.skip")}
          </Button>
          <Button
            type="button"
            size="sm"
            className={cn("min-w-20", instantHoverMotionClass, "active:!translate-y-0")}
            disabled={questionsBusy}
            onClick={handleContinue}
          >
            {questionsBusy ? <LoaderCircle className="size-4 animate-spin" /> : null}
            {t("app.continue")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
