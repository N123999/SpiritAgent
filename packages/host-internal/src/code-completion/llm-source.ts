import {
  CODE_COMPLETION_JSON_SCHEMA,
  CODE_COMPLETION_SCHEMA_NAME,
  type CodeCompletionResult,
  type JsonSchemaTransport,
  type LlmTransportConfig,
  validateCodeCompletionOutput,
} from '@spirit-agent/core';

import type { FormattedRecentEdits } from './edit-journal.js';
import { buildCodeCompletionSystemSections, buildCodeCompletionUserPrompt } from './prompts.js';
import type { CodeCompletionRequestContext, CodeCompletionSource } from './types.js';

export interface LlmCodeCompletionDependencies {
  transport: JsonSchemaTransport;
  transportConfig: LlmTransportConfig;
  modelName: string;
}

export class LlmCodeCompletionSource implements CodeCompletionSource {
  constructor(private readonly dependencies: LlmCodeCompletionDependencies) {}

  async suggest(
    context: CodeCompletionRequestContext,
    recentEdits: FormattedRecentEdits,
  ): Promise<CodeCompletionResult | null> {
    const userPrompt = buildCodeCompletionUserPrompt({
      context,
      recentEditsText: recentEdits.text,
      recentEditsTruncated: recentEdits.truncated,
    });
    const result = await this.dependencies.transport.createJsonSchemaCompletion(
      this.dependencies.transportConfig,
      {
        userPrompt,
        schemaName: CODE_COMPLETION_SCHEMA_NAME,
        schema: CODE_COMPLETION_JSON_SCHEMA,
        systemSections: buildCodeCompletionSystemSections(this.dependencies.modelName),
        includeToolAgentHostPrompt: false,
      },
    );

    const validated = validateCodeCompletionOutput(result.output);
    if (!validated) {
      return null;
    }
    return validated;
  }
}
