import { randomUUID } from 'node:crypto';
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
import { release as osRelease } from 'node:os';
import path from 'node:path';

import { glob as globPaths } from 'glob';

import {
  APPLY_PATCH_HOST_TOOL_NAME,
  throwUnknownToolError,
  toolNamesFromDefinitions,
  type JsonValue,
} from '@spirit-agent/core';

import { applyDiff } from './apply-diff.js';
import {
  formatGrepToolOutput,
  runRipgrepSearch,
} from './ripgrep-search.js';
import { resolveCompactionArchivesDir } from './compaction-archive.js';
import {
  defaultShellForPty,
  commandParameterDescriptionForResolvedShell,
  shellDisplayNameForResolvedShell,
} from './default-terminal-shell.js';
import { runShell } from './shell-execution.js';
import { resolveToolOutputArchivesDir } from './tool-output-archive.js';
import {
  readHostFileSnapshot,
  type HostFileChangeKind,
  type HostFileChangeObserver,
  type HostFileChangeRequestSummary,
  type HostRecordedFileChange,
  type HostToolRequestMetadata,
} from './file-rewind.js';
import {
  type HostExtensionManager,
  type HostExtensionToolApprovalMode,
  type HostExtensionToolExecutionMode,
} from './extensions.js';
import {
  CREATE_AUTOMATION_TOOL_NAME,
  deriveAutomationTitle,
  formatCreateAutomationApprovalLabel,
  parseCreateAutomationApprovalLevel,
  parseCreateAutomationTriggerInput,
} from './automation-host-tool.js';
import {
  createHostAutomationStore,
  formatTriggerLabel,
  type HostAutomationDefinition,
  type HostAutomationTrigger,
} from './automations.js';
import type { ModelReasoningEffort } from './reasoning-effort.js';
import { resolveInstructionPaths, type InstructionDiscoveryContext } from './storage.js';
import { isPathUnderPlansDir, resolvePlanFilePath } from './plans.js';
import {
  createHostDreamStore,
  type HostDreamScope,
  type HostDreamStore,
  type HostDreamSourceSessionRef,
} from './dreams.js';
import {
  createHostTodoStore,
  type HostTodoItem,
  type HostTodoScope,
  type HostTodoStore,
} from './todos.js';
import { detectSupportedImageFile, hasSupportedImageExtension } from './image-file-support.js';
import {
  GENERATED_IMAGES_DIR,
  GENERATED_VIDEOS_DIR,
  generatedDirForKind,
  generatedImageMarkdownRef,
  generatedVideoMarkdownRef,
  parseManagedGeneratedAssetReference,
} from './managed-generated-asset.js';
import { detectSupportedVideoFile, hasSupportedVideoExtension } from './video-file-support.js';
import { filterWorkspaceFilePathsByIgnore } from './workspace-ignore.js';
import {
  buildShellToolResult,
  serializeShellToolResult,
} from '@spirit-agent/core';
import {
  convertFetchedPageToToolText,
  WEB_FETCH_ACCEPT_HEADER,
  WEB_FETCH_TIMEOUT_MS,
  WEB_FETCH_USER_AGENT,
} from './web-fetch/index.js';
import { normalizeMimeType } from './web-fetch/resolve-url.js';

const PERMISSIONS_FILE = 'tool-permissions.json';
const MAX_READ_LINES_DEFAULT = 200;
const WEB_FETCH_IMAGE_CACHE_DIR = 'tool-web-fetch-images';
const WEB_FETCH_IMAGE_RETENTION_MS = 24 * 60 * 60 * 1000;
const WEB_FETCH_IMAGE_CACHE_MAX_FILES = 128;

const SEARCH_IGNORE_DIR_NAMES = new Set(['.git', 'target', 'node_modules']);

export type HostJsonPrimitive = string | number | boolean | null;
export type HostJsonValue = HostJsonPrimitive | HostJsonObject | HostJsonValue[];

export interface HostJsonObject {
  [key: string]: HostJsonValue;
}

export interface HostToolTextContentPart {
  type: 'text';
  text: string;
}

export interface HostToolImageContentPart {
  type: 'image';
  path: string;
}

export interface HostToolVideoContentPart {
  type: 'video';
  path: string;
}

export type HostToolContentPart =
  | HostToolTextContentPart
  | HostToolImageContentPart
  | HostToolVideoContentPart;

export interface HostToolModelCapabilities {
  imageInput?: true;
  audioInput?: true;
  videoInput?: true;
}

export interface HostToolModelCompatibilityProfile {
  hasExplicitCapabilities: boolean;
  capabilities: HostToolModelCapabilities;
}

export interface HostToolExecutionOutput {
  content: HostToolContentPart[];
  summaryText: string;
}

export interface HostGeneratedImageSaveRequest {
  data: Uint8Array;
  mediaType: string;
  prompt: string;
  model: string;
}

export interface HostGeneratedImageFile {
  path: string;
  mimeType: string;
  markdownRef: string;
}

export interface HostGeneratedVideoSaveRequest {
  data: Uint8Array;
  mediaType: string;
  prompt: string;
  model: string;
}

export interface HostGeneratedVideoFile {
  path: string;
  mimeType: string;
  markdownRef: string;
}

interface ResolvedReadFileTarget {
  canonicalPath: string;
  displayPath: string;
  managed: boolean;
}

export interface HostBuiltinToolDefinitionEnvironment {
  shellDisplayName: string;
  commandParameterDescription: string;
}

export interface HostOperatingSystemInfo {
  name: string;
  version: string;
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
  worktree?: boolean;
}

export type ApplyPatchOperationType = 'create_file' | 'update_file' | 'delete_file';

export interface ApplyPatchOperation {
  type: ApplyPatchOperationType;
  path: string;
  diff?: string;
}

export type HostToolRequest<QuestionSpec = HostAskQuestionsQuestionSpec> =
  | { name: 'finish_task'; summary?: string }
  | { name: 'shell'; command: string; reason: string }
  | { name: 'web_fetch'; url: string }
  | { name: 'list_directory_files'; path: string }
  | { name: 'glob'; pattern: string }
  | {
      name: 'read_file';
      path: string;
      offset?: number;
      limit?: number;
    }
  | { name: 'grep'; query: string; is_regexp?: boolean; glob?: string }
  | {
      name: 'run_subagent';
      task: string;
      success_criteria?: string;
      context_summary?: string;
      files_to_inspect: string[];
      expected_output?: string;
      worktree?: boolean;
    }
  | {
      name: 'generate_image';
      prompt: string;
      size?: string;
    }
  | {
      name: 'generate_video';
      prompt: string;
      duration?: number;
      aspect_ratio?: string;
      resolution?: string;
    }
  | {
      name: 'ask_questions';
      title?: string;
      questions: QuestionSpec[];
    }
  | {
      name: 'extension_tool';
      extension_id: string;
      tool_name: string;
      arguments: HostJsonObject;
      approval_mode?: HostExtensionToolApprovalMode;
      execution_mode?: HostExtensionToolExecutionMode;
      questions_result?: HostJsonValue;
    }
  | { name: 'create_file'; path: string; content: string }
  | { name: 'create_plan'; plan_name: string; content: string }
  | { name: 'edit_file'; path: string; old_text: string; new_text: string }
  | { name: 'delete_file'; path: string }
  | { name: typeof APPLY_PATCH_HOST_TOOL_NAME; operation: ApplyPatchOperation }
  | { name: 'dream_list'; include_deleted: boolean; include_expired: boolean }
  | { name: 'dream_read'; id: string }
  | { name: 'dream_record'; title: string; summary: string; details?: string; tags: string[] }
  | { name: 'dream_update'; id: string; title?: string; summary?: string; details?: string; tags?: string[] }
  | { name: 'dream_delete'; id: string; reason: string }
  | { name: 'todo_list'; include_completed: boolean }
  | { name: 'todo_write'; todos: HostTodoItem[] }
  | {
      name: typeof CREATE_AUTOMATION_TOOL_NAME;
      title: string;
      overview: string;
      trigger: HostAutomationTrigger;
      approval_level: ApprovalLevel;
    };

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

function createHostToolTextOutput(text: string): HostToolExecutionOutput {
  return createHostToolOutput(text);
}

function createHostToolOutput(
  summaryText: string,
  extraContent: HostToolContentPart[] = [],
): HostToolExecutionOutput {
  return {
    content: [
      ...(summaryText.length > 0 ? [{ type: 'text', text: summaryText } satisfies HostToolTextContentPart] : []),
      ...extraContent,
    ],
    summaryText,
  };
}

