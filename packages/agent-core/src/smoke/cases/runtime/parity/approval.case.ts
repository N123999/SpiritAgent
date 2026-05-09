import {
  AgentRuntime,
  ApprovalExecutor,
  ApprovalTransport,
  appendScriptedToolResult,
  appendScriptedUserMessage,
  createScriptedState,
  extractScriptedAssistantText,
  type RuntimeParityCaseResult,
} from './harness.js';

export async function runApprovalCase(): Promise<RuntimeParityCaseResult> {
  const approvalExecutor = new ApprovalExecutor();
  const approvalRuntime = new AgentRuntime({
    config: undefined,
    llmTransport: new ApprovalTransport(),
    toolExecutor: approvalExecutor,
    createToolAgentState: createScriptedState,
    appendToolResultMessage: appendScriptedToolResult,
    appendUserMessage: appendScriptedUserMessage,
    extractAssistantText: extractScriptedAssistantText,
  });

  const approvalResult = await approvalRuntime.submitUserTurn('请直接写文件。');
  if (approvalResult.kind !== 'requires-approval') {
    throw new Error(`approval smoke 期望 requires-approval，实际为 ${approvalResult.kind}`);
  }

  const approvalCompleted = await approvalRuntime.resumePendingApproval({
    kind: 'guidance',
    userMessage: '不要写文件，直接总结',
  });

  if (approvalCompleted.kind !== 'completed' || approvalCompleted.assistantText !== 'GUIDANCE_OK') {
    throw new Error('approval guidance smoke 未完成闭环。');
  }

  if (approvalExecutor.executedCalls !== 1) {
    throw new Error('approval guidance smoke 应继续执行后续排队工具。');
  }

  return { approvalCompleted };
}
