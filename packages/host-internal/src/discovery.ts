import { existsSync } from 'node:fs';

import { normalizeSpiritAgentMode, type SpiritAgentMode } from '@spirit-agent/core';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import {
  AGENTS_DIR_NAME,
  SKILL_FILE_NAME,
  SKILLS_DIR_NAME,
  SPIRIT_DIR_NAME,
  USER_RULE_FILE_NAME,
  WORKSPACE_RULE_FILE_NAME,
  WORKSPACE_SPIRIT_RULE_FILE_NAME,
  loadToggleState,
  resolveInstructionPaths,
  stablePathId,
  type HostToggleState,
  type InstructionDiscoveryContext,
} from './storage.js';

const RULE_PREVIEW_MAX_LINES = 8;
const RULE_PREVIEW_MAX_CHARS = 1_200;
const SKILL_PREVIEW_MAX_LINES = 8;
const SKILL_PREVIEW_MAX_CHARS = 1_200;
const SKILL_NAME_MAX_CHARS = 64;

export type HostRuleScope = 'workspace' | 'user';
export type HostSkillScope = 'workspace' | 'user';
export type HostSkillRootKind = 'workspaceSpirit' | 'workspaceAgents' | 'user';

export interface HostRuleSource {
  id: string;
  scope: HostRuleScope;
  title: string;
  shortLabel: string;
  path: string;
}

export interface HostRulePreview {
  excerpt: string;
  truncated: boolean;
}

export interface HostRuleEntry {
  source: HostRuleSource;
  exists: boolean;
  enabled: boolean;
  content?: string;
  preview?: HostRulePreview;
}

export interface HostEnabledRule {
  id: string;
  scope: HostRuleScope;
  title: string;
  path: string;
  content: string;
}

export interface HostRuleDiscoveryResult {
  discovered: number;
  enabled: number;
  enabledRules: HostEnabledRule[];
}

export interface HostSkillSource {
  id: string;
  scope: HostSkillScope;
  rootKind: HostSkillRootKind;
  name: string;
  description: string;
  shortLabel: string;
  path: string;
}

export interface HostSkillPreview {
  excerpt: string;
  truncated: boolean;
}

export interface HostSkillEntry {
  source: HostSkillSource;
  enabled: boolean;
  content: string;
  preview: HostSkillPreview;
}

export interface HostEnabledSkillCatalogEntry {
  id: string;
  scope: HostSkillScope;
  name: string;
  description: string;
  path: string;
}

export interface HostSkillDiscoveryResult {
  discovered: number;
  enabled: number;
  enabledSkillCatalog: HostEnabledSkillCatalogEntry[];
  /** 全部发现项（含未启用），供宿主设置页等列清单。 */
  entries: readonly HostSkillEntry[];
}

export interface HostPlanMetadata {
  path: string;
  exists: boolean;
  agentMode: SpiritAgentMode;
  /** @deprecated Use agentMode === 'plan'. */
  planMode: boolean;
}

export interface HostInstructionMetadataSummary {
  rules: HostRuleDiscoveryResult;
  skills: HostSkillDiscoveryResult;
  planMetadata: HostPlanMetadata;
}

export interface HostDiscoverySnapshot<Item> {
  discovered: number;
  enabled: number;
  enabledItems: readonly Item[];
}

export interface HostInstructionDiscovery<Rule, Skill, PlanMetadata> {
  loadRules(): Promise<HostDiscoverySnapshot<Rule>>;
  loadSkills(): Promise<HostDiscoverySnapshot<Skill>>;
  loadPlanMetadata(): Promise<PlanMetadata>;
}

export interface LoadHostInstructionMetadataOptions {
  agentMode?: SpiritAgentMode;
  /** @deprecated Use agentMode. */
  planMode?: boolean;
  useApplyPatchFileTools?: boolean;
  activePlanPath?: string;
  log?: (message: string) => void;
}

interface ParsedSkillDocument {
  name: string;
  description: string;
  body: string;
}

interface ParsedSkillFrontmatter {
  name?: string;
  description?: string;
}

export async function loadHostInstructionMetadata(
  context: InstructionDiscoveryContext,
  options: LoadHostInstructionMetadataOptions = {},
): Promise<HostInstructionMetadataSummary> {
  const [rules, skills] = await Promise.all([
    loadRuleDiscoveryResult(context),
    loadSkillDiscoveryResult(context, options.log),
  ]);

  return {
    rules,
    skills,
    planMetadata: planMetadataSnapshot(context, normalizeSpiritAgentMode(options), {
      useApplyPatchFileTools: options.useApplyPatchFileTools === true,
      ...(options.activePlanPath?.trim()
        ? { activePlanPath: options.activePlanPath.trim() }
        : {}),
    }),
  };
}

