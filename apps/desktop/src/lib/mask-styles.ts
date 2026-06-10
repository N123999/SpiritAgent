import type { CSSProperties } from "react";

/** 横向末端渐隐（workspace 选项卡关闭按钮等）。 */
export const maskFadeHorizontalEnd: CSSProperties = {
  maskImage: "linear-gradient(to right, transparent, black 50%)",
  WebkitMaskImage: "linear-gradient(to right, transparent, black 50%)",
};

/** 会话侧栏：顶栏按钮与下方滚动列表之间的固定间距（与渐隐遮罩 / Mica 无关）。 */
export const sidebarSessionsScrollTopGapClass = "pt-4";
