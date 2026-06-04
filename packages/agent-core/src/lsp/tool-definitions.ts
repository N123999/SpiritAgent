import type { JsonObject, JsonValue } from '../ports.js';
import { GET_DIAGNOSTICS_TOOL_NAME } from './constants.js';

export function buildLspHostToolDefinitions(): JsonValue[] {
  return [
    functionTool(
      GET_DIAGNOSTICS_TOOL_NAME,
      'Return TypeScript/JavaScript language-server diagnostics (errors and warnings) for one workspace file. Use after edits or when fixing type or lint issues. Requires typescript-language-server on the host PATH.',
      {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description:
              'Workspace-relative or absolute path to a .ts, .tsx, .js, or .jsx file.',
          },
        },
        required: ['path'],
        additionalProperties: false,
      },
    ),
  ];
}

function functionTool(name: string, description: string, parameters: JsonObject): JsonValue {
  return {
    type: 'function',
    function: {
      name,
      description,
      parameters,
    },
  };
}
