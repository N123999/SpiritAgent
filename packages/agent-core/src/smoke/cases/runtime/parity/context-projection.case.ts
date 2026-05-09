import {
  AgentRuntime,
  HostExecutor,
  ToolImageProjectionExecutor,
  ToolImageProjectionTransport,
  WorkspaceContextTransport,
  appendScriptedToolResult,
  appendScriptedUserLlmMessage,
  appendScriptedUserMessage,
  createScriptedState,
  extractScriptedAssistantText,
  join,
  llmMessageTextContent,
  mkdir,
  mkdtemp,
  pendingWorkspaceFilesFromInput,
  rm,
  tmpdir,
  type JsonValue,
  type RuntimeParityCaseResult,
  writeFile,
} from './harness.js';

export async function runContextProjectionCase(): Promise<RuntimeParityCaseResult> {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'spirit-agent-runtime-'));
  let workspaceFileSmoke: JsonValue;
  try {
    await mkdir(join(workspaceRoot, 'src'), { recursive: true });
    await writeFile(join(workspaceRoot, 'src', 'runtime.ts'), 'export const runtime = true;\n');
    await writeFile(join(workspaceRoot, 'README.md'), 'hello from readme\n');
    await writeFile(join(workspaceRoot, 'large.txt'), 'x'.repeat(24_050));

    const referencedFiles = await pendingWorkspaceFilesFromInput(
      workspaceRoot,
      '@src/runtime.ts 请参考 @README.md 和 @missing.rs 以及 @large.txt',
    );
    const referencedPaths = referencedFiles.map((file) => file.path);
    if (referencedPaths.join('|') !== 'src/runtime.ts|README.md|large.txt') {
      throw new Error('workspace file helper smoke 未按预期提取现有引用。');
    }

    const largeFile = referencedFiles.find((file) => file.path === 'large.txt');
    if (
      !largeFile ||
      largeFile.kind !== 'text' ||
      !largeFile.truncated ||
      !largeFile.content.endsWith('...<文件内容已截断>')
    ) {
      throw new Error('workspace file helper smoke 未按预期截断超长文件。');
    }

    const workspaceRuntime = new AgentRuntime({
      config: undefined,
      llmTransport: new WorkspaceContextTransport(),
      toolExecutor: new HostExecutor(),
      createToolAgentState: createScriptedState,
      appendToolResultMessage: appendScriptedToolResult,
      appendUserMessage: appendScriptedUserMessage,
      extractAssistantText: extractScriptedAssistantText,
      resolveWorkspaceFilesFromInput: (text) => pendingWorkspaceFilesFromInput(workspaceRoot, text),
    });

    const workspaceResult = await workspaceRuntime.submitUserTurn(
      '@src/runtime.ts 请结合 @README.md 总结',
    );
    if (
      workspaceResult.kind !== 'completed' ||
      workspaceResult.assistantText !== 'WORKSPACE_CONTEXT_OK'
    ) {
      throw new Error('workspace file context smoke 未完成闭环。');
    }

    const injectedContexts = workspaceRuntime.history().filter(
      (message) =>
        message.role === 'system' && llmMessageTextContent(message.content).startsWith('[WORKSPACE_FILE]'),
    );
    if (injectedContexts.length !== 2) {
      throw new Error('workspace file context smoke 注入的 system context 数量不正确。');
    }

    workspaceFileSmoke = {
      referencedPaths,
      truncatedLargeFile: largeFile.truncated,
      injectedContexts: injectedContexts.length,
      assistantText: workspaceResult.assistantText,
    };
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }

  const toolImageProjectionRuntime = new AgentRuntime({
    config: undefined,
    llmTransport: new ToolImageProjectionTransport(),
    toolExecutor: new ToolImageProjectionExecutor(),
    createToolAgentState: createScriptedState,
    appendToolResultMessage: appendScriptedToolResult,
    appendUserMessage: appendScriptedUserMessage,
    appendUserLlmMessage: appendScriptedUserLlmMessage,
    extractAssistantText: extractScriptedAssistantText,
  });

  const toolImageProjectionResult = await toolImageProjectionRuntime.submitUserTurn('请读取图片后继续分析。');
  if (
    toolImageProjectionResult.kind !== 'completed' ||
    toolImageProjectionResult.assistantText !== 'TOOL_IMAGE_PROJECTION_OK'
  ) {
    throw new Error('tool image projection smoke 未完成闭环。');
  }

  return { workspaceFileSmoke, toolImageProjectionResult };
}
