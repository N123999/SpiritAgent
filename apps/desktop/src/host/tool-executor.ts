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

import {
  buildBuiltinHostToolDefinitions,
  type BuiltinHostToolDefinitionEnvironment,
} from '@spirit-agent/agent-core';
import type {
  AskQuestionsRequest,
  AuthorizationDecision,
  JsonObject,
  JsonValue,
  McpStatusSnapshot,
  ToolExecutor,
} from '@spirit-agent/agent-core';

import type { AskQuestionsQuestionSpec } from '../types.js';
import { spiritAgentDataDir } from './storage.js';
import type { DesktopToolRequest } from './contracts.js';

const exec = promisify(execCallback);

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

export class DesktopToolExecutor
  implements ToolExecutor<DesktopToolRequest, string>
{
  constructor(private readonly workspaceRoot: string) {}

  toolDefinitionsJson(): JsonValue {
    const shell = detectShellForTools();
    const environment: BuiltinHostToolDefinitionEnvironment = {
      shellDisplayName: shell.displayName,
      shellCommandParameterDescription: shell.commandParamDescription,
    };
    return buildBuiltinHostToolDefinitions(environment);
  }

  async parseCommand(_message: string): Promise<DesktopToolRequest> {
    throw new Error('当前桌面宿主未实现手动工具命令解析。');
  }

  async requestFromFunctionCall(
    name: string,
    argumentsJson: string,
  ): Promise<DesktopToolRequest> {
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
        return {
          name,
          path: requiredString(parsed, 'path'),
          ...(optionalPositiveInt(parsed, 'start_line') !== undefined
            ? { start_line: optionalPositiveInt(parsed, 'start_line') }
            : {}),
          ...(optionalPositiveInt(parsed, 'end_line') !== undefined
            ? { end_line: optionalPositiveInt(parsed, 'end_line') }
            : {}),
        };
      case 'search_files':
        return {
          name,
          query: requiredString(parsed, 'query'),
        };
      case 'run_subagent':
        return {
          name,
          task: requiredString(parsed, 'task'),
          ...(optionalStringStrict(parsed, 'success_criteria')
            ? { success_criteria: optionalStringStrict(parsed, 'success_criteria') }
            : {}),
          ...(optionalStringStrict(parsed, 'context_summary')
            ? { context_summary: optionalStringStrict(parsed, 'context_summary') }
            : {}),
          files_to_inspect: optionalStringArrayStrict(parsed, 'files_to_inspect'),
          ...(optionalStringStrict(parsed, 'expected_output')
            ? { expected_output: optionalStringStrict(parsed, 'expected_output') }
            : {}),
        };
      case 'ask_questions':
        return {
          name,
          ...(optionalString(parsed, 'title') ? { title: optionalString(parsed, 'title') } : {}),
          questions: requiredQuestions(parsed, 'questions'),
        };
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
    request: DesktopToolRequest,
  ): Promise<AuthorizationDecision<string>> {
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
          } satisfies AskQuestionsRequest,
        };
      case 'run_shell_command': {
        const shell = detectShellForTools();
        return {
          kind: 'need-approval',
          prompt: `高风险工具调用: shell\n终端: ${shell.displayName}\n命令: ${request.command}\n\n输入 y 允许一次，n 拒绝，t 信任并持久化。`,
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
        if (this.isAllowedReadLocation(canonical)) {
          return { kind: 'allowed' };
        }
        return {
          kind: 'need-approval',
          prompt: `高风险工具调用: 遍历工作目录外目录\n路径: ${canonical}\n\n输入 y 允许一次，n 拒绝，t 信任并持久化。`,
          trustTarget: `external-read:${canonical}`,
        };
      }
      case 'read_file': {
        const canonical = await this.resolveExistingFilePath(request.path);
        if (this.isAllowedReadLocation(canonical)) {
          return { kind: 'allowed' };
        }
        return {
          kind: 'need-approval',
          prompt: `高风险工具调用: 读取工作目录外文件\n路径: ${canonical}\n\n输入 y 允许一次，n 拒绝，t 信任并持久化。`,
          trustTarget: `external-read:${canonical}`,
        };
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
      default:
        return { kind: 'allowed' };
    }
  }

  async trust(_target: string): Promise<void> {}

  async execute(request: DesktopToolRequest): Promise<string> {
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
      default:
        throw new Error(`未知工具: ${request satisfies never}`);
    }
  }

  startMcpBackgroundRefresh(): void {}

  mcpStatusSnapshot(): McpStatusSnapshot {
    return {
      revision: 0,
      state: 'idle',
      configuredServers: 0,
      loadedServers: 0,
      cachedTools: 0,
    };
  }

  async addMcpServer(_name: string, _config: JsonValue): Promise<string> {
    throw new Error('当前桌面宿主尚未实现 MCP server 管理。');
  }

  async listMcpServers(): Promise<never[]> {
    return [];
  }

  async inspectMcpServer(_name: string): Promise<never> {
    throw new Error('当前桌面宿主尚未实现 MCP server 检查。');
  }

  async listMcpTools(_name: string): Promise<never[]> {
    return [];
  }

  async listMcpResources(_name: string): Promise<never[]> {
    return [];
  }

  async readMcpResource(_name: string, _uri: string): Promise<JsonValue> {
    throw new Error('当前桌面宿主尚未实现 MCP resource 读取。');
  }

  async listCachedMcpPrompts(_name: string): Promise<never[]> {
    return [];
  }

  async listMcpPrompts(_name: string): Promise<never[]> {
    return [];
  }

  async getMcpPrompt(
    _name: string,
    _prompt: string,
    _argsJson?: string,
  ): Promise<JsonValue> {
    throw new Error('当前桌面宿主尚未实现 MCP prompt 获取。');
  }

  private isAllowedReadLocation(canonical: string): boolean {
    return (
      isWithinRoot(canonical, path.resolve(this.workspaceRoot)) ||
      isInsideSpiritManagedUserArea(canonical)
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

  /** 与 CLI `resolve_existing_path` 一致：相对路径相对工作区，路径须已存在并可 realpath。 */
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
    if (!isAllowedWritePath(joined, this.workspaceRoot)) {
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

    directories.sort((a, b) => a.localeCompare(b));
    files.sort((a, b) => a.localeCompare(b));

    let out = `[list]\npath: ${root}\ndirectories: ${directories.length}\nfiles: ${files.length}\ntruncated: ${truncated ? 'true' : 'false'}\nskipped_dirs: ${skippedDirs}\nskipped_symlinks: ${skippedSymlinks}\n\n`;

    if (directories.length === 0 && files.length === 0) {
      out += '（目录为空）';
    } else {
      if (directories.length > 0) {
        out += 'directories\n';
        for (const dir of directories) {
          out += `${dir}\n`;
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
    for (let idx = s; idx <= e; idx += 1) {
      const line = lines[idx - 1] ?? '';
      out += `${String(idx).padStart(6, ' ')} | ${line}\n`;
    }
    return out;
  }

  private async executeSearchFiles(query: string): Promise<string> {
    const needle = query.trim();
    if (!needle.length) {
      throw new Error('search query 不能为空');
    }

    const needleLower = needle.toLowerCase();
    const files = new Set<string>();
    const hits: string[] = [];
    const workspaceRoot = path.resolve(this.workspaceRoot);

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

      const rel = path.relative(workspaceRoot, filePath).replace(/\\/gu, '/');
      const relDisplay = rel || '.';
      const lines = content.split(/\r?\n/u);
      let fileMatchCount = 0;

      for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i] ?? '';
        if (!line.toLowerCase().includes(needleLower)) {
          continue;
        }
        files.add(relDisplay);
        if (hits.length < MAX_SEARCH_RESULTS && fileMatchCount < MAX_SEARCH_MATCHES_PER_FILE) {
          hits.push(
            `${relDisplay}:${i + 1} | ${truncateChars(normalizeSearchLine(line), 180)}`,
          );
        }
        fileMatchCount += 1;
        if (hits.length >= MAX_SEARCH_RESULTS) {
          return false;
        }
      }

      return hits.length < MAX_SEARCH_RESULTS;
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

    await walk(workspaceRoot);

    if (files.size === 0) {
      return `[tool] 搜索: ${query}\n未搜索到文件`;
    }

    let out = `[tool] 搜索: ${query}\n命中片段\n`;
    for (const hit of hits) {
      out += `${hit}\n`;
    }
    out += '\n涉及文件\n';
    const sortedFiles = [...files].sort((a, b) => a.localeCompare(b));
    for (const f of sortedFiles) {
      out += `${f}\n`;
    }
    return out;
  }

  private async executeShell(command: string): Promise<string> {
    const shell = detectShellForTools();
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
      code = 0;
    } catch (error: unknown) {
      const ex = error as { stdout?: string; stderr?: string; code?: number };
      stdout = ex.stdout ?? '';
      stderr = ex.stderr ?? '';
      code = typeof ex.code === 'number' ? ex.code : -1;
    }

    let combined = formatShellToolTranscript(
      shell.displayName,
      path.resolve(this.workspaceRoot),
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
    const parent = path.dirname(target);
    await mkdir(parent, { recursive: true });
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
      throw new Error(
        `edit_file 失败：old_text 命中 ${occurrences} 处，请提供更精确片段（详情已写入 CLI 日志，可用 /log 查看）`,
      );
    }

    const updated = source.replace(oldText, newText);
    await writeFile(target, updated, 'utf8');
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
  const prefix = raw
    .slice(0, 512)
    .toLowerCase();
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
  if (matchedStyle === 'none' || matchedStyle === 'mixed') {
    const sourceStyle = lineEndingStyle(source);
    if (sourceStyle === 'crlf') {
      return 'crlf';
    }
    if (sourceStyle === 'cr') {
      return 'cr';
    }
    return 'lf';
  }
  if (matchedStyle === 'crlf' || matchedStyle === 'lf' || matchedStyle === 'cr') {
    return matchedStyle;
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
  for (let i = 0; i <= nBuf.length - oBuf.length; i += 1) {
    if (nBuf.subarray(i, i + oBuf.length).equals(oBuf)) {
      matches.push(i);
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
  const preferred = preferredLineEndingStyle(matchedSlice, source);
  const replacement = rewriteLineEndings(newText, preferred);
  const prefix = Buffer.from(source, 'utf8').subarray(0, sourceStart).toString('utf8');
  const suffix = Buffer.from(source, 'utf8').subarray(sourceEnd).toString('utf8');
  return { updated: `${prefix}${replacement}${suffix}` };
}

function pathCompareKey(p: string): string {
  let normalized = path.resolve(p).replace(/\\/gu, '/');
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

function isInsideSpiritManagedUserArea(resolvedPath: string): boolean {
  const data = path.resolve(spiritAgentDataDir());
  const candidates = [
    path.resolve(data, 'rule.md'),
    path.resolve(data, 'plan.md'),
    path.resolve(data, 'skills'),
  ];
  return candidates.some((allowed) => pathHasPrefix(resolvedPath, allowed));
}

function isAllowedWritePath(resolvedPath: string, workspaceRoot: string): boolean {
  return (
    isWithinRoot(resolvedPath, path.resolve(workspaceRoot)) ||
    isInsideSpiritManagedUserArea(resolvedPath)
  );
}

function detectShellForTools(): {
  displayName: string;
  commandParamDescription: string;
} {
  if (process.platform !== 'win32') {
    const shell = process.env.SHELL ?? '/bin/sh';
    const name = path.basename(shell);
    return {
      displayName: `POSIX shell (${name})`,
      commandParamDescription: `The command to execute in POSIX shell (${name}). Prefer POSIX shell syntax such as ls, find, grep, cat, pwd, and cd.`,
    };
  }

  const comspec = (process.env.COMSPEC ?? 'cmd.exe').toLowerCase();
  if (comspec.includes('powershell') || comspec.includes('pwsh')) {
    return {
      displayName: 'Windows PowerShell',
      commandParamDescription:
        'The command to execute in Windows PowerShell. Prefer PowerShell syntax such as Get-ChildItem, Select-String, Get-Content, Set-Location, and Test-Path. Do not assume Bash-only syntax.',
    };
  }

  return {
    displayName: 'Command Prompt (cmd.exe)',
    commandParamDescription:
      'The command to execute in Command Prompt (cmd.exe). Prefer cmd.exe syntax such as dir, type, where, findstr, and cd. Do not assume Bash commands like find, ls, grep, or cat.',
  };
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

function truncateChars(value: string, maxChars: number): string {
  const chars = [...value];
  if (chars.length <= maxChars) {
    return value;
  }
  return `${chars.slice(0, maxChars).join('')}`;
}

function parseJsonObject(argumentsJson: string): JsonObject {
  const parsed = JSON.parse(argumentsJson) as JsonValue;
  if (!isJsonObject(parsed)) {
    throw new Error('工具参数必须为对象。');
  }
  return parsed;
}

function requiredString(obj: JsonObject, key: string): string {
  const value = obj[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`字段 ${key} 必须是非空字符串。`);
  }
  return value.trim();
}

function optionalString(obj: JsonObject, key: string): string | undefined {
  const value = obj[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

/** 与 CLI 一致：字段存在则必须为非空字符串。 */
function optionalStringStrict(obj: JsonObject, key: string): string | undefined {
  if (!(key in obj) || obj[key] === null) {
    return undefined;
  }
  const value = obj[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${key} 必须是非空字符串`);
  }
  return value.trim();
}

function optionalPositiveInt(obj: JsonObject, key: string): number | undefined {
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

function optionalStringArrayStrict(obj: JsonObject, key: string): string[] {
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

function requiredQuestions(obj: JsonObject, key: string): AskQuestionsQuestionSpec[] {
  const value = obj[key];
  if (!Array.isArray(value)) {
    throw new Error(`字段 ${key} 必须是数组。`);
  }

  return value.map((item, index) => parseQuestion(item, index));
}

function parseQuestion(value: JsonValue, index: number): AskQuestionsQuestionSpec {
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
        const label = requiredString(option, 'label');
        return {
          label,
          ...(optionalString(option, 'summary') ? { summary: optionalString(option, 'summary') } : {}),
        };
      })
    : [];

  return {
    id: requiredString(value, 'id'),
    title: requiredString(value, 'title'),
    kind,
    required: optionalBoolean(value, 'required') ?? false,
    options,
    allowCustomInput: optionalBoolean(value, 'allowCustomInput') ?? false,
    ...(optionalString(value, 'customInputPlaceholder')
      ? { customInputPlaceholder: optionalString(value, 'customInputPlaceholder') }
      : {}),
    ...(optionalString(value, 'customInputLabel')
      ? { customInputLabel: optionalString(value, 'customInputLabel') }
      : {}),
  };
}

function optionalBoolean(obj: JsonObject, key: string): boolean | undefined {
  const value = obj[key];
  return typeof value === 'boolean' ? value : undefined;
}

function isJsonObject(value: JsonValue): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isWithinRoot(candidate: string, root: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}
