import { useState } from 'react'

import { File, X } from 'lucide-react'

const ATTACHMENT_VISUAL_CLASS = 'size-[18px]'

export interface ComposerLocalFileAttachmentView {
  id: string
  path: string
  name: string
  isImage: boolean
  previewDataUrl?: string | null
}

type ComposerLocalFileStripProps = {
  attachments: readonly ComposerLocalFileAttachmentView[]
  onRemove(path: string): void
}

function ComposerLocalFileCard({
  attachment,
  onRemove,
}: {
  attachment: ComposerLocalFileAttachmentView
  onRemove(path: string): void
}) {
  const [imageLoadFailed, setImageLoadFailed] = useState(false)
  const showImage = attachment.isImage && !imageLoadFailed && Boolean(attachment.previewDataUrl)

  return (
    <div className="inline-flex min-w-0 max-w-full items-center gap-1 rounded-md border border-border/30 bg-input/40 pl-1 pr-1.5 py-0.75 dark:border-white/[0.07] dark:bg-white/[0.03]">
      <button
        type="button"
        onClick={() => onRemove(attachment.path)}
        className="inline-flex size-[18px] shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
        aria-label={`移除 ${attachment.name}`}
      >
        <X className="size-3" aria-hidden />
      </button>
      {showImage ? (
        <img
          src={attachment.previewDataUrl ?? undefined}
          alt=""
          className={`${ATTACHMENT_VISUAL_CLASS} -ml-0.25 shrink-0 rounded-sm object-cover`}
          onError={() => setImageLoadFailed(true)}
        />
      ) : (
        <div className="-ml-0.25 inline-flex shrink-0 items-center justify-center rounded-sm text-muted-foreground">
          <File className={`${ATTACHMENT_VISUAL_CLASS} shrink-0`} aria-hidden />
        </div>
      )}
      <div className="min-w-0 pr-0.5">
        <div className="truncate text-xs leading-4 font-medium text-foreground/90" title={attachment.path}>
          {attachment.name}
        </div>
      </div>
    </div>
  )
}

export function ComposerLocalFileStrip({
  attachments,
  onRemove,
}: ComposerLocalFileStripProps) {
  if (attachments.length === 0) {
    return null
  }

  return (
    <div className="flex flex-wrap gap-1.5 pl-2 pr-3 pt-2 pb-1">
      {attachments.map((attachment) => (
        <ComposerLocalFileCard
          key={attachment.id}
          attachment={attachment}
          onRemove={onRemove}
        />
      ))}
    </div>
  )
}