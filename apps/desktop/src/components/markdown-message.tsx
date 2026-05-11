import { useEffect, useMemo, useState, type ComponentPropsWithoutRef } from "react";

import type { Components, UrlTransform } from "react-markdown";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";

import { cn } from "@/lib/utils";

type ReadManagedImagePreviewDataUrl = (reference: string) => Promise<string | null>;

const MANAGED_GENERATED_IMAGE_PREFIX = "spirit-image://generated/";

function isManagedGeneratedImageRef(value: string): boolean {
  return value.trim().toLowerCase().startsWith(MANAGED_GENERATED_IMAGE_PREFIX);
}

const markdownUrlTransform: UrlTransform = (url, _key, node) => {
  if (node.tagName === "img" && isManagedGeneratedImageRef(url)) {
    return url;
  }
  return defaultUrlTransform(url);
};

function MarkdownImage({
  className,
  src,
  alt,
  readManagedImagePreviewDataUrl,
  ...props
}: ComponentPropsWithoutRef<"img"> & {
  readManagedImagePreviewDataUrl?: ReadManagedImagePreviewDataUrl;
}) {
  const normalizedSrc = typeof src === "string" && src.trim().length > 0 ? src.trim() : null;
  const managedRef = normalizedSrc && isManagedGeneratedImageRef(normalizedSrc) ? normalizedSrc : null;
  const [resolvedSrc, setResolvedSrc] = useState<string | null>(managedRef ? null : normalizedSrc);

  useEffect(() => {
    let cancelled = false;

    if (!normalizedSrc) {
      setResolvedSrc(null);
      return () => {
        cancelled = true;
      };
    }

    if (!managedRef) {
      setResolvedSrc(normalizedSrc);
      return () => {
        cancelled = true;
      };
    }

    if (!readManagedImagePreviewDataUrl) {
      setResolvedSrc(null);
      return () => {
        cancelled = true;
      };
    }

    setResolvedSrc(null);
    void readManagedImagePreviewDataUrl(managedRef)
      .then((dataUrl: string | null) => {
        if (!cancelled) {
          setResolvedSrc(dataUrl);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setResolvedSrc(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [managedRef, normalizedSrc, readManagedImagePreviewDataUrl]);

  if (managedRef && !readManagedImagePreviewDataUrl) {
    return (
      <div className="my-3 flex min-h-28 w-full items-center justify-center rounded-md border border-dashed border-border/50 bg-muted/20 px-3 text-xs text-muted-foreground">
        当前宿主不支持预览 Spirit 托管图片。
      </div>
    );
  }

  if (managedRef && !resolvedSrc) {
    return (
      <div className="my-3 flex min-h-28 w-full items-center justify-center rounded-md border border-dashed border-border/50 bg-muted/20 px-3 text-xs text-muted-foreground">
        加载图片中…
      </div>
    );
  }

  if (!resolvedSrc) {
    return null;
  }

  return (
    <img
      className={cn(
        "my-3 block max-h-[28rem] w-auto max-w-full rounded-md border border-border/40 bg-background/40 object-contain shadow-sm",
        className,
      )}
      src={resolvedSrc}
      alt={alt}
      loading="lazy"
      {...props}
    />
  );
}

function createMarkdownComponents(
  readManagedImagePreviewDataUrl?: ReadManagedImagePreviewDataUrl,
): Partial<Components> {
  return {
    h1: ({ className, ...props }) => (
      <h1
        className={cn("mt-3 mb-2 text-lg font-semibold tracking-tight text-foreground first:mt-0", className)}
        {...props}
      />
    ),
    h2: ({ className, ...props }) => (
      <h2
        className={cn("mt-3 mb-1.5 text-base font-semibold tracking-tight text-foreground first:mt-0", className)}
        {...props}
      />
    ),
    h3: ({ className, ...props }) => (
      <h3 className={cn("mt-2 mb-1 text-sm font-semibold text-foreground first:mt-0", className)} {...props} />
    ),
    h4: ({ className, ...props }) => (
      <h4 className={cn("mt-2 mb-1 text-sm font-medium text-foreground first:mt-0", className)} {...props} />
    ),
    p: ({ className, ...props }) => (
      <p className={cn("mb-2 text-sm leading-relaxed text-foreground/95 last:mb-0", className)} {...props} />
    ),
    ul: ({ className, ...props }) => (
      <ul className={cn("mb-2 list-disc space-y-1 pl-5 text-sm leading-relaxed text-foreground/95 last:mb-0", className)} {...props} />
    ),
    ol: ({ className, ...props }) => (
      <ol className={cn("mb-2 list-decimal space-y-1 pl-5 text-sm leading-relaxed text-foreground/95 last:mb-0", className)} {...props} />
    ),
    li: ({ className, ...props }) => <li className={cn("break-words", className)} {...props} />,
    blockquote: ({ className, ...props }) => (
      <blockquote
        className={cn(
          "mb-2 border-l-2 border-muted-foreground/35 py-0.5 pl-3 text-sm leading-relaxed text-muted-foreground last:mb-0",
          className,
        )}
        {...props}
      />
    ),
    hr: ({ className, ...props }) => <hr className={cn("my-4 border-border/60", className)} {...props} />,
    a: ({ className, href, children, ...props }) => (
      <a
        className={cn("break-words text-primary underline underline-offset-2 hover:opacity-90", className)}
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        {...props}
      >
        {children}
      </a>
    ),
    strong: ({ className, ...props }) => <strong className={cn("font-semibold text-foreground", className)} {...props} />,
    em: ({ className, ...props }) => <em className={cn("italic", className)} {...props} />,
    del: ({ className, ...props }) => <del className={cn("line-through text-muted-foreground", className)} {...props} />,
    code: ({ className, children, ...props }) => (
      <code
        className={cn(
          "break-words font-mono text-[0.85em] leading-relaxed text-foreground",
          "rounded-md border border-border/40 bg-muted/60 px-1 py-px",
          "[pre>&]:m-0 [pre>&]:block [pre>&]:w-full [pre>&]:max-w-none [pre>&]:rounded-none [pre>&]:border-0 [pre>&]:bg-transparent [pre>&]:p-0 [pre>&]:text-xs [pre>&]:whitespace-pre",
          className,
        )}
        {...props}
      >
        {children}
      </code>
    ),
    pre: ({ className, children, ...props }) => (
      <pre
        className={cn(
          "mb-2 max-w-full overflow-x-auto rounded-md border border-border/40 bg-muted/30 p-3 font-mono text-xs leading-relaxed text-foreground last:mb-0",
          className,
        )}
        {...props}
      >
        {children}
      </pre>
    ),
    table: ({ className, children, ...props }) => (
      <div className="my-2 max-w-full overflow-x-auto last:mb-0">
        <table className={cn("w-full min-w-[12rem] border-collapse border border-border/50 text-sm", className)} {...props}>
          {children}
        </table>
      </div>
    ),
    thead: ({ className, ...props }) => <thead className={cn("bg-muted/40", className)} {...props} />,
    th: ({ className, ...props }) => (
      <th className={cn("border border-border/50 px-2 py-1.5 text-left font-medium text-foreground", className)} {...props} />
    ),
    td: ({ className, ...props }) => (
      <td className={cn("border border-border/50 px-2 py-1.5 align-top text-foreground/95", className)} {...props} />
    ),
    tr: ({ className, ...props }) => <tr className={cn("", className)} {...props} />,
    img: ({ className, ...props }) => (
      <MarkdownImage
        className={className}
        readManagedImagePreviewDataUrl={readManagedImagePreviewDataUrl}
        {...props}
      />
    ),
    input: ({ type, className, ...props }) => {
      if (type === "checkbox") {
        return (
          <input
            type="checkbox"
            readOnly
            className={cn("mr-1.5 align-middle", className)}
            {...props}
          />
        );
      }
      return <input type={type} className={className} {...props} />;
    },
  };
}

export function MarkdownMessage({
  content,
  className,
  readManagedImagePreviewDataUrl,
}: {
  content: string;
  className?: string;
  readManagedImagePreviewDataUrl?: ReadManagedImagePreviewDataUrl;
}) {
  const markdownComponents = useMemo(
    () => createMarkdownComponents(readManagedImagePreviewDataUrl),
    [readManagedImagePreviewDataUrl],
  );

  return (
    <div className={cn("min-w-0 break-words text-foreground/95", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={markdownComponents}
        urlTransform={markdownUrlTransform}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
