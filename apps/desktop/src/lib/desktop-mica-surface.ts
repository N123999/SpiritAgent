/** Mica 开启时主内容区背景不透明度（仅 tint，不叠加 CSS backdrop-blur）。 */
export const DESKTOP_MICA_CONTENT_TINT_CLASS = "bg-background/70";

/** 工作区浏览器页槽：略高于主区，减轻 WebView 透底闪烁。 */
export const DESKTOP_MICA_BROWSER_TINT_CLASS = "bg-background/80";

/** 工作区面板选中 tab：与面板底色衔接。 */
export const DESKTOP_MICA_WORKSPACE_TAB_SELECTED_TINT_CLASS = "bg-background/60";

/** 文件详情预览区（Blur 关）：轻 tint 与文件树区分。 */
export const DESKTOP_FILES_DETAIL_PREVIEW_TINT_CLASS = "bg-background/30";

const SOLID_BACKGROUND_CLASS = "bg-background";
const TRANSPARENT_BACKGROUND_CLASS = "bg-transparent";

/** 主内容区外层：Mica 下半透明主题底色，否则实心背景。 */
export function desktopMicaTintClass(useMicaBackdrop: boolean): string {
  return useMicaBackdrop ? DESKTOP_MICA_CONTENT_TINT_CLASS : SOLID_BACKGROUND_CLASS;
}

/** 主内容区内层：Mica 下透明以避免多层 alpha 叠深，否则实心背景。 */
export function desktopMicaTintInnerClass(useMicaBackdrop: boolean): string {
  return useMicaBackdrop ? TRANSPARENT_BACKGROUND_CLASS : SOLID_BACKGROUND_CLASS;
}

/** 工作区浏览器全屏页槽。 */
export function desktopMicaBrowserTintClass(useMicaBackdrop: boolean): string {
  return useMicaBackdrop ? DESKTOP_MICA_BROWSER_TINT_CLASS : SOLID_BACKGROUND_CLASS;
}

/** 工作区集成终端容器：Mica 下透明以避免与面板 tint 叠深，由 xterm 透明底透出面板 blur。 */
export function desktopMicaTerminalTintClass(useMicaBackdrop: boolean): string {
  return useMicaBackdrop ? TRANSPARENT_BACKGROUND_CLASS : SOLID_BACKGROUND_CLASS;
}

/** 工作区面板选中 tab：Mica 下轻 tint 以衔接面板底色。 */
export function desktopMicaWorkspaceTabSelectedClass(useMicaBackdrop: boolean): string {
  return useMicaBackdrop ? DESKTOP_MICA_WORKSPACE_TAB_SELECTED_TINT_CLASS : SOLID_BACKGROUND_CLASS;
}

/** 文件详情预览/编辑槽：Mica 下透明以避免与面板 tint 叠深，否则轻 tint。 */
export function desktopMicaFileDetailSurfaceClass(useMicaBackdrop: boolean): string {
  return useMicaBackdrop ? TRANSPARENT_BACKGROUND_CLASS : DESKTOP_FILES_DETAIL_PREVIEW_TINT_CLASS;
}
