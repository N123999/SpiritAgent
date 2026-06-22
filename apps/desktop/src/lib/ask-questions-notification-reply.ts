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
  const text = payload.text.trim();
  if (
    current.request.questions.length !== 1 ||
    !question ||
    question.kind !== 'text' ||
    payload.context?.questionId !== question.id ||
    !text
  ) {
    return undefined;
  }

  return {
    status: 'answered',
    answers: [
      {
        questionId: question.id,
        title: question.title,
        kind: question.kind,
        answered: true,
        text,
      },
    ],
  };
}
