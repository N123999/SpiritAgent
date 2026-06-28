import {
  useMemo,
  useState,
  type ClipboardEvent as ReactClipboardEvent,
  type DragEvent as ReactDragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type RefObject,
} from "react";
import { useTranslation } from "react-i18next";

import { ArrowUp, LoaderCircle, Square } from "lucide-react";

import {
  ComposerAbortShortcutKbd,
  ComposerSendEnterKbd,
} from "@/components/composer/composer-shortcut-kbds";
import {
  ComposerLocalFileStrip,
  type ComposerLocalFileAttachmentView,
} from "@/components/composer-local-file-strip";
import { ComposerInsertMenu } from "@/components/composer-insert-menu";
import {
  ComposerRichInput,
  type ComposerRichInputHandle,
  type RichSegment,
} from "@/components/composer-rich-input";
import { ModelPickerMenu } from "@/components/model-picker-menu";
import { Button } from "@/components/ui/button";
import type { SaveLocalImageAs } from "@/components/tool-call/tool-call-types";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { DesktopAgentMode } from "@/lib/agent-mode";
import type { BrowserElementAttachment } from "@/lib/browser-element-attachment";
import {
  DESKTOP_COMPOSER_SURFACE_BACKDROP,
  instantHoverMotionClass,
} from "@/lib/desktop-chrome";
import { cn } from "@/lib/utils";
import type { DesktopModelReasoningEffort, DesktopSnapshot } from "@/types";

function isComposerChromeInteractiveTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  return Boolean(
    target.closest(
      'button, a, input, textarea, select, [contenteditable="true"], [role="button"], [role="combobox"], [role="menuitem"], [role="option"], [data-composer-chrome-static]',
    ),
  );
}

export type ComposerSurfaceProps = {
  value: string;
  localFileAttachments: readonly ComposerLocalFileAttachmentView[];
  placeholder: string;
  models: DesktopSnapshot["config"]["models"];
  catalogHints?: DesktopSnapshot["config"]["modelCatalogHints"];
  activeModel: string;
  agentMode: DesktopAgentMode;
  loopEnabled: boolean;
  canSend: boolean;
  canAbort?: boolean;
  busy: boolean;
  readOnly?: boolean;
  onChange(value: string): void;
  onSubmit(): void;
  onAbort?(): void;
  onModelSelect(name: string): void;
  onModelReasoningEffortSelect(name: string, reasoningEffort: DesktopModelReasoningEffort): void;
  onModelThinkingEnabledSelect?(name: string, enabled: boolean): void | Promise<boolean>;
  onAgentModeChange(mode: DesktopAgentMode): void;
  onLoopEnabledChange?(enabled: boolean): void;
  richInputRef?: RefObject<ComposerRichInputHandle | null>;
  onKeyDown?(event: ReactKeyboardEvent<HTMLTextAreaElement>): void;
  onSelectionChange?(selectionStart: number | null): void;
  showInsertButton?: boolean;
  canPickLocalFile?: boolean;
  onInsertWorkspaceFileReferenceTrigger?(): void;
  onPickLocalFile?(): void | Promise<void>;
  onInsertSkillTrigger?(): void;
  onRemoveLocalFileAttachment?(path: string): void;
  onPaste?(event: ReactClipboardEvent<HTMLTextAreaElement>): void;
  onDragOver?(event: ReactDragEvent<HTMLElement>): void;
  onDrop?(event: ReactDragEvent<HTMLElement>): void;
  browserElementAttachments?: readonly BrowserElementAttachment[];
  onElementAttachmentsChange?(attachments: BrowserElementAttachment[]): void;
  onSegmentsCommit?(): void;
  initialSegments?: readonly RichSegment[] | null;
  conversationBusy?: boolean;
  agentModeChipDismissed?: boolean;
  onAgentModeChipDismissChange?(dismissed: boolean): void;
  saveLocalImageAs?: SaveLocalImageAs;
};

