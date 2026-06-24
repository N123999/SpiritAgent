import { joinWorkspaceAbsolutePath } from "@/lib/workspace-entry-path-sync";
import { normalizeSlashPath } from "@/lib/local-file-attachments";

export const SPIRIT_WORKSPACE_ENTRY_MIME = "application/spirit-workspace-entry";

export function isComposerFileDropAccepted(dataTransfer: DataTransfer): boolean {
  const types = Array.from(dataTransfer.types);
  return types.includes("Files") || types.includes(SPIRIT_WORKSPACE_ENTRY_MIME);
}

export type ResolveComposerDropPathsOptions = {
  workspaceRoot: string;
  getPathForFile: (file: File) => string | null;
};

export function resolveComposerDropAbsolutePaths(
  event: Pick<DragEvent, "dataTransfer">,
  options: ResolveComposerDropPathsOptions,
): string[] {
  const { workspaceRoot, getPathForFile } = options;
  const paths: string[] = [];
  const seen = new Set<string>();

  const pushUniquePath = (value: string) => {
    const key = normalizeSlashPath(value);
    if (!key || seen.has(key)) {
      return;
    }
    seen.add(key);
    paths.push(value);
  };

  const spiritRaw = event.dataTransfer.getData(SPIRIT_WORKSPACE_ENTRY_MIME);
  if (spiritRaw) {
    try {
      const payload = JSON.parse(spiritRaw) as { relativePath?: string; kind?: string };
      if (payload.kind === "file" && payload.relativePath && workspaceRoot.trim()) {
        pushUniquePath(joinWorkspaceAbsolutePath(workspaceRoot, payload.relativePath));
      }
    } catch {
      // 无效 payload 与空 drop 一致：静默忽略
    }
    return paths;
  }

  for (const file of Array.from(event.dataTransfer.files)) {
    const absolutePath = getPathForFile(file);
    if (absolutePath) {
      pushUniquePath(absolutePath);
    }
  }

  return paths;
}
