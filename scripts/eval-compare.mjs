import { createHash, randomUUID } from 'node:crypto';
import { execFile as execFileCallback } from 'node:child_process';
import { existsSync } from 'node:fs';
import { cp, mkdir, mkdtemp, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

import { evalScenarios } from '../packages/agent-core/dist/eval/scenarios.js';
import { validateEvalRunArtifact } from '../packages/agent-core/dist/eval/artifacts.js';

const execFile = promisify(execFileCallback);
const require = createRequire(import.meta.url);
const DEFAULT_SCENARIO_ID = 'tool-heavy-code-edit';

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    printHelp();
    return;
  }

  if (options.listScenarios) {
    printScenarioList();
    return;
  }

  const scenario = resolveScenario(options);
  const modelConfig = resolveModelConfig(options);
  const repoRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

  const baselineRef = (await git(repoRoot, ['rev-parse', 'HEAD'])).stdout.trim();
  const stagedPatch = (await git(repoRoot, ['diff', '--cached', '--binary', '--no-ext-diff'])).stdout;
  if (!stagedPatch.trim()) {
    throw new Error('暂存区为空。先把候选改动加入 staged，再运行 compare runner。');
  }

  const stagedDiffFingerprint = sha256(stagedPatch);
  const runId = `eval-${new Date().toISOString().replace(/[.:]/gu, '-')}-${randomUUID().slice(0, 8)}`;
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'spirit-eval-compare-'));
  const artifactsDir = path.join(tempRoot, 'artifacts');
  const baselineRuntimeSource = path.join(tempRoot, 'baseline-runtime-source');
  const candidateRuntimeSource = path.join(tempRoot, 'candidate-runtime-source');
  const baselineWorkspace = path.join(tempRoot, 'baseline-workspace');
  const candidateWorkspace = path.join(tempRoot, 'candidate-workspace');

  await mkdir(artifactsDir, { recursive: true });

  try {
    await createRuntimeSourceSnapshot(repoRoot, baselineRuntimeSource, baselineRef);
    await createRuntimeSourceSnapshot(repoRoot, candidateRuntimeSource, baselineRef);
    await linkWorkspaceNodeModules(repoRoot, baselineRuntimeSource);
    await linkWorkspaceNodeModules(repoRoot, candidateRuntimeSource);
    await applyPatchToWorkspace(candidateRuntimeSource, stagedPatch);

    await createExecutionWorkspace(options.workspaceSource, baselineWorkspace);
    await createExecutionWorkspace(options.workspaceSource, candidateWorkspace);

    const startedAtUnixMs = Date.now();
    const [baselineResult, candidateResult] = await Promise.all([
      runCandidate({
        candidateId: 'baseline',
        label: '修改前',
        runtimeSourcePath: baselineRuntimeSource,
        workspacePath: baselineWorkspace,
        repoRoot,
        runId,
        scenario,
        modelConfig,
        artifactsDir,
        baselineRef,
        stagedDiffFingerprint,
        autoApprove: options.autoApprove,
      }),
      runCandidate({
        candidateId: 'candidate',
        label: '修改后',
        runtimeSourcePath: candidateRuntimeSource,
        workspacePath: candidateWorkspace,
        repoRoot,
        runId,
        scenario,
        modelConfig,
        artifactsDir,
        baselineRef,
        stagedDiffFingerprint,
        autoApprove: options.autoApprove,
      }),
    ]);

    const artifact = {
      schemaVersion: 1,
      runId,
      createdAtUnixMs: startedAtUnixMs,
      scenario,
      baselineRef,
      stagedDiffFingerprint,
      ...(options.workspaceSource ? { workspaceSource: options.workspaceSource } : {}),
      candidates: [baselineResult.record, candidateResult.record],
      humanReview: {
        status: 'pending-human-review',
      },
    };

    validateEvalRunArtifact(artifact);

    const artifactPath = path.join(artifactsDir, 'review-artifact.json');
    await writeJsonFile(artifactPath, artifact);

    console.log('');
    console.log('Compare 运行完成。');
    console.log(`运行 ID: ${runId}`);
    console.log(`场景: ${scenario.id} | ${scenario.title}`);
    console.log(`工作区来源: ${options.workspaceSource ?? 'empty'}`);
    console.log(`修改前工作区: ${baselineWorkspace}`);
    console.log(`修改后工作区: ${candidateWorkspace}`);
    console.log(`评审产物: ${artifactPath}`);
    console.log(`暂存区指纹: ${stagedDiffFingerprint}`);

    await maybePromptCleanup({
      tempRoot,
      baselineWorkspace,
      candidateWorkspace,
      keepWorkspaces: options.keepWorkspaces,
      skipPrompt: options.noCleanupPrompt,
    });
  } catch (error) {
    console.error('Compare 运行失败。');
    console.error(renderError(error));
    console.error(`临时目录已保留，便于人工检查: ${tempRoot}`);
    process.exitCode = 1;
  }
}

