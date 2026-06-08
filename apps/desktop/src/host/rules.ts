import { existsSync } from 'node:fs';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  discoverRuleEntries,
  resolveInstructionPaths,
  type InstructionDiscoveryContext,
} from '@spirit-agent/host-internal';

import i18n from '../lib/i18n-host.js';
import type {
  CreateRuleRequest,
  DeleteRuleRequest,
  DesktopSkillRootKind,
} from '../types.js';
import { desktopInstructionPaths, parseSkillRootKind } from './skills.js';
import { spiritAgentDataDir } from './storage.js';

export type RuleSlashScope = 'workspace' | 'user';

export interface ParsedCreateRuleSlashRequest {
  scope: RuleSlashScope;
  prompt: string;
}

const CREATE_RULE_PROMPT_HINT =
  '请在 /create-rule 后描述你想生成或收紧的规则，例如：/create-rule 提交信息一律使用简体中文';

const USER_SCOPE_PREFIXES = [
  'user',
  'user-level',
  '用户级规则',
  '用户级',
  '用户规则',
  '用户',
  '全局规则',
  '全局',
  '个人规则',
  '个人',
] as const;

const WORKSPACE_SCOPE_PREFIXES = [
  'repo',
  'repository',
  'workspace',
  'repo-level',
  'workspace-level',
  '仓库级规则',
  '仓库级',
  '仓库规则',
  '仓库',
  '工作区规则',
  '工作区',
  '项目规则',
  '项目',
] as const;

export function resolveRuleFilePath(
  instructionPaths: ReturnType<typeof resolveInstructionPaths>,
  rootKind: DesktopSkillRootKind,
): string {
  switch (rootKind) {
    case 'workspaceSpirit':
      return instructionPaths.workspaceSpiritRuleFile;
    case 'workspaceAgents':
      return instructionPaths.workspaceAgentsRuleFile;
    case 'user':
      return instructionPaths.userRuleFile;
    default: {
      const _exhaustive: never = rootKind;
      return _exhaustive;
    }
  }
}

function assertManagedRulePath(
  instructionPaths: ReturnType<typeof resolveInstructionPaths>,
  targetPath: string,
): void {
  const allowed = [
    instructionPaths.workspaceSpiritRuleFile,
    instructionPaths.workspaceAgentsRuleFile,
    instructionPaths.userRuleFile,
  ].map((entry) => path.resolve(entry));
  const resolved = path.resolve(targetPath);
  if (!allowed.includes(resolved)) {
    throw new Error(i18n.t('error.rulePathOutsideManaged'));
  }
}

export async function ensureWorkspaceSpiritDir(workspaceRoot: string): Promise<void> {
  const instructionPaths = desktopInstructionPaths(workspaceRoot);
  const spiritDir = path.dirname(instructionPaths.workspaceSpiritRuleFile);
  await mkdir(spiritDir, { recursive: true });
}

export async function createRuleFile(
  workspaceRoot: string,
  request: CreateRuleRequest,
): Promise<void> {
  const instructionPaths = desktopInstructionPaths(workspaceRoot);
  const rootKind = parseSkillRootKind(request.rootKind);
  const description = request.description.trim();
  if (!description) {
    throw new Error(i18n.t('error.descriptionRequired'));
  }

  const targetPath = resolveRuleFilePath(instructionPaths, rootKind);
  if (existsSync(targetPath)) {
    throw new Error(i18n.t('error.ruleAlreadyExists', { path: targetPath }));
  }

  if (rootKind === 'workspaceSpirit') {
    await ensureWorkspaceSpiritDir(workspaceRoot);
  }

  const fileContent = `# Rules

${description}

在此补充短、硬、可执行的约束，供后续 agent 读取。
`;

  await writeFile(targetPath, fileContent, 'utf8');
}

export async function deleteRuleFile(
  workspaceRoot: string,
  request: DeleteRuleRequest,
  context: InstructionDiscoveryContext,
): Promise<void> {
  const ruleId = request.id.trim();
  if (!ruleId) {
    throw new Error(i18n.t('error.ruleIdRequired'));
  }

  const entries = await discoverRuleEntries(context);
  const entry = entries.find((item) => item.source.id === ruleId);
  if (!entry) {
    throw new Error(i18n.t('error.ruleNotFound'));
  }
  if (!entry.exists) {
    throw new Error(i18n.t('error.ruleNotFound'));
  }

  const instructionPaths = desktopInstructionPaths(workspaceRoot);
  assertManagedRulePath(instructionPaths, entry.source.path);
  await unlink(entry.source.path);
}

function matchPrefix(input: string, prefixes: readonly string[]): string | undefined {
  for (const prefix of prefixes) {
    const remainder = input.startsWith(prefix) ? input.slice(prefix.length) : undefined;
    if (remainder === undefined) {
      continue;
    }
    if (remainder.length === 0) {
      return remainder;
    }
    const first = remainder.charAt(0);
    if (
      /\s/u.test(first)
      || first === ':'
      || first === '：'
      || first === '-'
      || first === '，'
      || first === ','
      || first === ';'
      || first === '；'
    ) {
      return remainder.replace(/^[\s:：\-，,;；]+/u, '');
    }
  }
  return undefined;
}

