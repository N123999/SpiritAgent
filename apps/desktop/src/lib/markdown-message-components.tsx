import type {
  AnchorHTMLAttributes,
  ComponentPropsWithoutRef,
  ComponentType,
  HTMLAttributes,
  ImgHTMLAttributes,
  InputHTMLAttributes,
  MouseEvent,
} from "react";

import { MarkdownImage, type ReadManagedImagePreviewDataUrl } from "@/components/markdown-image";
import { MarkdownVideo, type ReadManagedVideoPreviewUrl } from "@/components/markdown-video";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { WorkspaceMarkdownLinkClickHandler } from "@/components/workspace-markdown-link-context";
import { cn } from "@/lib/utils";

export type MarkdownTone = "default" | "muted";
export type MarkdownSize = "default" | "compact";

/** Shared element overrides for Streamdown message rendering. */
export function createMarkdownMessageComponents(
  readManagedImagePreviewDataUrl?: ReadManagedImagePreviewDataUrl,
  tone: MarkdownTone = "default",
  readManagedVideoPreviewUrl?: ReadManagedVideoPreviewUrl,
  onLinkClick?: WorkspaceMarkdownLinkClickHandler,
  size: MarkdownSize = "default",
  allowHtml = false,
): Record<string, ComponentType<Record<string, unknown>>> {
  const compact = size === "compact";
  const muted = tone === "muted";
  const bodyText = muted
    ? compact
      ? "text-xs leading-relaxed text-foreground/80"
      : "text-sm leading-relaxed text-muted-foreground"
    : compact
      ? "text-xs leading-relaxed text-foreground/90"
      : "text-sm leading-relaxed text-foreground/95";
  const headingText = muted ? (compact ? "text-foreground/85" : "text-muted-foreground") : "text-foreground";
  const inlineCodeText = muted ? (compact ? "text-foreground/80" : "text-muted-foreground") : "text-foreground";
  const blockCodeText = inlineCodeText;
  const tableCellText = muted
    ? compact
      ? "text-foreground/80"
      : "text-muted-foreground"
    : compact
      ? "text-foreground/90"
      : "text-foreground/95";

  return {
    h1: ({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) => (
      <h1
        className={cn(
          compact
            ? "mt-2 mb-1.5 text-sm font-semibold tracking-tight first:mt-0"
            : muted
              ? "mt-2 mb-1.5 text-sm font-semibold tracking-tight first:mt-0"
              : "mt-3 mb-2 text-lg font-semibold tracking-tight first:mt-0",
          headingText,
          className,
        )}
        {...props}
      />
    ),
    h2: ({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) => (
      <h2
        className={cn(
          compact
            ? "mt-2 mb-1 text-xs font-semibold tracking-tight first:mt-0"
            : muted
              ? "mt-2 mb-1 text-sm font-semibold tracking-tight first:mt-0"
              : "mt-3 mb-1.5 text-base font-semibold tracking-tight first:mt-0",
          headingText,
          className,
        )}
        {...props}
      />
    ),
    h3: ({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) => (
      <h3
        className={cn("mt-2 mb-1 text-sm font-semibold first:mt-0", headingText, className)}
        {...props}
      />
    ),
    h4: ({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) => (
      <h4
        className={cn("mt-2 mb-1 text-sm font-medium first:mt-0", headingText, className)}
        {...props}
      />
    ),
    p: ({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) => (
      <p className={cn("mb-2 last:mb-0", bodyText, className)} {...props} />
    ),
    ul: ({ className, ...props }: HTMLAttributes<HTMLUListElement>) => (
      <ul className={cn("mb-2 list-disc space-y-1 pl-5 last:mb-0", bodyText, className)} {...props} />
    ),
    ol: ({ className, ...props }: HTMLAttributes<HTMLOListElement>) => (
      <ol
        className={cn("mb-2 list-decimal space-y-1 pl-5 last:mb-0", bodyText, className)}
        {...props}
      />
    ),
    li: ({ className, ...props }: HTMLAttributes<HTMLLIElement>) => (
      <li className={cn("break-words", className)} {...props} />
    ),
    blockquote: ({ className, ...props }: HTMLAttributes<HTMLQuoteElement>) => (
      <blockquote
        className={cn(
          "mb-2 border-l-2 border-muted-foreground/35 py-0.5 pl-3 text-sm leading-relaxed text-muted-foreground last:mb-0",
          className,
        )}
        {...props}
      />
    ),
    hr: ({ className, ...props }: HTMLAttributes<HTMLHRElement>) => (
      <hr className={cn("my-4 border-border/60", className)} {...props} />
    ),
    a: ({ className, href, children, onClick, ...props }: AnchorHTMLAttributes<HTMLAnchorElement>) => (
      <a
        className={cn(
          muted
            ? "break-words text-muted-foreground underline underline-offset-2 hover:text-foreground/80"
            : "break-words text-primary underline underline-offset-2 hover:opacity-90",
          className,
        )}
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(event: MouseEvent<HTMLAnchorElement>) => {
          onClick?.(event);
          const hrefValue = href?.trim();
          if (hrefValue && onLinkClick?.(hrefValue, event)) {
            event.preventDefault();
          }
        }}
        {...props}
      >
        {children}
      </a>
    ),
    strong: ({ className, ...props }: HTMLAttributes<HTMLElement>) => (
      <strong
        className={cn("font-semibold", muted ? "text-muted-foreground" : "text-foreground", className)}
        {...props}
      />
    ),
    em: ({ className, ...props }: HTMLAttributes<HTMLElement>) => (
      <em className={cn("italic", className)} {...props} />
    ),
    del: ({ className, ...props }: HTMLAttributes<HTMLElement>) => (
      <del className={cn("line-through text-muted-foreground", className)} {...props} />
    ),
    code: ({ className, children, ...props }: HTMLAttributes<HTMLElement>) => (
      <code
        className={cn(
          "break-words font-mono text-[0.85em] leading-relaxed",
          inlineCodeText,
          muted
            ? "rounded-md border border-border/30 bg-muted/40 px-1 py-px"
            : "rounded-md border border-border/40 bg-muted/60 px-1 py-px",
          "[pre>&]:m-0 [pre>&]:block [pre>&]:w-full [pre>&]:max-w-none [pre>&]:rounded-none [pre>&]:border-0 [pre>&]:bg-transparent [pre>&]:p-0 [pre>&]:text-xs [pre>&]:whitespace-pre",
          className,
        )}
        {...props}
      >
        {children}
      </code>
    ),
    pre: ({ className, children, ...props }: HTMLAttributes<HTMLPreElement>) => (
      <ScrollArea scrollbars="horizontal" className="mb-2 max-w-full min-w-0 last:mb-0">
        <pre
          className={cn(
            "w-max min-w-full rounded-md border p-3 font-mono leading-relaxed",
            compact ? "text-[11px]" : "text-xs",
            muted ? "border-border/30 bg-muted/20" : "border-border/40 bg-muted/30",
            blockCodeText,
            className,
          )}
          {...props}
        >
          {children}
        </pre>
      </ScrollArea>
    ),
    table: ({ className, children, ...props }: HTMLAttributes<HTMLTableElement>) => (
      <ScrollArea scrollbars="horizontal" className="my-2 max-w-full min-w-0 last:mb-0">
        <table
          className={cn(
            "w-max min-w-full border-collapse border border-border/50 text-sm",
            className,
          )}
          {...props}
        >
          {children}
        </table>
      </ScrollArea>
    ),
    thead: ({ className, ...props }: HTMLAttributes<HTMLTableSectionElement>) => (
      <thead className={cn("bg-muted/40", className)} {...props} />
    ),
    th: ({ className, ...props }: HTMLAttributes<HTMLTableCellElement>) => (
      <th
        className={cn(
          "border border-border/50 px-2 py-1.5 text-left font-medium",
          muted ? "text-muted-foreground" : "text-foreground",
          className,
        )}
        {...props}
      />
    ),
    td: ({ className, ...props }: HTMLAttributes<HTMLTableCellElement>) => (
      <td className={cn("border border-border/50 px-2 py-1.5 align-top", tableCellText, className)} {...props} />
    ),
    tr: ({ className, ...props }: HTMLAttributes<HTMLTableRowElement>) => (
      <tr className={cn("", className)} {...props} />
    ),
    img: ({ className, ...props }: ImgHTMLAttributes<HTMLImageElement>) => (
      <MarkdownImage
        className={className}
        readManagedImagePreviewDataUrl={readManagedImagePreviewDataUrl}
        {...props}
      />
    ),
    video: ({ className, ...props }: ComponentPropsWithoutRef<"video">) => (
      <MarkdownVideo
        className={className}
        readManagedVideoPreviewUrl={readManagedVideoPreviewUrl}
        {...props}
      />
    ),
    input: ({ type, className, ...props }: InputHTMLAttributes<HTMLInputElement>) => {
      if (type === "checkbox") {
        return (
          <input type="checkbox" readOnly className={cn("mr-1.5 align-middle", className)} {...props} />
        );
      }
      return <input type={type} className={className} {...props} />;
    },
    ...(allowHtml
      ? {
          picture: ({ className, children, ...props }: HTMLAttributes<HTMLPictureElement>) => (
            <picture className={cn("inline-block max-w-full", className)} {...props}>
              {children}
            </picture>
          ),
          source: (props: ComponentPropsWithoutRef<"source">) => <source {...props} />,
          sup: ({ className, ...props }: HTMLAttributes<HTMLElement>) => (
            <sup
              className={cn("text-[10px] leading-snug text-muted-foreground/80", className)}
              {...props}
            />
          ),
          sub: ({ className, ...props }: HTMLAttributes<HTMLElement>) => (
            <sub className={cn("text-[10px] leading-snug", className)} {...props} />
          ),
        }
      : {}),
  };
}

export function markdownMessageRootClassName(
  tone: MarkdownTone,
  className?: string,
  size: MarkdownSize = "default",
): string {
  const compact = size === "compact";
  return cn(
    "min-w-0 break-words",
    compact
      ? tone === "muted"
        ? "text-xs leading-relaxed text-foreground/80"
        : "text-xs leading-relaxed text-foreground/90"
      : tone === "muted"
        ? "font-sans text-sm leading-relaxed text-muted-foreground"
        : "text-foreground/95",
    className,
  );
}