function parseArgs(argv) {
  const options = {
    help: false,
    listScenarios: false,
    scenarioId: DEFAULT_SCENARIO_ID,
    prompt: undefined,
    title: undefined,
    objective: undefined,
    apiKey: undefined,
    baseUrl: undefined,
    model: undefined,
    llmVendor: undefined,
    reasoningEffort: undefined,
    workspaceSource: undefined,
    autoApprove: false,
    keepWorkspaces: false,
    noCleanupPrompt: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case '--help':
      case '-h':
        options.help = true;
        break;
      case '--list-scenarios':
        options.listScenarios = true;
        break;
      case '--scenario':
        options.scenarioId = requiredArgValue(argv, ++index, '--scenario');
        break;
      case '--prompt':
        options.prompt = requiredArgValue(argv, ++index, '--prompt');
        break;
      case '--title':
        options.title = requiredArgValue(argv, ++index, '--title');
        break;
      case '--objective':
        options.objective = requiredArgValue(argv, ++index, '--objective');
        break;
      case '--api-key':
        options.apiKey = requiredArgValue(argv, ++index, '--api-key');
        break;
      case '--base-url':
        options.baseUrl = requiredArgValue(argv, ++index, '--base-url');
        break;
      case '--model':
        options.model = requiredArgValue(argv, ++index, '--model');
        break;
      case '--llm-vendor':
        options.llmVendor = requiredArgValue(argv, ++index, '--llm-vendor');
        break;
      case '--reasoning-effort':
        options.reasoningEffort = requiredArgValue(argv, ++index, '--reasoning-effort');
        break;
      case '--workspace-source':
        options.workspaceSource = path.resolve(requiredArgValue(argv, ++index, '--workspace-source'));
        break;
      case '--auto-approve':
        options.autoApprove = true;
        break;
      case '--keep-workspaces':
        options.keepWorkspaces = true;
        break;
      case '--no-cleanup-prompt':
        options.noCleanupPrompt = true;
        break;
      case '--require-approvals':
        options.autoApprove = false;
        break;
      default:
        throw new Error(`未知参数: ${arg}`);
    }
  }

  return options;
}

async function validateWorkspaceSource(sourcePath) {
  if (!existsSync(sourcePath)) {
    throw new Error(`--workspace-source 指向的目录不存在: ${sourcePath}`);
  }

  const stats = await stat(sourcePath);
  if (!stats.isDirectory()) {
    throw new Error(`--workspace-source 必须指向目录: ${sourcePath}`);
  }
}

function requiredArgValue(argv, index, flag) {
  const value = argv[index];
  if (!value) {
    throw new Error(`${flag} 需要一个值。`);
  }
  return value;
}

function resolveScenario(options) {
  if (options.prompt) {
    return {
      id: 'custom-staged-diff-compare',
      title: options.title ?? 'Custom staged diff compare',
      description: options.objective ?? 'Compare baseline and staged candidate behavior in isolated artifact workspaces.',
      userPrompt: options.prompt,
      expectedDeliverables: ['workspace diff', 'assistant output', 'review artifact'],
      rubric: {
        id: 'custom-compare-v1',
        title: 'Custom compare rubric',
        criteria: [
          {
            id: 'task-completion',
            label: 'Task completion',
            description: 'The delivered result satisfies the user request end to end.',
            weight: 0.35,
            scale: { min: 1, max: 5 },
          },
          {
            id: 'tool-judgment',
            label: 'Tool judgment',
            description: 'Tool use is necessary, scoped, and sequenced well.',
            weight: 0.25,
            scale: { min: 1, max: 5 },
          },
          {
            id: 'instruction-following',
            label: 'Instruction following',
            description: 'System, repository, and user instructions are followed without drift.',
            weight: 0.2,
            scale: { min: 1, max: 5 },
          },
          {
            id: 'user-experience',
            label: 'User experience',
            description: 'The final answer is useful, concise, and easy for a human reviewer to act on.',
            weight: 0.2,
            scale: { min: 1, max: 5 },
          },
        ],
      },
      metadata: {
        tags: ['custom', 'staged-diff', 'compare'],
        decisionPrompt: 'Compare baseline and candidate outputs for this scenario. Pick the better user experience, or tie if neither is meaningfully better.',
      },
    };
  }

  const scenario = evalScenarios.find((entry) => entry.id === options.scenarioId);
  if (!scenario) {
    const ids = evalScenarios.map((entry) => entry.id).join(', ');
    throw new Error(`未知场景: ${options.scenarioId}。可用场景: ${ids}`);
  }
  return scenario;
}

