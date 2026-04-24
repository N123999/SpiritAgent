import { exec as execCallback } from 'node:child_process';
import { existsSync } from 'node:fs';
import {
  lstat,
  mkdir,
  readdir,
  readFile,
  realpath,
  unlink,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { resolveInstructionPaths, type InstructionDiscoveryContext } from './storage.js';

const exec = promisify(execCallback);

const PERMISSIONS_FILE = 'tool-permissions.json';
const MAX_READ_LINES_DEFAULT = 200;
const MAX_DIRECTORY_LIST_RESULTS = 4000;
const MAX_WEB_FETCH_OUTPUT_CHARS = 24_000;
const WEB_FETCH_TIMEOUT_MS = 20_000;
const MAX_COMMAND_OUTPUT_CHARS = 16_000;
const MAX_SEARCH_RESULTS = 80;
const MAX_SEARCH_MATCHES_PER_FILE = 3;
const MAX_SEARCH_FILE_BYTES = 1_000_000;
const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36';

const SEARCH_IGNORE_DIR_NAMES = new Set(['.git', 'target', 'node_modules']);
const BINARY_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.ico',
  '.zip',
  '.gz',
  '.7z',
  '.pdf',
  '.exe',
  '.dll',
  '.so',
  '.dylib',
  '.class',
]);

export type HostJsonPrimitive = string | number | boolean | null;
export type HostJsonValue = HostJsonPrimitive | HostJsonObject | HostJsonValue[];

export interface HostJsonObject {
  [key: string]: HostJsonValue;
}

export interface HostBuiltinToolDefinitionEnvironment {
  shellDisplayName: string;
  shellCommandParameterDescription: string;
}

export interface HostAskQuestionsOptionSpec {
  label: string;
  summary?: string;
}

export interface HostAskQuestionsQuestionSpec {
  id: string;
  title: string;
  kind: 'single_select' | 'multi_select' | 'text';
  required: boolean;
  options: HostAskQuestionsOptionSpec[];
  allowCustomInput: boolean;
  customInputPlaceholder?: string;
  customInputLabel?: string;
}

export interface HostAskQuestionsRequest<QuestionSpec = HostAskQuestionsQuestionSpec> {
  title?: string;
  questions: QuestionSpec[];
}

export interface RunSubagentRequest {
  task: string;
  success_criteria?: string;
  context_summary?: string;
  files_to_inspect: string[];
  expected_output?: string;
}

export type HostToolRequest<QuestionSpec = HostAskQuestionsQuestionSpec> =
  | { name: 'run_shell_command'; command: string }
  | { name: 'web_fetch'; url: string }
  | { name: 'list_directory_files'; path: string }
  | {
      name: 'read_file';
      path: string;
      start_line?: number;
      end_line?: number;
    }
  | { name: 'search_files'; query: string }
  | {
      name: 'run_subagent';
      task: string;
      success_criteria?: string;
      context_summary?: string;
      files_to_inspect: string[];
      expected_output?: string;
    }
  | {
      name: 'ask_questions';
      title?: string;
      questions: QuestionSpec[];
    }
  | { name: 'create_file'; path: string; content: string }
  | { name: 'edit_file'; path: string; old_text: string; new_text: string }
  | { name: 'delete_file'; path: string };

export type HostAuthorizationDecision<QuestionSpec = HostAskQuestionsQuestionSpec> =
  | { kind: 'allowed' }
  | { kind: 'need-approval'; prompt: string; trustTarget?: string }
  | { kind: 'need-questions'; questions: HostAskQuestionsRequest<QuestionSpec> };

export type HostMcpStatusState = 'idle' | 'loading' | 'ready' | 'error';

export interface HostMcpStatusSnapshot {
  revision: number;
  state: HostMcpStatusState;
  configuredServers: number;
  loadedServers: number;
  cachedTools: number;
  lastError?: string;
}

export interface HostBuiltinToolService<QuestionSpec = HostAskQuestionsQuestionSpec> {
  toolDefinitionEnvironment(): HostBuiltinToolDefinitionEnvironment;
  requestFromFunctionCall(name: string, argumentsJson: string): Promise<HostToolRequest<QuestionSpec>>;
  authorize(request: HostToolRequest<QuestionSpec>): Promise<HostAuthorizationDecision<QuestionSpec>>;
  trust(target: string): Promise<void>;
  execute(request: HostToolRequest<QuestionSpec>): Promise<string>;
  startMcpBackgroundRefresh(): void;
  mcpStatusSnapshot(): HostMcpStatusSnapshot;
  addMcpServer(name: string, config: HostJsonValue): Promise<string>;
  listMcpServers(): Promise<unknown[]>;
  inspectMcpServer(name: string): Promise<unknown>;
  listMcpTools(name: string): Promise<unknown[]>;
  listMcpResources(name: string): Promise<unknown[]>;
  readMcpResource(name: string, uri: string): Promise<HostJsonValue>;
  listCachedMcpPrompts(name: string): Promise<unknown[]>;
  listMcpPrompts(name: string): Promise<unknown[]>;
  getMcpPrompt(name: string, prompt: string, argsJson?: string): Promise<HostJsonValue>;
}

export interface HostMcpAdapter {
  startBackgroundRefresh(): void;
  statusSnapshot(): HostMcpStatusSnapshot;
  addServer(name: string, config: HostJsonValue): Promise<string>;
  listServers(): Promise<unknown[]>;
  inspectServer(name: string): Promise<unknown>;
  listTools(name: string): Promise<unknown[]>;
  listResources(name: string): Promise<unknown[]>;
  readResource(name: string, uri: string): Promise<HostJsonValue>;
  listCachedPrompts(name: string): Promise<unknown[]>;
  listPrompts(name: string): Promise<unknown[]>;
  getPrompt(name: string, prompt: string, argsJson?: string): Promise<HostJsonValue>;
}

