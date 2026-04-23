import { exec as execCallback } from 'node:child_process';
import { existsSync } from 'node:fs';
import {
  mkdir,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

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
const MAX_FILE_CHARS = 16_000;
const MAX_COMMAND_OUTPUT_CHARS = 20_000;
const MAX_FETCH_OUTPUT_CHARS = 20_000;
const MAX_GREP_RESULTS = 80;
const DEFAULT_READ_END_LINE = 200;
const DEFAULT_COMMAND_TIMEOUT_MS = 20_000;
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
const IGNORED_DIRS = new Set(['.git', 'node_modules', 'target', 'dist', 'dist-electron']);

export class DesktopToolExecutor
  implements ToolExecutor<DesktopToolRequest, string>
{
  constructor(private readonly workspaceRoot: string) {}

  toolDefinitionsJson(): JsonValue {
    return [
      functionTool('list_dir', '列出目录的直接子项。path 可为工作区内相对路径或绝对路径。', {
        type: 'object',
        properties: {
          path: stringField('要列出的目录路径'),
        },
        required: ['path'],
        additionalProperties: false,
      }),
      functionTool('read_file', '读取文本文件，可指定 1-based 行号范围。', {
        type: 'object',
        properties: {
          filePath: stringField('文件路径'),
          startLine: numberField('起始行号，1-based，可选'),
          endLine: numberField('结束行号，1-based，可选'),
        },
        required: ['filePath'],
        additionalProperties: false,
      }),
      functionTool('grep_search', '在工作区文本文件中做大小写不敏感搜索。', {
        type: 'object',
        properties: {
          query: stringField('搜索字符串或正则'),
          isRegexp: booleanField('是否按正则解释 query'),
          includePattern: stringField('可选，仅搜索路径包含该片段的文件'),
          maxResults: numberField('最多返回多少条匹配'),
        },
        required: ['query'],
        additionalProperties: false,
      }),
      functionTool('run_in_terminal', '在工作区里运行一个 shell 命令。执行前需要用户审批。', {
        type: 'object',
        properties: {
          command: stringField('要执行的命令'),
          explanation: stringField('对用户展示的一句话解释，可选'),
          goal: stringField('执行目标，可选'),
          timeoutMs: numberField('超时时间，毫秒，可选'),
        },
        required: ['command'],
        additionalProperties: false,
      }),
      functionTool('create_directory', '创建目录，支持递归创建。执行前需要用户审批。', {
        type: 'object',
        properties: {
          dirPath: stringField('要创建的目录路径'),
        },
        required: ['dirPath'],
        additionalProperties: false,
      }),
      functionTool('create_file', '创建新文件；如果已存在则失败。执行前需要用户审批。', {
        type: 'object',
        properties: {
          filePath: stringField('要创建的文件路径'),
          content: stringField('文件内容'),
        },
        required: ['filePath', 'content'],
        additionalProperties: false,
      }),
      functionTool('write_file', '覆盖写入文件；如果目录不存在会自动创建。执行前需要用户审批。', {
        type: 'object',
        properties: {
          filePath: stringField('要写入的文件路径'),
          content: stringField('完整文件内容'),
        },
        required: ['filePath', 'content'],
        additionalProperties: false,
      }),
      functionTool('delete_path', '删除文件或目录。执行前需要用户审批。', {
        type: 'object',
        properties: {
          path: stringField('要删除的文件或目录路径'),
        },
        required: ['path'],
        additionalProperties: false,
      }),
      functionTool('fetch_webpage', '抓取一个网页的文本内容。', {
        type: 'object',
        properties: {
          url: stringField('目标 URL'),
          query: stringField('可选，仅提取包含该字符串的行'),
        },
        required: ['url'],
        additionalProperties: false,
      }),
      functionTool('ask_questions', '向用户发起结构化问卷。该工具不会直接执行，而是暂停等待用户回答。', {
        type: 'object',
        properties: {
          title: stringField('问卷标题，可选'),
          questions: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: stringField('问题唯一 ID'),
                title: stringField('问题标题'),
                kind: {
                  type: 'string',
                  enum: ['single_select', 'multi_select', 'text'],
                },
                required: booleanField('是否必答'),
                options: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      label: stringField('选项标题'),
                      summary: stringField('选项说明，可选'),
                    },
                    required: ['label'],
                    additionalProperties: false,
                  },
                },
                allowCustomInput: booleanField('是否允许自定义输入'),
                customInputPlaceholder: stringField('自定义输入占位文案，可选'),
                customInputLabel: stringField('自定义输入标签，可选'),
              },
              required: ['id', 'title', 'kind'],
              additionalProperties: false,
            },
          },
        },
        required: ['questions'],
        additionalProperties: false,
      }),
    ];
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
      case 'list_dir':
        return {
          name,
          path: requiredString(parsed, 'path'),
        };
      case 'read_file':
        return {
          name,
          filePath: requiredString(parsed, 'filePath'),
          ...(optionalNumber(parsed, 'startLine') !== undefined
            ? { startLine: optionalNumber(parsed, 'startLine') }
            : {}),
          ...(optionalNumber(parsed, 'endLine') !== undefined
            ? { endLine: optionalNumber(parsed, 'endLine') }
            : {}),
        };
      case 'grep_search':
        return {
          name,
          query: requiredString(parsed, 'query'),
          ...(optionalBoolean(parsed, 'isRegexp') !== undefined
            ? { isRegexp: optionalBoolean(parsed, 'isRegexp') }
            : {}),
          ...(optionalString(parsed, 'includePattern')
            ? { includePattern: optionalString(parsed, 'includePattern') }
            : {}),
          ...(optionalNumber(parsed, 'maxResults') !== undefined
            ? { maxResults: optionalNumber(parsed, 'maxResults') }
            : {}),
        };
      case 'run_in_terminal':
        return {
          name,
          command: requiredString(parsed, 'command'),
          ...(optionalString(parsed, 'explanation')
            ? { explanation: optionalString(parsed, 'explanation') }
            : {}),
          ...(optionalString(parsed, 'goal')
            ? { goal: optionalString(parsed, 'goal') }
            : {}),
          ...(optionalNumber(parsed, 'timeoutMs') !== undefined
            ? { timeoutMs: optionalNumber(parsed, 'timeoutMs') }
            : {}),
        };
      case 'create_directory':
        return {
          name,
          dirPath: requiredString(parsed, 'dirPath'),
        };
      case 'create_file':
        return {
          name,
          filePath: requiredString(parsed, 'filePath'),
          content: requiredString(parsed, 'content'),
        };
      case 'write_file':
        return {
          name,
          filePath: requiredString(parsed, 'filePath'),
          content: requiredString(parsed, 'content'),
        };
      case 'delete_path':
        return {
          name,
          path: requiredString(parsed, 'path'),
        };
      case 'fetch_webpage':
        return {
          name,
          url: requiredString(parsed, 'url'),
          ...(optionalString(parsed, 'query') ? { query: optionalString(parsed, 'query') } : {}),
        };
      case 'ask_questions':
        return {
          name,
          ...(optionalString(parsed, 'title') ? { title: optionalString(parsed, 'title') } : {}),
          questions: requiredQuestions(parsed, 'questions'),
        };
      default:
        throw new Error(`未知工具: ${name}`);
    }
  }

  async authorize(
    request: DesktopToolRequest,
  ): Promise<AuthorizationDecision<string>> {
    switch (request.name) {
      case 'list_dir':
      case 'read_file':
      case 'grep_search':
      case 'fetch_webpage':
        return { kind: 'allowed' };
      case 'ask_questions':
        return {
          kind: 'need-questions',
          questions: {
            ...(request.title ? { title: request.title } : {}),
            questions: request.questions,
          } satisfies AskQuestionsRequest,
        };
      case 'run_in_terminal':
        return {
          kind: 'need-approval',
          prompt: `执行命令需要确认：${request.command}`,
          trustTarget: 'run_in_terminal',
        };
      case 'create_directory':
        return {
          kind: 'need-approval',
          prompt: `创建目录需要确认：${request.dirPath}`,
          trustTarget: 'filesystem-write',
        };
      case 'create_file':
      case 'write_file':
        return {
          kind: 'need-approval',
          prompt: `写入文件需要确认：${request.filePath}`,
          trustTarget: 'filesystem-write',
        };
      case 'delete_path':
        return {
          kind: 'need-approval',
          prompt: `删除路径需要确认：${request.path}`,
          trustTarget: 'filesystem-delete',
        };
      default:
        return { kind: 'allowed' };
    }
  }

  async trust(_target: string): Promise<void> {}

  async execute(request: DesktopToolRequest): Promise<string> {
    switch (request.name) {
      case 'list_dir':
        return this.listDir(request.path);
      case 'read_file':
        return this.readFile(request.filePath, request.startLine, request.endLine);
      case 'grep_search':
        return this.grepSearch(
          request.query,
          request.isRegexp === true,
          request.includePattern,
          request.maxResults,
        );
      case 'run_in_terminal':
        return this.runInTerminal(request.command, request.timeoutMs);
      case 'create_directory':
        return this.createDirectory(request.dirPath);
      case 'create_file':
        return this.createFile(request.filePath, request.content);
      case 'write_file':
        return this.writeExistingFile(request.filePath, request.content);
      case 'delete_path':
        return this.deletePath(request.path);
      case 'fetch_webpage':
        return this.fetchWebpage(request.url, request.query);
      case 'ask_questions':
        throw new Error('ask_questions 由运行时暂停处理，不应直接执行。');
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

  private async listDir(inputPath: string): Promise<string> {
    const target = this.resolveAllowedPath(inputPath);
    const entries = await readdir(target, { withFileTypes: true });
    const sorted = entries
      .map((entry) => `${entry.name}${entry.isDirectory() ? '/' : ''}`)
      .sort((left, right) => left.localeCompare(right));

    return safeJson({
      path: target,
      entries: sorted,
    });
  }

  private async readFile(
    inputPath: string,
    startLine?: number,
    endLine?: number,
  ): Promise<string> {
    const target = this.resolveAllowedPath(inputPath);
    const content = await readFile(target, 'utf8');
    const lines = content.split(/\r?\n/u);
    const normalizedStart = Math.max(1, Math.floor(startLine ?? 1));
    const normalizedEnd = Math.max(
      normalizedStart,
      Math.floor(endLine ?? Math.min(lines.length, DEFAULT_READ_END_LINE)),
    );
    const selected = lines.slice(normalizedStart - 1, normalizedEnd);
    const joined = selected.join('\n');

    return safeJson({
      filePath: target,
      startLine: normalizedStart,
      endLine: normalizedStart + selected.length - 1,
      truncated: Array.from(joined).length > MAX_FILE_CHARS,
      content: truncateText(joined, MAX_FILE_CHARS),
    });
  }

  private async grepSearch(
    query: string,
    isRegexp: boolean,
    includePattern?: string,
    maxResults?: number,
  ): Promise<string> {
    const matcher = isRegexp
      ? new RegExp(query, 'iu')
      : undefined;
    const results: Array<{ path: string; line: number; text: string }> = [];
    const limit = Math.max(1, Math.min(maxResults ?? 40, MAX_GREP_RESULTS));
    await this.walkDirectory(this.workspaceRoot, async (filePath) => {
      if (results.length >= limit) {
        return false;
      }
      const normalized = filePath.replace(/\\/gu, '/');
      if (includePattern && !normalized.toLowerCase().includes(includePattern.toLowerCase())) {
        return true;
      }
      const ext = path.extname(filePath).toLowerCase();
      if (BINARY_EXTENSIONS.has(ext)) {
        return true;
      }

      let content: string;
      try {
        content = await readFile(filePath, 'utf8');
      } catch {
        return true;
      }

      const lines = content.split(/\r?\n/u);
      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index] ?? '';
        const matched = matcher
          ? matcher.test(line)
          : line.toLowerCase().includes(query.toLowerCase());
        if (!matched) {
          if (matcher) {
            matcher.lastIndex = 0;
          }
          continue;
        }

        results.push({
          path: filePath,
          line: index + 1,
          text: truncateText(line, 240),
        });
        if (matcher) {
          matcher.lastIndex = 0;
        }
        if (results.length >= limit) {
          break;
        }
      }

      return results.length < limit;
    });

    return safeJson({
      query,
      isRegexp,
      count: results.length,
      results,
    });
  }

  private async runInTerminal(command: string, timeoutMs?: number): Promise<string> {
    const result = await exec(command, {
      cwd: this.workspaceRoot,
      timeout: Math.max(1, Math.floor(timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS)),
      maxBuffer: 8 * 1024 * 1024,
      windowsHide: true,
    });

    return safeJson({
      command,
      stdout: truncateText(result.stdout ?? '', MAX_COMMAND_OUTPUT_CHARS),
      stderr: truncateText(result.stderr ?? '', MAX_COMMAND_OUTPUT_CHARS),
    });
  }

  private async createDirectory(dirPath: string): Promise<string> {
    const target = this.resolveAllowedPath(dirPath, true);
    await mkdir(target, { recursive: true });
    return safeJson({ created: true, dirPath: target });
  }

  private async createFile(filePath: string, content: string): Promise<string> {
    const target = this.resolveAllowedPath(filePath, true);
    if (existsSync(target)) {
      throw new Error(`文件已存在: ${target}`);
    }
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content, 'utf8');
    return safeJson({ created: true, filePath: target, bytes: Buffer.byteLength(content) });
  }

  private async writeExistingFile(filePath: string, content: string): Promise<string> {
    const target = this.resolveAllowedPath(filePath, true);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content, 'utf8');
    return safeJson({ written: true, filePath: target, bytes: Buffer.byteLength(content) });
  }

  private async deletePath(inputPath: string): Promise<string> {
    const target = this.resolveAllowedPath(inputPath);
    await rm(target, { recursive: true, force: true });
    return safeJson({ deleted: true, path: target });
  }

  private async fetchWebpage(url: string, query?: string): Promise<string> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`抓取失败: ${response.status} ${response.statusText}`);
    }

    const text = await response.text();
    const trimmed = query?.trim();
    const content = trimmed
      ? text
          .split(/\r?\n/u)
          .filter((line) => line.toLowerCase().includes(trimmed.toLowerCase()))
          .join('\n')
      : text;

    return safeJson({
      url,
      query: trimmed || undefined,
      content: truncateText(content, MAX_FETCH_OUTPUT_CHARS),
      truncated: Array.from(content).length > MAX_FETCH_OUTPUT_CHARS,
    });
  }

  private resolveAllowedPath(inputPath: string, allowMissing = false): string {
    const candidate = inputPath.trim();
    if (!candidate) {
      throw new Error('路径不能为空');
    }

    const base = path.isAbsolute(candidate)
      ? path.resolve(candidate)
      : path.resolve(this.workspaceRoot, candidate);
    const normalized = path.resolve(base);
    const workspaceRoot = path.resolve(this.workspaceRoot);
    const appDataRoot = path.resolve(spiritAgentDataDir());
    const insideWorkspace = isWithinRoot(normalized, workspaceRoot);
    const insideAppData = isWithinRoot(normalized, appDataRoot);

    if (!insideWorkspace && !insideAppData) {
      throw new Error(`不支持访问工作区外路径: ${candidate}`);
    }

    if (!allowMissing && !existsSync(normalized)) {
      throw new Error(`路径不存在: ${normalized}`);
    }

    return normalized;
  }

  private async walkDirectory(
    root: string,
    visit: (filePath: string) => Promise<boolean>,
  ): Promise<boolean> {
    const entries = await readdir(root, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(root, entry.name);
      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name)) {
          continue;
        }
        const shouldContinue = await this.walkDirectory(fullPath, visit);
        if (!shouldContinue) {
          return false;
        }
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      const info = await stat(fullPath);
      if (info.size > 1024 * 1024) {
        continue;
      }
      const shouldContinue = await visit(fullPath);
      if (!shouldContinue) {
        return false;
      }
    }

    return true;
  }
}

function functionTool(name: string, description: string, parameters: JsonObject): JsonValue {
  return {
    type: 'function',
    function: {
      name,
      description,
      parameters,
    },
  };
}

function stringField(description: string): JsonObject {
  return { type: 'string', description };
}

function numberField(description: string): JsonObject {
  return { type: 'number', description };
}

function booleanField(description: string): JsonObject {
  return { type: 'boolean', description };
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
  return value;
}

function optionalString(obj: JsonObject, key: string): string | undefined {
  const value = obj[key];
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function optionalNumber(obj: JsonObject, key: string): number | undefined {
  const value = obj[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function optionalBoolean(obj: JsonObject, key: string): boolean | undefined {
  const value = obj[key];
  return typeof value === 'boolean' ? value : undefined;
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

function isJsonObject(value: JsonValue): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function safeJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function truncateText(value: string, maxChars: number): string {
  const chars = Array.from(value);
  if (chars.length <= maxChars) {
    return value;
  }
  return `${chars.slice(0, maxChars).join('')}...<truncated>`;
}

function isWithinRoot(candidate: string, root: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}