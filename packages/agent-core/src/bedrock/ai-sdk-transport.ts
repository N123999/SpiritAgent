import type {
  CompactHistoryManualContext,
  LlmMessage,
  LlmTransport,
  StartedToolAgentRound,
  ToolAgentRoundCompletion,
} from '../ports.js';
import type { LlmToolAgentState } from '../llm-tool-agent.js';
import type { JsonSchemaCompletionRequest, JsonSchemaCompletionResult, JsonSchemaTransport } from '../json-schema.js';
import type { BedrockTransportConfig } from './bedrock-compat.js';
import type { JsonValue } from '../ports.js';
import type { LlmTransportConfig } from '../provider-config.js';

/**
 * Phase 1 占位：完整实现在 Phase 2 完成。
 * 工厂已能路由到此 transport，避免误走 OpenAI-compatible 路径。
 */
export class AiSdkBedrockTransport
  implements LlmTransport<BedrockTransportConfig, LlmToolAgentState>, JsonSchemaTransport
{
  private static notImplemented(): never {
    throw new Error('Bedrock transport 尚未实现；请完成 Phase 2 后再调用。');
  }

  startToolAgentRound(): Promise<ToolAgentRoundCompletion<LlmToolAgentState>> {
    return Promise.reject(AiSdkBedrockTransport.notImplemented());
  }

  compactHistoryManual(): Promise<never> {
    return Promise.reject(AiSdkBedrockTransport.notImplemented());
  }

  compactSummaryText(): undefined {
    return undefined;
  }

  isContextOverflowError(): boolean {
    return false;
  }

  llmHistoryAsApiMessages(): JsonValue[] {
    return [];
  }

  llmSystemPromptsForExport(): JsonValue {
    return [];
  }

  createJsonSchemaCompletion<T extends JsonValue = JsonValue>(
    _config: LlmTransportConfig,
    _request: JsonSchemaCompletionRequest,
  ): Promise<JsonSchemaCompletionResult<T>> {
    return Promise.reject(AiSdkBedrockTransport.notImplemented());
  }
}
