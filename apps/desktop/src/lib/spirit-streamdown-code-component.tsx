import { isValidElement, type ComponentType, type ReactNode } from "react";
import type { Element } from "hast";
import type { CodeHighlighterPlugin } from "streamdown";
import { useIsCodeFenceIncomplete } from "streamdown";

import { MarkdownMermaidBlock } from "@/components/markdown-mermaid-block";
import { SpiritMessageCodeBlock } from "@/components/spirit-message-code-block";

const FENCE_LANGUAGE_PATTERN = /language-([^\s]+)/;

function extractFenceCode(children: ReactNode): string {
  if (
    isValidElement(children)
    && children.props
    && typeof children.props === "object"
    && "children" in children.props
    && typeof children.props.children === "string"
  ) {
    return children.props.children;
  }
  if (typeof children === "string") {
    return children;
  }
  return "";
}

function extractFenceLanguage(className?: string): string {
  const match = className?.match(FENCE_LANGUAGE_PATTERN);
  return match?.[1] ?? "";
}

type StreamdownCodeProps = {
  node?: Element;
  className?: string;
  children?: ReactNode;
  "data-block"?: boolean;
};

/**
 * 覆盖 Streamdown block code：仅传 inlineCode 时 block 仍走内置 handler，须传 components.code 统一拦截围栏。
 */
export function createSpiritStreamdownCodeComponent(
  codePlugin: CodeHighlighterPlugin,
  inlineCode: ComponentType<StreamdownCodeProps>,
  resolvedDark: boolean,
): ComponentType<StreamdownCodeProps> {
  return function SpiritStreamdownCode(props: StreamdownCodeProps) {
    const isInline = !("data-block" in props);
    if (isInline) {
      return inlineCode(props);
    }

    const language = extractFenceLanguage(props.className);
    const code = extractFenceCode(props.children);
    const isIncomplete = useIsCodeFenceIncomplete();

    if (language === "mermaid") {
      return (
        <MarkdownMermaidBlock
          code={code}
          language={language}
          isIncomplete={isIncomplete}
          resolvedDark={resolvedDark}
        />
      );
    }

    return (
      <SpiritMessageCodeBlock
        code={code}
        language={language}
        isIncomplete={isIncomplete}
        codePlugin={codePlugin}
      />
    );
  };
}
