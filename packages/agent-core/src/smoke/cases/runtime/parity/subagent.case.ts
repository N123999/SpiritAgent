import {
  AgentRuntime,
  SubagentExecutor,
  SubagentTransport,
  appendScriptedToolResult,
  appendScriptedUserMessage,
  createScriptedState,
  extractScriptedAssistantText,
  type RuntimeParityCaseResult,
} from './harness.js';

export async function runSubagentCase(): Promise<RuntimeParityCaseResult> {
  const subagentExecutor = new SubagentExecutor();
  const subagentRuntime = new AgentRuntime({
    config: undefined,
    llmTransport: new SubagentTransport(),
    toolExecutor: subagentExecutor,
    createToolAgentState: createScriptedState,
    appendToolResultMessage: appendScriptedToolResult,
    appendUserMessage: appendScriptedUserMessage,
    extractAssistantText: extractScriptedAssistantText,
  });

  const subagentResult = await subagentRuntime.submitUserTurn('调用 SubAgent 输出一句话');
  if (subagentResult.kind !== 'completed' || subagentResult.assistantText !== 'SUBAGENT_OK') {
    throw new Error('subagent smoke 未完成闭环。');
  }
  if (subagentExecutor.executedSubagentCalls !== 0) {
    throw new Error('subagent smoke 错误落到了宿主 execute。');
  }
  const subagentExecution = subagentResult.toolExecutions.find(
    (execution) => execution.toolName === 'run_subagent',
  );
  if (
    !subagentExecution
    || subagentExecution.failed
    || subagentExecution.output !== '好的，我是 SubAgent，哈哈哈'
  ) {
    throw new Error('subagent smoke 未记录正确的子代理工具结果。');
  }

  return { subagentResult };
}
