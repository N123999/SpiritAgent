import { ChevronLeft, ChevronRight, LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { QuestionDraft } from "@/hooks/useDesktopRuntime";
import {
  DESKTOP_CHROME_TOGGLE_ICON_BTN,
  DESKTOP_FORM_INPUT_INNER,
  DESKTOP_FORM_INPUT_SHELL,
  instantHoverMotionClass,
} from "@/lib/desktop-chrome";
import { cn } from "@/lib/utils";
import type { AskQuestionsQuestionSpec, PendingQuestionsSnapshot } from "@/types";

const questionOptionClass = cn(
  "rounded-xl border px-3 py-2.5 text-left outline-none transition-none",
  instantHoverMotionClass,
  "active:!translate-y-0",
);

type PendingQuestionsCardProps = {
  pendingQuestions: PendingQuestionsSnapshot;
  questionDrafts: Record<string, QuestionDraft>;
  questionError: string;
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
    selectedOptionIndexes: [],
    customInput: "",
    text: "",
  };
}

function isQuestionDraftAnswered(
  question: AskQuestionsQuestionSpec,
  draft: QuestionDraft,
): boolean {
  if (question.kind === "text") {
    return draft.text.trim().length > 0;
  }

  return draft.selectedOptionIndexes.length > 0 || draft.customInput.trim().length > 0;
}

export function PendingQuestionsCard({
  pendingQuestions,
  questionDrafts,
  questionError,
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

  const goToNextQuestion = () => {
    if (!isLastQuestion) {
      setCurrentIndex((index) => Math.min(index + 1, questions.length - 1));
    }
  };

  const handleContinue = () => {
    if (question.required && !isQuestionDraftAnswered(question, draft)) {
      return;
    }

    if (!isLastQuestion) {
      goToNextQuestion();
      return;
    }

    const missingRequiredIndex = questions.findIndex(
      (item) =>
        item.required
        && !isQuestionDraftAnswered(
          item,
          questionDrafts[item.id] ?? emptyQuestionDraft(),
        ),
    );
    if (missingRequiredIndex >= 0 && missingRequiredIndex !== currentIndex) {
      setCurrentIndex(missingRequiredIndex);
    }
    onSubmitQuestions();
  };

  const handleSingleSelect = (index: number) => {
    onUpdateDraft(question.id, (current) => ({
      ...current,
      selectedOptionIndexes: [index],
    }));

    if (!isLastQuestion) {
      setCurrentIndex((current) => Math.min(current + 1, questions.length - 1));
    }
  };

  const handleMultiSelectToggle = (index: number) => {
    onUpdateDraft(question.id, (current) => {
      const selected = current.selectedOptionIndexes.includes(index);
      const next = selected
        ? current.selectedOptionIndexes.filter((item) => item !== index)
        : [...current.selectedOptionIndexes, index];
      return {
        ...current,
        selectedOptionIndexes: Array.from(new Set(next)).sort((left, right) => left - right),
      };
    });
  };

  const continueDisabled =
    questionsBusy || (question.required && !isQuestionDraftAnswered(question, draft));

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
      <CardContent className="grid gap-1.5 px-3 pb-2 pt-0">
        {question.kind === "single_select" ? (
          <div className="grid gap-1.5">
            {question.options.map((option, index) => {
              const selected = draft.selectedOptionIndexes[0] === index;
              return (
                <button
                  key={`${question.id}-single-${index}`}
                  type="button"
                  className={cn(
                    questionOptionClass,
                    selected
                      ? "border-primary/60 bg-primary/8"
                      : "border-border/60 bg-card/70 hover:bg-foreground/[0.06] dark:hover:bg-foreground/10",
                  )}
                  disabled={questionsBusy}
                  onClick={() => handleSingleSelect(index)}
                >
                  <div className="space-y-0.5">
                    <span className="font-medium">{option.label}</span>
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

        {question.kind === "multi_select" ? (
          <div className="grid gap-1.5">
            {question.options.map((option, index) => {
              const selected = draft.selectedOptionIndexes.includes(index);
              return (
                <button
                  key={`${question.id}-multi-${index}`}
                  type="button"
                  className={cn(
                    questionOptionClass,
                    selected
                      ? "border-primary/60 bg-primary/8"
                      : "border-border/60 bg-card/70 hover:bg-foreground/[0.06] dark:hover:bg-foreground/10",
                  )}
                  disabled={questionsBusy}
                  onClick={() => handleMultiSelectToggle(index)}
                >
                  <div className="space-y-0.5">
                    <span className="font-medium">{option.label}</span>
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

        {question.kind === "text" ? (
          <div className="space-y-1">
            <Label htmlFor={`${question.id}-text`} className="text-xs">
              {question.customInputLabel ?? t("app.answer")}
            </Label>
            <div className="overflow-hidden rounded-md border border-input bg-transparent focus-within:border-ring/60 focus-within:ring-2 focus-within:ring-ring/20">
              <Textarea
                id={`${question.id}-text`}
                value={draft.text}
                onChange={(event) =>
                  onUpdateDraft(question.id, (current) => ({
                    ...current,
                    text: event.target.value,
                  }))
                }
                placeholder={question.customInputPlaceholder ?? t("app.enterAnswer")}
                className="min-h-20 flex-1 resize-none rounded-none border-0 bg-transparent px-2.5 py-2 text-sm shadow-none focus-visible:ring-0"
                disabled={questionsBusy}
              />
            </div>
          </div>
        ) : null}

        {question.allowCustomInput ? (
          <div
            className={cn(
              "space-y-1",
              (question.kind === "single_select" || question.kind === "multi_select")
                && "mt-2.5",
            )}
          >
            <Label htmlFor={`${question.id}-custom`} className="text-xs">
              {question.customInputLabel ?? t("app.customInput")}
            </Label>
            <div className={DESKTOP_FORM_INPUT_SHELL}>
              <Input
                id={`${question.id}-custom`}
                value={draft.customInput}
                onChange={(event) =>
                  onUpdateDraft(question.id, (current) => ({
                    ...current,
                    customInput: event.target.value,
                  }))
                }
                placeholder={question.customInputPlaceholder ?? t("app.supplementOption")}
                className={DESKTOP_FORM_INPUT_INNER}
                disabled={questionsBusy}
              />
            </div>
          </div>
        ) : null}

        {questionError ? (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 px-2.5 py-2 text-xs text-destructive">
            {questionError}
          </div>
        ) : null}

        <div className="flex items-center justify-between gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className={cn(
              "h-8 px-2 text-muted-foreground hover:bg-foreground/[0.06] dark:hover:bg-foreground/10",
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
            className={cn("h-8 min-w-20", instantHoverMotionClass, "active:!translate-y-0")}
            disabled={continueDisabled}
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