function includesWorkspaceScope(context: InstructionDiscoveryContext): boolean {
  return context.includeWorkspaceScope !== false;
}

export async function discoverRuleEntries(
  context: InstructionDiscoveryContext,
  state?: HostToggleState,
): Promise<HostRuleEntry[]> {
  const paths = resolveInstructionPaths(context);
  const loadedState = state ?? (await loadToggleState(paths.rulesStateFile));
  const overrides = loadedState.enabledOverrides ?? {};
  const workspaceSources = includesWorkspaceScope(context)
    ? [
        buildRuleSource(
          paths.workspaceSpiritRuleFile,
          'workspace',
          '工作区 Spirit 规则',
          WORKSPACE_SPIRIT_RULE_FILE_NAME.replace(/\\/gu, '/'),
        ),
        buildRuleSource(
          paths.workspaceAgentsRuleFile,
          'workspace',
          '工作区 AGENTS 规则',
          WORKSPACE_RULE_FILE_NAME,
        ),
      ]
    : [];
  const sources = await Promise.all([
    ...workspaceSources,
    buildRuleSource(paths.userRuleFile, 'user', '用户规则', USER_RULE_FILE_NAME),
  ]);

  return Promise.all(
    sources.map(async (source) => {
      if (!existsSync(source.path)) {
        return {
          source,
          exists: false,
          enabled: overrides[source.id] ?? false,
        } satisfies HostRuleEntry;
      }

      const content = await readFile(source.path, 'utf8');
      return {
        source,
        exists: true,
        enabled: overrides[source.id] ?? true,
        content,
        preview: buildPreview(content, RULE_PREVIEW_MAX_LINES, RULE_PREVIEW_MAX_CHARS),
      } satisfies HostRuleEntry;
    }),
  );
}

export function enabledRules(entries: readonly HostRuleEntry[]): HostEnabledRule[] {
  return entries
    .filter((entry) => entry.exists && entry.enabled && entry.content !== undefined)
    .map((entry) => ({
      id: entry.source.id,
      scope: entry.source.scope,
      title: entry.source.title,
      path: entry.source.path,
      content: entry.content!,
    }));
}

export async function loadRuleDiscoveryResult(
  context: InstructionDiscoveryContext,
): Promise<HostRuleDiscoveryResult> {
  const entries = await discoverRuleEntries(context);
  const enabledRulesResult = enabledRules(entries);
  return {
    discovered: entries.filter((entry) => entry.exists).length,
    enabled: enabledRulesResult.length,
    enabledRules: enabledRulesResult,
  };
}

export async function discoverSkillEntries(
  context: InstructionDiscoveryContext,
  state?: HostToggleState,
  log?: (message: string) => void,
): Promise<HostSkillEntry[]> {
  const paths = resolveInstructionPaths(context);
  const loadedState = state ?? (await loadToggleState(paths.skillsStateFile));
  const overrides = loadedState.enabledOverrides ?? {};
  const roots = [
    ...(includesWorkspaceScope(context)
      ? [
          {
            rootPath: paths.workspaceSpiritSkillsDir,
            scope: 'workspace' as const,
            rootKind: 'workspaceSpirit' as const,
          },
          {
            rootPath: paths.workspaceAgentsSkillsDir,
            scope: 'workspace' as const,
            rootKind: 'workspaceAgents' as const,
          },
        ]
      : []),
    {
      rootPath: paths.userSkillsDir,
      scope: 'user' as const,
      rootKind: 'user' as const,
    },
  ];

  const discovered = new Map<string, HostSkillEntry>();
  for (const root of roots) {
    const entries = await discoverSkillsInRoot(root.rootPath, root.scope, root.rootKind, overrides, log);
    for (const entry of entries) {
      const existing = discovered.get(entry.source.name);
      if (existing) {
        log?.(
          `[skills] shadowed skill name=${entry.source.name} kept=${existing.source.path} ignored=${entry.source.path}`,
        );
        continue;
      }

      discovered.set(entry.source.name, entry);
    }
  }

  return [...discovered.values()].sort((left, right) => {
    return scopeRank(left.source.scope) - scopeRank(right.source.scope)
      || left.source.name.localeCompare(right.source.name)
      || left.source.path.localeCompare(right.source.path);
  });
}

