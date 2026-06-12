import type { ToolBlockSnapshot } from '@/types';

export type ProcessToolCategory =
  | 'view'
  | 'create'
  | 'edit'
  | 'delete'
  | 'ask'
  | 'diagnose'
  | 'generate'
  | 'run'
  | 'other';

export type ProcessToolCounts = Record<ProcessToolCategory, number>;

export const PROCESS_TOOL_CATEGORY_ORDER: readonly ProcessToolCategory[] = [
  'view',
  'create',
  'edit',
  'delete',
  'ask',
  'diagnose',
  'generate',
  'run',
  'other',
];

const VIEW_TOOLS = new Set([
  'read_file',
  'list_directory_files',
  'grep',
  'glob',
  'web_fetch',
  'web_search',
  'dream_read',
  'dream_list',
  'todo_list',
]);

const CREATE_TOOLS = new Set([
  'create_file',
  'create_plan',
  'todo_create',
  'create_automation',
]);

const EDIT_TOOLS = new Set(['edit_file', 'todo_update', 'dream_update', 'dream_record']);

const DELETE_TOOLS = new Set(['delete_file', 'dream_delete', 'todo_complete']);

const APPLY_PATCH_CREATE = new Set(['创建', 'Create', 'Creating', 'Created']);
const APPLY_PATCH_EDIT = new Set(['编辑', 'Edit', 'Editing', 'Edited']);
const APPLY_PATCH_DELETE = new Set(['删除', 'Delete', 'Deleting', 'Deleted']);

export function emptyProcessToolCounts(): ProcessToolCounts {
  return {
    view: 0,
    create: 0,
    edit: 0,
    delete: 0,
    ask: 0,
    diagnose: 0,
    generate: 0,
    run: 0,
    other: 0,
  };
}

function classifyApplyPatch(headline: string | undefined): ProcessToolCategory {
  const normalized = headline?.trim() ?? '';
  if (APPLY_PATCH_CREATE.has(normalized)) {
    return 'create';
  }
  if (APPLY_PATCH_EDIT.has(normalized)) {
    return 'edit';
  }
  if (APPLY_PATCH_DELETE.has(normalized)) {
    return 'delete';
  }
  return 'edit';
}

export function classifyProcessToolCategory(
  toolName: string,
  headline?: string,
): ProcessToolCategory {
  if (toolName === 'finish_task') {
    return 'other';
  }
  if (toolName === 'generate_image' || toolName === 'generate_video') {
    return 'generate';
  }
  if (toolName === 'ask_questions') {
    return 'ask';
  }
  if (toolName === 'get_diagnostics') {
    return 'diagnose';
  }
  if (toolName === 'run_shell_command') {
    return 'run';
  }
  if (toolName === 'apply_patch') {
    return classifyApplyPatch(headline);
  }
  if (VIEW_TOOLS.has(toolName)) {
    return 'view';
  }
  if (CREATE_TOOLS.has(toolName)) {
    return 'create';
  }
  if (EDIT_TOOLS.has(toolName)) {
    return 'edit';
  }
  if (DELETE_TOOLS.has(toolName)) {
    return 'delete';
  }
  return 'other';
}

export function classifyProcessToolCategoryFromSnapshot(
  tool: Pick<ToolBlockSnapshot, 'toolName' | 'headline'>,
): ProcessToolCategory {
  return classifyProcessToolCategory(tool.toolName, tool.headline);
}

export function incrementProcessToolCounts(
  counts: ProcessToolCounts,
  category: ProcessToolCategory,
): ProcessToolCounts {
  return {
    ...counts,
    [category]: counts[category] + 1,
  };
}

export function aggregateProcessToolCounts(
  tools: ReadonlyArray<Pick<ToolBlockSnapshot, 'toolName' | 'headline'>>,
): ProcessToolCounts {
  return tools.reduce((counts, tool) => {
    const category = classifyProcessToolCategoryFromSnapshot(tool);
    return incrementProcessToolCounts(counts, category);
  }, emptyProcessToolCounts());
}