function resolveModelConfig(options) {
  const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('缺少 API Key。请设置 OPENAI_API_KEY，或通过 --api-key 传入。');
  }

  const model = options.model ?? process.env.OPENAI_MODEL;
  if (!model) {
    throw new Error('缺少模型配置。请设置 OPENAI_MODEL，或通过 --model 传入。');
  }

  return {
    apiKey,
    model,
    ...(options.baseUrl ?? process.env.OPENAI_BASE_URL
      ? { baseUrl: options.baseUrl ?? process.env.OPENAI_BASE_URL }
      : {}),
    ...(options.llmVendor ?? process.env.SPIRIT_AGENT_EVAL_LLM_VENDOR
      ? { llmVendor: options.llmVendor ?? process.env.SPIRIT_AGENT_EVAL_LLM_VENDOR }
      : {}),
    ...(options.reasoningEffort ?? process.env.SPIRIT_AGENT_EVAL_REASONING_EFFORT
      ? { reasoningEffort: options.reasoningEffort ?? process.env.SPIRIT_AGENT_EVAL_REASONING_EFFORT }
      : {}),
  };
}

async function runCandidate(params) {
  const spiritDataDir = path.join(params.workspacePath, '.spirit-eval-data');
  await mkdir(spiritDataDir, { recursive: true });

  const tracker = new CandidateTracker(params.candidateId, params.label);
  tracker.info(`进行中 | 工作区: ${params.workspacePath}`);
  tracker.info(`运行时代码源: ${params.runtimeSourcePath}`);
  tracker.info('构建隔离 runtime 源');

  const modules = await loadWorkspaceRuntimeModules(params.runtimeSourcePath);
  const {
    AgentRuntime,
    pendingWorkspaceFilesFromInput,
    buildBuiltinHostToolDefinitions,
    createToolExecutionTextOutput,
    createOpenAiCompatibleTransport,
    appendOpenAiToolResultMessage,
    appendOpenAiUserLlmMessage,
    appendOpenAiUserMessage,
    continueOpenAiToolAgentState,
    extractLastOpenAiAssistantText,
    rebuildOpenAiToolAgentStateAfterCompaction,
    startOpenAiToolAgentState,
    truncateOpenAiHistoryForCompaction,
    truncateOpenAiToolAgentStateForContextRetry,
    resolveOpenAiModelCompatibilityProfile,
    loadHostInstructionMetadata,
    NodeHostToolService,
  } = modules;

  const context = {
    workspaceRoot: params.workspacePath,
    spiritDataDir,
  };
  const hostMetadata = await loadHostInstructionMetadata(context);
  const hostToolService = new NodeHostToolService(context, {
    getModelCompatibilityProfile: () => resolveOpenAiModelCompatibilityProfile(params.modelConfig),
  });
  const toolExecutor = new EvalHostToolExecutor(hostToolService, tracker, {
    autoApprove: params.autoApprove,
    buildBuiltinHostToolDefinitions,
    createToolExecutionTextOutput,
  });
  const toolDefinitionsJson = toolExecutor.toolDefinitionsJson();
  const initialState = startOpenAiToolAgentState(
    [],
    params.scenario.userPrompt,
    params.workspacePath,
    hostMetadata.rules.enabledRules,
    hostMetadata.skills.enabledSkillCatalog,
    [],
    params.modelConfig.model,
    hostMetadata.planMetadata,
    [],
  );
  const runtime = new AgentRuntime({
    config: {
      ...params.modelConfig,
      workspaceRoot: params.workspacePath,
    },
    llmTransport: createOpenAiCompatibleTransport(params.modelConfig),
    toolExecutor,
    createToolAgentState: (history, userInput) =>
      startOpenAiToolAgentState(
        history,
        userInput,
        params.workspacePath,
        hostMetadata.rules.enabledRules,
        hostMetadata.skills.enabledSkillCatalog,
        [],
        params.modelConfig.model,
        hostMetadata.planMetadata,
        [],
      ),
    createContinuationState: (history) =>
      continueOpenAiToolAgentState(
        history,
        params.workspacePath,
        hostMetadata.rules.enabledRules,
        hostMetadata.skills.enabledSkillCatalog,
        [],
        params.modelConfig.model,
        hostMetadata.planMetadata,
        [],
      ),
    appendToolResultMessage: appendOpenAiToolResultMessage,
    appendUserMessage: appendOpenAiUserMessage,
    appendUserLlmMessage: (state, message) =>
      appendOpenAiUserLlmMessage(state, message, params.workspacePath),
    extractAssistantText: extractLastOpenAiAssistantText,
    truncateStateForContextRetry: truncateOpenAiToolAgentStateForContextRetry,
    truncateHistoryForCompaction: truncateOpenAiHistoryForCompaction,
    rebuildRetryStateAfterCompaction: (history, userInput, retryState) =>
      rebuildOpenAiToolAgentStateAfterCompaction(
        history,
        userInput,
        retryState,
        params.workspacePath,
        hostMetadata.rules.enabledRules,
        hostMetadata.skills.enabledSkillCatalog,
        [],
        params.modelConfig.model,
        hostMetadata.planMetadata,
        [],
      ),
    resolveWorkspaceFilesFromInput: (text) => pendingWorkspaceFilesFromInput(params.workspacePath, text),
    onEvent: (event) => tracker.handleEvent(event),
  });

  let result;
  try {
    result = await runtime.submitUserTurn(params.scenario.userPrompt);
  } catch (error) {
    result = {
      kind: 'failed',
      error: renderError(error),
      requestTrace: [],
      toolExecutions: [],
      compactions: [],
    };
  }

  const normalized = normalizeRuntimeResult(result);
  if (normalized.status === 'completed') {
    tracker.info('已完成');
  } else {
    tracker.info('已失败');
  }

  const assistantPath = path.join(params.artifactsDir, `${params.candidateId}-assistant.txt`);
  const eventsPath = path.join(params.artifactsDir, `${params.candidateId}-events.log`);
  const requestTracePath = path.join(params.artifactsDir, `${params.candidateId}-request-trace.json`);
  const toolExecutionsPath = path.join(params.artifactsDir, `${params.candidateId}-tool-executions.json`);
  const workspaceSummaryPath = path.join(params.artifactsDir, `${params.candidateId}-workspace-summary.txt`);

  await writeFile(assistantPath, `${normalized.outputText}\n`, 'utf8');
  await writeFile(eventsPath, `${tracker.lines.join('\n')}\n`, 'utf8');
  await writeJsonFile(requestTracePath, normalized.requestTrace);
  await writeJsonFile(toolExecutionsPath, normalized.toolExecutions);
  await writeFile(workspaceSummaryPath, await collectWorkspaceSummary(params.workspacePath), 'utf8');

  return {
    record: {
      id: params.candidateId,
      label: params.label,
      sourceRef:
        params.candidateId === 'baseline'
          ? `HEAD:${params.baselineRef}`
          : `HEAD:${params.baselineRef}+staged:${params.stagedDiffFingerprint.slice(0, 12)}`,
      ...(params.candidateId === 'candidate'
        ? { patchFingerprint: params.stagedDiffFingerprint }
        : {}),
      modelConfigFingerprint: sha256(stableJsonStringify(redactModelConfig(params.modelConfig))),
      systemPromptFingerprint: sha256(stableJsonStringify(initialState.messages[0] ?? null)),
      toolSchemaFingerprint: sha256(stableJsonStringify(toolDefinitionsJson)),
      workspaceIsolationId: path.basename(params.workspacePath),
      outputText: normalized.outputText,
      artifactPaths: [
        params.workspacePath,
        assistantPath,
        eventsPath,
        requestTracePath,
        toolExecutionsPath,
        workspaceSummaryPath,
      ],
      traceSummary: tracker.buildTraceSummary(),
    },
  };
}

