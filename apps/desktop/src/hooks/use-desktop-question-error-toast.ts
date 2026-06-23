import { useEffect } from "react";

import { showDesktopErrorToast } from "@/lib/desktop-error-toast";

export function useDesktopQuestionErrorToast(questionError: string) {
  useEffect(() => {
    showDesktopErrorToast(questionError, "question-error");
  }, [questionError]);
}