interface ToolPermissionStore {
  trusted_shell_commands?: string[];
  trusted_external_read_paths?: string[];
}

export function createNoopMcpAdapter(): HostMcpAdapter {
  return {
    startBackgroundRefresh() {},
    statusSnapshot() {
      return {
        revision: 0,
        state: 'idle',
        configuredServers: 0,
        loadedServers: 0,
        cachedTools: 0,
      };
    },
    async addServer() {
      throw new Error('当前桌面宿主尚未实现 MCP server 管理。');
    },
    async listServers() {
      return [];
    },
    async inspectServer() {
      throw new Error('当前桌面宿主尚未实现 MCP server 检查。');
    },
    async listTools() {
      return [];
    },
    async listResources() {
      return [];
    },
    async readResource() {
      throw new Error('当前桌面宿主尚未实现 MCP resource 读取。');
    },
    async listCachedPrompts() {
      return [];
    },
    async listPrompts() {
      return [];
    },
    async getPrompt() {
      throw new Error('当前桌面宿主尚未实现 MCP prompt 获取。');
    },
  };
}

export function detectShellForTools(): HostBuiltinToolDefinitionEnvironment {
  if (process.platform !== 'win32') {
    const shell = process.env.SHELL ?? '/bin/sh';
    const name = path.basename(shell);
    return {
      shellDisplayName: `POSIX shell (${name})`,
      shellCommandParameterDescription: `The command to execute in POSIX shell (${name}). Prefer POSIX shell syntax such as ls, find, grep, cat, pwd, and cd.`,
    };
  }

  const comspec = (process.env.COMSPEC ?? 'cmd.exe').toLowerCase();
  if (comspec.includes('powershell') || comspec.includes('pwsh')) {
    return {
      shellDisplayName: 'Windows PowerShell',
      shellCommandParameterDescription:
        'The command to execute in Windows PowerShell. Prefer PowerShell syntax such as Get-ChildItem, Select-String, Get-Content, Set-Location, and Test-Path. Do not assume Bash-only syntax.',
    };
  }

  return {
    shellDisplayName: 'Command Prompt (cmd.exe)',
    shellCommandParameterDescription:
      'The command to execute in Command Prompt (cmd.exe). Prefer cmd.exe syntax such as dir, type, where, findstr, and cd. Do not assume Bash commands like find, ls, grep, or cat.',
  };
}