export interface HostBuiltinToolService<QuestionSpec = HostAskQuestionsQuestionSpec> {
  toolDefinitionEnvironment(): HostBuiltinToolDefinitionEnvironment;
  operatingSystemInfo(): HostOperatingSystemInfo;
  parseCommand(message: string): Promise<HostToolRequest<QuestionSpec>>;
  requestFromFunctionCall(name: string, argumentsJson: string): Promise<HostToolRequest<QuestionSpec>>;
  authorize(request: HostToolRequest<QuestionSpec>): Promise<HostAuthorizationDecision<QuestionSpec>>;
  trust(target: string): Promise<void>;
  execute(request: HostToolRequest<QuestionSpec>): Promise<HostToolExecutionOutput | string>;
  attachRequestMetadata?(
    request: HostToolRequest<QuestionSpec>,
    metadata: HostToolRequestMetadata,
  ): HostToolRequest<QuestionSpec>;
  shouldExecuteInBackground?(request: HostToolRequest<QuestionSpec>): boolean;
  backgroundStatusText?(request: HostToolRequest<QuestionSpec>): string | undefined;
  abortRunningShell?(): void;
  abortShell?(toolCallId: string): boolean;
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

export type HostFileToolRequest<QuestionSpec = HostAskQuestionsQuestionSpec> = Extract<
  HostToolRequest<QuestionSpec>,
  { name: 'create_file' | 'create_plan' | 'edit_file' | 'delete_file' }
>;

export type HostWritableFileToolRequest<QuestionSpec = HostAskQuestionsQuestionSpec> =
  | HostFileToolRequest<QuestionSpec>
  | Extract<HostToolRequest<QuestionSpec>, { name: typeof APPLY_PATCH_HOST_TOOL_NAME }>;

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

export interface HostExtensionRuntimeBinding<THostApi> {
  manager: HostExtensionManager;
  getHost(): THostApi;
  logger?: Pick<Console, 'error' | 'log'>;
}

export type ApprovalLevel = 'default' | 'full-approval';

export function normalizeApprovalLevel(value: unknown): ApprovalLevel {
  if (value === 'full-approval' || value === 'full-access') {
    return 'full-approval';
  }
  return 'default';
}

export interface HostAutomationCreateDefaults {
  workspaceRoot: string;
  modelName: string;
  reasoningEffort?: ModelReasoningEffort;
}

export interface NodeHostToolServiceOptions {
  mcp?: HostMcpAdapter;
  fileChangeObserver?: HostFileChangeObserver;
  extensions?: HostExtensionRuntimeBinding<unknown>;
  dreamScope?: HostDreamScope;
  dreamSourceSession?: HostDreamSourceSessionRef;
  todoScope?: HostTodoScope;
  getModelCompatibilityProfile?: () => HostToolModelCompatibilityProfile | undefined;
  getApprovalLevel?: () => ApprovalLevel;
  getAutomationCreateDefaults?: () => HostAutomationCreateDefaults;
  onAutomationCreated?: (definition: HostAutomationDefinition) => void;
  /** Full tool list exposed to the model (builtin + extension + MCP). Used for unknown-tool errors. */
  availableToolDefinitions?: () => JsonValue;
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
      commandParameterDescription: `The command to execute in POSIX shell (${name}). Prefer POSIX shell syntax such as ls, find, grep, cat, pwd, and cd.`,
    };
  }

  const { file } = defaultShellForPty();
  return {
    shellDisplayName: shellDisplayNameForResolvedShell(file),
    commandParameterDescription: commandParameterDescriptionForResolvedShell(file),
  };
}

export function detectOperatingSystemInfo(): HostOperatingSystemInfo {
  const name = process.platform === 'win32'
    ? 'Windows'
    : process.platform === 'darwin'
      ? 'macOS'
      : process.platform === 'linux'
        ? 'Linux'
        : process.platform;
  return {
    name,
    version: osRelease(),
  };
}

