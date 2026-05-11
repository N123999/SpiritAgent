import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  createOpenAiJsonSchemaTransport,
  validateEvalRunArtifact,
} from '../packages/agent-core/dist/index.js';

const JUDGE_OUTPUT_MAX_CHARS = 12_000;
const JUDGE_WORKSPACE_SUMMARY_MAX_CHARS = 8_000;
const TRUNCATION_HEAD_RATIO_NUM = 2;
const TRUNCATION_HEAD_RATIO_DEN = 3;

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    printHelp();
    return;
  }

  assertRequiredOptions(options);

  const artifactPath = path.resolve(options.artifactPath);
  const artifact = await loadArtifact(artifactPath);
  if (artifact.judgeReview?.status === 'completed' && !options.force) {
    throw new Error(
      `artifact 已包含已完成的 judgeReview。若要覆盖，请使用 --force: ${artifactPath}`,
    );
  }

  const modelConfig = resolveModelConfig(options);
  const blindVariants = resolveBlindVariants(artifact);
  const judgeBundle = await buildJudgeBundle(artifact, blindVariants);
  const schema = buildJudgeSchema(artifact.scenario.rubric.criteria);
  const systemSections = [buildJudgeSystemSection()];
  const userPrompt = [
    'Evaluate the following blind run comparison and return JSON that matches the requested schema.',
    'Do not reveal, guess, or rely on baseline/candidate identity beyond the allowed outcome labels.',
    '',
    stableJsonStringify(judgeBundle),
  ].join('\n');
  const promptFingerprint = sha256(stableJsonStringify({
    schema,
    systemSections,
    userPrompt,
  }));

  const artifactDir = path.dirname(artifactPath);
  const inputPath = path.join(artifactDir, 'llm-judge-input.json');
  const requestTracePath = path.join(artifactDir, 'llm-judge-request-trace.json');
  const rawResponsePath = path.join(artifactDir, 'llm-judge-raw-response.txt');
  await writeJsonFile(inputPath, judgeBundle);

  const transport = createOpenAiJsonSchemaTransport();

  try {
    const result = await transport.createJsonSchemaCompletion(modelConfig, {
      userPrompt,
      schemaName: 'eval_judge_review',
      schema,
      systemSections,
      includeToolAgentHostPrompt: false,
    });

    const normalized = normalizeJudgeOutput(
      result.output,
      artifact.scenario.rubric.criteria,
      blindVariants,
    );

    await writeJsonFile(requestTracePath, result.requestTrace);
    await writeFile(rawResponsePath, `${result.rawText.trim()}\n`, 'utf8');

    const nextArtifact = {
      ...artifact,
      judgeReview: {
        status: 'completed',
        judgedAt: new Date().toISOString(),
        reviewerKind: 'llm',
        model: modelConfig.model,
        ...(modelConfig.llmVendor ? { llmVendor: modelConfig.llmVendor } : {}),
        promptFingerprint,
        blindVariantMapping: {
          variantA: blindVariants.variantA.id,
          variantB: blindVariants.variantB.id,
        },
        artifactPaths: [inputPath, requestTracePath, rawResponsePath],
        outcome: normalized.outcome,
        confidence: normalized.confidence,
        rationale: normalized.rationale,
        criterionScores: normalized.criterionScores,
        ...(normalized.notes ? { notes: normalized.notes } : {}),
      },
    };

    validateEvalRunArtifact(nextArtifact);
    await writeJsonFile(artifactPath, nextArtifact);

    console.log('');
    console.log('Judge 运行完成。');
    console.log(`artifact: ${artifactPath}`);
    console.log(`outcome: ${normalized.outcome}`);
    console.log(`confidence: ${normalized.confidence.toFixed(2)}`);
    console.log(`judge input: ${inputPath}`);
    console.log(`judge trace: ${requestTracePath}`);
    return;
  } catch (error) {
    const failedArtifact = {
      ...artifact,
      judgeReview: {
        status: 'failed',
        judgedAt: new Date().toISOString(),
        reviewerKind: 'llm',
        model: modelConfig.model,
        ...(modelConfig.llmVendor ? { llmVendor: modelConfig.llmVendor } : {}),
        promptFingerprint,
        blindVariantMapping: {
          variantA: blindVariants.variantA.id,
          variantB: blindVariants.variantB.id,
        },
        artifactPaths: [inputPath],
        error: renderError(error),
      },
    };
    validateEvalRunArtifact(failedArtifact);
    await writeJsonFile(artifactPath, failedArtifact);
    throw error;
  }
}