function normalizeRuntimeResult(result) {
  switch (result.kind) {
    case 'completed':
      return {
        status: 'completed',
        outputText: nonEmpty(result.assistantText, '[empty assistant output]'),
        requestTrace: result.requestTrace,
        toolExecutions: result.toolExecutions,
      };
    case 'failed':
      return {
        status: 'failed',
        outputText: `[run failed] ${nonEmpty(result.error, 'unknown error')}`,
        requestTrace: result.requestTrace,
        toolExecutions: result.toolExecutions,
      };
    case 'requires-approval':
      return {
        status: 'failed',
        outputText: `[run blocked by approval] ${nonEmpty(result.approval.prompt, 'approval required')}`,
        requestTrace: result.requestTrace,
        toolExecutions: result.toolExecutions,
      };
    case 'requires-questions':
      return {
        status: 'failed',
        outputText: `[run blocked by ask_questions] ${result.questions.questions.title ?? result.questions.toolName}`,
        requestTrace: result.requestTrace,
        toolExecutions: result.toolExecutions,
      };
    default:
      return {
        status: 'failed',
        outputText: '[run failed] unknown runtime result',
        requestTrace: [],
        toolExecutions: [],
      };
  }
}

class EvalHostToolExecutor {
  constructor(service, tracker, options) {
    this.service = service;
    this.tracker = tracker;
    this.autoApprove = options.autoApprove;
    this.createToolExecutionTextOutput = options.createToolExecutionTextOutput;
    this.hostToolDefinitionsCache = options.buildBuiltinHostToolDefinitions(service.toolDefinitionEnvironment());
  }

