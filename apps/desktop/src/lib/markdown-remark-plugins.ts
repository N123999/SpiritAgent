import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import { defaultRemarkPlugins } from "streamdown";
import type { Pluggable } from "unified";

/** react-markdown：GFM + 单换行转硬换行（思考摘要等模型输出）。 */
export const spiritRemarkPluginsForReactMarkdown: Pluggable[] = [
  remarkGfm,
  remarkBreaks,
];

/** Streamdown：保留默认 remark 插件并追加 remark-breaks。 */
export const spiritRemarkPluginsForStreamdown: Pluggable[] = [
  ...Object.values(defaultRemarkPlugins),
  remarkBreaks,
];
