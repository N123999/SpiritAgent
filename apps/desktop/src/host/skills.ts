import { existsSync } from 'node:fs';
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type {
  OpenAiActiveSkill,
  OpenAiActiveSkillResourceEntry,
} from '@spirit-agent/agent-core';
import {
  resolveInstructionPaths,
  SKILL_FILE_NAME,
  validateSkillName,
} from '@spirit-agent/host-internal';

import type {
  CreateSkillRequest,
  DeleteSkillRequest,
  DesktopSkillRootKind,
} from '../types.js';
import {
  type HostMetadataSummary,
  spiritAgentDataDir,
} from './storage.js';
import { formatYamlScalarForSkillFrontmatter } from './service-utils.js';

const ACTIVE_SKILL_CONTENT_MAX_CHARS = 12_000;
const ACTIVE_SKILL_RESOURCE_MAX_ENTRIES = 24;
const ACTIVE_SKILL_RESOURCE_DIRS: ReadonlyArray<{
  kind: OpenAiActiveSkillResourceEntry['kind'];
  dirname: string;
}> = [
  { kind: 'scripts', dirname: 'scripts' },
  { kind: 'references', dirname: 'references' },
  { kind: 'assets', dirname: 'assets' },
];

export function desktopInstructionPaths(workspaceRoot: string) {
  return resolveInstructionPaths({
    workspaceRoot,
    spiritDataDir: spiritAgentDataDir(),
  });
}

export function parseSkillRootKind(value: unknown): DesktopSkillRootKind {
  if (value === 'user' || value === 'workspaceSpirit' || value === 'workspaceAgents') {
    return value;
  }
  throw new Error('无效的 Skill 根类型。');
}

export function resolveSkillRootDir(
  instructionPaths: ReturnType<typeof resolveInstructionPaths>,
  rootKind: DesktopSkillRootKind,
): string {
  switch (rootKind) {
    case 'user':
      return instructionPaths.userSkillsDir;
    case 'workspaceSpirit':
      return instructionPaths.workspaceSpiritSkillsDir;
    case 'workspaceAgents':
      return instructionPaths.workspaceAgentsSkillsDir;
    default: {
      const _exhaustive: never = rootKind;
      return _exhaustive;
    }
  }
}

export function resolveSkillDir(
  instructionPaths: ReturnType<typeof resolveInstructionPaths>,
  skillDirectoryName: string,
  rootKind: DesktopSkillRootKind,
): string {
  return path.join(resolveSkillRootDir(instructionPaths, rootKind), skillDirectoryName);
}

export function assertPathUnderSkillRoot(
  instructionPaths: ReturnType<typeof resolveInstructionPaths>,
  targetDir: string,
  rootKind: DesktopSkillRootKind,
): void {
  const root = path.resolve(resolveSkillRootDir(instructionPaths, rootKind));
  const resolved = path.resolve(targetDir);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error('Skill 路径不在允许的根目录内。');
  }
}

export async function createSkillFile(
  workspaceRoot: string,
  request: CreateSkillRequest,
): Promise<void> {
  const instructionPaths = desktopInstructionPaths(workspaceRoot);
  const rootKind = parseSkillRootKind(request.rootKind);
  const name = request.name.trim().toLowerCase();
  const nameIssue = validateSkillName(name);
  if (nameIssue) {
    throw new Error(nameIssue);
  }

  const description = (request.description ?? '').trim();
  if (!description) {
    throw new Error('描述不能为空。');
  }
  const skillDir = resolveSkillDir(instructionPaths, name, rootKind);
  if (existsSync(skillDir)) {
    throw new Error(`该位置已存在同名 Skill：${name}`);
  }

  const frontmatterDescription = formatYamlScalarForSkillFrontmatter(description);
  const fileContent = `---
name: ${name}
description: ${frontmatterDescription}
---

在此编写技能正文：步骤、示例、边界条件与相对路径引用。
`;

  await mkdir(skillDir, { recursive: true });
  await writeFile(path.join(skillDir, SKILL_FILE_NAME), fileContent, 'utf8');
}

export async function deleteSkillDir(
  workspaceRoot: string,
  request: DeleteSkillRequest,
): Promise<void> {
  const instructionPaths = desktopInstructionPaths(workspaceRoot);
  const rootKind = parseSkillRootKind(request.rootKind);
  const name = request.name.trim().toLowerCase();
  const nameIssue = validateSkillName(name);
  if (nameIssue) {
    throw new Error(nameIssue);
  }

  const skillDir = resolveSkillDir(instructionPaths, name, rootKind);
  assertPathUnderSkillRoot(instructionPaths, skillDir, rootKind);

  if (!existsSync(skillDir)) {
    throw new Error(`Skill 不存在：${name}`);
  }

  await rm(skillDir, { recursive: true, force: true });
}

export function buildActivateSkillUserTurn(skillName: string, extraNote: string): string {
  const trimmed = extraNote.trim();
  if (!trimmed) {
    return `请按 skill "${skillName}" 处理当前任务。`;
  }
  return trimmed;
}

const CREATE_SKILL_PROMPT_HINT =
  '请在 /create-skill 后描述你想生成或收紧的 Skill，例如：/create-skill 做一个用于排查 Electron 白屏的 Skill';

export function parseCreateSkillSlashPrompt(input: string): string | Error {
  const trimmed = input.trim();
  const prompt = trimmed.startsWith('/create-skill')
    ? trimmed.slice('/create-skill'.length).trim()
    : trimmed;
  if (!prompt) {
    return new Error(CREATE_SKILL_PROMPT_HINT);
  }

  return prompt;
}

