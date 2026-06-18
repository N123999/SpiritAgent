import type { CSSProperties } from "react";

/** 横向末端渐隐（workspace 选项卡关闭按钮等）：略强于默认 50%，实心区仅限 X 附近。 */
export const maskFadeHorizontalEnd: CSSProperties = {
  maskImage: "linear-gradient(to right, transparent 0%, black 42%)",
  WebkitMaskImage: "linear-gradient(to right, transparent 0%, black 42%)",
};

/** 会话侧栏：顶栏按钮与下方滚动列表之间的固定间距（与渐隐遮罩 / Mica 无关）。 */
export const sidebarSessionsScrollTopGapClass = "pt-4";
