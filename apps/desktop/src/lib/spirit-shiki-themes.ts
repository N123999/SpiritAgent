/** Streamdown 与 Workspace Monaco 共用的 Shiki VS Code 主题（与 @streamdown/code 默认一致）。 */
export const SPIRIT_SHIKI_PLUS_THEMES = ["light-plus", "dark-plus"] as const;

export type SpiritShikiPlusTheme = (typeof SPIRIT_SHIKI_PLUS_THEMES)[number];

export const SPIRIT_MONACO_SHIKI_LIGHT = "light-plus" satisfies SpiritShikiPlusTheme;
export const SPIRIT_MONACO_SHIKI_DARK = "dark-plus" satisfies SpiritShikiPlusTheme;

/** Workspace 文件树常见扩展名对应的 Shiki 语法（与 monacoLanguageId 对齐）。 */
export const SPIRIT_SHIKI_WORKSPACE_LANGS = [
  "typescript",
  "javascript",
  "json",
  "markdown",
  "css",
  "scss",
  "less",
  "html",
  "yaml",
  "rust",
  "python",
  "xml",
  "sql",
  "shell",
  "powershell",
  "ini",
] as const;
