import assert from 'node:assert/strict';
import test from 'node:test';

import { buildSingleTextQuestionNotificationReplyResult } from '../../src/lib/ask-questions-notification-reply.ts';

function pendingQuestions(overrides = {}) {
  return {
    toolCallId: 'tool-1',
    request: {
      questions: [
        {
          id: 'question-1',
          title: 'What should happen next?',
          allowMultiple: false,
          options: [],
        },
      ],
    },
    ...overrides,
  };
}

test('buildSingleTextQuestionNotificationReplyResult maps matching text reply', () => {
  assert.deepEqual(
    buildSingleTextQuestionNotificationReplyResult(pendingQuestions(), {
      text: '  Proceed carefully  ',
      context: {
        questionToolCallId: 'tool-1',
        questionId: 'question-1',
      },
    }),
    {
      status: 'answered',
      answers: [
        {
          questionId: 'question-1',
          selectedOptionIds: [],
          customText: 'Proceed carefully',
        },
      ],
    },
  );
});

test('buildSingleTextQuestionNotificationReplyResult ignores stale tool call', () => {
  assert.equal(
    buildSingleTextQuestionNotificationReplyResult(pendingQuestions(), {
      text: 'Proceed',
      context: {
        questionToolCallId: 'old-tool',
        questionId: 'question-1',
      },
    }),
    undefined,
  );
});

test('buildSingleTextQuestionNotificationReplyResult ignores multi-question prompts', () => {
  assert.equal(
    buildSingleTextQuestionNotificationReplyResult(
      pendingQuestions({
        request: {
          questions: [
            {
              id: 'question-1',
              title: 'First?',
              allowMultiple: false,
              options: [],
            },
            {
              id: 'question-2',
              title: 'Second?',
              allowMultiple: false,
              options: [],
            },
          ],
        },
      }),
      {
        text: 'Proceed',
        context: {
          questionToolCallId: 'tool-1',
          questionId: 'question-1',
        },
      },
    ),
    undefined,
  );
});