function parseArgs(argv) {
  const options = {
    help: false,
    artifactPath: undefined,
    apiKey: undefined,
    baseUrl: undefined,
    model: undefined,
    llmVendor: undefined,
    reasoningEffort: undefined,
    force: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case '--help':
      case '-h':
        options.help = true;
        break;
      case '--artifact':
        options.artifactPath = requiredArgValue(argv, ++index, '--artifact');
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
      case '--force':
        options.force = true;
        break;
      default:
        throw new Error(`未知参数: ${arg}`);
    }
  }

  return options;
}

function printHelp() {
  console.log('用法: npm run eval:judge -- [options]');
  console.log('');
  console.log('选项:');
  console.log('  --artifact <path>        必填；compare runner 产出的 review-artifact.json');
  console.log('  --api-key <key>          覆盖 OPENAI_API_KEY');
  console.log('  --base-url <url>         覆盖 OPENAI_BASE_URL');
  console.log('  --model <id>             覆盖 OPENAI_MODEL；未传时直接读取环境变量');
  console.log('  --llm-vendor <vendor>    例如 deepseek / kimi / custom');
  console.log('  --reasoning-effort <v>   例如 low / medium / high');
  console.log('  --force                  覆盖已有的已完成 judgeReview');
}

function assertRequiredOptions(options) {
  if (!options.artifactPath) {
    throw new Error('缺少 artifact 路径。请通过 --artifact 指定 review-artifact.json。');
  }
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

async function loadArtifact(artifactPath) {
  if (!existsSync(artifactPath)) {
    throw new Error(`artifact 不存在: ${artifactPath}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(await readFile(artifactPath, 'utf8'));
  } catch (error) {
    throw new Error(`artifact 不是合法 JSON: ${artifactPath}\n${renderError(error)}`);
  }

  validateEvalRunArtifact(parsed);
  return parsed;
}

function resolveBlindVariants(artifact) {
  const baseline = artifact.candidates.find((candidate) => candidate.id === 'baseline');
  const candidate = artifact.candidates.find((entry) => entry.id === 'candidate');
  if (!baseline || !candidate) {
    throw new Error('judge runner 当前要求 artifact 中包含 baseline 与 candidate 两个候选。');
  }

  const seed = sha256(`${artifact.runId}:${artifactDiffFingerprint(artifact)}`);
  const variantA = Number.parseInt(seed.slice(0, 2), 16) % 2 === 0 ? baseline : candidate;
  const variantB = variantA.id === 'baseline' ? candidate : baseline;
  return { variantA, variantB };
}

function artifactDiffFingerprint(artifact) {
  return artifact.schemaVersion === 1
    ? artifact.stagedDiffFingerprint
    : artifact.comparison.diffFingerprint;
}

async function buildJudgeBundle(artifact, blindVariants) {
  const scenario = artifact.scenario;
  return {
    scenario: {
      id: scenario.id,
      title: scenario.title,
      ...(scenario.description ? { description: scenario.description } : {}),
      userPrompt: scenario.userPrompt,
      ...(scenario.workspaceBrief ? { workspaceBrief: scenario.workspaceBrief } : {}),
      ...(Array.isArray(scenario.expectedDeliverables) && scenario.expectedDeliverables.length > 0
        ? { expectedDeliverables: [...scenario.expectedDeliverables] }
        : {}),
      ...(Array.isArray(scenario.constraints) && scenario.constraints.length > 0
        ? { constraints: [...scenario.constraints] }
        : {}),
      ...(readScenarioDecisionPrompt(scenario)
        ? { decisionPrompt: readScenarioDecisionPrompt(scenario) }
        : {}),
      rubric: {
        id: scenario.rubric.id,
        title: scenario.rubric.title,
        criteria: scenario.rubric.criteria.map((criterion) => ({
          id: criterion.id,
          label: criterion.label,
          description: criterion.description,
          weight: criterion.weight,
          scale: { ...criterion.scale },
        })),
      },
      evidenceNotes: [
        'Variant labels are blinded as variant_a and variant_b.',
        'Long assistant outputs or workspace summaries may be truncated for judging.',
      ],
    },
    variants: {
      variant_a: await buildVariantEvidence(blindVariants.variantA),
      variant_b: await buildVariantEvidence(blindVariants.variantB),
    },
  };
}

function readScenarioDecisionPrompt(scenario) {
  return isRecord(scenario.metadata) && typeof scenario.metadata.decisionPrompt === 'string'
    ? scenario.metadata.decisionPrompt
    : undefined;
}

async function buildVariantEvidence(candidate) {
  const workspacePath = candidate.artifactPaths[0];
  const workspaceSummaryPath = candidate.artifactPaths.find((entry) => entry.endsWith('-workspace-summary.txt'));
  const workspaceSummary = workspaceSummaryPath ? await readOptionalTextFile(workspaceSummaryPath) : undefined;
  return {
    assistantOutput: truncateForJudge(
      sanitizeBlindEvidence(candidate.outputText, workspacePath),
      JUDGE_OUTPUT_MAX_CHARS,
      '[assistant output truncated for judge]',
    ),
    traceSummary: {
      toolCallCount: candidate.traceSummary.toolCallCount,
      approvalRequestCount: candidate.traceSummary.approvalRequestCount,
      backgroundToolCount: candidate.traceSummary.backgroundToolCount,
      compactionCount: candidate.traceSummary.compactionCount,
      streamingEventCount: candidate.traceSummary.streamingEventCount,
      warnings: candidate.traceSummary.warnings.map((warning) => sanitizeBlindEvidence(warning, workspacePath)),
    },
    workspaceSummary: workspaceSummary
      ? truncateForJudge(
        normalizeWorkspaceSummary(workspaceSummary, workspacePath),
        JUDGE_WORKSPACE_SUMMARY_MAX_CHARS,
        '[workspace summary truncated for judge]',
      )
      : '(workspace summary not available)',
  };
}

async function readOptionalTextFile(filePath) {
  if (!filePath || !existsSync(filePath)) {
    return undefined;
  }
  return readFile(filePath, 'utf8');
}

function normalizeWorkspaceSummary(text, workspacePath) {
  const lines = text.split(/\r?\n/u);
  const body = lines[0]?.startsWith('[workspace]') ? lines.slice(2) : lines;
  return sanitizeBlindEvidence(body.join('\n').trim(), workspacePath);
}

function sanitizeBlindEvidence(text, workspacePath) {
  let result = text;
  if (workspacePath) {
    result = result.split(workspacePath).join('[isolated workspace]');
    result = result.split(path.basename(workspacePath)).join('isolated-workspace');
  }
  return result
    .replaceAll(/baseline-workspace/gu, 'isolated-workspace')
    .replaceAll(/candidate-workspace/gu, 'isolated-workspace');
}

function buildJudgeSystemSection() {
  return [
    'You are an impartial judge for blind evaluation of agentic coding runs.',
    'Evaluate Variant A and Variant B only from the provided evidence.',
    'Do not infer or mention baseline/candidate identity beyond the allowed outcome labels.',
    'Prefer tie when the differences are small or not clearly supported by evidence.',
    'Return inconclusive only when the evidence is too weak to support even a tie-or-win judgment.',
    'Judge user-visible usefulness first, then tool judgment, instruction following, and overall experience according to the rubric.',
    'Do not reward a variant merely for taking more actions or making more edits.',
  ].join('\n');
}

function buildJudgeSchema(criteria) {
  const criterionIds = criteria.map((criterion) => criterion.id);
  const minScore = Math.min(...criteria.map((criterion) => criterion.scale.min));
  const maxScore = Math.max(...criteria.map((criterion) => criterion.scale.max));

  return {
    type: 'object',
    additionalProperties: false,
    required: ['outcome', 'confidence', 'rationale', 'criterionScores'],
    properties: {
      outcome: {
        type: 'string',
        enum: ['variant_a', 'variant_b', 'tie', 'inconclusive'],
      },
      confidence: {
        type: 'number',
        minimum: 0,
        maximum: 1,
      },
      rationale: {
        type: 'string',
      },
      criterionScores: {
        type: 'array',
        minItems: criteria.length,
        maxItems: criteria.length,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['criterionId', 'variantAScore', 'variantBScore', 'notes'],
          properties: {
            criterionId: {
              type: 'string',
              enum: criterionIds,
            },
            variantAScore: {
              type: 'number',
              minimum: minScore,
              maximum: maxScore,
            },
            variantBScore: {
              type: 'number',
              minimum: minScore,
              maximum: maxScore,
            },
            notes: {
              type: 'string',
            },
          },
        },
      },
      notes: {
        type: 'string',
      },
    },
  };
}

function normalizeJudgeOutput(output, criteria, blindVariants) {
  if (!isRecord(output)) {
    throw new Error('judge 输出必须是对象。');
  }

  const rationale = typeof output.rationale === 'string' ? output.rationale.trim() : '';
  if (!rationale) {
    throw new Error('judge 输出缺少 rationale。');
  }

  if (typeof output.confidence !== 'number' || !Number.isFinite(output.confidence)) {
    throw new Error('judge 输出缺少合法 confidence。');
  }

  if (output.confidence < 0 || output.confidence > 1) {
    throw new Error('judge 输出 confidence 必须位于 0 到 1 之间。');
  }

  const criterionMap = new Map(criteria.map((criterion) => [criterion.id, criterion]));
  if (!Array.isArray(output.criterionScores) || output.criterionScores.length !== criteria.length) {
    throw new Error('judge 输出 criterionScores 数量必须与 rubric criteria 一致。');
  }

  const seen = new Set();
  const criterionScores = output.criterionScores.map((entry) => {
    if (!isRecord(entry) || typeof entry.criterionId !== 'string') {
      throw new Error('judge 输出中的 criterion score 缺少 criterionId。');
    }

    const criterion = criterionMap.get(entry.criterionId);
    if (!criterion) {
      throw new Error(`judge 输出包含未知 criterionId: ${entry.criterionId}`);
    }

    if (seen.has(entry.criterionId)) {
      throw new Error(`judge 输出中 criterionId 重复: ${entry.criterionId}`);
    }
    seen.add(entry.criterionId);

    const variantAScore = readCriterionScore(entry.variantAScore, criterion, 'variantAScore');
    const variantBScore = readCriterionScore(entry.variantBScore, criterion, 'variantBScore');
    const baselineScore = blindVariants.variantA.id === 'baseline' ? variantAScore : variantBScore;
    const candidateScore = blindVariants.variantA.id === 'candidate' ? variantAScore : variantBScore;
    return {
      criterionId: entry.criterionId,
      baselineScore,
      candidateScore,
      ...(typeof entry.notes === 'string' && entry.notes.trim() ? { notes: entry.notes.trim() } : {}),
    };
  });

  if (seen.size !== criteria.length) {
    throw new Error('judge 输出缺少部分 rubric criteria。');
  }

  return {
    outcome: mapJudgeOutcome(output.outcome, blindVariants),
    confidence: output.confidence,
    rationale,
    criterionScores,
    ...(typeof output.notes === 'string' && output.notes.trim() ? { notes: output.notes.trim() } : {}),
  };
}

function readCriterionScore(value, criterion, fieldName) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`judge 输出中的 ${criterion.id}.${fieldName} 必须是数字。`);
  }

  if (value < criterion.scale.min || value > criterion.scale.max) {
    throw new Error(
      `judge 输出中的 ${criterion.id}.${fieldName} 超出范围 ${criterion.scale.min}-${criterion.scale.max}。`,
    );
  }

  return value;
}

function mapJudgeOutcome(outcome, blindVariants) {
  if (outcome === 'tie' || outcome === 'inconclusive') {
    return outcome;
  }

  if (outcome === 'variant_a') {
    return blindVariants.variantA.id;
  }

  if (outcome === 'variant_b') {
    return blindVariants.variantB.id;
  }

  throw new Error(`judge 输出包含未知 outcome: ${String(outcome)}`);
}

async function writeJsonFile(filePath, value) {
  await writeFile(filePath, `${stableJsonStringify(value)}\n`, 'utf8');
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

function truncateForJudge(text, maxChars, label) {
  const chars = Array.from(text);
  if (chars.length <= maxChars) {
    return text;
  }

  const overhead = Array.from(label).length + 64;
  const usable = Math.max(maxChars - overhead, 256);
  const headChars = Math.floor((usable * TRUNCATION_HEAD_RATIO_NUM) / TRUNCATION_HEAD_RATIO_DEN);
  const tailChars = Math.max(usable - headChars, 0);
  const head = takeFirstChars(text, headChars);
  const tail = takeLastChars(text, tailChars);
  const omittedChars = Math.max(chars.length - Array.from(head).length - Array.from(tail).length, 0);

  return [
    head,
    `${label} omitted_chars=${omittedChars}`,
    tail,
  ].filter((part) => part.trim().length > 0).join('\n');
}

function takeFirstChars(text, count) {
  return Array.from(text).slice(0, count).join('');
}

function takeLastChars(text, count) {
  const chars = Array.from(text);
  return chars.slice(Math.max(chars.length - count, 0)).join('');
}

function requiredArgValue(argv, index, flag) {
  const value = argv[index];
  if (!value) {
    throw new Error(`${flag} 需要一个值。`);
  }
  return value;
}

function sha256(text) {
  return createHash('sha256').update(text).digest('hex');
}

function renderError(error) {
  if (error instanceof Error) {
    return error.stack ?? error.message;
  }
  return String(error);
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

void main().catch((error) => {
  console.error('Judge 运行失败。');
  console.error(renderError(error));
  process.exitCode = 1;
});