import { MarkdownMessage } from "@/components/markdown-message";
import { cn } from "@/lib/utils";

export function WorkspacePrMarkdown({
  content,
  className,
}: {
  content: string;
  className?: string;
}) {
  return (
    <MarkdownMessage content={content} tone="muted" size="compact" allowHtml className={cn(className)} />
  );
}