export function enabledSkillCatalog(
  entries: readonly HostSkillEntry[],
): HostEnabledSkillCatalogEntry[] {
  return entries
    .filter((entry) => entry.enabled)
    .map((entry) => ({
      id: entry.source.id,
      scope: entry.source.scope,
      name: entry.source.name,
      description: entry.source.description,
      path: entry.source.path,
    }));
}

export async function loadSkillDiscoveryResult(
  context: InstructionDiscoveryContext,
  log?: (message: string) => void,
): Promise<HostSkillDiscoveryResult> {
  const entries = await discoverSkillEntries(context, undefined, log);
  const enabledSkillCatalogResult = enabledSkillCatalog(entries);
  return {
    discovered: entries.length,
    enabled: enabledSkillCatalogResult.length,
    enabledSkillCatalog: enabledSkillCatalogResult,
    entries,
  };
}

export interface PlanMetadataSnapshotOptions {
  useApplyPatchFileTools?: boolean;
  activePlanPath?: string;
}

export function planMetadataSnapshot(
  _context: InstructionDiscoveryContext,
  agentModeInput: SpiritAgentMode | boolean,
  options?: PlanMetadataSnapshotOptions,
): HostPlanMetadata {
  const agentMode =
    typeof agentModeInput === 'boolean'
      ? agentModeInput
        ? 'plan'
        : 'agent'
      : agentModeInput;
  const activePath = options?.activePlanPath?.trim() ?? '';
  return {
    path: activePath,
    exists: activePath.length > 0 && existsSync(activePath),
    agentMode,
    planMode: agentMode === 'plan',
  };
}

export function buildStartImplementingUserTurn(
  _context: InstructionDiscoveryContext,
  activePlanPath?: string,
): string {
  const trimmed = activePlanPath?.trim();
  if (!trimmed) {
    return '用户已确认方案并要求开始实现。本会话尚未记录可用的实施计划路径；请先使用 create_plan 创建计划后再开始实现。';
  }
  return `用户已确认方案并要求开始实现。开始实现前，先读取 Spirit 托管的计划文件 ${trimmed}，理解其中执行方案后再开始编码与验证。若该文件不存在、无法读取，或内容与当前需求明显不一致，先明确说明并请求用户重新生成或确认计划，不要假设计划内容。`;
}

async function buildRuleSource(
  filePath: string,
  scope: HostRuleScope,
  title: string,
  shortLabel: string,
): Promise<HostRuleSource> {
  return {
    id: await stablePathId(filePath),
    scope,
    title,
    shortLabel,
    path: filePath,
  };
}

async function discoverSkillsInRoot(
  rootPath: string,
  scope: HostSkillScope,
  rootKind: HostSkillRootKind,
  overrides: Record<string, boolean>,
  log?: (message: string) => void,
): Promise<HostSkillEntry[]> {
  if (!existsSync(rootPath)) {
    return [];
  }

  let directoryEntries;
  try {
    directoryEntries = await readdir(rootPath, { withFileTypes: true });
  } catch {
    log?.(`[skills] scan root is not a directory: ${rootPath}`);
    return [];
  }

  const directories = directoryEntries
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(rootPath, entry.name))
    .sort((left, right) => left.localeCompare(right));

  const entries: HostSkillEntry[] = [];
  for (const skillDir of directories) {
    const skillPath = path.join(skillDir, SKILL_FILE_NAME);
    if (!existsSync(skillPath)) {
      continue;
    }

    const parsed = await parseSkillDocument(skillPath, log);
    if (!parsed) {
      continue;
    }

    const source = {
      id: await stablePathId(skillPath),
      scope,
      rootKind,
      name: parsed.name,
      description: parsed.description,
      shortLabel: shortLabelForSkill(rootKind, parsed.name),
      path: skillPath,
    } satisfies HostSkillSource;
    entries.push({
      source,
      enabled: overrides[source.id] ?? true,
      content: parsed.body,
      preview: buildPreview(parsed.body, SKILL_PREVIEW_MAX_LINES, SKILL_PREVIEW_MAX_CHARS),
    });
  }

  return entries;
}

async function parseSkillDocument(
  filePath: string,
  log?: (message: string) => void,
): Promise<ParsedSkillDocument | undefined> {
  const raw = await readFile(filePath, 'utf8');
  const split = splitSkillFrontmatter(raw);
  if (!split) {
    log?.(`[skills] skipped missing frontmatter path=${filePath}`);
    return undefined;
  }

  const parsed = parseSkillFrontmatter(split.frontmatter);
  const name = parsed.name?.trim();
  if (!name) {
    log?.(`[skills] skipped missing name path=${filePath}`);
    return undefined;
  }

  const description = parsed.description?.trim();
  if (!description) {
    log?.(`[skills] skipped missing description path=${filePath}`);
    return undefined;
  }

  const nameError = validateSkillName(name);
  if (nameError) {
    log?.(`[skills] non-conforming name path=${filePath} name=${name} warning=${nameError}`);
  }

  const directoryName = path.basename(path.dirname(filePath));
  if (directoryName !== name) {
    log?.(`[skills] name-directory mismatch path=${filePath} name=${name} directory=${directoryName}`);
  }

  return {
    name,
    description,
    body: split.body.trim(),
  };
}