  toolDefinitionsJson() {
    return this.hostToolDefinitionsCache;
  }

  parseCommand(message) {
    return this.service.parseCommand(message);
  }

  requestFromFunctionCall(name, argumentsJson) {
    return this.service.requestFromFunctionCall(name, argumentsJson);
  }

  async authorize(request) {
    const decision = await this.service.authorize(request);
    if (decision.kind !== 'need-approval' || !this.autoApprove) {
      return decision;
    }

    // TODO: 当前 compare runner 只支持“阻塞”或“自动放行”两种审批模式；后续可补交互式 y/n 审批或更细粒度 allowlist。
    this.tracker.recordApprovalBypass(request.name, decision.prompt);
    return { kind: 'allowed' };
  }

  trust(target) {
    return this.service.trust(target);
  }

  async execute(request) {
    const output = await this.service.execute(request);
    return normalizeToolExecutionOutput(output);
  }

  attachRequestMetadata(request, metadata) {
    return this.service.attachRequestMetadata
      ? this.service.attachRequestMetadata(request, metadata)
      : request;
  }

  async continueAfterQuestions(request, result) {
    if (!request || request.name !== 'extension_tool') {
      return undefined;
    }
    return {
      ...request,
      questions_result: result,
    };
  }

  shouldExecuteInBackground(request) {
    return this.service.shouldExecuteInBackground?.(request) ?? false;
  }

  backgroundStatusText(request) {
    return this.service.backgroundStatusText?.(request);
  }

  startMcpBackgroundRefresh() {
    this.service.startMcpBackgroundRefresh();
  }

  mcpStatusSnapshot() {
    return this.service.mcpStatusSnapshot();
  }

  addMcpServer(name, config) {
    return this.service.addMcpServer(name, config);
  }

  listMcpServers() {
    return this.service.listMcpServers();
  }

  inspectMcpServer(name) {
    return this.service.inspectMcpServer(name);
  }

  listMcpTools(name) {
    return this.service.listMcpTools(name);
  }

  listMcpResources(name) {
    return this.service.listMcpResources(name);
  }

  readMcpResource(name, uri) {
    return this.service.readMcpResource(name, uri);
  }

  listCachedMcpPrompts(name) {
    return this.service.listCachedMcpPrompts(name);
  }

  listMcpPrompts(name) {
    return this.service.listMcpPrompts(name);
  }

  getMcpPrompt(name, prompt, argsJson) {
    return this.service.getMcpPrompt(name, prompt, argsJson);
  }
}

function normalizeToolExecutionOutput(output) {
  return normalizeToolExecutionOutputWithFactory(output, createToolExecutionTextOutputFallback);
}

function normalizeToolExecutionOutputWithFactory(output, createToolExecutionTextOutput) {
  if (typeof output === 'string') {
    return createToolExecutionTextOutput(output);
  }

  return {
    summaryText: output.summaryText,
    content: output.content.map((part) => {
      if (part.type === 'text') {
        return { type: 'text', text: part.text };
      }
      return { type: 'image', path: part.path };
    }),
  };
}

function createToolExecutionTextOutputFallback(text) {
  return {
    summaryText: text,
    content: text.length > 0 ? [{ type: 'text', text }] : [],
  };
}

class CandidateTracker {
  constructor(candidateId, label) {
    this.candidateId = candidateId;
    this.label = label;
    this.lines = [];
    this.toolCallCount = 0;
    this.approvalRequestCount = 0;
    this.backgroundToolCount = 0;
    this.compactionCount = 0;
    this.streamingEventCount = 0;
    this.autoApprovalBypassCount = 0;
    this.warnings = [];
  }

  info(message) {
    const line = `[${new Date().toISOString()}] [${this.candidateId}] ${message}`;
    this.lines.push(line);
    console.log(line);
  }

  handleEvent(event) {
    switch (event.kind) {
      case 'tool-call-started':
        this.toolCallCount += 1;
        this.info(`工具调用: ${event.toolName}`);
        break;
      case 'tool-execution-finished':
        this.info(
          `${event.execution.failed ? '工具失败' : '工具完成'}: ${event.execution.toolName} | ${truncate(event.execution.output, 180)}`,
        );
        break;
      case 'approval-requested':
        this.approvalRequestCount += 1;
        this.info(`等待审批: ${event.approval.toolName}`);
        break;
      case 'background-tool-status':
        if (event.phase === 'started') {
          this.backgroundToolCount += 1;
        }
        this.info(
          `后台工具${event.phase === 'started' ? '开始' : '结束'}: ${event.toolName}${event.failed ? ' | failed' : ''}`,
        );
        break;
      case 'history-compacted':
        this.compactionCount += 1;
        this.info(`上下文压缩: dropped=${event.droppedMessages}`);
        break;
      case 'assistant-chunk':
      case 'update-pending-assistant-thinking':
      case 'streaming-tool-preview':
        this.streamingEventCount += 1;
        break;
      default:
        break;
    }
  }

