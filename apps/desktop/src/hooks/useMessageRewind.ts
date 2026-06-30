import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ClipboardEvent as ReactClipboardEvent,
  type DragEvent as ReactDragEvent,
} from "react";

import type { ComposerRichInputHandle } from "@/components/composer-rich-input";
import { segmentsToMessageText } from "@/components/composer-rich-input";
import { useLocalFileAttachmentPreviews } from "@/hooks/useLocalFileAttachmentPreviews";
import type { useDesktopRuntime } from "@/hooks/useDesktopRuntime";
import type { useSubagentViewer } from "@/hooks/useSubagentViewer";
import {
  messageContentToRichSegments,
  segmentsToAttachments,
  segmentsToPlainText,
} from "@/lib/composer-segment-model";
import {
  composerAttachmentViewFromPath,
  normalizeSlashPath as normalizeAttachmentPath,
  snapshotsToComposerAttachmentViews,
} from "@/lib/local-file-attachments";
import { canStartMessageRewind } from "@/lib/message-rewind-eligibility";
import {
  isComposerFileDropAccepted,
  resolveComposerDropAbsolutePaths,
  resolveComposerDropEffect,
} from "@/lib/composer-file-drop";
import type { ConversationMessageSnapshot, MessageRewindDraftState } from "@/types";

type DesktopRuntime = ReturnType<typeof useDesktopRuntime>;
type SubagentViewer = ReturnType<typeof useSubagentViewer>;

export type UseMessageRewindOptions = {
  runtime: DesktopRuntime;
  messages: readonly ConversationMessageSnapshot[];
  subagentViewer: SubagentViewer;
  messageRewindComposerEnabled: boolean;
  activeSessionReadOnly: boolean;
};

