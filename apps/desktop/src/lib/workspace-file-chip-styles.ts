import {
  isWorkspaceReferenceDirectoryPath,
  normalizeWorkspaceReferenceDirectoryPath,
} from '@spirit-agent/host-internal/workspace-file-reference-query';
import { workspaceFileBasename } from '@/lib/file-picker-path';
import { PLAN_CHIP_CLASS, PLAN_CHIP_ICON_CLASS } from '@/lib/plan-chip-styles';
import { appendWorkspaceExplorerIconSvg } from '@/lib/workspace-explorer-icon-dom';
import type { WorkspaceExplorerEntryKind } from '@/types';

/** 工作区 @file 引用 chip，尺寸与元素 chip 对齐 */
export const WORKSPACE_FILE_CHIP_CLASS =
  "inline-flex items-center gap-1 rounded-md border border-emerald-200/90 bg-emerald-50 px-1.5 py-0.5 text-xs font-medium leading-none text-emerald-900 select-none align-middle mx-0.5 dark:border-emerald-700/60 dark:bg-emerald-950 dark:text-emerald-300";

export const WORKSPACE_FILE_CHIP_ICON_CLASS = "text-emerald-600 dark:text-emerald-400";

export function isWorkspaceDirectoryChipPath(path: string): boolean {
  return isWorkspaceReferenceDirectoryPath(path.replace(/\\/gu, '/'));
}

export function resolveWorkspaceFileChipPresentation(path: string): {
  chipClass: string;
  iconClass: string;
  iconKind: WorkspaceExplorerEntryKind;
  iconPath: string;
} {
  const normalized = path.replace(/\\/gu, '/');
  if (isWorkspaceDirectoryChipPath(normalized)) {
    return {
      chipClass: PLAN_CHIP_CLASS,
      iconClass: PLAN_CHIP_ICON_CLASS,
      iconKind: 'dir',
      iconPath: normalizeWorkspaceReferenceDirectoryPath(normalized),
    };
  }

  return {
    chipClass: WORKSPACE_FILE_CHIP_CLASS,
    iconClass: WORKSPACE_FILE_CHIP_ICON_CLASS,
    iconKind: 'file',
    iconPath: normalized,
  };
}

export function makeFileChipNode(path: string, doc: Document): HTMLElement {
  const normalized = path.replace(/\\/gu, "/");
  const presentation = resolveWorkspaceFileChipPresentation(normalized);
  const span = doc.createElement("span");
  span.contentEditable = "false";
  span.dataset.fileChip = "true";
  span.dataset.filePath = normalized;
  span.setAttribute("data-file-chip", "true");
  span.setAttribute("data-file-path", normalized);
  span.className = presentation.chipClass;
  span.title = normalized;

  appendWorkspaceExplorerIconSvg(span, doc, presentation.iconPath, {
    size: 10,
    className: presentation.iconClass,
  }, presentation.iconKind);

  span.appendChild(doc.createTextNode(workspaceFileBasename(normalized)));
  return span;
}