  recordApprovalBypass(toolName, prompt) {
    this.autoApprovalBypassCount += 1;
    this.warnings.push(`auto-approved risky tool ${toolName}`);
    this.info(`自动批准: ${toolName} | ${truncate(prompt, 120)}`);
  }

  buildTraceSummary() {
    const warnings = [...new Set([
      ...this.warnings,
      ...(this.autoApprovalBypassCount > 0
        ? [`auto-approved ${this.autoApprovalBypassCount} risky tool call(s)`]
        : []),
    ])];
    return {
      toolCallCount: this.toolCallCount,
      approvalRequestCount: this.approvalRequestCount,
      backgroundToolCount: this.backgroundToolCount,
      compactionCount: this.compactionCount,
      streamingEventCount: this.streamingEventCount,
      warnings,
    };
  }
}

async function collectWorkspaceSummary(workspacePath) {
  const status = (await git(workspacePath, ['status', '--short', '--untracked-files=all'])).stdout.trim();
  const diff = (await git(workspacePath, ['diff', '--stat', '--no-ext-diff'])).stdout.trim();
  const stagedDiff = (await git(workspacePath, ['diff', '--cached', '--stat', '--no-ext-diff'])).stdout.trim();
  return [
    `[workspace] ${workspacePath}`,
    '',
    '[status]',
    status || '(clean)',
    '',
    '[diff]',
    diff || '(no unstaged diff)',
    '',
    '[cached diff]',
    stagedDiff || '(no staged diff)',
    '',
  ].join('\n');
}

async function createExecutionWorkspace(workspaceSource, workspacePath) {
  if (workspaceSource) {
    await createCopiedExecutionWorkspace(workspaceSource, workspacePath);
    return;
  }

  await createEmptyExecutionWorkspace(workspacePath);
}

async function createCopiedExecutionWorkspace(sourcePath, workspacePath) {
  await validateWorkspaceSource(sourcePath);
  await cp(sourcePath, workspacePath, {
    recursive: true,
    force: true,
    filter: (source) => !shouldSkipWorkspaceCopyPath(source, sourcePath),
  });
  await initializeWorkspaceGitRepo(workspacePath, `workspace-source ${sourcePath}`);
}

function shouldSkipWorkspaceCopyPath(source, root) {
  const relative = path.relative(root, source);
  if (!relative) {
    return false;
  }

  const segments = relative.split(path.sep);
  return segments.some((segment) => segment === '.git' || segment === 'node_modules');
}

async function maybePromptCleanup(params) {
  if (params.keepWorkspaces || params.noCleanupPrompt || !process.stdin.isTTY || !process.stdout.isTTY) {
    if (params.keepWorkspaces || params.noCleanupPrompt) {
      console.log(`已保留临时目录: ${params.tempRoot}`);
    }
    return;
  }

  const rl = readline.createInterface({ input, output });
  try {
    const answer = (await rl.question('是否删除本次 compare 产生的临时工作区与评审产物？输入 y 删除，其他任意输入保留: ')).trim().toLowerCase();
    if (answer !== 'y' && answer !== 'yes') {
      console.log(`已保留临时目录: ${params.tempRoot}`);
      return;
    }
  } finally {
    rl.close();
  }

  await rm(params.tempRoot, { recursive: true, force: true });
  console.log('临时工作区与评审产物已删除。');
}

async function createRuntimeSourceSnapshot(repoRoot, workspacePath, ref) {
  await createIsolatedWorkspaceSnapshot(repoRoot, workspacePath, ref);
}

async function createIsolatedWorkspaceSnapshot(repoRoot, workspacePath, ref) {
  await mkdir(workspacePath, { recursive: true });

  const archivePath = path.join(path.dirname(workspacePath), `${path.basename(workspacePath)}.tar`);
  try {
    await git(repoRoot, ['archive', '--format=tar', '-o', archivePath, ref]);
    await extractArchiveWithNodeTar(repoRoot, archivePath, workspacePath);
  } finally {
    await rm(archivePath, { force: true });
  }

  await initializeWorkspaceGitRepo(workspacePath, ref);
}

async function createEmptyExecutionWorkspace(workspacePath) {
  await mkdir(workspacePath, { recursive: true });
  await git(workspacePath, ['init', '--quiet']);
  await git(workspacePath, ['config', 'user.name', 'Spirit Eval']);
  await git(workspacePath, ['config', 'user.email', 'spirit-eval@example.invalid']);
}