export function useMessageRewind({
  runtime,
  messages,
  subagentViewer,
  messageRewindComposerEnabled,
  activeSessionReadOnly,
}: UseMessageRewindOptions) {
  const [rewindDraft, setRewindDraft] = useState<MessageRewindDraftState | null>(null);
  const rewindRichInputRef = useRef<ComposerRichInputHandle | null>(null);

  useEffect(() => {
    if (rewindDraft && subagentViewer.active) {
      void subagentViewer.close();
    }
  }, [rewindDraft, subagentViewer]);

  useLocalFileAttachmentPreviews(
    rewindDraft?.localFileAttachments ?? [],
    (update) => {
      setRewindDraft((current) => {
        if (!current) {
          return current;
        }
        const localFileAttachments =
          typeof update === "function" ? update(current.localFileAttachments) : update;
        return { ...current, localFileAttachments };
      });
    },
    runtime.readLocalImagePreviewDataUrl,
  );

  useEffect(() => {
    if (!rewindDraft) {
      return;
    }
    const anchor = messages[rewindDraft.listIndex];
    const stillAvailable =
      anchor?.id === rewindDraft.messageId && anchor.canRewind === true;
    if (!stillAvailable) {
      setRewindDraft(null);
    }
  }, [messages, rewindDraft]);

  useLayoutEffect(() => {
    if (!rewindDraft) {
      return;
    }
    const focus = () => rewindRichInputRef.current?.focusAtEnd();
    queueMicrotask(focus);
    requestAnimationFrame(focus);
  }, [rewindDraft?.listIndex, rewindDraft?.messageId]);

  const startMessageRewind = useCallback(
    (message: ConversationMessageSnapshot, listIndex: number) => {
      if (!canStartMessageRewind({ messageRewindComposerEnabled, message })) {
        return;
      }
      const segments = messageContentToRichSegments(message.content, String(message.id));
      setRewindDraft({
        messageId: message.id,
        listIndex,
        text: segmentsToPlainText(segments),
        browserElementAttachments: segmentsToAttachments(segments),
        localFileAttachments: snapshotsToComposerAttachmentViews(message.localFileAttachments),
      });
    },
    [messageRewindComposerEnabled],
  );

  const submitMessageRewind = useCallback(() => {
    if (!rewindDraft) {
      return;
    }
    const segs = rewindRichInputRef.current?.getSegments() ?? [];
    const wireText = segmentsToMessageText(segs) || rewindDraft.text;
    void runtime
      .rewindAndSubmitMessage({
        messageId: rewindDraft.messageId,
        text: wireText,
        ...(rewindDraft.localFileAttachments.length > 0
          ? { localFilePaths: rewindDraft.localFileAttachments.map((item) => item.path) }
          : {}),
      })
      .then((ok) => {
        if (ok) {
          setRewindDraft(null);
        }
      });
  }, [rewindDraft, runtime]);

  const removeRewindLocalFileAttachment = useCallback((path: string) => {
    setRewindDraft((current) => {
      if (!current) {
        return current;
      }
      const localFileAttachments = current.localFileAttachments.filter(
        (item) => normalizeAttachmentPath(item.path) !== normalizeAttachmentPath(path),
      );
      return { ...current, localFileAttachments };
    });
  }, []);

  const attachRewindMediaFilePath = useCallback((filePath: string) => {
    setRewindDraft((current) => {
      if (!current) {
        return current;
      }
      const normalizedPath = normalizeAttachmentPath(filePath);
      if (
        current.localFileAttachments.some(
          (item) => normalizeAttachmentPath(item.path) === normalizedPath,
        )
      ) {
        return current;
      }
      return {
        ...current,
        localFileAttachments: [
          ...current.localFileAttachments,
          composerAttachmentViewFromPath(normalizedPath),
        ],
      };
    });
  }, []);

  const routeRewindLocalFilePath = useCallback(
    async (filePath: string) => {
      const route = await runtime.classifyLocalFileComposerRoute(filePath);
      if (route === "media") {
        attachRewindMediaFilePath(filePath);
        return;
      }
      rewindRichInputRef.current?.insertWorkspaceFileAtCaret(normalizeAttachmentPath(filePath));
      rewindRichInputRef.current?.focus();
    },
    [attachRewindMediaFilePath, runtime.classifyLocalFileComposerRoute],
  );

  const pickRewindLocalFileFromPalette = useCallback(() => {
    void runtime.pickLocalFile().then((filePath) => {
      if (!filePath) {
        return;
      }
      void routeRewindLocalFilePath(filePath);
    });
  }, [routeRewindLocalFilePath, runtime]);

  const handleRewindComposerPaste = useCallback(
    (event: ReactClipboardEvent<HTMLTextAreaElement>) => {
      if (activeSessionReadOnly || runtime.hostKind !== "electron" || !rewindDraft) {
        return;
      }

      const hasClipboardImage = Array.from(event.clipboardData?.items ?? []).some(
        (item) => item.kind === "file" && item.type.startsWith("image/"),
      );
      if (!hasClipboardImage) {
        return;
      }

      event.preventDefault();
      void runtime.ingestClipboardImage().then((filePath) => {
        if (filePath) {
          attachRewindMediaFilePath(filePath);
        }
      });
    },
    [activeSessionReadOnly, attachRewindMediaFilePath, rewindDraft, runtime],
  );

  const handleRewindComposerDragOver = useCallback(
    (event: ReactDragEvent<HTMLElement>) => {
      if (activeSessionReadOnly || runtime.hostKind !== "electron" || !rewindDraft) {
        return;
      }
      if (!isComposerFileDropAccepted(event.dataTransfer)) {
        return;
      }
      event.preventDefault();
      event.dataTransfer.dropEffect = resolveComposerDropEffect(event.dataTransfer);
    },
    [activeSessionReadOnly, rewindDraft, runtime.hostKind],
  );

  const handleRewindComposerDrop = useCallback(
    (event: ReactDragEvent<HTMLElement>) => {
      if (activeSessionReadOnly || runtime.hostKind !== "electron" || !rewindDraft) {
        return;
      }
      if (!isComposerFileDropAccepted(event.dataTransfer)) {
        return;
      }
      event.preventDefault();
      const paths = resolveComposerDropAbsolutePaths(event, {
        workspaceRoot: runtime.snapshot?.workspaceRoot ?? "",
        getPathForFile: runtime.getPathForDroppedFile,
      });
      for (const filePath of paths) {
        void routeRewindLocalFilePath(filePath);
      }
    },
    [
      activeSessionReadOnly,
      rewindDraft,
      routeRewindLocalFilePath,
      runtime.getPathForDroppedFile,
      runtime.hostKind,
      runtime.snapshot?.workspaceRoot,
    ],
  );

  return {
    rewindDraft,
    setRewindDraft,
    rewindRichInputRef,
    startMessageRewind,
    submitMessageRewind,
    removeRewindLocalFileAttachment,
    attachRewindLocalFilePath: routeRewindLocalFilePath,
    pickRewindLocalFileFromPalette,
    handleRewindComposerPaste,
    handleRewindComposerDragOver,
    handleRewindComposerDrop,
  };
}
