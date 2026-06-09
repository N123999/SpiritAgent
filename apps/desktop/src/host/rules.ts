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