export function buildCreateSkillUserTurn(
  workspaceRoot: string,
  instructionPaths: ReturnType<typeof resolveInstructionPaths>,
  prompt: string,
): string {
  const workspaceTargetRoot = instructionPaths.workspaceSpiritSkillsDir;
  const userTargetRoot = instructionPaths.userSkillsDir;

  return `你现在在处理一个 /create-skill 请求。

目标:
- default_scope: 工作区
- workspace_skill_root: ${workspaceTargetRoot}
- user_skill_root: ${userTargetRoot}
- workspace_root: ${workspaceRoot}

用户需求:
${prompt}

要求:
- 先把它当成一次正常的 assistant 对话来处理，正常流式输出，不要伪装成后台静默生成器。
- 默认创建到工作区 skill 根目录 ${workspaceTargetRoot}；只有在用户明确要求“用户级 / 全局 / 跨仓库复用 / 写到用户目录”这类语义时，才改为用户目录 ${userTargetRoot}。
- 你需要先根据用户需求自行决定一个合适的 skill_name；名称必须是 1-64 个字符，只能使用小写字母、数字和连字符，不能以连字符开头或结尾，也不能包含连续连字符。
- 最终目标目录名与 frontmatter \`name\` 必须完全等于你决定的 skill_name。
- 最终文件路径必须是 \`<选定根目录>/<skill_name>/SKILL.md\`；不要写到其他位置。
- 如果目标 Skill 已存在，先读取原有 \`SKILL.md\`，再基于现有内容压缩重写或收紧，不要在旧内容后面继续堆砌模板化废话。
- \`SKILL.md\` 必须以 YAML frontmatter 开头，至少包含 \`name\` 和 \`description\`；正文使用 Markdown，重点写清“做什么、何时用、怎么做”。
- \`description\` 要具体说明适用场景，便于 agent 在 catalog 中识别。
- Skill 是给后续 agent/LLM 直接消费的能力说明，不是给人类流程管理看的。
- 正文优先写步骤、输入输出示例、边界条件；避免空话、组织治理废话和泛泛 checklist。
- 需要事实时先读取仓库内相关文件，不要臆造项目结构、技术栈、目录或既有工作流。
- 如果技能需要引用其他文件，正文里使用相对路径表达，不要假设这些文件已经存在。
- 如果你选择工作区 scope，优先提炼当前仓库内可复用的流程知识、约束和操作步骤，避免写成泛化的团队治理文档。
- 如果你选择用户 scope，优先提炼跨仓库稳定复用的个人工作流、判断标准与执行步骤。
- 写入仍会经过正常审批；不要假设自己已经拿到权限，也不要在工具成功前声称“已创建”或“已更新”。

交付方式:
- 如果你能直接在目标路径落盘，就在确认内容后使用文件工具写入。
- 如果不能直接落盘，就把最终 \`SKILL.md\` 完整贴在回复里，并明确说明未写入。`;
}

export async function buildActiveSkillPayload(
  entry: HostMetadataSummary['skills']['entries'][number],
): Promise<OpenAiActiveSkill> {
  const skillRoot = path.dirname(entry.source.path);
  const { content, truncated } = truncateActiveSkillContent(entry.content);
  const { resources, truncated: resourcesTruncated } = await collectSkillResources(skillRoot);

  return {
    id: entry.source.id,
    scope: entry.source.scope,
    name: entry.source.name,
    description: entry.source.description,
    path: entry.source.path,
    content,
    truncated,
    resources,
    resourcesTruncated,
  };
}

function truncateActiveSkillContent(content: string): {
  content: string;
  truncated: boolean;
} {
  const chars = [...content];
  if (chars.length <= ACTIVE_SKILL_CONTENT_MAX_CHARS) {
    return {
      content: content.trim(),
      truncated: false,
    };
  }

  return {
    content: `${chars.slice(0, ACTIVE_SKILL_CONTENT_MAX_CHARS).join('').trimEnd()}\n\n...<skill content truncated>`,
    truncated: true,
  };
}

async function collectSkillResources(skillRoot: string): Promise<{
  resources: OpenAiActiveSkillResourceEntry[];
  truncated: boolean;
}> {
  const resources: OpenAiActiveSkillResourceEntry[] = [];
  let truncated = false;

  for (const { kind, dirname } of ACTIVE_SKILL_RESOURCE_DIRS) {
    const root = path.join(skillRoot, dirname);
    if (!existsSync(root)) {
      continue;
    }

    const stack = [root];
    while (stack.length > 0) {
      const current = stack.pop();
      if (!current) {
        continue;
      }

      const entries = await readdir(current, { withFileTypes: true });
      entries.sort((left, right) => left.name.localeCompare(right.name));
      for (const entry of entries) {
        const fullPath = path.join(current, entry.name);
        if (entry.isDirectory()) {
          stack.push(fullPath);
          continue;
        }
        if (!entry.isFile()) {
          continue;
        }
        if (resources.length >= ACTIVE_SKILL_RESOURCE_MAX_ENTRIES) {
          truncated = true;
          return { resources, truncated };
        }

        resources.push({
          kind,
          path: path.relative(skillRoot, fullPath).replace(/\\/gu, '/'),
        });
      }
    }
  }

  return { resources, truncated };
}
