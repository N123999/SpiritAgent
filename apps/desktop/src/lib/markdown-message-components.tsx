import type {
  AnchorHTMLAttributes,
  ComponentType,
  HTMLAttributes,
  ImgHTMLAttributes,
  InputHTMLAttributes,
} from "react";

import { MarkdownImage, type ReadManagedImagePreviewDataUrl } from "@/components/markdown-image";
import { cn } from "@/lib/utils";

export type MarkdownTone = "default" | "muted";

/** Shared element overrides for react-markdown and Streamdown. */
export function createMarkdownMessageComponents(
  readManagedImagePreviewDataUrl?: ReadManagedImagePreviewDataUrl,
  tone: MarkdownTone = "default",
): Record<string, ComponentType<Record<string, unknown>>> {
  const muted = tone === "muted";
  const bodyText = muted
    ? "text-sm leading-relaxed text-muted-foreground"
    : "text-sm leading-relaxed text-foreground/95";
  const headingText = muted ? "text-muted-foreground" : "text-foreground";
  const inlineCodeText = muted ? "text-muted-foreground" : "text-foreground";
  const blockCodeText = muted ? "text-muted-foreground" : "text-foreground";
  const tableCellText = muted ? "text-muted-foreground" : "text-foreground/95";

  return {
    h1: ({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) => (
      <h1
        className={cn(
          muted
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
          muted
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
    a: ({ className, href, children, ...props }: AnchorHTMLAttributes<HTMLAnchorElement>) => (
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
      <pre
        className={cn(
          "mb-2 max-w-full overflow-x-auto rounded-md border p-3 font-mono text-xs leading-relaxed last:mb-0",
          muted ? "border-border/30 bg-muted/20" : "border-border/40 bg-muted/30",
          blockCodeText,
          className,
        )}
        {...props}
      >
        {children}
      </pre>
    ),
    table: ({ className, children, ...props }: HTMLAttributes<HTMLTableElement>) => (
      <div className="my-2 max-w-full overflow-x-auto last:mb-0">
        <table
          className={cn(
            "w-full min-w-[12rem] border-collapse border border-border/50 text-sm",
            className,
          )}
          {...props}
        >
          {children}
        </table>
      </div>
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
    input: ({ type, className, ...props }: InputHTMLAttributes<HTMLInputElement>) => {
      if (type === "checkbox") {
        return (
          <input type="checkbox" readOnly className={cn("mr-1.5 align-middle", className)} {...props} />
        );
      }
      return <input type={type} className={className} {...props} />;
    },
  };
}

export function markdownMessageRootClassName(
  tone: MarkdownTone,
  className?: string,
): string {
  return cn(
    "min-w-0 break-words",
    tone === "muted" ? "font-sans text-sm leading-relaxed text-muted-foreground" : "text-foreground/95",
    className,
  );
}