async function extractArchiveWithNodeTar(repoRoot, archivePath, workspacePath) {
  const tarPackagePath = path.join(repoRoot, 'packages', 'host-internal', 'node_modules', 'tar');
  if (!existsSync(tarPackagePath)) {
    throw new Error(
      `缺少 Node tar 依赖，无法解包 git archive: ${tarPackagePath}。请先运行 npm --prefix packages/host-internal install。`,
    );
  }

  const tar = require(tarPackagePath);
  if (!tar || typeof tar.x !== 'function') {
    throw new Error(`无法从 ${tarPackagePath} 加载 tar.x()，compare runner 无法解包快照。`);
  }

  await tar.x({
    file: archivePath,
    cwd: workspacePath,
    strict: true,
  });
}

async function linkWorkspaceNodeModules(repoRoot, workspacePath) {
  const packageRelativePaths = [
    'packages/agent-core/node_modules',
    'packages/host-internal/node_modules',
  ];

  for (const relativePath of packageRelativePaths) {
    const sourceNodeModules = path.join(repoRoot, relativePath);
    const targetNodeModules = path.join(workspacePath, relativePath);

    if (!existsSync(sourceNodeModules)) {
      throw new Error(`当前仓库缺少 node_modules，无法为隔离工作区复用依赖: ${sourceNodeModules}`);
    }

    if (existsSync(targetNodeModules)) {
      continue;
    }

    await symlink(sourceNodeModules, targetNodeModules, process.platform === 'win32' ? 'junction' : 'dir');
  }
}

async function applyPatchToWorkspace(workspacePath, patchText) {
  const patchPath = path.join(workspacePath, '.spirit-eval-staged.patch');
  await writeFile(patchPath, patchText, 'utf8');
  try {
    await git(workspacePath, ['apply', '--binary', '--whitespace=nowarn', patchPath]);
  } finally {
    await rm(patchPath, { force: true });
  }
}

async function git(cwd, args) {
  return execFile('git', args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true,
  });
}

async function initializeWorkspaceGitRepo(workspacePath, ref) {
  await git(workspacePath, ['init', '--quiet']);
  await git(workspacePath, ['config', 'user.name', 'Spirit Eval']);
  await git(workspacePath, ['config', 'user.email', 'spirit-eval@example.invalid']);
  await git(workspacePath, ['add', '--all']);
  await git(workspacePath, ['commit', '--quiet', '--allow-empty', '-m', `snapshot ${ref}`]);
}

async function loadWorkspaceRuntimeModules(workspacePath) {
  await buildWorkspacePackages(workspacePath);

  const [
    runtimeModule,
    hostToolsModule,
    portsModule,
    transportFactoryModule,
    toolAgentHelpersModule,
    openAiCompatModule,
    discoveryModule,
    hostInternalToolsModule,
  ] = await Promise.all([
    importModuleFromWorkspace(workspacePath, 'packages/agent-core/dist/runtime.js'),
    importModuleFromWorkspace(workspacePath, 'packages/agent-core/dist/host-tools.js'),
    importModuleFromWorkspace(workspacePath, 'packages/agent-core/dist/ports.js'),
    importModuleFromWorkspace(workspacePath, 'packages/agent-core/dist/openai/transport-factory.js'),
    importModuleFromWorkspace(workspacePath, 'packages/agent-core/dist/openai/tool-agent-helpers.js'),
    importModuleFromWorkspace(workspacePath, 'packages/agent-core/dist/openai/openai-compat.js'),
    importModuleFromWorkspace(workspacePath, 'packages/host-internal/dist/discovery.js'),
    importModuleFromWorkspace(workspacePath, 'packages/host-internal/dist/tools.js'),
  ]);

  return {
    AgentRuntime: runtimeModule.AgentRuntime,
    pendingWorkspaceFilesFromInput: runtimeModule.pendingWorkspaceFilesFromInput,
    buildBuiltinHostToolDefinitions: hostToolsModule.buildBuiltinHostToolDefinitions,
    createToolExecutionTextOutput: portsModule.createToolExecutionTextOutput,
    createOpenAiCompatibleTransport: transportFactoryModule.createOpenAiCompatibleTransport,
    appendOpenAiToolResultMessage: toolAgentHelpersModule.appendOpenAiToolResultMessage,
    appendOpenAiUserLlmMessage: toolAgentHelpersModule.appendOpenAiUserLlmMessage,
    appendOpenAiUserMessage: toolAgentHelpersModule.appendOpenAiUserMessage,
    continueOpenAiToolAgentState: toolAgentHelpersModule.continueOpenAiToolAgentState,
    extractLastOpenAiAssistantText: toolAgentHelpersModule.extractLastOpenAiAssistantText,
    rebuildOpenAiToolAgentStateAfterCompaction:
      toolAgentHelpersModule.rebuildOpenAiToolAgentStateAfterCompaction,
    startOpenAiToolAgentState: toolAgentHelpersModule.startOpenAiToolAgentState,
    truncateOpenAiHistoryForCompaction: toolAgentHelpersModule.truncateOpenAiHistoryForCompaction,
    truncateOpenAiToolAgentStateForContextRetry:
      toolAgentHelpersModule.truncateOpenAiToolAgentStateForContextRetry,
    resolveOpenAiModelCompatibilityProfile: openAiCompatModule.resolveOpenAiModelCompatibilityProfile,
    loadHostInstructionMetadata: discoveryModule.loadHostInstructionMetadata,
    NodeHostToolService: hostInternalToolsModule.NodeHostToolService,
  };
}

