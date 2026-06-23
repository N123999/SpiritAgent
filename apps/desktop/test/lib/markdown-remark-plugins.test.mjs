import assert from "node:assert/strict";
import { test } from "node:test";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import { visit } from "unist-util-visit";

import { spiritRemarkPluginsForReactMarkdown } from "../../src/lib/markdown-remark-plugins.ts";

function countHardBreaks(markdown, remarkPlugins) {
  let processor = unified().use(remarkParse);
  for (const plugin of remarkPlugins) {
    processor = processor.use(plugin);
  }
  const tree = processor.runSync(processor.parse(markdown));
  let breaks = 0;
  visit(tree, "break", () => {
    breaks += 1;
  });
  return breaks;
}

test("spirit remark plugins turn single newline inside paragraph into hard break", () => {
  const markdown = "主题\n我正在处理";
  const withSpiritPlugins = countHardBreaks(
    markdown,
    spiritRemarkPluginsForReactMarkdown,
  );
  const gfmOnly = countHardBreaks(markdown, [remarkGfm]);

  assert.equal(withSpiritPlugins, 1);
  assert.equal(gfmOnly, 0);
});

test("spirit remark plugins preserve two-line plain text breaks", () => {
  const markdown = "第一行文本\n第二行文本";
  const breaks = countHardBreaks(markdown, spiritRemarkPluginsForReactMarkdown);
  assert.equal(breaks, 1);
});
