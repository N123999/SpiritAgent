import { useContext, useEffect, useMemo, useState } from "react";
import type { BundledLanguage, TokensResult } from "shiki";
import {
  CodeBlockContainer,
  StreamdownContext,
  type CodeHighlighterPlugin,
  type CustomRendererProps,
} from "streamdown";

import { ScrollArea } from "@/components/ui/scroll-area";
import {
  plainHighlightResult,
  renderHighlightedCodeBody,
  trimTrailingNewlines,
} from "@/lib/spirit-message-code-highlight";
import { SPIRIT_SHIKI_PLUS_THEMES } from "@/lib/spirit-shiki-themes";

export type SpiritMessageCodeBlockProps = CustomRendererProps & {
  codePlugin: CodeHighlighterPlugin;
};

function resolveHighlightLanguage(
  codePlugin: CodeHighlighterPlugin,
  language: string,
): BundledLanguage | null {
  const normalized = language.trim();
  if (!normalized) {
    return null;
  }
  if (codePlugin.supportsLanguage(normalized as BundledLanguage)) {
    return normalized as BundledLanguage;
  }
  return null;
}

export function SpiritMessageCodeBlock({
  code,
  language,
  isIncomplete,
  codePlugin,
}: SpiritMessageCodeBlockProps) {
  const { shikiTheme } = useContext(StreamdownContext);
  const themes = shikiTheme ?? [...SPIRIT_SHIKI_PLUS_THEMES];
  const resolvedLanguage = resolveHighlightLanguage(codePlugin, language);
  const normalizedCode = useMemo(() => trimTrailingNewlines(code), [code]);
  const plainResult = useMemo(() => plainHighlightResult(normalizedCode), [normalizedCode]);
  const [result, setResult] = useState<TokensResult>(plainResult);

  useEffect(() => {
    setResult(plainResult);
    if (!resolvedLanguage) {
      return;
    }

    const syncResult = codePlugin.highlight(
      { code: normalizedCode, language: resolvedLanguage, themes },
      (highlighted) => {
        setResult(highlighted as TokensResult);
      },
    );
    if (syncResult) {
      setResult(syncResult as TokensResult);
    }
  }, [codePlugin, normalizedCode, plainResult, resolvedLanguage, themes]);

  return (
    <CodeBlockContainer isIncomplete={isIncomplete} language={language}>
      <ScrollArea scrollbars="horizontal" className="w-full min-w-0">
        {renderHighlightedCodeBody(result)}
      </ScrollArea>
    </CodeBlockContainer>
  );
}
