import type { JsonObject } from '../ports.js';

export const CODE_COMPLETION_JSON_SCHEMA: JsonObject = {
  type: 'object',
  additionalProperties: false,
  properties: {
    operations: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          kind: { type: 'string', enum: ['insert', 'replace', 'delete'] },
          startLine: { type: 'integer', minimum: 1 },
          startColumn: { type: 'integer', minimum: 1 },
          endLine: { type: 'integer', minimum: 1 },
          endColumn: { type: 'integer', minimum: 1 },
          text: { type: 'string' },
        },
        required: ['kind', 'startLine', 'startColumn', 'endLine', 'endColumn'],
      },
    },
  },
  required: ['operations'],
};

export const CODE_COMPLETION_SCHEMA_NAME = 'code_completion';
