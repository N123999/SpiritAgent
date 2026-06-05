import type { JsonObject, JsonValue } from '../ports.js';
import { GET_DIAGNOSTICS_TOOL_NAME } from './constants.js';

const SUPPORTED_PATH_HINT =
  'Supported extensions include TypeScript/JavaScript (.ts, .tsx, .js, .jsx), Python (.py), Go (.go), Rust (.rs), C/C++ (.c, .cpp, .h, .hpp), Java (.java), and C# (.cs). HTML and CSS are not supported.';

export function buildLspHostToolDefinitions(): JsonValue[] {
  return [
    functionTool(
      GET_DIAGNOSTICS_TOOL_NAME,
      `Return language-server diagnostics (errors and warnings) for one workspace source file. Routes automatically by file extension to the installed server (typescript-language-server, pyright, gopls, rust-analyzer, clangd, jdtls, or OmniSharp). Use after edits or when fixing type or lint issues. ${SUPPORTED_PATH_HINT}`,
      {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: `Workspace-relative or absolute path to a supported source file. ${SUPPORTED_PATH_HINT}`,
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