function splitSkillFrontmatter(raw: string): { frontmatter: string; body: string } | undefined {
  const content = raw.startsWith('\uFEFF') ? raw.slice(1) : raw;
  const segments = content.split(/\r?\n/);
  if (segments[0] !== '---') {
    return undefined;
  }

  let closingIndex = -1;
  for (let index = 1; index < segments.length; index += 1) {
    if (segments[index] === '---') {
      closingIndex = index;
      break;
    }
  }

  if (closingIndex < 0) {
    return undefined;
  }

  return {
    frontmatter: segments.slice(1, closingIndex).join('\n'),
    body: segments.slice(closingIndex + 1).join('\n'),
  };
}

function parseSkillFrontmatter(frontmatter: string): ParsedSkillFrontmatter {
  const parsed: ParsedSkillFrontmatter = {};
  for (const line of frontmatter.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    if (line.startsWith(' ') || line.startsWith('\t')) {
      continue;
    }

    if (parsed.name === undefined && trimmed.startsWith('name:')) {
      parsed.name = unquoteYamlScalar(trimmed.slice('name:'.length).trim());
      continue;
    }
    if (parsed.description === undefined && trimmed.startsWith('description:')) {
      parsed.description = unquoteYamlScalar(trimmed.slice('description:'.length).trim());
    }
  }

  return parsed;
}

function unquoteYamlScalar(value: string): string {
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === '"' && last === '"') || (first === '\'' && last === '\'')) {
      return value.slice(1, -1);
    }
  }

  return value;
}

export function validateSkillName(name: string): string | undefined {
  if (!name || [...name].length > SKILL_NAME_MAX_CHARS) {
    return `skill-name 必须为 1-${SKILL_NAME_MAX_CHARS} 个字符`;
  }
  if (name.startsWith('-') || name.endsWith('-')) {
    return 'skill-name 不能以连字符开头或结尾';
  }
  if (name.includes('--')) {
    return 'skill-name 不能包含连续连字符';
  }
  if (![...name].every((character) => /[a-z0-9-]/u.test(character))) {
    return 'skill-name 仅允许小写字母、数字和连字符';
  }

  return undefined;
}

function shortLabelForSkill(rootKind: HostSkillRootKind, skillName: string): string {
  switch (rootKind) {
    case 'workspaceSpirit':
      return `${SPIRIT_DIR_NAME}/${SKILLS_DIR_NAME}/${skillName}/${SKILL_FILE_NAME}`;
    case 'workspaceAgents':
      return `${AGENTS_DIR_NAME}/${SKILLS_DIR_NAME}/${skillName}/${SKILL_FILE_NAME}`;
    case 'user':
      return `${SKILLS_DIR_NAME}/${skillName}/${SKILL_FILE_NAME}`;
  }
}

function scopeRank(scope: HostSkillScope): number {
  return scope === 'workspace' ? 0 : 1;
}

function buildPreview(content: string, maxLines: number, maxChars: number): HostRulePreview {
  const excerptLines: string[] = [];
  let usedChars = 0;
  let truncated = false;

  for (const [index, line] of content.split(/\r?\n/u).entries()) {
    if (index >= maxLines) {
      truncated = true;
      break;
    }

    const lineChars = [...line].length;
    const separator = excerptLines.length === 0 ? 0 : 1;
    if (usedChars + separator + lineChars > maxChars) {
      const remaining = Math.max(0, maxChars - usedChars - separator);
      if (remaining > 0) {
        excerptLines.push(truncateChars(line, remaining));
      }
      truncated = true;
      break;
    }

    excerptLines.push(line);
    usedChars += separator + lineChars;
  }

  if (!truncated && content.split(/\r?\n/u).length <= maxLines) {
    truncated = [...content].length > maxChars;
  }

  return {
    excerpt: excerptLines.join('\n').trimEnd(),
    truncated,
  };
}

function truncateChars(text: string, count: number): string {
  if (count <= 0) {
    return '';
  }

  const chars = [...text];
  if (chars.length <= count) {
    return text;
  }

  return `${chars.slice(0, count).join('')}…`;
}