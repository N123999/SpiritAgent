import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Code2, X } from "lucide-react";

import {
  BROWSER_ELEMENT_CARD_SHELL_CLASS,
  BROWSER_ELEMENT_CHIP_ICON_CLASS,
  BROWSER_ELEMENT_CHIP_REMOVE_CLASS,
} from "@/lib/browser-element-chip-styles";
import type { BrowserElementAttachment } from "@/lib/browser-element-attachment";

export { BROWSER_ELEMENT_CHIP_CLASS } from "@/lib/browser-element-chip-styles";

type BrowserElementCardProps = {
  attachment: BrowserElementAttachment;
  readOnly?: boolean;
  onRemove?(id: string): void;
};

export function BrowserElementCard({
  attachment,
  readOnly = false,
  onRemove,
}: BrowserElementCardProps) {
  const { t } = useTranslation();
  const [imgError, setImgError] = useState(false);

  return (
    <div className={BROWSER_ELEMENT_CARD_SHELL_CLASS}>
      {!readOnly && onRemove ? (
        <button
          type="button"
          onClick={() => onRemove(attachment.id)}
          className={BROWSER_ELEMENT_CHIP_REMOVE_CLASS}
          aria-label={t("composer.removeAttachment", { name: attachment.tagName })}
        >
          <X className="size-3" aria-hidden />
        </button>
      ) : null}
      {!imgError && attachment.screenshotDataUrl ? (
        <img
          src={attachment.screenshotDataUrl}
          alt=""
          className="-ml-0.25 size-[18px] shrink-0 rounded-sm object-cover"
          onError={() => setImgError(true)}
        />
      ) : (
        <div
          className={`-ml-0.25 inline-flex size-[18px] shrink-0 items-center justify-center rounded-sm ${BROWSER_ELEMENT_CHIP_ICON_CLASS}`}
        >
          <Code2 className="size-[14px] shrink-0" aria-hidden />
        </div>
      )}
      <div className="min-w-0 pr-0.5">
        <div
          className={`truncate text-xs leading-4 font-medium ${BROWSER_ELEMENT_CHIP_ICON_CLASS}`}
          title={attachment.pageUrl}
        >
          {"<"}{attachment.tagName}{">"}
        </div>
      </div>
    </div>
  );
}

type BrowserElementStripProps = {
  attachments: readonly BrowserElementAttachment[];
  readOnly?: boolean;
  className?: string;
  onRemove?(id: string): void;
};

export function BrowserElementStrip({
  attachments,
  readOnly = false,
  className,
  onRemove,
}: BrowserElementStripProps) {
  if (attachments.length === 0) return null;

  return (
    <div className={className ?? "flex flex-wrap gap-1.5 pl-2 pr-3 pt-2 pb-1"}>
      {attachments.map((attachment) => (
        <BrowserElementCard
          key={attachment.id}
          attachment={attachment}
          readOnly={readOnly}
          onRemove={onRemove}
        />
      ))}
    </div>
  );
}
