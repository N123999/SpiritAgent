import {
  AgentRuntime,
  VisionExecutor,
  VisionTransport,
  appendScriptedToolResult,
  appendScriptedUserMessage,
  createScriptedState,
  extractScriptedAssistantText,
  isOpenAiVisionUnsupportedError,
  join,
  llmMessageHasImages,
  llmMessageTextContent,
  mkdtemp,
  rm,
  tmpdir,
  type RuntimeEvent,
  type RuntimeParityCaseResult,
  type ScriptedToolRequest,
  userMessageContentMatchesInput,
  writeFile,
} from './harness.js';

export async function runVisionCase(): Promise<RuntimeParityCaseResult> {
  const visionEvents: RuntimeEvent<ScriptedToolRequest>[] = [];
  const tempDir = await mkdtemp(join(tmpdir(), 'spirit-agent-vision-case-'));
  const imagePath = join(tempDir, 'demo.png');
  await writeFile(
    imagePath,
    Buffer.from(
      '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000188f53d5d0000000049454e44ae426082',
      'hex',
    ),
  );

  try {
    const visionRuntime = new AgentRuntime({
      config: undefined,
      llmTransport: new VisionTransport(),
      toolExecutor: new VisionExecutor(),
      createToolAgentState: createScriptedState,
      appendToolResultMessage: appendScriptedToolResult,
      appendUserMessage: appendScriptedUserMessage,
      extractAssistantText: extractScriptedAssistantText,
      isVisionUnsupportedError: isOpenAiVisionUnsupportedError,
      onEvent: (event) => visionEvents.push(event),
    });

    const visionResult = await visionRuntime.submitUserTurn('请描述这张图。', [imagePath]);
    if (visionResult.kind !== 'completed' || visionResult.assistantText !== 'VISION_OK') {
      throw new Error('vision fallback smoke 未完成闭环。');
    }

    const visionEvent = visionEvents.find((event) => event.kind === 'vision-fallback-retry');
    if (!visionEvent || visionEvent.droppedImages !== 1) {
      throw new Error('vision fallback smoke 未记录正确的降级事件。');
    }
    const visionUserHistory = visionRuntime.history().find(
      (message) =>
        message.role === 'user' &&
        userMessageContentMatchesInput(llmMessageTextContent(message.content), '请描述这张图。'),
    );
    if (!visionUserHistory || llmMessageHasImages(visionUserHistory.content)) {
      throw new Error('vision fallback smoke 未清空 user imagePaths。');
    }

    return { visionResult };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}
