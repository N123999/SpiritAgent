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
          kind: 'text',
          title: 'What should happen next?',
          required: true,
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
          title: 'What should happen next?',
          kind: 'text',
          answered: true,
          text: 'Proceed carefully',
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

test('buildSingleTextQuestionNotificationReplyResult ignores non-text or multi-question prompts', () => {
  assert.equal(
    buildSingleTextQuestionNotificationReplyResult(
      pendingQuestions({
        request: {
          questions: [
            {
              id: 'question-1',
              kind: 'text',
              title: 'First?',
              required: true,
              options: [],
            },
            {
              id: 'question-2',
              kind: 'text',
              title: 'Second?',
              required: true,
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
