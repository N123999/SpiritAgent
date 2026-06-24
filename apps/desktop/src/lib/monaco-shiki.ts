import { shikiToMonaco } from "@shikijs/monaco";
import * as monaco from "monaco-editor";
import { createHighlighter } from "shiki";

import {
  registerSpiritShikiPlusMonacoThemes,
  syncMonacoThemeFromDocument,
} from "@/lib/monaco-theme";
import { isMonacoShikiReady, setMonacoShikiReady } from "@/lib/monaco-shiki-state";
import {
  SPIRIT_SHIKI_PLUS_THEMES,
  SPIRIT_SHIKI_WORKSPACE_LANGS,
} from "@/lib/spirit-shiki-themes";

let monacoShikiReadyPromise: Promise<void> | null = null;

export { isMonacoShikiReady } from "@/lib/monaco-shiki-state";

/** 与 Streamdown 相同：Shiki TextMate 引擎 + dark-plus / light-plus 主题。 */
export function ensureMonacoShikiReady(): Promise<void> {
  if (isMonacoShikiReady()) {
    return Promise.resolve();
  }
  monacoShikiReadyPromise ??= initMonacoShiki().finally(() => {
    monacoShikiReadyPromise = null;
  });
  return monacoShikiReadyPromise;
}

async function initMonacoShiki(): Promise<void> {
  const highlighter = await createHighlighter({
    themes: [...SPIRIT_SHIKI_PLUS_THEMES],
    langs: [...SPIRIT_SHIKI_WORKSPACE_LANGS],
  });
  shikiToMonaco(highlighter, monaco);
  setMonacoShikiReady(true);
  registerSpiritShikiPlusMonacoThemes();
  syncMonacoThemeFromDocument();
}
