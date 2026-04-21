import { setImmediate as waitForImmediate } from 'node:timers/promises';

import type { AuthorizationDecision } from '../ports.js';

import { renderError, toolNameFromRequest } from './helpers.js';
import type { ToolExecutionResult } from './tool-execution.js';
import type {
  AgentRuntimeOptions,
  PendingManualApprovalState,
  RuntimeApprovalDecision,
  RuntimeCompletedManualToolCommandResult,
  RuntimeEvent,
  RuntimeManualToolCommandResult,
  RuntimeManualToolCommandStartResult,
  RuntimeTurnResult,
} from './types.js';

export interface ManualToolsRuntime<
  Config,
  State,
  ToolRequest,
  TrustTarget = string,
> {
  options: AgentRuntimeOptions<Config, State, ToolRequest, TrustTarget>;
  pendingManualApproval: PendingManualApprovalState<ToolRequest, TrustTarget> | undefined;
  completedManualToolCommandResultStore:
    | RuntimeCompletedManualToolCommandResult<ToolRequest>
    | undefined;
  emitEvent(event: RuntimeEvent<ToolRequest>): void;
  isBusy(): boolean;
  startUserTurn(userInput: string, explicitImages?: string[]): Promise<void>;
  startManualBackgroundToolExecution(request: ToolRequest, toolName: string): string | undefined;
  performToolExecution(request: ToolRequest, toolName: string): Promise<ToolExecutionResult>;
  takeCompletedManualToolCommandResult():
    | RuntimeCompletedManualToolCommandResult<ToolRequest>
    | undefined;
  waitForCompletedTurnResult(): Promise<RuntimeTurnResult<State, ToolRequest, TrustTarget>>;
  poll(): Promise<void>;
}

export async function startManualToolCommand<
  Config,
  State,
  ToolRequest,
  TrustTarget = string,
>(
  runtime: ManualToolsRuntime<Config, State, ToolRequest, TrustTarget>,
  message: string,
): Promise<RuntimeManualToolCommandStartResult<State, ToolRequest, TrustTarget>> {
  if (runtime.isBusy()) {
    throw new Error('当前已有响应或审批在处理中，请稍候。');
  }

  runtime.completedManualToolCommandResultStore = undefined;

  let request: ToolRequest;
  try {
    request = await runtime.options.toolExecutor.parseCommand(message);
    request = runtime.options.toolExecutor.attachRequestMetadata?.(request, {
      toolName: toolNameFromRequest(request),
    }) ?? request;
  } catch (error) {
    return {
      kind: 'failed',
      error: `工具命令解析失败: ${renderError(error)}`,
    };
  }

  const toolName = toolNameFromRequest(request);

  let authorization: AuthorizationDecision<TrustTarget>;
  try {
    authorization = await runtime.options.toolExecutor.authorize(request);
  } catch (error) {
    return {
      kind: 'failed',
      error: `工具权限检查失败: ${renderError(error)}`,
      request,
    };
  }

  if (authorization.kind === 'need-approval') {
    runtime.pendingManualApproval = {
      request,
      prompt: authorization.prompt,
      ...(authorization.trustTarget !== undefined
        ? { trustTarget: authorization.trustTarget }
        : {}),
      toolName,
    };
    runtime.emitEvent({
      kind: 'approval-requested',
      approval: {
        prompt: authorization.prompt,
        request,
        ...(authorization.trustTarget !== undefined
          ? { trustTarget: authorization.trustTarget }
          : {}),
        toolName,
      },
    });
    return {
      kind: 'requires-approval',
      approval: {
        prompt: authorization.prompt,
        request,
        ...(authorization.trustTarget !== undefined
          ? { trustTarget: authorization.trustTarget }
          : {}),
        toolName,
      },
    };
  }

  if (authorization.kind === 'need-questions') {
    return {
      kind: 'failed',
      error: '手动工具命令不支持 ask_questions 交互。',
      request,
    };
  }

  return startManualToolRequest(runtime, request, toolName);
}