export class NodeHostToolService<QuestionSpec = HostAskQuestionsQuestionSpec>
  implements HostBuiltinToolService<QuestionSpec>
{
  private readonly workspaceRoot: string;
  private readonly spiritDataDir: string;
  private readonly permissionStorePath: string;
  private readonly mcp: HostMcpAdapter;
  private readonly fileChangeObserver: HostFileChangeObserver | undefined;
  private readonly extensions: HostExtensionRuntimeBinding<unknown> | undefined;
  private readonly dreamStore: HostDreamStore | undefined;
  private readonly dreamSourceSession: HostDreamSourceSessionRef | undefined;
  private todoStore: HostTodoStore | undefined;
  private permissionsPromise: Promise<ToolPermissionStore> | undefined;
  private readonly requestMetadata = new WeakMap<object, HostToolRequestMetadata>();
  private readonly activeShellKills = new Map<string, () => void>();
  private availableToolDefinitions: (() => JsonValue) | undefined;

  constructor(
    private readonly context: InstructionDiscoveryContext,
    options: NodeHostToolServiceOptions = {},
  ) {
    this.workspaceRoot = path.resolve(context.workspaceRoot);
    this.spiritDataDir = path.resolve(context.spiritDataDir);
    this.permissionStorePath = path.join(this.spiritDataDir, PERMISSIONS_FILE);
    this.mcp = options.mcp ?? createNoopMcpAdapter();
    this.fileChangeObserver = options.fileChangeObserver;
    this.extensions = options.extensions;
    this.dreamStore = options.dreamScope
      ? createHostDreamStore({ spiritDataDir: this.spiritDataDir, scope: options.dreamScope })
      : undefined;
    this.dreamSourceSession = options.dreamSourceSession;
    this.todoStore = options.todoScope
      ? createHostTodoStore({ spiritDataDir: this.spiritDataDir, scope: options.todoScope })
      : undefined;
    this.getModelCompatibilityProfile = options.getModelCompatibilityProfile;
    this.getApprovalLevel = options.getApprovalLevel;
    this.getAutomationCreateDefaults = options.getAutomationCreateDefaults;
    this.onAutomationCreated = options.onAutomationCreated;
    this.availableToolDefinitions = options.availableToolDefinitions;
  }

  private readonly getModelCompatibilityProfile:
    | (() => HostToolModelCompatibilityProfile | undefined)
    | undefined;

  private readonly getApprovalLevel: (() => ApprovalLevel) | undefined;

  private readonly getAutomationCreateDefaults: (() => HostAutomationCreateDefaults) | undefined;

  private readonly onAutomationCreated: ((definition: HostAutomationDefinition) => void) | undefined;

  bindAvailableToolDefinitions(provider: () => JsonValue): void {
    this.availableToolDefinitions = provider;
  }

  setTodoScope(todoScope: HostTodoScope | undefined): void {
    this.todoStore = todoScope
      ? createHostTodoStore({ spiritDataDir: this.spiritDataDir, scope: todoScope })
      : undefined;
  }

  toolDefinitionEnvironment(): HostBuiltinToolDefinitionEnvironment {
    return detectShellForTools();
  }

  operatingSystemInfo(): HostOperatingSystemInfo {
    return detectOperatingSystemInfo();
  }

  async parseCommand(message: string): Promise<HostToolRequest<QuestionSpec>> {
    const raw = message.startsWith('/tool') ? message.slice('/tool'.length).trim() : '';
    if (!raw) {
      throw new Error(
        '用法:\n/tool shell <command>\n/tool web <url>\n/tool list <absolute-dir>\n/tool glob <pattern>\n/tool read <path> [start] [end]\n/tool search <query>',
      );
    }

    const tokens = tokenize(raw);
    const subcommand = tokens[0];
    if (!subcommand) {
      throw new Error('缺少子命令');
    }

    switch (subcommand) {
      case 'shell': {
        const command = raw.slice('shell'.length).trim();
        if (!command) {
          throw new Error('用法: /tool shell <command>');
        }
        return {
          name: 'shell',
          command,
          reason: '用户手动执行',
        };
      }
      case 'web':
        if (tokens.length < 2) {
          throw new Error('用法: /tool web <url>');
        }
        return { name: 'web_fetch', url: tokens[1]! };
      case 'list':
        if (tokens.length < 2) {
          throw new Error('用法: /tool list <absolute-dir>');
        }
        return { name: 'list_directory_files', path: tokens[1]! };
      case 'glob': {
        const pattern = raw.slice('glob'.length).trim();
        if (!pattern) {
          throw new Error('用法: /tool glob <pattern>');
        }
        return { name: 'glob', pattern };
      }
      case 'read': {
        if (tokens.length < 2) {
          throw new Error('用法: /tool read <path> [offset] [limit]');
        }
        const offset = parseOptionalManualLine(tokens[2], 'offset');
        const limit = parseOptionalManualLine(tokens[3], 'limit');
        return {
          name: 'read_file',
          path: tokens[1]!,
          ...(offset !== undefined ? { offset } : {}),
          ...(limit !== undefined ? { limit } : {}),
        };
      }
      case 'search': {
        const searchInput = raw.slice('search'.length).trim();
        const usesRegexp = searchInput.startsWith('--regexp ') || searchInput.startsWith('--regex ');
        const query = usesRegexp
          ? searchInput.replace(/^--regex(p)?\s+/u, '').trim()
          : searchInput;
        if (!query) {
          throw new Error('用法: /tool search [--regexp] <query>');
        }
        return {
          name: 'grep',
          query,
          ...(usesRegexp ? { is_regexp: true } : {}),
        };
      }
      default:
        throw new Error(`未知 /tool 子命令: ${subcommand}\n可用: shell | web | list | glob | read | search`);
    }
  }

  async requestFromFunctionCall(
    name: string,
    argumentsJson: string,
  ): Promise<HostToolRequest<QuestionSpec>> {
    const parsed = parseJsonObject(argumentsJson);

    switch (name) {
      case 'finish_task':
        {
          const summary = optionalStringStrict(parsed, 'summary');
          return {
            name,
            ...(summary ? { summary } : {}),
          };
        }
      case 'shell':
        return {
          name,
          reason: requiredString(parsed, 'reason'),
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
      case 'glob':
        return {
          name,
          pattern: requiredString(parsed, 'pattern'),
        };
      case 'read_file':
        {
          const offset = optionalPositiveInt(parsed, 'offset');
          const limit = optionalPositiveInt(parsed, 'limit');
        return {
          name,
          path: requiredString(parsed, 'path'),
          ...(offset !== undefined ? { offset } : {}),
          ...(limit !== undefined ? { limit } : {}),
        };
        }
      case 'grep':
        {
          const isRegexp = optionalBoolean(parsed, 'is_regexp');
          const glob = optionalStringStrict(parsed, 'glob');
          return {
            name,
            query: requiredString(parsed, 'query'),
            ...(isRegexp !== undefined ? { is_regexp: isRegexp } : {}),
            ...(glob ? { glob } : {}),
          };
        }
      case 'run_subagent':
        {
          const successCriteria = optionalStringStrict(parsed, 'success_criteria');
          const contextSummary = optionalStringStrict(parsed, 'context_summary');
          const expectedOutput = optionalStringStrict(parsed, 'expected_output');
          const worktree = optionalBoolean(parsed, 'worktree');
        return {
          name,
          task: requiredString(parsed, 'task'),
          ...(successCriteria ? { success_criteria: successCriteria } : {}),
          ...(contextSummary ? { context_summary: contextSummary } : {}),
          files_to_inspect: optionalStringArrayStrict(parsed, 'files_to_inspect'),
          ...(expectedOutput ? { expected_output: expectedOutput } : {}),
          ...(worktree === true ? { worktree: true } : {}),
        };
        }
      case 'generate_image':
        {
          const size = optionalStringStrict(parsed, 'size');
        return {
          name,
          prompt: requiredString(parsed, 'prompt'),
          ...(size ? { size } : {}),
        };
        }
      case 'generate_video':
        {
          const duration = optionalPositiveInt(parsed, 'duration');
          const aspectRatio = optionalStringStrict(parsed, 'aspect_ratio');
          const resolution = optionalStringStrict(parsed, 'resolution');
        return {
          name,
          prompt: requiredString(parsed, 'prompt'),
          ...(duration !== undefined ? { duration } : {}),
          ...(aspectRatio ? { aspect_ratio: aspectRatio } : {}),
          ...(resolution ? { resolution } : {}),
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
      case 'create_plan':
        return {
          name,
          plan_name: requiredString(parsed, 'name'),
          content: requiredString(parsed, 'content'),
        };
      case CREATE_AUTOMATION_TOOL_NAME: {
        const overview = requiredString(parsed, 'overview');
        const explicitTitle = optionalStringStrict(parsed, 'title');
        return {
          name: CREATE_AUTOMATION_TOOL_NAME,
          title: deriveAutomationTitle(overview, explicitTitle),
          overview,
          trigger: parseCreateAutomationTriggerInput(parsed),
          approval_level: parseCreateAutomationApprovalLevel(parsed.approval_level),
        };
      }
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
      case APPLY_PATCH_HOST_TOOL_NAME:
        return {
          name: APPLY_PATCH_HOST_TOOL_NAME,
          operation: parseApplyPatchOperation(parsed),
        };
      case 'dream_list':
        return {
          name,
          include_deleted: optionalBoolean(parsed, 'include_deleted') ?? false,
          include_expired: optionalBoolean(parsed, 'include_expired') ?? false,
        };
      case 'dream_read':
        return {
          name,
          id: requiredString(parsed, 'id'),
        };
      case 'dream_record':
        {
          const details = optionalStringStrict(parsed, 'details');
        return {
          name,
          title: requiredString(parsed, 'title'),
          summary: requiredString(parsed, 'summary'),
          ...(details ? { details } : {}),
          tags: optionalStringArrayStrict(parsed, 'tags'),
        };
        }
      case 'dream_update':
        {
          const title = optionalStringStrict(parsed, 'title');
          const summary = optionalStringStrict(parsed, 'summary');
          const details = optionalStringStrict(parsed, 'details');
          const tags = optionalStringArrayPatch(parsed, 'tags');
        return {
          name,
          id: requiredString(parsed, 'id'),
          ...(title ? { title } : {}),
          ...(summary ? { summary } : {}),
          ...(details ? { details } : {}),
          ...(tags !== undefined ? { tags } : {}),
        };
        }
      case 'dream_delete':
        return {
          name,
          id: requiredString(parsed, 'id'),
          reason: requiredString(parsed, 'reason'),
        };
      case 'todo_list':
        return {
          name,
          include_completed: optionalBoolean(parsed, 'include_completed') ?? true,
        };
      case 'todo_write':
        return {
          name,
          todos: parseTodoWriteItems(parsed),
        };
      default:
        {
          const extensionTool = await this.resolveExtensionToolRequest(name, parsed);
          if (extensionTool) {
            return extensionTool;
          }
        }
        throwUnknownToolError(name, toolNamesFromDefinitions(this.resolveAvailableToolDefinitions()));
    }
  }

  async authorize(
    request: HostToolRequest<QuestionSpec>,
  ): Promise<HostAuthorizationDecision<QuestionSpec>> {
    const isExtensionQuestions =
      request.name === 'extension_tool' && request.approval_mode === 'need-questions';
    const bypassHighRiskApproval =
      this.getApprovalLevel?.() === 'full-approval'
      && request.name !== 'ask_questions'
      && !isExtensionQuestions;
    if (bypassHighRiskApproval) {
      return { kind: 'allowed' };
    }

    switch (request.name) {
      case 'finish_task':
      case 'glob':
      case 'grep':
      case 'run_subagent':
      case 'generate_image':
      case 'generate_video':
        return { kind: 'allowed' };
      case 'ask_questions':
        return {
          kind: 'need-questions',
          questions: {
            ...(request.title ? { title: request.title } : {}),
            questions: request.questions,
          },
        };
      case 'extension_tool':
        if (request.approval_mode === 'need-questions') {
          if (request.questions_result !== undefined) {
            return { kind: 'allowed' };
          }
          return buildExtensionQuestionsAuthorization(request) as HostAuthorizationDecision<QuestionSpec>;
        }
        if (request.approval_mode === 'need-approval') {
          return {
            kind: 'need-approval',
            prompt: buildExtensionApprovalPrompt(request),
          };
        }
        return { kind: 'allowed' };
      case 'shell': {
        const metadata = this.requestMetadataFor(request);
        if (metadata?.userInitiated) {
          return { kind: 'allowed' };
        }

        const permissions = await this.loadPermissions();
        if ((permissions.trusted_shell_commands ?? []).includes(request.command)) {
          return { kind: 'allowed' };
        }

        const shell = this.toolDefinitionEnvironment();
        return {
          kind: 'need-approval',
          prompt:
            `理由: ${request.reason}\n` +
            `高风险工具调用: shell\n终端: ${shell.shellDisplayName}\n命令: ${request.command}`,
          trustTarget: `shell:${request.command}`,
        };
      }
      case 'web_fetch':
        return {
          kind: 'need-approval',
          prompt: `高风险工具调用: 抓取网页\nURL: ${request.url}\n\n正文将进入对话；请确认来源可信，恶意页面可能提示词注入。`,
        };
      case 'list_directory_files': {
        const canonical = await this.resolveExistingAbsoluteDirectory(request.path);
        return this.authorizeExternalReadPath(canonical, '遍历工作目录外目录');
      }
      case 'read_file': {
        const target = await this.resolveReadFileTarget(request.path);
        if (target.managed) {
          return { kind: 'allowed' };
        }
        const canonical = target.canonicalPath;
        return this.authorizeExternalReadPath(canonical, '读取工作目录外文件');
      }
      case 'create_file':
        return {
          kind: 'need-approval',
          prompt: `高风险工具调用: 创建文件\n路径: ${request.path}\n内容长度: ${[...request.content].length} 字符`,
        };
      case 'create_plan':
        return {
          kind: 'need-approval',
          prompt: `高风险工具调用: 创建计划\n名称: ${request.plan_name}\n内容长度: ${[...request.content].length} 字符`,
        };
      case CREATE_AUTOMATION_TOOL_NAME:
        return {
          kind: 'need-approval',
          prompt:
            `高风险工具调用: 创建自动化\n` +
            `标题: ${request.title}\n` +
            `调度: ${formatTriggerLabel(request.trigger)}\n` +
            `运行审批: ${formatCreateAutomationApprovalLabel(request.approval_level)}\n` +
            `概述长度: ${[...request.overview].length} 字符`,
        };
      case 'edit_file':
        return {
          kind: 'need-approval',
          prompt: `高风险工具调用: 编辑文件（精确替换）\n路径: ${request.path}\n旧文本长度: ${[...request.old_text].length} 字符\n新文本长度: ${[...request.new_text].length} 字符`,
        };
      case 'delete_file':
        return {
          kind: 'need-approval',
          prompt: `高风险工具调用: 删除文件\n路径: ${request.path}`,
        };
      case APPLY_PATCH_HOST_TOOL_NAME: {
        const diffLines =
          request.operation.diff === undefined ? 0 : request.operation.diff.split(/\r?\n/).length;
        return {
          kind: 'need-approval',
          prompt:
            `高风险工具调用: apply_patch (${request.operation.type})\n` +
            `路径: ${request.operation.path}` +
            (request.operation.type === 'update_file' ? `\nDiff 行数: ${diffLines}` : ''),
        };
      }
      case 'dream_list':
      case 'dream_read':
      case 'dream_record':
      case 'dream_update':
      case 'dream_delete':
      case 'todo_list':
      case 'todo_write':
        return { kind: 'allowed' };
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

  async execute(request: HostToolRequest<QuestionSpec>): Promise<HostToolExecutionOutput | string> {
    switch (request.name) {
      case 'finish_task':
        return createHostToolTextOutput(request.summary?.trim() || 'Task marked complete.');
      case 'shell': {
        const shellMetadata = this.requestMetadataFor(request);
        return this.executeShell(request.command, {
          ...(shellMetadata?.onOutputChunk ? { onOutputChunk: shellMetadata.onOutputChunk } : {}),
          ...(shellMetadata?.toolCallId ? { toolCallId: shellMetadata.toolCallId } : {}),
        });
      }
      case 'web_fetch':
        return this.executeWebFetch(request.url);
      case 'list_directory_files':
        return this.executeListDirectory(request.path);
      case 'glob':
        return this.executeGlob(request.pattern);
      case 'read_file':
        return this.executeReadFile(request.path, request.offset, request.limit);
      case 'grep':
        return this.executeSearchFiles(request.query, request.is_regexp ?? false, request.glob);
      case 'run_subagent':
        throw new Error('run_subagent 应由 Agent runtime 接管，不应落到 host-internal 工具执行器');
      case 'generate_image':
        throw new Error('generate_image 应由 Agent runtime 接管，不应落到 host-internal 工具执行器');
      case 'generate_video':
        throw new Error('generate_video 应由 Agent runtime 接管，不应落到 host-internal 工具执行器');
      case 'ask_questions':
        throw new Error('ask_questions 应由运行时挂起并等待用户填写，不应直接执行');
      case 'extension_tool':
        if (!this.extensions) {
          throw new Error('当前宿主未启用扩展工具执行。');
        }
        return this.extensions.manager.invokeTool({
          extensionId: request.extension_id,
          toolName: request.tool_name,
          arguments: request.arguments,
          host: this.extensions.getHost(),
          ...(this.extensions.logger ? { logger: this.extensions.logger } : {}),
          ...(typeof request.questions_result === 'object' && request.questions_result !== null
            ? { questionsResult: request.questions_result }
            : {}),
          ...((() => {
            const toolCallId = this.requestMetadata.get(request)?.toolCallId;
            return toolCallId ? { toolCallId } : {};
          })()),
        });
      case 'create_file':
        return this.executeCreateFile(request);
      case 'create_plan':
        return this.executeCreatePlan(request);
      case CREATE_AUTOMATION_TOOL_NAME:
        return this.executeCreateAutomation(request);
      case 'edit_file':
        return this.executeEditFile(request);
      case 'delete_file':
        return this.executeDeleteFile(request);
      case APPLY_PATCH_HOST_TOOL_NAME:
        return this.executeApplyPatch(request);
      case 'dream_list':
        return JSON.stringify({
          dreams: await this.requireDreamStore().list({
            includeDeleted: request.include_deleted,
            includeExpired: request.include_expired,
          }),
        });
      case 'dream_read':
        {
          const dream = await this.requireDreamStore().read(request.id);
          if (!dream) {
            throw new Error(`梦境不存在: ${request.id}`);
          }
        return JSON.stringify({ dream });
        }
      case 'dream_record':
        return JSON.stringify({
          dream: await this.requireDreamStore().record({
            title: request.title,
            summary: request.summary,
            ...(request.details ? { details: request.details } : {}),
            tags: request.tags,
            ...(this.dreamSourceSession ? { sourceSession: this.dreamSourceSession } : {}),
          }),
        });
      case 'dream_update':
        return JSON.stringify({
          dream: await this.requireDreamStore().update({
            id: request.id,
            ...(request.title ? { title: request.title } : {}),
            ...(request.summary ? { summary: request.summary } : {}),
            ...(request.details ? { details: request.details } : {}),
            ...(request.tags !== undefined ? { tags: request.tags } : {}),
            ...(this.dreamSourceSession ? { sourceSession: this.dreamSourceSession } : {}),
          }),
        });
      case 'dream_delete':
        return JSON.stringify({
          dream: await this.requireDreamStore().delete(request.id, request.reason),
        });
      case 'todo_list':
        return JSON.stringify({
          todos: await this.requireTodoStore().listItems({
            includeCompleted: request.include_completed,
          }),
        });
      case 'todo_write':
        return JSON.stringify({
          todos: await this.requireTodoStore().write(request.todos),
        });
    }
  }

  async saveGeneratedImage(request: HostGeneratedImageSaveRequest): Promise<HostGeneratedImageFile> {
    const imageType = detectGeneratedImageType(request.mediaType, request.data);
    const outputDir = path.join(this.spiritDataDir, GENERATED_IMAGES_DIR);
    await mkdir(outputDir, { recursive: true });

    const filePath = path.join(outputDir, `${Date.now()}-${randomUUID()}${imageType.extension}`);
    await writeFile(filePath, request.data);
    return {
      path: filePath,
      mimeType: imageType.mimeType,
      markdownRef: generatedImageMarkdownRef(filePath),
    };
  }

  async saveGeneratedVideo(request: HostGeneratedVideoSaveRequest): Promise<HostGeneratedVideoFile> {
    const videoType = detectGeneratedVideoType(request.mediaType, request.data);
    const outputDir = path.join(this.spiritDataDir, GENERATED_VIDEOS_DIR);
    await mkdir(outputDir, { recursive: true });

    const filePath = path.join(outputDir, `${Date.now()}-${randomUUID()}${videoType.extension}`);
    await writeFile(filePath, request.data);
    return {
      path: filePath,
      mimeType: videoType.mimeType,
      markdownRef: generatedVideoMarkdownRef(filePath),
    };
  }

  attachRequestMetadata(
    request: HostToolRequest<QuestionSpec>,
    metadata: HostToolRequestMetadata,
  ): HostToolRequest<QuestionSpec> {
    if (typeof request === 'object' && request !== null) {
      this.requestMetadata.set(request, metadata);
    }
    return request;
  }

  shouldExecuteInBackground(request: HostToolRequest<QuestionSpec>): boolean {
    if (request.name === 'shell' || request.name === 'web_fetch') {
      return true;
    }
    return request.name === 'extension_tool' && request.execution_mode === 'background';
  }

  abortRunningShell(): void {
    for (const kill of this.activeShellKills.values()) {
      kill();
    }
    this.activeShellKills.clear();
  }

  abortShell(toolCallId: string): boolean {
    const trimmed = toolCallId.trim();
    if (!trimmed) {
      return false;
    }
    const kill = this.activeShellKills.get(trimmed);
    if (!kill) {
      return false;
    }
    kill();
    this.activeShellKills.delete(trimmed);
    return true;
  }

  backgroundStatusText(request: HostToolRequest<QuestionSpec>): string | undefined {
    if (request.name === 'shell' || request.name === 'web_fetch') {
      // Status is shown on the tool card; do not mirror into thinking aux.
      return undefined;
    }
    if (request.name !== 'extension_tool' || request.execution_mode !== 'background') {
      return undefined;
    }
    return `扩展工具执行中: ${request.tool_name}`;
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

  private resolveAvailableToolDefinitions(): JsonValue {
    return this.availableToolDefinitions?.() ?? [];
  }

  private async resolveExtensionToolRequest(
    name: string,
    parsed: HostJsonObject,
  ): Promise<HostToolRequest<QuestionSpec> | undefined> {
    if (!this.extensions) {
      return undefined;
    }

    const resolved = await this.extensions.manager.resolveTool(name);
    if (!resolved) {
      return undefined;
    }

    return {
      name: 'extension_tool',
      extension_id: resolved.extensionId,
      tool_name: resolved.tool.name,
      arguments: parsed,
      ...(resolved.tool.approvalMode ? { approval_mode: resolved.tool.approvalMode } : {}),
      ...(resolved.tool.executionMode ? { execution_mode: resolved.tool.executionMode } : {}),
    };
  }

  private requireDreamStore(): HostDreamStore {
    if (!this.dreamStore) {
      throw new Error('当前宿主未配置梦境 scope，无法执行梦境工具。');
    }
    return this.dreamStore;
  }

  private requireTodoStore(): HostTodoStore {
    if (!this.todoStore) {
      throw new Error('当前宿主未配置会话 TODO scope，无法执行 todo 工具。');
    }
    return this.todoStore;
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
      prompt: `高风险工具调用: ${promptTitle}\n路径: ${canonical}`,
      trustTarget: `external-read:${canonical}`,
    };
  }

  private isAllowedReadLocation(canonical: string): boolean {
    return (
      isWithinRoot(canonical, this.workspaceRoot) ||
      isInsideSpiritManagedUserArea(canonical, this.context) ||
      isSpiritDataInternalReadPath(canonical, this.context.spiritDataDir)
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

  private async resolveReadFileTarget(input: string): Promise<ResolvedReadFileTarget> {
    const trimmed = input.trim();
    if (!trimmed) {
      throw new Error('path 不能为空');
    }

    const managedCanonical = await this.tryResolveManagedGeneratedAssetPath(trimmed);
    if (managedCanonical) {
      return {
        canonicalPath: managedCanonical,
        displayPath: trimmed,
        managed: true,
      };
    }

    const canonicalPath = await this.resolveExistingFilePath(trimmed);
    return {
      canonicalPath,
      displayPath: canonicalPath,
      managed: false,
    };
  }

  private async tryResolveManagedGeneratedAssetPath(reference: string): Promise<string | undefined> {
    const parsed = parseManagedGeneratedAssetReference(reference);
    if (!parsed) {
      return undefined;
    }

    const { kind, basename, reference: trimmed } = parsed;
    const assetLabel = kind === 'image' ? '图片' : '视频';

    const managedRoot = path.join(this.spiritDataDir, generatedDirForKind(kind));
    const candidatePath = path.join(managedRoot, basename);
    try {
      const managedRootStats = await lstat(managedRoot);
      if (!managedRootStats.isDirectory() || managedRootStats.isSymbolicLink()) {
        throw new Error(`Spirit 托管${assetLabel}目录无效: ${trimmed}`);
      }

      const candidate = await lstat(candidatePath);
      if (candidate.isSymbolicLink()) {
        throw new Error(`Spirit 托管${assetLabel}引用不能指向符号链接: ${trimmed}`);
      }
      if (!candidate.isFile()) {
        throw new Error(`Spirit 托管${assetLabel}不存在: ${trimmed}`);
      }

      const [canonicalSpiritRoot, canonicalRoot, canonical] = await Promise.all([
        realpath(this.spiritDataDir),
        realpath(managedRoot),
        realpath(candidatePath),
      ]);
      if (!pathHasPrefix(canonicalRoot, canonicalSpiritRoot)) {
        throw new Error(`Spirit 托管${assetLabel}目录越界: ${trimmed}`);
      }
      if (!pathHasPrefix(canonical, canonicalRoot)) {
        throw new Error(`Spirit 托管${assetLabel}引用越界: ${trimmed}`);
      }

      const st = await lstat(canonical);
      if (st.isSymbolicLink() || !st.isFile()) {
        throw new Error(`Spirit 托管${assetLabel}不存在: ${trimmed}`);
      }

      return canonical;
    } catch (error) {
      if (error instanceof Error && error.message.includes(trimmed)) {
        throw error;
      }
      throw new Error(`Spirit 托管${assetLabel}不存在: ${trimmed}`);
    }
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

    let entries;
    try {
      entries = await readdir(root, { withFileTypes: true });
    } catch {
      skippedDirs += 1;
      return `[list]\npath: ${root}\nfiles: 0\nskipped_dirs: ${skippedDirs}\nskipped_symlinks: ${skippedSymlinks}\n\n（无法读取目录）`;
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
      }
    }

    directories.sort((left, right) => left.localeCompare(right));
    files.sort((left, right) => left.localeCompare(right));

    let out = `[list]\npath: ${root}\ndirectories: ${directories.length}\nfiles: ${files.length}\nskipped_dirs: ${skippedDirs}\nskipped_symlinks: ${skippedSymlinks}\n\n`;

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

    return out;
  }

  private async executeReadFile(
    inputPath: string,
    offset?: number,
    limit?: number,
  ): Promise<HostToolExecutionOutput> {
    const target = await this.resolveReadFileTarget(inputPath);
    const canonical = target.canonicalPath;
    const errorPath = target.managed ? target.displayPath : canonical;

    let st;
    let bytes;
    try {
      st = await lstat(canonical);
      if (!st.isFile()) {
        throw new Error(`目标不是文件: ${errorPath}`);
      }

      bytes = await readFile(canonical);
    } catch (error) {
      if (error instanceof Error && error.message.includes(errorPath)) {
        throw error;
      }
      throw new Error(`读取文件失败: ${errorPath}`);
    }

    const image = detectSupportedImageFile(canonical, bytes);
    if (image) {
      return this.createImageToolOutput(
        '[read image]',
        `path: ${target.displayPath}`,
        canonical,
        image.mimeType,
      );
    }

    if (hasSupportedImageExtension(canonical)) {
      throw new Error(`图片文件校验失败: ${errorPath}`);
    }

    const video = detectSupportedVideoFile(canonical, bytes);
    if (video) {
      return this.createVideoToolOutput(
        '[read video]',
        `path: ${target.displayPath}`,
        canonical,
        video.mimeType,
      );
    }

    if (hasSupportedVideoExtension(canonical)) {
      throw new Error(`视频文件校验失败: ${errorPath}`);
    }

    if (bytes.includes(0)) {
      throw new Error(`暂不支持以文本方式读取二进制文件: ${errorPath}`);
    }

    const content = bytes.toString('utf8');
    const start = offset ?? 1;
    if (start === 0) {
      throw new Error('offset 从 1 开始');
    }

    const lineLimit = limit ?? MAX_READ_LINES_DEFAULT;
    if (lineLimit < 1) {
      throw new Error('limit 必须 >= 1');
    }

    const end = start + lineLimit - 1;

    const lines = content.split(/\r?\n/u);
    const maxLine = Math.max(lines.length, 1);
    const s = Math.min(start, maxLine);
    const e = Math.min(end, maxLine);

    let out = `[read]\npath: ${target.displayPath}\nrange: ${s}-${e}\n\n`;
    for (let index = s; index <= e; index += 1) {
      const line = lines[index - 1] ?? '';
      out += `${String(index).padStart(6, ' ')} | ${line}\n`;
    }
    return createHostToolTextOutput(out);
  }

  private async executeGlob(inputPattern: string): Promise<string> {
    const pattern = normalizeWorkspaceGlobPattern(inputPattern);
    const rawMatches = (await globPaths(pattern, {
      cwd: this.workspaceRoot,
      absolute: false,
      nodir: true,
      dot: true,
      windowsPathsNoEscape: true,
      ignore: [...SEARCH_IGNORE_DIR_NAMES].map((name) => `**/${name}/**`),
    }))
      .map((value) => value.replace(/\\/gu, '/'))
      .sort((left, right) => left.localeCompare(right));
    const matches = await filterWorkspaceFilePathsByIgnore(this.workspaceRoot, rawMatches);

    let out = `[glob]\npattern: ${pattern}\nmatches: ${matches.length}\n\n`;
    if (matches.length === 0) {
      out += '未搜索到文件';
      return out;
    }

    for (const file of matches) {
      out += `${file}\n`;
    }
    return out;
  }

  private async executeSearchFiles(
    query: string,
    isRegexp = false,
    inputGlob?: string,
  ): Promise<string> {
    const needle = query.trim();
    if (!needle) {
      throw new Error('search query 不能为空');
    }

    const globPattern =
      inputGlob !== undefined && inputGlob.trim() !== ''
        ? normalizeWorkspaceGlobPattern(inputGlob)
        : null;

    const { matches } = await runRipgrepSearch({
      workspaceRoot: this.workspaceRoot,
      query: needle,
      isRegexp,
      globPattern,
    });

    return formatGrepToolOutput({
      query,
      isRegexp,
      globPattern,
      matches,
    });
  }

  private async executeShell(
    command: string,
    options: { onOutputChunk?: (chunk: string) => void; toolCallId?: string } = {},
  ): Promise<string> {
    const shell = this.toolDefinitionEnvironment();
    const handle = runShell({
      workspaceRoot: this.workspaceRoot,
      command,
      ...(options.onOutputChunk ? { onOutputChunk: options.onOutputChunk } : {}),
    });
    const toolCallId = options.toolCallId?.trim();
    if (toolCallId) {
      this.activeShellKills.set(toolCallId, handle.kill);
    }
    let result;
    try {
      result = await handle.result;
    } finally {
      if (toolCallId) {
        this.activeShellKills.delete(toolCallId);
      }
    }

    return serializeShellToolResult(
      buildShellToolResult({
        terminal: shell.shellDisplayName,
        workspace: this.workspaceRoot,
        command,
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
      }),
    );
  }

  private createImageToolOutput(
    header: string,
    locationLine: string,
    imagePath: string,
    mimeType: string,
    extraLines: string[] = [],
  ): HostToolExecutionOutput {
    const summaryLines = [header, locationLine, ...extraLines, `mime_type: ${mimeType}`];
    const compatibilityProfile = this.getModelCompatibilityProfile?.();
    if (isImageInputBlocked(compatibilityProfile)) {
      return createHostToolTextOutput([
        ...summaryLines,
        '',
        '该模型不支持 Image 输入，图像文件无法作为图片输入返回。',
      ].join('\n'));
    }

    return createHostToolOutput([
      ...summaryLines,
      '',
      '图像文件已作为图片输入返回。',
    ].join('\n'), [{ type: 'image', path: imagePath }]);
  }

  private createVideoToolOutput(
    header: string,
    locationLine: string,
    videoPath: string,
    mimeType: string,
    extraLines: string[] = [],
  ): HostToolExecutionOutput {
    const summaryLines = [header, locationLine, ...extraLines, `mime_type: ${mimeType}`];
    const compatibilityProfile = this.getModelCompatibilityProfile?.();
    if (isVideoInputBlocked(compatibilityProfile)) {
      return createHostToolTextOutput([
        ...summaryLines,
        '',
        '该模型不支持视频输入，视频文件无法作为视频输入返回。',
      ].join('\n'));
    }

    return createHostToolOutput([
      ...summaryLines,
      '',
      '视频文件已作为视频输入返回。',
    ].join('\n'), [{ type: 'video', path: videoPath }]);
  }

  private async persistWebFetchedImage(bytes: Uint8Array, extension: string): Promise<string> {
    const cacheDir = path.join(this.spiritDataDir, WEB_FETCH_IMAGE_CACHE_DIR);
    await mkdir(cacheDir, { recursive: true });

    const filePath = path.join(cacheDir, `${Date.now()}-${randomUUID()}${extension}`);
    await writeFile(filePath, bytes);
    await this.prunePersistedWebFetchedImages(cacheDir);
    return filePath;
  }

  private async prunePersistedWebFetchedImages(cacheDir: string): Promise<void> {
    try {
      const entries = await readdir(cacheDir);
      const now = Date.now();
      const retained: Array<{ path: string; mtimeMs: number }> = [];

      for (const entry of entries) {
        const filePath = path.join(cacheDir, entry);
        try {
          const metadata = await lstat(filePath);
          if (!metadata.isFile()) {
            continue;
          }

          if (now - metadata.mtimeMs > WEB_FETCH_IMAGE_RETENTION_MS) {
            await unlink(filePath);
            continue;
          }

          retained.push({ path: filePath, mtimeMs: metadata.mtimeMs });
        } catch {
          // 清理失败不应影响本次工具结果。
        }
      }

      retained.sort((left, right) => right.mtimeMs - left.mtimeMs);
      for (const stale of retained.slice(WEB_FETCH_IMAGE_CACHE_MAX_FILES)) {
        try {
          await unlink(stale.path);
        } catch {
          // 清理失败不应影响本次工具结果。
        }
      }
    } catch {
      // 清理失败不应影响本次工具结果。
    }
  }

  private async executeWebFetch(url: string): Promise<HostToolExecutionOutput> {
    const parsedUrl = parseWebFetchUrl(url);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), WEB_FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(parsedUrl, {
        redirect: 'follow',
        signal: controller.signal,
        headers: {
          'User-Agent': WEB_FETCH_USER_AGENT,
          Accept: WEB_FETCH_ACCEPT_HEADER,
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        },
      });
      const status = response.status;
      const finalUrl = response.url || parsedUrl;
      const contentType = response.headers.get('content-type') ?? 'unknown';
      const imageExtension = inferSupportedImageExtensionFromWebResponse(finalUrl, contentType);
      const normalizedMimeType = normalizeMimeType(contentType);

      if (imageExtension || normalizedMimeType.startsWith('image/')) {
        if (!imageExtension) {
          throw new Error(`暂不支持作为图片抓取该网页响应: ${contentType}`);
        }

        const bytes = Buffer.from(await response.arrayBuffer());
        const image = detectSupportedImageFile(`web-fetch${imageExtension}`, bytes);
        if (!image) {
          throw new Error(`网页图片校验失败: ${finalUrl}`);
        }

        const cachedImagePath = await this.persistWebFetchedImage(bytes, imageExtension);
        return this.createImageToolOutput(
          '[web image]',
          `url: ${parsedUrl}`,
          cachedImagePath,
          image.mimeType,
          [
            `final_url: ${finalUrl}`,
            `status: ${status}`,
            `content_type: ${contentType}`,
            `path: ${cachedImagePath}`,
          ],
        );
      }

      const raw = await response.text();
      return createHostToolTextOutput(
        convertFetchedPageToToolText({
          url: parsedUrl,
          finalUrl,
          status,
          contentType,
          raw,
        }),
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  private assertCreateFileAllowed(resolvedPath: string): void {
    if (isPathUnderPlansDir(resolvedPath, this.context)) {
      throw new Error(
        'plans/ 目录下新建文件请使用 create_plan；已存在的计划文件可用 edit_file 修改。',
      );
    }
  }

  private async executeCreateFile(
    request: Extract<HostToolRequest<QuestionSpec>, { name: 'create_file' }>,
  ): Promise<string> {
    const inputPath = request.path;
    const content = request.content;
    const target = this.resolveWorkspaceWriteTarget(inputPath);
    this.assertCreateFileAllowed(target);
    if (existsSync(target)) {
      throw new Error(`文件已存在: ${target}`);
    }
    const before = await readHostFileSnapshot(target);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content, 'utf8');
    const after = await readHostFileSnapshot(target);
    await this.recordFileChange(request, target, before, after);
    return `[write]\naction: create_file\npath: ${target}\nchars: ${[...content].length}`;
  }

  private async executeCreateAutomation(
    request: Extract<HostToolRequest<QuestionSpec>, { name: typeof CREATE_AUTOMATION_TOOL_NAME }>,
  ): Promise<string> {
    const defaults = this.getAutomationCreateDefaults?.();
    if (!defaults) {
      throw new Error('create_automation 仅在 Desktop 宿主可用。');
    }
    const store = createHostAutomationStore(this.spiritDataDir);
    const definition = await store.create({
      title: request.title,
      overview: request.overview,
      trigger: request.trigger,
      workspaceRoot: defaults.workspaceRoot,
      modelName: defaults.modelName,
      ...(defaults.reasoningEffort ? { reasoningEffort: defaults.reasoningEffort } : {}),
      approvalLevel: request.approval_level,
      enabled: true,
    });
    this.onAutomationCreated?.(definition);
    return (
      `[automation]\n` +
      `action: create_automation\n` +
      `id: ${definition.id}\n` +
      `title: ${definition.title}\n` +
      `trigger: ${formatTriggerLabel(definition.trigger)}\n` +
      `workspace: ${definition.workspaceRoot}`
    );
  }

  private async executeCreatePlan(
    request: Extract<HostToolRequest<QuestionSpec>, { name: 'create_plan' }>,
  ): Promise<string> {
    const content = request.content;
    const target = resolvePlanFilePath(this.context, request.plan_name);
    if (existsSync(target)) {
      throw new Error(`计划文件已存在: ${target}`);
    }
    const before = await readHostFileSnapshot(target);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content, 'utf8');
    const after = await readHostFileSnapshot(target);
    await this.recordFileChange(request, target, before, after);
    return `[plan]\npath: ${target}\naction: create_plan\nchars: ${[...content].length}`;
  }

  private async executeEditFile(
    request: Extract<HostToolRequest<QuestionSpec>, { name: 'edit_file' }>,
  ): Promise<string> {
    const inputPath = request.path;
    const oldText = request.old_text;
    const newText = request.new_text;
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
    const before = await readHostFileSnapshot(target);
    const occurrences = countSubstringOccurrences(source, oldText);
    if (occurrences === 0) {
      const normalizedSource = normalizeLineEndings(source);
      const normalizedOld = normalizeLineEndings(oldText);
      const normalizedHits = countSubstringOccurrences(normalizedSource, normalizedOld);
      if (normalizedHits === 1) {
        const replaced = replaceSingleMatchAllowingNewlineDifferences(source, oldText, newText);
        if (replaced) {
          await writeFile(target, replaced.updated, 'utf8');
          const after = await readHostFileSnapshot(target);
          await this.recordFileChange(request, target, before, after);
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
    const after = await readHostFileSnapshot(target);
    await this.recordFileChange(request, target, before, after);
    return `[write]\naction: edit_file\npath: ${target}\nreplaced_once: true\nold_chars: ${[...oldText].length}\nnew_chars: ${[...newText].length}`;
  }

  private async executeApplyPatch(
    request: Extract<HostToolRequest<QuestionSpec>, { name: typeof APPLY_PATCH_HOST_TOOL_NAME }>,
  ): Promise<string> {
    const { operation } = request;
    switch (operation.type) {
      case 'create_file': {
        if (operation.diff === undefined || operation.diff.trim().length === 0) {
          throw new Error('apply_patch create_file 需要非空 diff');
        }
        const content = applyDiff('', operation.diff, 'create');
        return this.executeCreateFile({
          name: 'create_file',
          path: operation.path,
          content,
        });
      }
      case 'update_file': {
        if (operation.diff === undefined || operation.diff.trim().length === 0) {
          throw new Error('apply_patch update_file 需要非空 diff');
        }
        const inputPath = operation.path;
        const target = this.resolveWorkspaceWriteTarget(inputPath);
        if (!existsSync(target)) {
          throw new Error(`路径不存在或无法访问: ${target}`);
        }
        const st = await lstat(target);
        if (!st.isFile()) {
          throw new Error(`目标不是文件: ${target}`);
        }
        const source = await readFile(target, 'utf8');
        const before = await readHostFileSnapshot(target);
        const updated = applyDiff(source, operation.diff);
        await writeFile(target, updated, 'utf8');
        const after = await readHostFileSnapshot(target);
        await this.recordWritableFileChange(request, target, before, after, 'edit_file', {
          name: 'edit_file',
          path: operation.path,
          oldChars: [...source].length,
          newChars: [...updated].length,
        });
        return `[write]\naction: apply_patch\noperation: update_file\npath: ${target}\nold_chars: ${[...source].length}\nnew_chars: ${[...updated].length}`;
      }
      case 'delete_file':
        return this.executeDeleteFile({
          name: 'delete_file',
          path: operation.path,
        });
      default:
        throw new Error(`不支持的 apply_patch 操作: ${(operation as ApplyPatchOperation).type}`);
    }
  }

  private async executeDeleteFile(
    request: Extract<HostToolRequest<QuestionSpec>, { name: 'delete_file' }>,
  ): Promise<string> {
    const inputPath = request.path;
    const target = this.resolveWorkspaceWriteTarget(inputPath);
    if (!existsSync(target)) {
      throw new Error(`路径不存在或无法访问: ${target}`);
    }
    const st = await lstat(target);
    if (!st.isFile()) {
      throw new Error(`目标不是文件: ${target}`);
    }
    const before = await readHostFileSnapshot(target);
    await unlink(target);
    const after = await readHostFileSnapshot(target);
    await this.recordFileChange(request, target, before, after);
    return `[write]\naction: delete_file\npath: ${target}`;
  }

  private async recordWritableFileChange(
    request: HostWritableFileToolRequest<QuestionSpec>,
    resolvedPath: string,
    before: HostRecordedFileChange['before'],
    after: HostRecordedFileChange['after'],
    kind: HostFileChangeKind,
    summary: HostFileChangeRequestSummary,
  ): Promise<void> {
    if (!this.fileChangeObserver) {
      return;
    }

    const metadata = this.requestMetadataFor(request);
    const change: HostRecordedFileChange = {
      kind,
      path: summary.path,
      resolvedPath,
      toolName: metadata?.toolName ?? request.name,
      ...(metadata?.toolCallId ? { toolCallId: metadata.toolCallId } : {}),
      ...(metadata?.subagentSessionId ? { subagentSessionId: metadata.subagentSessionId } : {}),
      ...(metadata?.subagentTitle ? { subagentTitle: metadata.subagentTitle } : {}),
      request: summary,
      before,
      after,
      createdAtUnixMs: Date.now(),
    };

    try {
      await this.fileChangeObserver.recordFileChange(change);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`文件变更已写入，但记录回溯快照失败: ${message}`);
    }
  }

  private async recordFileChange(
    request: HostFileToolRequest<QuestionSpec>,
    resolvedPath: string,
    before: HostRecordedFileChange['before'],
    after: HostRecordedFileChange['after'],
  ): Promise<void> {
    const changeKind: HostFileChangeKind =
      request.name === 'create_plan' ? 'create_file' : request.name;
    await this.recordWritableFileChange(
      request,
      resolvedPath,
      before,
      after,
      changeKind,
      summarizeFileToolRequest(request),
    );
  }

  private requestMetadataFor(
    request: HostToolRequest<QuestionSpec>,
  ): HostToolRequestMetadata | undefined {
    if (typeof request !== 'object' || request === null) {
      return undefined;
    }
    return this.requestMetadata.get(request);
  }
}

function summarizeFileToolRequest<QuestionSpec>(
  request: HostFileToolRequest<QuestionSpec>,
): HostFileChangeRequestSummary {
    switch (request.name) {
    case 'create_file':
      return {
        name: request.name,
        path: request.path,
        contentChars: [...request.content].length,
      };
    case 'create_plan':
      return {
        name: 'create_file',
        path: request.plan_name,
        contentChars: [...request.content].length,
      };
    case 'edit_file':
      return {
        name: request.name,
        path: request.path,
        oldChars: [...request.old_text].length,
        newChars: [...request.new_text].length,
      };
    case 'delete_file':
      return {
        name: request.name,
        path: request.path,
      };
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
  if (argumentsJson.trim().length === 0) {
    return {};
  }
  const parsed = JSON.parse(argumentsJson) as HostJsonValue;
  if (!isJsonObject(parsed)) {
    throw new Error('工具参数必须为对象。');
  }
  return parsed;
}

function parseTodoWriteItems(parsed: HostJsonObject): HostTodoItem[] {
  const rawItems = parsed.todos;
  if (!Array.isArray(rawItems)) {
    throw new Error('todos 必须是数组。');
  }
  return rawItems.map((entry, index) => {
    if (!isJsonObject(entry)) {
      throw new Error(`todos[${index}] 必须是对象。`);
    }
    const statusRaw = requiredString(entry, 'status');
    if (
      statusRaw !== 'pending' &&
      statusRaw !== 'in_progress' &&
      statusRaw !== 'completed'
    ) {
      throw new Error(`todos[${index}].status 无效: ${statusRaw}`);
    }
    const idRaw = entry.id;
    const id =
      typeof idRaw === 'string' && idRaw.trim().length > 0 ? idRaw.trim() : undefined;
    return {
      ...(id ? { id } : {}),
      title: requiredString(entry, 'title'),
      status: statusRaw,
    };
  });
}

function parseApplyPatchOperation(parsed: HostJsonObject): ApplyPatchOperation {
  const operationRaw = parsed.operation;
  if (typeof operationRaw !== 'object' || operationRaw === null || Array.isArray(operationRaw)) {
    throw new Error('apply_patch 需要 operation 对象');
  }

  const operation = operationRaw as HostJsonObject;
  const type = requiredString(operation, 'type');
  if (type !== 'create_file' && type !== 'update_file' && type !== 'delete_file') {
    throw new Error(`apply_patch operation.type 无效: ${type}`);
  }

  const path = requiredString(operation, 'path');
  const diff = optionalStringStrict(operation, 'diff');
  return {
    type,
    path,
    ...(diff !== undefined ? { diff } : {}),
  };
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

function normalizeWorkspaceGlobPattern(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error('pattern 不能为空');
  }

  const normalized = trimmed.replace(/\\/gu, '/').replace(/^(?:\.\/)+/u, '');
  if (!normalized) {
    throw new Error('pattern 不能为空');
  }
  if (path.win32.isAbsolute(trimmed) || path.posix.isAbsolute(normalized)) {
    throw new Error(`glob 仅接受 workspace-relative pattern: ${trimmed}`);
  }
  if (normalized.split('/').some((segment) => segment === '..')) {
    throw new Error(`glob pattern 不能跳出 workspace: ${trimmed}`);
  }
  return normalized;
}

function isImageInputBlocked(
  profile: HostToolModelCompatibilityProfile | undefined,
): boolean {
  return profile?.hasExplicitCapabilities === true && profile.capabilities.imageInput !== true;
}

function isVideoInputBlocked(
  profile: HostToolModelCompatibilityProfile | undefined,
): boolean {
  return profile?.hasExplicitCapabilities === true && profile.capabilities.videoInput !== true;
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

function optionalStringArrayPatch(obj: HostJsonObject, key: string): string[] | undefined {
  if (!(key in obj) || obj[key] === null) {
    return undefined;
  }
  return optionalStringArrayStrict(obj, key);
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

function inferSupportedImageExtensionFromWebResponse(
  finalUrl: string,
  contentType: string,
): string | undefined {
  const mimeType = normalizeMimeType(contentType);
  switch (mimeType) {
    case 'image/bmp':
      return '.bmp';
    case 'image/gif':
      return '.gif';
    case 'image/jpeg':
      return '.jpg';
    case 'image/png':
      return '.png';
    case 'image/webp':
      return '.webp';
    default:
      break;
  }

  try {
    const extension = path.extname(new URL(finalUrl).pathname).toLowerCase();
    return hasSupportedImageExtension(`file${extension}`) ? extension : undefined;
  } catch {
    return undefined;
  }
}

function buildExtensionApprovalPrompt<QuestionSpec>(
  request: Extract<HostToolRequest<QuestionSpec>, { name: 'extension_tool' }>,
): string {
  const preview = truncateChars(JSON.stringify(request.arguments, null, 2), 1_200);
  return `扩展工具需要确认\n扩展: ${request.extension_id}\n工具: ${request.tool_name}\n\n参数\n${preview}`;
}

function buildExtensionQuestionsAuthorization<QuestionSpec>(
  request: Extract<HostToolRequest<QuestionSpec>, { name: 'extension_tool' }>,
): HostAuthorizationDecision<QuestionSpec> {
  return {
    kind: 'need-questions',
    questions: {
      title: `补充扩展工具执行信息: ${request.tool_name}`,
      questions: [
        {
          id: 'execution_note',
          title: '补充执行说明',
          kind: 'text',
          required: true,
          options: [],
          allowCustomInput: true,
          customInputLabel: '说明',
          customInputPlaceholder: '补充这次扩展工具调用需要携带的执行说明。',
        } as QuestionSpec,
      ],
    },
  };
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

function truncateChars(value: string, maxChars: number): string {
  const chars = [...value];
  if (chars.length <= maxChars) {
    return value;
  }
  return chars.slice(0, maxChars).join('');
}

function detectGeneratedImageType(mediaType: string, bytes: Uint8Array): { extension: string; mimeType: string } {
  const normalizedMediaType = mediaType.toLowerCase().split(';', 1)[0]?.trim() ?? '';
  const preferredExtension = imageExtensionForMediaType(normalizedMediaType);
  if (preferredExtension && detectSupportedImageFile(`generated${preferredExtension}`, bytes)) {
    return {
      extension: preferredExtension,
      mimeType: mimeTypeForImageExtension(preferredExtension) ?? 'image/png',
    };
  }

  for (const extension of ['.png', '.jpg', '.webp', '.gif', '.bmp'] as const) {
    const detected = detectSupportedImageFile(`generated${extension}`, bytes);
    if (detected) {
      return {
        extension: detected.extension,
        mimeType: detected.mimeType,
      };
    }
  }

  const fallbackExtension = preferredExtension ?? '.png';
  return {
    extension: fallbackExtension,
    mimeType: mimeTypeForImageExtension(fallbackExtension) ?? 'image/png',
  };
}

function imageExtensionForMediaType(mediaType: string): string | undefined {
  switch (mediaType) {
    case 'image/bmp':
      return '.bmp';
    case 'image/gif':
      return '.gif';
    case 'image/jpeg':
      return '.jpg';
    case 'image/png':
      return '.png';
    case 'image/webp':
      return '.webp';
    default:
      return undefined;
  }
}

function mimeTypeForImageExtension(extension: string): string | undefined {
  switch (extension) {
    case '.bmp':
      return 'image/bmp';
    case '.gif':
      return 'image/gif';
    case '.jpg':
      return 'image/jpeg';
    case '.png':
      return 'image/png';
    case '.webp':
      return 'image/webp';
    default:
      return undefined;
  }
}

function detectGeneratedVideoType(mediaType: string, bytes: Uint8Array): { extension: string; mimeType: string } {
  const normalizedMediaType = mediaType.toLowerCase().split(';', 1)[0]?.trim() ?? '';
  const preferredExtension = videoExtensionForMediaType(normalizedMediaType);
  if (preferredExtension && detectSupportedVideoFile(`generated${preferredExtension}`, bytes)) {
    return {
      extension: preferredExtension,
      mimeType: mimeTypeForVideoExtension(preferredExtension) ?? 'video/mp4',
    };
  }

  for (const extension of ['.mp4', '.webm', '.mov', '.mpeg', '.mpg'] as const) {
    const detected = detectSupportedVideoFile(`generated${extension}`, bytes);
    if (detected) {
      return {
        extension: detected.extension,
        mimeType: detected.mimeType,
      };
    }
  }

  const fallbackExtension = preferredExtension ?? '.mp4';
  return {
    extension: fallbackExtension,
    mimeType: mimeTypeForVideoExtension(fallbackExtension) ?? 'video/mp4',
  };
}

function videoExtensionForMediaType(mediaType: string): string | undefined {
  switch (mediaType) {
    case 'video/mp4':
      return '.mp4';
    case 'video/webm':
      return '.webm';
    case 'video/quicktime':
      return '.mov';
    case 'video/mpeg':
      return '.mpeg';
    default:
      return undefined;
  }
}

function mimeTypeForVideoExtension(extension: string): string | undefined {
  switch (extension) {
    case '.mp4':
      return 'video/mp4';
    case '.webm':
      return 'video/webm';
    case '.mov':
      return 'video/quicktime';
    case '.mpeg':
    case '.mpg':
      return 'video/mpeg';
    default:
      return undefined;
  }
}

function isJsonObject(value: HostJsonValue): value is HostJsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isWithinRoot(candidate: string, root: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function isSpiritDataInternalReadPath(resolvedPath: string, spiritDataDir: string): boolean {
  const resolvedSpiritDataDir = path.resolve(spiritDataDir);
  const allowedRoots = [
    resolveCompactionArchivesDir(resolvedSpiritDataDir),
    resolveToolOutputArchivesDir(resolvedSpiritDataDir),
  ];
  return allowedRoots.some((allowed) => pathHasPrefix(resolvedPath, allowed));
}

function isInsideSpiritManagedUserArea(
  resolvedPath: string,
  context: InstructionDiscoveryContext,
): boolean {
  const paths = resolveInstructionPaths({
    workspaceRoot: context.workspaceRoot,
    spiritDataDir: context.spiritDataDir,
  });
  return [paths.userRuleFile, paths.plansDir, paths.userSkillsDir]
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

function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let buffer = '';
  let inQuotes = false;

  for (const character of input) {
    if (character === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (/\s/u.test(character) && !inQuotes) {
      if (buffer.length > 0) {
        tokens.push(buffer);
        buffer = '';
      }
      continue;
    }
    buffer += character;
  }

  if (buffer.length > 0) {
    tokens.push(buffer);
  }

  return tokens;
}

function parseOptionalManualLine(
  value: string | undefined,
  label: string,
): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${label} 非法: ${value}`);
  }
  return parsed;
}
