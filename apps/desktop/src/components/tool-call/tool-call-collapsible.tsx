import { MinimalToolCallCard } from "@/components/minimal-tool-call-card";
import { ImageGenerationToolCard } from "@/components/tool-call/image-generation-tool-card";
import type {
  ReadLocalImagePreview,
  ReadLocalVideoPreview,
  ReadManagedVideoPreview,
  SaveLocalImageAs,
} from "@/components/tool-call/tool-call-types";
import { VideoGenerationToolCard } from "@/components/tool-call/video-generation-tool-card";
import type { EditorFileTarget } from "@/lib/workspace-editor-navigation";
import type { ToolBlockSnapshot } from "@/types";

export function ToolCallCollapsible({
  tool,
  workspaceRoot = "",
  readLocalImagePreviewDataUrl,
  readLocalVideoPreviewUrl,
  readManagedVideoPreviewUrl,
  saveLocalImageAs,
  onOpenSubagentViewer,
  onOpenReadFile,
  onAbortShell,
}: {
  tool: ToolBlockSnapshot;
  workspaceRoot?: string;
  readLocalImagePreviewDataUrl: ReadLocalImagePreview;
  readLocalVideoPreviewUrl: ReadLocalVideoPreview;
  readManagedVideoPreviewUrl: ReadManagedVideoPreview;
  saveLocalImageAs: SaveLocalImageAs;
  onOpenSubagentViewer?: (toolCallId: string) => void;
  onOpenReadFile?: (target: EditorFileTarget) => void;
  onAbortShell?: (toolCallId: string) => void;
}) {
  if (tool.toolName === "finish_task") {
    return null;
  }

  if (tool.toolName === "generate_image") {
    return (
      <ImageGenerationToolCard
        tool={tool}
        readLocalImagePreviewDataUrl={readLocalImagePreviewDataUrl}
        saveLocalImageAs={saveLocalImageAs}
      />
    );
  }

  if (tool.toolName === "generate_video") {
    return (
      <VideoGenerationToolCard
        tool={tool}
        readLocalVideoPreviewUrl={readLocalVideoPreviewUrl}
        readManagedVideoPreviewUrl={readManagedVideoPreviewUrl}
      />
    );
  }

  return (
    <MinimalToolCallCard
      tool={tool}
      workspaceRoot={workspaceRoot}
      onOpenSubagentViewer={onOpenSubagentViewer}
      onOpenReadFile={onOpenReadFile}
      onAbortShell={onAbortShell}
    />
  );
}
