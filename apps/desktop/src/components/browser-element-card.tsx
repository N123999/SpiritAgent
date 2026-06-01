import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Code2, X } from "lucide-react";

import type { BrowserElementAttachment } from "@/lib/browser-element-attachment";

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
    <div className="inline-flex min-w-0 max-w-[12rem] items-center gap-1 rounded-md border border-blue-700/60 bg-blue-950 pl-1 pr-1.5 py-0.75">
      {!readOnly && onRemove ? (
        <button
          type="button"
          onClick={() => onRemove(attachment.id)}
          className="inline-flex size-[18px] shrink-0 items-center justify-center rounded-full text-blue-400 transition-colors hover:bg-blue-900 hover:text-blue-200"
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
        <div className="-ml-0.25 inline-flex size-[18px] shrink-0 items-center justify-center rounded-sm text-blue-400">
          <Code2 className="size-[14px] shrink-0" aria-hidden />
        </div>
      )}
      <div className="min-w-0 pr-0.5">
        <div className="truncate text-xs leading-4 font-medium text-blue-400" title={attachment.pageUrl}>
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