export class NodeHostToolService<QuestionSpec = HostAskQuestionsQuestionSpec>
  implements HostBuiltinToolService<QuestionSpec>
{
  private readonly workspaceRoot: string;
  private readonly spiritDataDir: string;
  private readonly permissionStorePath: string;
  private readonly mcp: HostMcpAdapter;
  private permissionsPromise: Promise<ToolPermissionStore> | undefined;

  constructor(
    private readonly context: InstructionDiscoveryContext,
    options: { mcp?: HostMcpAdapter } = {},
  ) {
    this.workspaceRoot = path.resolve(context.workspaceRoot);
    this.spiritDataDir = path.resolve(context.spiritDataDir);
    this.permissionStorePath = path.join(this.spiritDataDir, PERMISSIONS_FILE);
    this.mcp = options.mcp ?? createNoopMcpAdapter();
  }

  toolDefinitionEnvironment(): HostBuiltinToolDefinitionEnvironment {
    return detectShellForTools();
  }

  async requestFromFunctionCall(
    name: string,
    argumentsJson: string,
  ): Promise<HostToolRequest<QuestionSpec>> {
    const parsed = parseJsonObject(argumentsJson);

    switch (name) {
      case 'run_shell_command':
        return {
          name,
          command: requiredString(parsed, 'command'),
        };
      case 'web_fetch':
        return {
          name,
          url: requiredString(parsed, 'url'),
        };
      case 'list_directory_files':
        return {
          name,
          path: requiredString(parsed, 'path'),
        };
      case 'read_file':
        {
          const startLine = optionalPositiveInt(parsed, 'start_line');
          const endLine = optionalPositiveInt(parsed, 'end_line');
        return {
          name,
          path: requiredString(parsed, 'path'),
          ...(startLine !== undefined ? { start_line: startLine } : {}),
          ...(endLine !== undefined ? { end_line: endLine } : {}),
        };
        }
      case 'search_files':
        return {
          name,
          query: requiredString(parsed, 'query'),
        };
      case 'run_subagent':
        {
          const successCriteria = optionalStringStrict(parsed, 'success_criteria');
          const contextSummary = optionalStringStrict(parsed, 'context_summary');
          const expectedOutput = optionalStringStrict(parsed, 'expected_output');
        return {
          name,
          task: requiredString(parsed, 'task'),
          ...(successCriteria ? { success_criteria: successCriteria } : {}),
          ...(contextSummary ? { context_summary: contextSummary } : {}),
          files_to_inspect: optionalStringArrayStrict(parsed, 'files_to_inspect'),
          ...(expectedOutput ? { expected_output: expectedOutput } : {}),
        };
        }
      case 'ask_questions':
        return parseAskQuestionsRequest(parsed) as HostToolRequest<QuestionSpec>;
      case 'create_file':
        return {
          name,
          path: requiredString(parsed, 'path'),
          content: requiredString(parsed, 'content'),
        };
      case 'edit_file':
        return {
          name,
          path: requiredString(parsed, 'path'),
          old_text: requiredString(parsed, 'old_text'),
          new_text: requiredString(parsed, 'new_text'),
        };
      case 'delete_file':
        return {
          name,
          path: requiredString(parsed, 'path'),
        };
      default:
        throw new Error(`未知工具: ${name}`);
    }
  }

  async authorize(
    request: HostToolRequest<QuestionSpec>,
  ): Promise<HostAuthorizationDecision<QuestionSpec>> {
    switch (request.name) {
      case 'search_files':
      case 'run_subagent':
        return { kind: 'allowed' };
      case 'ask_questions':
        return {
          kind: 'need-questions',
          questions: {
            ...(request.title ? { title: request.title } : {}),
            questions: request.questions,
          },
        };
      case 'run_shell_command': {
        const permissions = await this.loadPermissions();
        if ((permissions.trusted_shell_commands ?? []).includes(request.command)) {
          return { kind: 'allowed' };
        }

        const shell = this.toolDefinitionEnvironment();
        return {
          kind: 'need-approval',
          prompt: `高风险工具调用: shell\n终端: ${shell.shellDisplayName}\n命令: ${request.command}\n\n输入 y 允许一次，n 拒绝，t 信任并持久化。`,
          trustTarget: `shell:${request.command}`,
        };
      }
      case 'web_fetch':
        return {
          kind: 'need-approval',
          prompt: `高风险工具调用: 抓取网页\nURL: ${request.url}\n\n正文将进入对话；请确认来源可信，恶意页面可能提示词注入。\n\n输入 y 允许一次，n 拒绝。`,
        };
      case 'list_directory_files': {
        const canonical = await this.resolveExistingAbsoluteDirectory(request.path);
        return this.authorizeExternalReadPath(canonical, '遍历工作目录外目录');
      }
      case 'read_file': {
        const canonical = await this.resolveExistingFilePath(request.path);
        return this.authorizeExternalReadPath(canonical, '读取工作目录外文件');
      }
      case 'create_file':
        return {
          kind: 'need-approval',
          prompt: `高风险工具调用: 创建文件\n路径: ${request.path}\n内容长度: ${[...request.content].length} 字符\n\n输入 y 允许一次，n 拒绝。`,
        };
      case 'edit_file':
        return {
          kind: 'need-approval',
          prompt: `高风险工具调用: 编辑文件（精确替换）\n路径: ${request.path}\n旧文本长度: ${[...request.old_text].length} 字符\n新文本长度: ${[...request.new_text].length} 字符\n\n输入 y 允许一次，n 拒绝。`,
        };
      case 'delete_file':
        return {
          kind: 'need-approval',
          prompt: `高风险工具调用: 删除文件\n路径: ${request.path}\n\n输入 y 允许一次，n 拒绝。`,
        };
    }
  }

  async trust(target: string): Promise<void> {
    const permissions = await this.loadPermissions();
    if (target.startsWith('shell:')) {
      const command = target.slice('shell:'.length);
      const trusted = permissions.trusted_shell_commands ?? [];
      if (!trusted.includes(command)) {
        trusted.push(command);
      }
      permissions.trusted_shell_commands = trusted;
      await this.savePermissions(permissions);
      return;
    }

    if (target.startsWith('external-read:')) {
      const externalPath = target.slice('external-read:'.length);
      const trusted = permissions.trusted_external_read_paths ?? [];
      if (!trusted.includes(externalPath)) {
        trusted.push(externalPath);
      }
      permissions.trusted_external_read_paths = trusted;
      await this.savePermissions(permissions);
      return;
    }

    throw new Error(`未知 trust target: ${target}`);
  }

  async execute(request: HostToolRequest<QuestionSpec>): Promise<string> {
    switch (request.name) {
      case 'run_shell_command':
        return this.executeShell(request.command);
      case 'web_fetch':
        return this.executeWebFetch(request.url);
      case 'list_directory_files':
        return this.executeListDirectory(request.path);
      case 'read_file':
        return this.executeReadFile(request.path, request.start_line, request.end_line);
      case 'search_files':
        return this.executeSearchFiles(request.query);
      case 'run_subagent':
        throw new Error('run_subagent 应由 Agent runtime 接管，不应落到宿主 ToolRuntime::execute');
      case 'ask_questions':
        throw new Error('ask_questions 应由运行时挂起并等待用户填写，不应直接执行');
      case 'create_file':
        return this.executeCreateFile(request.path, request.content);
      case 'edit_file':
        return this.executeEditFile(request.path, request.old_text, request.new_text);
      case 'delete_file':
        return this.executeDeleteFile(request.path);
    }
  }

  startMcpBackgroundRefresh(): void {
    this.mcp.startBackgroundRefresh();
  }

  mcpStatusSnapshot(): HostMcpStatusSnapshot {
    return this.mcp.statusSnapshot();
  }

  async addMcpServer(name: string, config: HostJsonValue): Promise<string> {
    return this.mcp.addServer(name, config);
  }

  async listMcpServers(): Promise<unknown[]> {
    return this.mcp.listServers();
  }

  async inspectMcpServer(name: string): Promise<unknown> {
    return this.mcp.inspectServer(name);
  }

  async listMcpTools(name: string): Promise<unknown[]> {
    return this.mcp.listTools(name);
  }

  async listMcpResources(name: string): Promise<unknown[]> {
    return this.mcp.listResources(name);
  }

  async readMcpResource(name: string, uri: string): Promise<HostJsonValue> {
    return this.mcp.readResource(name, uri);
  }

  async listCachedMcpPrompts(name: string): Promise<unknown[]> {
    return this.mcp.listCachedPrompts(name);
  }

  async listMcpPrompts(name: string): Promise<unknown[]> {
    return this.mcp.listPrompts(name);
  }

  async getMcpPrompt(name: string, prompt: string, argsJson?: string): Promise<HostJsonValue> {
    return this.mcp.getPrompt(name, prompt, argsJson);
  }

  private async loadPermissions(): Promise<ToolPermissionStore> {
    this.permissionsPromise ??= loadPermissions(this.permissionStorePath);
    return this.permissionsPromise;
  }

  private async savePermissions(store: ToolPermissionStore): Promise<void> {
    this.permissionsPromise = Promise.resolve(store);
    await savePermissions(this.permissionStorePath, store);
  }

  private async authorizeExternalReadPath(
    canonical: string,
    promptTitle: string,
  ): Promise<HostAuthorizationDecision<QuestionSpec>> {
    if (this.isAllowedReadLocation(canonical)) {
      return { kind: 'allowed' };
    }

    const permissions = await this.loadPermissions();
    if ((permissions.trusted_external_read_paths ?? []).includes(canonical)) {
      return { kind: 'allowed' };
    }

    return {
      kind: 'need-approval',
      prompt: `高风险工具调用: ${promptTitle}\n路径: ${canonical}\n\n输入 y 允许一次，n 拒绝，t 信任并持久化。`,
      trustTarget: `external-read:${canonical}`,
    };
  }

  private isAllowedReadLocation(canonical: string): boolean {
    return (
      isWithinRoot(canonical, this.workspaceRoot) ||
      isInsideSpiritManagedUserArea(canonical, this.context)
    );
  }

  private async resolveExistingAbsoluteDirectory(input: string): Promise<string> {
    const trimmed = input.trim();
    if (!trimmed) {
      throw new Error('path 不能为空');
    }
    if (!path.isAbsolute(trimmed)) {
      throw new Error(`list_directory_files 仅接受 absolute path: ${trimmed}`);
    }
    const canonical = await realpath(trimmed);
    const st = await lstat(canonical);
    if (!st.isDirectory()) {
      throw new Error(`目标不是目录: ${canonical}`);
    }
    return canonical;
  }

  private async resolveExistingFilePath(input: string): Promise<string> {
    const trimmed = input.trim();
    if (!trimmed) {
      throw new Error('path 不能为空');
    }
    const raw = path.isAbsolute(trimmed) ? trimmed : path.resolve(this.workspaceRoot, trimmed);
    return realpath(raw);
  }

  private resolveWorkspaceWriteTarget(input: string): string {
    const trimmed = input.trim();
    if (!trimmed) {
      throw new Error('path 不能为空');
    }
    const joined = path.isAbsolute(trimmed)
      ? path.resolve(trimmed)
      : path.resolve(this.workspaceRoot, trimmed);
    if (!isAllowedWritePath(joined, this.context)) {
      throw new Error(
        `仅允许修改工作目录内文件，或 Spirit 托管的用户规则/plan/skills 路径: ${joined}`,
      );
    }
    return joined;
  }

  private async executeListDirectory(inputPath: string): Promise<string> {
    const root = await this.resolveExistingAbsoluteDirectory(inputPath);
    const files: string[] = [];
    const directories: string[] = [];
    let skippedDirs = 0;
    let skippedSymlinks = 0;
    let truncated = false;

    let entries;
    try {
      entries = await readdir(root, { withFileTypes: true });
    } catch {
      skippedDirs += 1;
      return `[list]\npath: ${root}\nfiles: 0\ntruncated: false\nskipped_dirs: ${skippedDirs}\nskipped_symlinks: ${skippedSymlinks}\n\n（无法读取目录）`;
    }

    for (const entry of entries) {
      let fileType;
      try {
        fileType = await lstat(path.join(root, entry.name));
      } catch {
        continue;
      }
      const entryPath = path.join(root, entry.name);
      if (fileType.isSymbolicLink()) {
        skippedSymlinks += 1;
      } else if (fileType.isDirectory()) {
        directories.push(entryPath);
      } else if (fileType.isFile()) {
        files.push(entryPath);
        if (files.length >= MAX_DIRECTORY_LIST_RESULTS) {
          truncated = true;
          break;
        }
      }
    }

    directories.sort((left, right) => left.localeCompare(right));
    files.sort((left, right) => left.localeCompare(right));

    let out = `[list]\npath: ${root}\ndirectories: ${directories.length}\nfiles: ${files.length}\ntruncated: ${truncated ? 'true' : 'false'}\nskipped_dirs: ${skippedDirs}\nskipped_symlinks: ${skippedSymlinks}\n\n`;

    if (directories.length === 0 && files.length === 0) {
      out += '（目录为空）';
    } else {
      if (directories.length > 0) {
        out += 'directories\n';
        for (const directory of directories) {
          out += `${directory}\n`;
        }
        out += '\n';
      }
      if (files.length > 0) {
        out += 'files\n';
        for (const file of files) {
          out += `${file}\n`;
        }
      }
    }

    if (truncated) {
      out += `\n...<结果已截断，最多列出 ${MAX_DIRECTORY_LIST_RESULTS} 个文件>`;
    }

    return out;
  }

  private async executeReadFile(
    inputPath: string,
    startLine?: number,
    endLine?: number,
  ): Promise<string> {
    const canonical = await this.resolveExistingFilePath(inputPath);
    const st = await lstat(canonical);
    if (!st.isFile()) {
      throw new Error(`目标不是文件: ${canonical}`);
    }

    const content = await readFile(canonical, 'utf8');
    const start = startLine ?? 1;
    if (start === 0) {
      throw new Error('line 从 1 开始');
    }

    const end = endLine ?? start + MAX_READ_LINES_DEFAULT - 1;
    if (end < start) {
      throw new Error('end line 不能小于 start line');
    }

    const lines = content.split(/\r?\n/u);
    const maxLine = Math.max(lines.length, 1);
    const s = Math.min(start, maxLine);
    const e = Math.min(end, maxLine);

    let out = `[read]\npath: ${canonical}\nrange: ${s}-${e}\n\n`;
    for (let index = s; index <= e; index += 1) {
      const line = lines[index - 1] ?? '';
      out += `${String(index).padStart(6, ' ')} | ${line}\n`;
    }
    return out;
  }

  private async executeSearchFiles(query: string): Promise<string> {
    const needle = query.trim();
    if (!needle) {
      throw new Error('search query 不能为空');
    }

    const needleLower = needle.toLowerCase();
    const files = new Set<string>();
    const hits: string[] = [];

    const visitFile = async (filePath: string): Promise<boolean> => {
      if (hits.length >= MAX_SEARCH_RESULTS) {
        return false;
      }

      const ext = path.extname(filePath).toLowerCase();
      if (BINARY_EXTENSIONS.has(ext)) {
        return true;
      }

      let st;
      try {
        st = await lstat(filePath);
      } catch {
        return true;
      }
      if (!st.isFile() || st.size > MAX_SEARCH_FILE_BYTES) {
        return true;
      }

      let content: string;
      try {
        content = await readFile(filePath, 'utf8');
      } catch {
        return true;
      }

      const rel = path.relative(this.workspaceRoot, filePath).replace(/\\/gu, '/');
      const relDisplay = rel || '.';
      const lines = content.split(/\r?\n/u);
      let fileMatchCount = 0;

      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index] ?? '';
        if (!line.toLowerCase().includes(needleLower)) {
          continue;
        }

        files.add(relDisplay);
        if (hits.length < MAX_SEARCH_RESULTS && fileMatchCount < MAX_SEARCH_MATCHES_PER_FILE) {
          hits.push(`${relDisplay}:${index + 1} | ${truncateChars(normalizeSearchLine(line), 180)}`);
        }
        fileMatchCount += 1;
        if (hits.length >= MAX_SEARCH_RESULTS) {
          return false;
        }
      }

      return true;
    };

    const walk = async (dir: string): Promise<void> => {
      if (hits.length >= MAX_SEARCH_RESULTS) {
        return;
      }

      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        if (hits.length >= MAX_SEARCH_RESULTS) {
          return;
        }

        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (SEARCH_IGNORE_DIR_NAMES.has(entry.name)) {
            continue;
          }
          await walk(full);
        } else if (entry.isFile()) {
          const ok = await visitFile(full);
          if (!ok) {
            return;
          }
        }
      }
    };

    await walk(this.workspaceRoot);

    if (files.size === 0) {
      return `[tool] 搜索: ${query}\n未搜索到文件`;
    }

    let out = `[tool] 搜索: ${query}\n命中片段\n`;
    for (const hit of hits) {
      out += `${hit}\n`;
    }
    out += '\n涉及文件\n';
    for (const file of [...files].sort((left, right) => left.localeCompare(right))) {
      out += `${file}\n`;
    }
    return out;
  }

  private async executeShell(command: string): Promise<string> {
    const shell = this.toolDefinitionEnvironment();
    let stdout = '';
    let stderr = '';
    let code = 0;
    try {
      const result = await exec(command, {
        cwd: this.workspaceRoot,
        maxBuffer: 8 * 1024 * 1024,
        windowsHide: true,
      });
      stdout = result.stdout ?? '';
      stderr = result.stderr ?? '';
    } catch (error: unknown) {
      const ex = error as { stdout?: string; stderr?: string; code?: number };
      stdout = ex.stdout ?? '';
      stderr = ex.stderr ?? '';
      code = typeof ex.code === 'number' ? ex.code : -1;
    }

    let combined = formatShellToolTranscript(
      shell.shellDisplayName,
      this.workspaceRoot,
      command,
      code,
      stdout,
      stderr,
    );
    if ([...combined].length > MAX_COMMAND_OUTPUT_CHARS) {
      combined = `${truncateChars(combined, MAX_COMMAND_OUTPUT_CHARS)}\n\n...<输出已截断>`;
    }
    return combined;
  }

  private async executeWebFetch(url: string): Promise<string> {
    const parsedUrl = parseWebFetchUrl(url);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), WEB_FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(parsedUrl, {
        redirect: 'follow',
        signal: controller.signal,
        headers: {
          'User-Agent': BROWSER_USER_AGENT,
          Accept:
            'text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.5',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        },
      });
      const status = response.status;
      const finalUrl = response.url;
      const contentType = response.headers.get('content-type') ?? 'unknown';
      const raw = await response.text();
      const extracted = extractWebText(raw, contentType);
      const normalized = normalizeWebText(extracted);
      const preview = truncateChars(normalized, MAX_WEB_FETCH_OUTPUT_CHARS);
      const totalChars = [...normalized].length;
      const truncated = totalChars > MAX_WEB_FETCH_OUTPUT_CHARS;
      return `[web]\nurl: ${parsedUrl}\nfinal_url: ${finalUrl}\nstatus: ${status}\ncontent_type: ${contentType}\nuser_agent: ${BROWSER_USER_AGENT}\ncontent_chars: ${totalChars}\ntruncated: ${truncated ? 'true' : 'false'}\n\ncontent\n${preview}${truncated ? '\n\n...<网页内容已截断>' : ''}`;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async executeCreateFile(inputPath: string, content: string): Promise<string> {
    const target = this.resolveWorkspaceWriteTarget(inputPath);
    if (existsSync(target)) {
      throw new Error(`文件已存在: ${target}`);
    }
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content, 'utf8');
    return `[write]\naction: create_file\npath: ${target}\nchars: ${[...content].length}`;
  }

  private async executeEditFile(
    inputPath: string,
    oldText: string,
    newText: string,
  ): Promise<string> {
    if (!oldText.length) {
      throw new Error('edit_file 的 old_text 不能为空');
    }
    const target = this.resolveWorkspaceWriteTarget(inputPath);
    if (!existsSync(target)) {
      throw new Error(`路径不存在或无法访问: ${target}`);
    }
    const st = await lstat(target);
    if (!st.isFile()) {
      throw new Error(`目标不是文件: ${target}`);
    }

    const source = await readFile(target, 'utf8');
    const occurrences = countSubstringOccurrences(source, oldText);
    if (occurrences === 0) {
      const normalizedSource = normalizeLineEndings(source);
      const normalizedOld = normalizeLineEndings(oldText);
      const normalizedHits = countSubstringOccurrences(normalizedSource, normalizedOld);
      if (normalizedHits === 1) {
        const replaced = replaceSingleMatchAllowingNewlineDifferences(source, oldText, newText);
        if (replaced) {
          await writeFile(target, replaced.updated, 'utf8');
          return `[write]\naction: edit_file\npath: ${target}\nreplaced_once: true\nmatch_mode: normalized_newlines\nold_chars: ${[...oldText].length}\nnew_chars: ${[...newText].length}`;
        }
      }
      throw new Error(
        'edit_file 失败：old_text 未匹配到目标文件内容（详情已写入 CLI 日志，可用 /log 查看）',
      );
    }
    if (occurrences > 1) {
      throw new Error(`edit_file 失败：old_text 命中 ${occurrences} 处，请提供更精确片段（详情已写入 CLI 日志，可用 /log 查看）`);
    }

    await writeFile(target, source.replace(oldText, newText), 'utf8');
    return `[write]\naction: edit_file\npath: ${target}\nreplaced_once: true\nold_chars: ${[...oldText].length}\nnew_chars: ${[...newText].length}`;
  }

  private async executeDeleteFile(inputPath: string): Promise<string> {
    const target = this.resolveWorkspaceWriteTarget(inputPath);
    if (!existsSync(target)) {
      throw new Error(`路径不存在或无法访问: ${target}`);
    }
    const st = await lstat(target);
    if (!st.isFile()) {
      throw new Error(`目标不是文件: ${target}`);
    }
    await unlink(target);
    return `[write]\naction: delete_file\npath: ${target}`;
  }
}