export function ComposerSurface({
  value,
  localFileAttachments,
  placeholder,
  models,
  catalogHints,
  activeModel,
  agentMode,
  loopEnabled = false,
  canSend,
  canAbort = false,
  busy,
  readOnly = false,
  onChange,
  onSubmit,
  onAbort,
  onModelSelect,
  onModelReasoningEffortSelect,
  onModelThinkingEnabledSelect,
  onAgentModeChange,
  onLoopEnabledChange,
  richInputRef,
  onKeyDown,
  onSelectionChange,
  showInsertButton = false,
  canPickLocalFile = false,
  onInsertWorkspaceFileReferenceTrigger,
  onPickLocalFile,
  onInsertSkillTrigger,
  onRemoveLocalFileAttachment,
  onPaste,
  onDragOver,
  onDrop,
  browserElementAttachments,
  onElementAttachmentsChange,
  onSegmentsCommit,
  initialSegments,
  conversationBusy = false,
  agentModeChipDismissed = false,
  onAgentModeChipDismissChange,
  saveLocalImageAs,
}: ComposerSurfaceProps) {
  const { t } = useTranslation();
  const [fileDragOver, setFileDragOver] = useState(false);
  const activeModelProfile = useMemo(
    () => models.find((model) => model.name === activeModel),
    [activeModel, models],
  );

  const focusRichInput = () => {
    if (!readOnly) {
      richInputRef?.current?.focus();
    }
  };

  const handleComposerChromeMouseDown = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (readOnly || isComposerChromeInteractiveTarget(event.target)) {
      return;
    }
    event.preventDefault();
    focusRichInput();
  };

  const handleSurfaceDragOver = (event: ReactDragEvent<HTMLDivElement>) => {
    onDragOver?.(event);
    if (event.defaultPrevented) {
      setFileDragOver(true);
    }
  };

  const handleSurfaceDragLeave = (event: ReactDragEvent<HTMLDivElement>) => {
    const related = event.relatedTarget;
    if (related instanceof Node && event.currentTarget.contains(related)) {
      return;
    }
    setFileDragOver(false);
  };

  const handleSurfaceDrop = (event: ReactDragEvent<HTMLDivElement>) => {
    setFileDragOver(false);
    onDrop?.(event);
  };

  return (
    <div
      data-spirit-surface="composer-surface"
      className={cn(
        "relative overflow-hidden rounded-2xl border border-border/50 shadow-sm focus-within:ring-0 hover:border-ring/60 focus-within:border-ring/60 dark:border-white/10 dark:hover:border-white/12 dark:focus-within:border-white/12",
        fileDragOver && "border-ring/60 dark:border-white/12",
        DESKTOP_COMPOSER_SURFACE_BACKDROP,
      )}
      onDragOver={handleSurfaceDragOver}
      onDragLeave={handleSurfaceDragLeave}
      onDrop={handleSurfaceDrop}
    >
      {localFileAttachments.length > 0 ? (
        <div className="cursor-text" onMouseDown={handleComposerChromeMouseDown}>
          <ComposerLocalFileStrip
            attachments={localFileAttachments}
            onRemove={(path) => onRemoveLocalFileAttachment?.(path)}
            saveLocalImageAs={saveLocalImageAs}
          />
        </div>
      ) : null}
      <ComposerRichInput
        ref={richInputRef}
        value={value}
        elementAttachments={browserElementAttachments}
        initialSegments={initialSegments}
        placeholder={placeholder}
        readOnly={readOnly}
        loopEnabled={loopEnabled}
        loopChipLabel={t('composer.loopChipLabel')}
        agentMode={agentMode}
        planChipLabel={t('composer.planChipLabel')}
        askChipLabel={t('composer.askChipLabel')}
        onTextChange={onChange}
        onElementAttachmentsChange={(atts) => onElementAttachmentsChange?.(atts)}
        onSegmentsCommit={onSegmentsCommit}
        onLoopEnabledChange={onLoopEnabledChange}
        onAgentModeChange={onAgentModeChange}
        conversationBusy={conversationBusy}
        agentModeChipDismissed={agentModeChipDismissed}
        onAgentModeChipDismissChange={onAgentModeChipDismissChange}
        onPaste={(e) => onPaste?.(e as unknown as ReactClipboardEvent<HTMLTextAreaElement>)}
        onKeyDown={(e) => {
          onKeyDown?.(e as unknown as ReactKeyboardEvent<HTMLTextAreaElement>);
          if (e.defaultPrevented) return;
          if (
            e.key === 'Enter' &&
            !e.shiftKey &&
            !e.ctrlKey &&
            !e.metaKey &&
            // React synthetic event 的 isComposing 不可靠，必须用 nativeEvent 检测 IME 组合态
            !e.nativeEvent.isComposing
          ) {
            e.preventDefault();
            if (canSend) onSubmit();
          }
        }}
        onSelectionChange={onSelectionChange}
      />
      <div
        className="cursor-text px-3 pt-0.5 pb-2"
        onMouseDown={handleComposerChromeMouseDown}
      >
        <div className="flex w-full max-w-full items-center justify-between gap-2">
          <div className="flex min-w-0 flex-1 items-center gap-1.5">
            {showInsertButton ? (
              <div className="shrink-0">
                <ComposerInsertMenu
                  disabled={readOnly}
                  canPickLocalFile={canPickLocalFile}
                  onInsertWorkspaceReference={() => onInsertWorkspaceFileReferenceTrigger?.()}
                  onPickLocalFile={() => onPickLocalFile?.()}
                  onInsertSkillTrigger={() => onInsertSkillTrigger?.()}
                />
              </div>
            ) : null}
            <ModelPickerMenu
              models={models}
              catalogHints={catalogHints}
              activeModelName={activeModel}
              activeReasoningEffort={activeModelProfile?.reasoningEffort}
              disabled={readOnly}
              onModelSelect={onModelSelect}
              onModelReasoningEffortSelect={onModelReasoningEffortSelect}
              onModelThinkingEnabledSelect={onModelThinkingEnabledSelect}
              triggerClassName="max-w-[min(12rem,100%)] pr-0.5 pl-1"
              menuContentClassName="z-[100]"
            />
          </div>
          {(() => {
            const hasComposerPayload =
              value.trim().length > 0 || localFileAttachments.length > 0;
            const showAbortButton = canAbort && Boolean(onAbort) && !hasComposerPayload;
            const showEnqueueWhileBusy = canAbort && hasComposerPayload;
            const sendDisabled = showAbortButton ? false : !canSend || (busy && !canAbort);
            const actionAriaLabel = showAbortButton
              ? t("app.abort")
              : showEnqueueWhileBusy
                ? t("composer.enqueueWhileBusy")
                : t("app.send");
            const actionButton = (
              <Button
                type="button"
                className={cn(
                  "size-8 shrink-0 rounded-full p-0 shadow-none [&_svg]:size-3.5",
                  instantHoverMotionClass,
                  sendDisabled &&
                    "disabled:pointer-events-auto disabled:cursor-default disabled:active:translate-y-0",
                )}
                onClick={showAbortButton ? onAbort : onSubmit}
                disabled={sendDisabled}
                aria-label={actionAriaLabel}
              >
                {showAbortButton ? (
                  <Square className="size-3.5" strokeWidth={2.4} aria-hidden />
                ) : busy ? (
                  <LoaderCircle className="size-3.5 animate-spin" />
                ) : (
                  <ArrowUp className="size-3.5" strokeWidth={2.25} aria-hidden />
                )}
              </Button>
            );

            if (sendDisabled) {
              return actionButton;
            }

            return (
              <Tooltip delayDuration={300} disableHoverableContent>
                <TooltipTrigger asChild>{actionButton}</TooltipTrigger>
                <TooltipContent side="top" sideOffset={4}>
                  {showAbortButton ? (
                    <>
                      {t("app.abort")} <ComposerAbortShortcutKbd />
                    </>
                  ) : showEnqueueWhileBusy ? (
                    t("composer.enqueueWhileBusy")
                  ) : (
                    <>
                      {t("app.send")} <ComposerSendEnterKbd />
                    </>
                  )}
                </TooltipContent>
              </Tooltip>
            );
          })()}
        </div>
      </div>
    </div>
  );
}