function parseLeadingRuleScope(input: string): { scope: RuleSlashScope; remainder: string } | undefined {
  const userRemainder = matchPrefix(input, USER_SCOPE_PREFIXES);
  if (userRemainder !== undefined) {
    return { scope: 'user', remainder: userRemainder };
  }
  const workspaceRemainder = matchPrefix(input, WORKSPACE_SCOPE_PREFIXES);
  if (workspaceRemainder !== undefined) {
    return { scope: 'workspace', remainder: workspaceRemainder };
  }
  return undefined;
}

export function parseCreateRuleRequest(input: string): ParsedCreateRuleSlashRequest | Error {
  const trimmed = input.trim();
  if (!trimmed) {
    return new Error(CREATE_RULE_PROMPT_HINT);
  }

  const scoped = parseLeadingRuleScope(trimmed);
  if (scoped) {
    const prompt = scoped.remainder.trim();
    if (!prompt) {
      return new Error(CREATE_RULE_PROMPT_HINT);
    }
    return { scope: scoped.scope, prompt };
  }

  return { scope: 'workspace', prompt: trimmed };
}

export function parseCreateRuleSlashPrompt(input: string): ParsedCreateRuleSlashRequest | Error {
  const trimmed = input.trim();
  const tail = trimmed.startsWith('/create-rule')
    ? trimmed.slice('/create-rule'.length).trim()
    : trimmed;
  return parseCreateRuleRequest(tail);
}

function rulePathForSlashScope(
  workspaceRoot: string,
  scope: RuleSlashScope,
): string {
  const instructionPaths = desktopInstructionPaths(workspaceRoot);
  return scope === 'workspace'
    ? instructionPaths.workspaceSpiritRuleFile
    : instructionPaths.userRuleFile;
}

function ruleScopeLabel(scope: RuleSlashScope): string {
  return scope === 'workspace' ? '工作区' : '用户';
}

export function buildCreateRuleUserTurn(
  workspaceRoot: string,
  request: ParsedCreateRuleSlashRequest,
): string {
  const targetPath = rulePathForSlashScope(workspaceRoot, request.scope);
  const targetExists = existsSync(targetPath);
  const scopeHint =
    request.scope === 'workspace'
      ? '优先提炼当前仓库真实存在的目录边界、代码风格差异、验证命令和高价值限制。'
      : '优先提炼跨仓库通用的个人偏好、默认协作方式和稳定工作习惯。';
  const targetNote = targetExists
    ? '目标文件已存在；如果要更新，先读取原文并压缩重写，不要在旧内容后面继续堆砌模板化废话。'
    : '目标文件目前不存在；如果内容确定且路径可写，直接创建即可。';
  const writeNote =
    request.scope === 'workspace'
      ? `目标文件位于当前工作区内。你可以在内容确认后使用 create_file 或 edit_file 写入 ${targetPath}。写入仍会经过正常审批；不要假设自己已经拿到权限，也不要在工具成功前声称“已创建”或“已更新”。`
      : `目标文件位于 Spirit 托管的用户目录：${targetPath}。你可以在内容确认后使用 create_file 或 edit_file 写入；该路径虽在工作区外，但属于允许写入的托管范围，写入仍会经过正常审批；不要假设自己已经拿到权限，也不要在工具成功前声称“已创建”或“已更新”。`;

  return `你现在在处理一个 /create-rule 请求。

目标:
- scope: ${ruleScopeLabel(request.scope)}
- target_path: ${targetPath}
- workspace_root: ${workspaceRoot}

用户需求:
${request.prompt}

要求:
- 先把它当成一次正常的 assistant 对话来处理，正常流式输出，不要伪装成后台静默生成器。
- 最终规则文件是给后续 LLM 看的，不是给人类流程管理看的。
- 保持内容短、硬、可执行；优先保留真正影响编码行为的约束。
- 需要事实时先读取仓库内相关文件，不要臆造项目结构、技术栈或工作流。
- 避免空话和人类治理废话，例如生效日期、发布流程、分支策略、贡献者流程、严重级别分层、泛化检查清单、冗长示例。
- 规则文件必须以 Markdown 一级标题开头，正文优先使用短标题和短 bullet。
- 如果某条信息不会改变后续 agent 的行为，就不要写进文件。
- ${scopeHint}
- ${targetNote}
- ${writeNote}

交付方式:
- 如果你能直接在目标路径落盘，就在确认内容后使用文件工具写入。
- 如果不能直接落盘，就把最终文件内容完整贴在回复里，并明确说明未写入。`;
}

export function buildRuleDiscoveryContext(
  workspaceRoot: string,
  workspaceBinding: 'project' | 'none' = 'project',
): InstructionDiscoveryContext {
  return {
    workspaceRoot,
    spiritDataDir: spiritAgentDataDir(),
    includeWorkspaceScope: workspaceBinding === 'project',
  };
}