async function loadPermissions(filePath: string): Promise<ToolPermissionStore> {
  if (!existsSync(filePath)) {
    return {};
  }

  try {
    const raw = await readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw) as ToolPermissionStore;
    return {
      trusted_shell_commands: parsed.trusted_shell_commands ?? [],
      trusted_external_read_paths: parsed.trusted_external_read_paths ?? [],
    };
  } catch {
    return {};
  }
}

async function savePermissions(filePath: string, store: ToolPermissionStore): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(store, null, 2), 'utf8');
}

function parseJsonObject(argumentsJson: string): HostJsonObject {
  const parsed = JSON.parse(argumentsJson) as HostJsonValue;
  if (!isJsonObject(parsed)) {
    throw new Error('工具参数必须为对象。');
  }
  return parsed;
}

function requiredString(obj: HostJsonObject, key: string): string {
  const value = obj[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`字段 ${key} 必须是非空字符串。`);
  }
  return value.trim();
}

function optionalString(obj: HostJsonObject, key: string): string | undefined {
  const value = obj[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function optionalStringStrict(obj: HostJsonObject, key: string): string | undefined {
  if (!(key in obj) || obj[key] === null) {
    return undefined;
  }
  const value = obj[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${key} 必须是非空字符串`);
  }
  return value.trim();
}

function optionalPositiveInt(obj: HostJsonObject, key: string): number | undefined {
  const value = obj[key];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`字段 ${key} 必须是整数`);
  }
  const n = Math.trunc(value);
  if (n < 1) {
    throw new Error(`字段 ${key} 必须 >= 1`);
  }
  return n;
}

function optionalBoolean(obj: HostJsonObject, key: string): boolean | undefined {
  const value = obj[key];
  return typeof value === 'boolean' ? value : undefined;
}

function optionalStringArrayStrict(obj: HostJsonObject, key: string): string[] {
  if (!(key in obj) || obj[key] === null) {
    return [];
  }
  const value = obj[key];
  if (!Array.isArray(value)) {
    throw new Error(`${key} 必须是字符串数组`);
  }
  return value.map((item, index) => {
    if (typeof item !== 'string' || item.trim().length === 0) {
      throw new Error(`${key}[${index}] 必须是非空字符串`);
    }
    return item.trim();
  });
}

function parseAskQuestionsRequest(
  obj: HostJsonObject,
): HostToolRequest<HostAskQuestionsQuestionSpec> {
  const questionsValue = obj.questions;
  if (!Array.isArray(questionsValue) || questionsValue.length === 0) {
    throw new Error('ask_questions 至少需要一个问题');
  }

  const questions = questionsValue.map((item, index) => parseQuestion(item, index));
  validateQuestions(questions);

  const title = optionalString(obj, 'title');
  return {
    name: 'ask_questions',
    ...(title ? { title } : {}),
    questions,
  };
}

function parseQuestion(value: HostJsonValue, index: number): HostAskQuestionsQuestionSpec {
  if (!isJsonObject(value)) {
    throw new Error(`questions[${index}] 必须是对象。`);
  }

  const kind = requiredString(value, 'kind');
  if (kind !== 'single_select' && kind !== 'multi_select' && kind !== 'text') {
    throw new Error(`questions[${index}].kind 非法: ${kind}`);
  }

  const optionsValue = value.options;
  const options = Array.isArray(optionsValue)
    ? optionsValue.map((option, optionIndex) => {
        if (!isJsonObject(option)) {
          throw new Error(`questions[${index}].options[${optionIndex}] 必须是对象。`);
        }
        const summary = optionalString(option, 'summary');
        const parsedOption: HostAskQuestionsOptionSpec = {
          label: requiredString(option, 'label'),
        };
        if (summary) {
          parsedOption.summary = summary;
        }
        return parsedOption;
      })
    : [];

  const customInputPlaceholder = optionalString(value, 'customInputPlaceholder');
  const customInputLabel = optionalString(value, 'customInputLabel');

  return {
    id: requiredString(value, 'id'),
    title: requiredString(value, 'title'),
    kind,
    required: optionalBoolean(value, 'required') ?? false,
    options,
    allowCustomInput: optionalBoolean(value, 'allowCustomInput') ?? false,
    ...(customInputPlaceholder ? { customInputPlaceholder } : {}),
    ...(customInputLabel ? { customInputLabel } : {}),
  };
}

function validateQuestions(questions: HostAskQuestionsQuestionSpec[]): void {
  const seenIds = new Set<string>();
  for (const question of questions) {
    const id = question.id.trim();
    if (!id) {
      throw new Error('ask_questions 问题 id 不能为空');
    }
    if (seenIds.has(id)) {
      throw new Error(`ask_questions 问题 id 不能重复: ${id}`);
    }
    seenIds.add(id);
    if (!question.title.trim()) {
      throw new Error(`ask_questions 问题标题不能为空: ${id}`);
    }

    if (question.kind === 'text') {
      if (question.options.length > 0) {
        throw new Error(`ask_questions 文本题不能包含 options: ${id}`);
      }
      continue;
    }

    if (question.options.length === 0 && !question.allowCustomInput) {
      throw new Error(`ask_questions 选择题至少需要一个预设选项或开启自定义输入: ${id}`);
    }
    for (const option of question.options) {
      if (!option.label.trim()) {
        throw new Error(`ask_questions 选项文本不能为空: ${id}`);
      }
    }
  }
}

function normalizeSearchLine(line: string): string {
  return line.replace(/\r?\n$/u, '').trim();
}

function countSubstringOccurrences(haystack: string, needle: string): number {
  if (!needle.length) {
    return 0;
  }
  let count = 0;
  let pos = 0;
  while (pos <= haystack.length - needle.length) {
    const idx = haystack.indexOf(needle, pos);
    if (idx === -1) {
      break;
    }
    count += 1;
    pos = idx + needle.length;
  }
  return count;
}

function parseWebFetchUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    throw new Error(`非法 URL: ${url}`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`web_fetch 仅支持 http/https，当前 scheme: ${parsed.protocol.replace(':', '')}`);
  }
  return parsed.toString();
}

function looksLikeHtml(raw: string): boolean {
  const prefix = raw.slice(0, 512).toLowerCase();
  return (
    prefix.includes('<html') ||
    prefix.includes('<!doctype html') ||
    prefix.includes('<body') ||
    prefix.includes('<head')
  );
}

function extractWebText(raw: string, contentType: string): string {
  const ct = contentType.toLowerCase();
  if (ct.includes('html') || looksLikeHtml(raw)) {
    return stripHtmlToApproximateText(raw);
  }
  return raw;
}

function stripHtmlToApproximateText(html: string): string {
  const noScript = html.replace(/<script[\s\S]*?<\/script>/giu, ' ');
  const noStyle = noScript.replace(/<style[\s\S]*?<\/style>/giu, ' ');
  const noTags = noStyle.replace(/<[^>]+>/gu, ' ');
  return noTags
    .replace(/&nbsp;/giu, ' ')
    .replace(/&lt;/giu, '<')
    .replace(/&gt;/giu, '>')
    .replace(/&amp;/giu, '&')
    .replace(/&quot;/giu, '"');
}

function normalizeWebText(text: string): string {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const out: string[] = [];
  let blankRun = 0;
  for (const line of normalized.split('\n')) {
    const trimmed = line.replace(/\s+$/u, '');
    if (trimmed.trim().length === 0) {
      blankRun += 1;
      if (blankRun <= 1) {
        out.push('');
      }
      continue;
    }
    blankRun = 0;
    out.push(trimmed.replace(/^\uFEFF/u, ''));
  }
  const result = out.join('\n').trim();
  return result.length === 0 ? '（网页内容为空）' : result;
}

function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function lineEndingStyle(text: string): 'none' | 'crlf' | 'lf' | 'cr' | 'mixed' {
  const hasCrlf = text.includes('\r\n');
  const normalized = text.replace(/\r\n/g, '');
  const hasLf = normalized.includes('\n');
  const hasCr = normalized.includes('\r');
  if (!hasCrlf && !hasLf && !hasCr) {
    return 'none';
  }
  if (hasCrlf && !hasLf && !hasCr) {
    return 'crlf';
  }
  if (!hasCrlf && hasLf && !hasCr) {
    return 'lf';
  }
  if (!hasCrlf && !hasLf && hasCr) {
    return 'cr';
  }
  return 'mixed';
}

function rewriteLineEndings(text: string, targetStyle: 'crlf' | 'lf' | 'cr'): string {
  const normalized = normalizeLineEndings(text);
  if (targetStyle === 'crlf') {
    return normalized.replace(/\n/g, '\r\n');
  }
  if (targetStyle === 'cr') {
    return normalized.replace(/\n/g, '\r');
  }
  return normalized;
}

function preferredLineEndingStyle(matchedSlice: string, source: string): 'crlf' | 'lf' | 'cr' {
  const matchedStyle = lineEndingStyle(matchedSlice);
  if (matchedStyle === 'crlf' || matchedStyle === 'lf' || matchedStyle === 'cr') {
    return matchedStyle;
  }
  const sourceStyle = lineEndingStyle(source);
  if (sourceStyle === 'crlf' || sourceStyle === 'cr') {
    return sourceStyle;
  }
  return 'lf';
}

function normalizedByteOffsetsToSourceByteOffsets(source: string): number[] {
  const bytes = Buffer.from(source, 'utf8');
  const mapping: number[] = [0];
  let index = 0;
  while (index < bytes.length) {
    if (bytes[index] === 0x0d && index + 1 < bytes.length && bytes[index + 1] === 0x0a) {
      mapping.push(index + 2);
      index += 2;
    } else if (bytes[index] === 0x0d) {
      mapping.push(index + 1);
      index += 1;
    } else {
      mapping.push(index + 1);
      index += 1;
    }
  }
  return mapping;
}

function replaceSingleMatchAllowingNewlineDifferences(
  source: string,
  oldText: string,
  newText: string,
): { updated: string } | undefined {
  const normalizedSource = normalizeLineEndings(source);
  const normalizedOld = normalizeLineEndings(oldText);
  const nBuf = Buffer.from(normalizedSource, 'utf8');
  const oBuf = Buffer.from(normalizedOld, 'utf8');
  const matches: number[] = [];
  if (!oBuf.length) {
    return undefined;
  }
  for (let index = 0; index <= nBuf.length - oBuf.length; index += 1) {
    if (nBuf.subarray(index, index + oBuf.length).equals(oBuf)) {
      matches.push(index);
    }
  }
  if (matches.length !== 1) {
    return undefined;
  }
  const normalizedStart = matches[0]!;
  const mapping = normalizedByteOffsetsToSourceByteOffsets(source);
  const normalizedEnd = normalizedStart + oBuf.length;
  const sourceStart = mapping[normalizedStart];
  const sourceEnd = mapping[normalizedEnd];
  if (sourceStart === undefined || sourceEnd === undefined) {
    return undefined;
  }
  const matchedBytes = Buffer.from(source, 'utf8').subarray(sourceStart, sourceEnd);
  const matchedSlice = matchedBytes.toString('utf8');
  const replacement = rewriteLineEndings(newText, preferredLineEndingStyle(matchedSlice, source));
  const prefix = Buffer.from(source, 'utf8').subarray(0, sourceStart).toString('utf8');
  const suffix = Buffer.from(source, 'utf8').subarray(sourceEnd).toString('utf8');
  return { updated: `${prefix}${replacement}${suffix}` };
}

function formatShellToolTranscript(
  shellName: string,
  workspace: string,
  command: string,
  exitCode: number,
  stdout: string,
  stderr: string,
): string {
  let s = '';
  s += `终端      ${shellName}\n`;
  s += `工作目录  ${workspace}\n`;
  s += `命令      ${command}\n`;
  s += `退出码    ${exitCode}\n`;
  s += '\n';
  s += appendShellSectionChunk('标准输出', stdout, '（无输出）');
  s += appendShellSectionChunk('标准错误', stderr, '（无输出）');
  return s;
}

function appendShellSectionChunk(title: string, body: string, emptyPlaceholder: string): string {
  let chunk = `── ${title} ──\n`;
  if (body.trim().length === 0) {
    chunk += `${emptyPlaceholder}\n\n`;
  } else {
    chunk += body;
    if (!body.endsWith('\n')) {
      chunk += '\n';
    }
    chunk += '\n';
  }
  return chunk;
}

function truncateChars(value: string, maxChars: number): string {
  const chars = [...value];
  if (chars.length <= maxChars) {
    return value;
  }
  return chars.slice(0, maxChars).join('');
}

function isJsonObject(value: HostJsonValue): value is HostJsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isWithinRoot(candidate: string, root: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function isInsideSpiritManagedUserArea(
  resolvedPath: string,
  context: InstructionDiscoveryContext,
): boolean {
  const paths = resolveInstructionPaths({
    workspaceRoot: context.workspaceRoot,
    spiritDataDir: context.spiritDataDir,
  });
  return [paths.userRuleFile, paths.planFile, paths.userSkillsDir]
    .map((allowed) => path.resolve(allowed))
    .some((allowed) => pathHasPrefix(resolvedPath, allowed));
}

function isAllowedWritePath(resolvedPath: string, context: InstructionDiscoveryContext): boolean {
  return (
    isWithinRoot(resolvedPath, path.resolve(context.workspaceRoot)) ||
    isInsideSpiritManagedUserArea(resolvedPath, context)
  );
}

function pathCompareKey(inputPath: string): string {
  let normalized = path.resolve(inputPath).replace(/\\/gu, '/');
  if (normalized.startsWith('//?/UNC/')) {
    normalized = `//${normalized.slice('//?/UNC/'.length)}`;
  } else if (normalized.startsWith('//?/')) {
    normalized = normalized.slice('//?/'.length);
  }
  return normalized.replace(/\/+$/u, '');
}

function pathHasPrefix(candidate: string, prefix: string): boolean {
  const c = pathCompareKey(candidate);
  const p = pathCompareKey(prefix);
  return c === p || c.startsWith(`${p}/`);
}