async function buildWorkspacePackages(workspacePath) {
  await execWorkspaceCommand(workspacePath, npmExecutable(), ['--prefix', 'packages/host-internal', 'run', 'build']);
  await execWorkspaceCommand(workspacePath, npmExecutable(), ['--prefix', 'packages/agent-core', 'run', 'build']);
}

async function execWorkspaceCommand(cwd, command, args) {
  if (process.platform === 'win32') {
    await execFile(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', `${command} ${args.join(' ')}`], {
      cwd,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
      windowsHide: true,
    });
    return;
  }

  await execFile(command, args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    windowsHide: true,
  });
}

function npmExecutable() {
  return 'npm';
}

async function importModuleFromWorkspace(workspacePath, relativePath) {
  const filePath = path.join(workspacePath, relativePath);
  return import(pathToFileURL(filePath).href);
}

async function writeJsonFile(filePath, value) {
  await writeFile(filePath, `${stableJsonStringify(value)}\n`, 'utf8');
}

function redactModelConfig(modelConfig) {
  return {
    model: modelConfig.model,
    ...(modelConfig.baseUrl ? { baseUrl: modelConfig.baseUrl } : {}),
    ...(modelConfig.llmVendor ? { llmVendor: modelConfig.llmVendor } : {}),
    ...(modelConfig.reasoningEffort ? { reasoningEffort: modelConfig.reasoningEffort } : {}),
  };
}

function stableJsonStringify(value) {
  return JSON.stringify(sortJsonValue(value), null, 2);
}

function sortJsonValue(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => sortJsonValue(entry));
  }

  if (value && typeof value === 'object') {
    return Object.keys(value)
      .sort((left, right) => left.localeCompare(right))
      .reduce((accumulator, key) => {
        accumulator[key] = sortJsonValue(value[key]);
        return accumulator;
      }, {});
  }

  return value;
}

function sha256(text) {
  return createHash('sha256').update(text).digest('hex');
}

function truncate(text, maxChars) {
  if (text.length <= maxChars) {
    return text;
  }
  return `${text.slice(0, maxChars)}...`;
}

function nonEmpty(text, fallback) {
  return text && text.trim() ? text : fallback;
}

function renderError(error) {
  if (error instanceof Error) {
    return error.stack ?? error.message;
  }
  return String(error);
}

function printScenarioList() {
  console.log('可用场景:');
  for (const scenario of evalScenarios) {
    console.log(`- ${scenario.id}: ${scenario.title}`);
  }
}

function printHelp() {
  console.log('用法: npm run eval:compare -- [options]');
  console.log('');
  console.log('选项:');
  console.log('  --list-scenarios          列出内建场景');
  console.log('  --scenario <id>          选择内建场景，默认 tool-heavy-code-edit');
  console.log('  --prompt <text>          直接指定自定义用户提示词');
  console.log('  --title <text>           自定义场景标题，仅配合 --prompt 使用');
  console.log('  --objective <text>       自定义场景目标，仅配合 --prompt 使用');
  console.log('  --api-key <key>          覆盖 OPENAI_API_KEY');
  console.log('  --base-url <url>         覆盖 OPENAI_BASE_URL');
  console.log('  --model <id>             覆盖 OPENAI_MODEL；未传时直接读取环境变量');
  console.log('  --llm-vendor <vendor>    例如 deepseek / kimi / custom');
  console.log('  --reasoning-effort <v>   例如 low / medium / high');
  console.log('  --workspace-source <dir> 复制指定工作区目录到临时目录；默认使用空工作区');
  console.log('  --auto-approve           显式自动放行高风险工具审批；默认阻塞并将结果记入 artifact');
  console.log('  --keep-workspaces        运行后直接保留临时工作区，不询问删除');
  console.log('  --no-cleanup-prompt      运行后不弹删除确认，直接保留');
}

void main();