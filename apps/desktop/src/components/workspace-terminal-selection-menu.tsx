import { useCallback, type RefObject } from "react";
import { useTranslation } from "react-i18next";

import {
  TextSelectionActionMenu,
  TextSelectionActionMenuItem,
} from "@/components/text-selection-action-menu";
import { useTerminalSelectionActionMenu, readTerminalSelectionLineRange } from "@/hooks/use-terminal-selection-action-menu";
import type { TerminalSnippetAttachment } from "@/lib/terminal-snippet-attachment";
import type { Terminal } from "@xterm/xterm";

function TerminalSelectionMenu({
  containerRef,
  terminal,
  terminalDisplayName,
  onTerminalAddToSession,
}: {
  containerRef: RefObject<HTMLElement | null>;
  terminal: Terminal | null;
  terminalDisplayName: string;
  onTerminalAddToSession?: (attachment: TerminalSnippetAttachment) => void;
}) {
  const { t } = useTranslation();
  const enabled = Boolean(onTerminalAddToSession);
  const { open, setOpen, anchor, selectionText, lineRange, dismiss } = useTerminalSelectionActionMenu({
    enabled,
    containerRef,
    terminal,
  });

  const handleAddToSession = useCallback(() => {
    const term = terminal;
    if (!term || !onTerminalAddToSession) {
      dismiss();
      return;
    }

    const selectedText = (selectionText.trim() || term.getSelection()).trim();
    if (!selectedText) {
      dismiss();
      return;
    }

    const range = readTerminalSelectionLineRange(term) ?? lineRange ?? { lineStart: 0, lineEnd: 0 };
    const attachment: TerminalSnippetAttachment = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      terminalName: terminalDisplayName,
      lineStart: range.lineStart,
      lineEnd: range.lineEnd,
      selectedText,
    };
    onTerminalAddToSession(attachment);
    dismiss();
    term.clearSelection();
  }, [dismiss, lineRange, onTerminalAddToSession, selectionText, terminal, terminalDisplayName]);

  if (!enabled) {
    return null;
  }

  return (
    <TextSelectionActionMenu open={open && Boolean(selectionText.trim())} anchor={anchor} onOpenChange={setOpen}>
      <TextSelectionActionMenuItem
        label={t("workspace.prAddDiffToSession")}
        onSelect={handleAddToSession}
      />
    </TextSelectionActionMenu>
  );
}

export { TerminalSelectionMenu };
