import type { AskQuestionsResult, PendingQuestionsSnapshot } from '../types';

export function buildSingleTextQuestionNotificationReplyResult(
  pendingQuestions: PendingQuestionsSnapshot | null | undefined,
  payload: {
    text: string;
    context?: {
      questionToolCallId?: string;
      questionId?: string;
    };
  },
): AskQuestionsResult | undefined {
  const current = pendingQuestions;
  if (!current || payload.context?.questionToolCallId !== current.toolCallId) {
    return undefined;
  }

  const question = current.request.questions[0];
  const customText = payload.text.trim();
  if (
    current.request.questions.length !== 1 ||
    !question ||
    payload.context?.questionId !== question.id ||
    !customText
  ) {
    return undefined;
  }

  return {
    status: 'answered',
    answers: [
      {
        questionId: question.id,
        selectedOptionIds: [],
        customText,
      },
    ],
  };
}
