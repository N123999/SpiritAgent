import refractor from 'refractor/core';
import bash from 'refractor/lang/bash.js';
import css from 'refractor/lang/css.js';
import ini from 'refractor/lang/ini.js';
import javascript from 'refractor/lang/javascript.js';
import json from 'refractor/lang/json.js';
import jsx from 'refractor/lang/jsx.js';
import less from 'refractor/lang/less.js';
import markdown from 'refractor/lang/markdown.js';
import markup from 'refractor/lang/markup.js';
import python from 'refractor/lang/python.js';
import rust from 'refractor/lang/rust.js';
import scss from 'refractor/lang/scss.js';
import tsx from 'refractor/lang/tsx.js';
import typescript from 'refractor/lang/typescript.js';
import yaml from 'refractor/lang/yaml.js';

const REGISTERED = [
  bash,
  css,
  ini,
  javascript,
  json,
  jsx,
  less,
  markdown,
  markup,
  python,
  rust,
  scss,
  tsx,
  typescript,
  yaml,
] as const;

for (const grammar of REGISTERED) {
  refractor.register(grammar);
}

export const toolDiffRefractor = refractor;

const LANGUAGE_ALIASES: Record<string, string> = {
  jsonc: 'json',
  md: 'markdown',
  mdx: 'markdown',
  html: 'markup',
  htm: 'markup',
  xml: 'markup',
  svg: 'markup',
  yml: 'yaml',
  shell: 'bash',
  sh: 'bash',
  ps1: 'bash',
  toml: 'ini',
  plaintext: '',
};

/** monacoLanguageId / file-tool-diff-source 的 languageId → refractor 语法名；undefined 表示不高亮。 */
export function refractorLanguageForPath(languageId: string): string | undefined {
  const normalized = languageId.trim().toLowerCase();
  if (!normalized || normalized === 'plaintext') {
    return undefined;
  }
  const aliased = LANGUAGE_ALIASES[normalized] ?? normalized;
  if (!aliased) {
    return undefined;
  }
  return refractor.registered(aliased) ? aliased : undefined;
}