export async function continuePendingManualToolApproval<
  Config,
  State,
  ToolRequest,
  TrustTarget = string,
>(
  runtime: ManualToolsRuntime<Config, State, ToolRequest, TrustTarget>,
  decision: RuntimeApprovalDecision,
): Promise<RuntimeManualToolCommandStartResult<State, ToolRequest, TrustTarget>> {
  const pending = runtime.pendingManualApproval;
  if (!pending) {
    throw new Error('当前没有待确认的手动工具调用。');
  }

  runtime.pendingManualApproval = undefined;
  runtime.completedManualToolCommandResultStore = undefined;

  if (decision.kind === 'allow') {
    if (decision.persistTrust && pending.trustTarget !== undefined) {
      await runtime.options.toolExecutor.trust(pending.trustTarget);
    }

    return startManualToolRequest(runtime, pending.request, pending.toolName);
  }

  if (decision.kind === 'guidance') {
    const userMessage = decision.userMessage.trim();
    if (!userMessage) {
      return {
        kind: 'denied',
        request: pending.request,
        toolName: pending.toolName,
        message: '已拒绝本次工具调用。',
      };
    }

    await runtime.startUserTurn(userMessage);
    return {
      kind: 'started-user-turn',
      userMessage,
    };
  }

  return {
    kind: 'denied',
    request: pending.request,
    toolName: pending.toolName,
    message: '已拒绝本次工具调用。',
  };
}

export async function startManualToolRequest<
  Config,
  State,
  ToolRequest,
  TrustTarget = string,
>(
  runtime: ManualToolsRuntime<Config, State, ToolRequest, TrustTarget>,
  request: ToolRequest,
  toolName: string,
): Promise<RuntimeManualToolCommandStartResult<State, ToolRequest, TrustTarget>> {
  if (runtime.options.toolExecutor.shouldExecuteInBackground?.(request) ?? false) {
    const statusText = runtime.startManualBackgroundToolExecution(request, toolName);
    return {
      kind: 'started-background',
      request,
      toolName,
      ...(statusText !== undefined ? { statusText } : {}),
    };
  }

  const execution = await runtime.performToolExecution(request, toolName);
  return {
    kind: 'completed',
    request,
    toolName,
    output: execution.output,
    failed: execution.failed,
    backgroundExecution: execution.backgroundExecution,
  };
}

export async function waitForStartedManualToolCommandResult<
  Config,
  State,
  ToolRequest,
  TrustTarget = string,
>(
  runtime: ManualToolsRuntime<Config, State, ToolRequest, TrustTarget>,
  result: RuntimeManualToolCommandStartResult<State, ToolRequest, TrustTarget>,
): Promise<RuntimeManualToolCommandResult<State, ToolRequest, TrustTarget>> {
  if (result.kind === 'started-background') {
    return waitForCompletedManualToolCommandResult(runtime);
  }

  if (result.kind === 'started-user-turn') {
    return {
      kind: 'submitted-user-turn',
      userMessage: result.userMessage,
      result: await runtime.waitForCompletedTurnResult(),
    };
  }

  return result;
}

export async function waitForCompletedManualToolCommandResult<
  Config,
  State,
  ToolRequest,
  TrustTarget = string,
>(
  runtime: ManualToolsRuntime<Config, State, ToolRequest, TrustTarget>,
): Promise<RuntimeCompletedManualToolCommandResult<ToolRequest>> {
  while (true) {
    const existing = runtime.takeCompletedManualToolCommandResult();
    if (existing) {
      return existing;
    }

    if (!runtime.isBusy()) {
      throw new Error('runtime 在未产出手动工具结果时提前进入空闲状态。');
    }

    await runtime.poll();

    const result = runtime.takeCompletedManualToolCommandResult();
    if (result) {
      return result;
    }

    if (!runtime.isBusy()) {
      throw new Error('runtime 在未产出手动工具结果时提前进入空闲状态。');
    }

    await waitForImmediate();
  }
}