/** Mica 开启时主内容区背景不透明度（仅 tint，不叠加 CSS backdrop-blur）。 */
export const DESKTOP_MICA_CONTENT_TINT_CLASS = "bg-background/70";

/** 工作区浏览器页槽：略高于主区，减轻 WebView 透底闪烁。 */
export const DESKTOP_MICA_BROWSER_TINT_CLASS = "bg-background/80";

/** 工作区终端：保留较高不透明度以保证 ANSI 可读性。 */
export const DESKTOP_MICA_TERMINAL_TINT_CLASS = "bg-background/87";

/** 工作区面板选中 tab：与面板底色衔接。 */
export const DESKTOP_MICA_WORKSPACE_TAB_SELECTED_TINT_CLASS = "bg-background/60";

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

/** 工作区集成终端容器。 */
export function desktopMicaTerminalTintClass(useMicaBackdrop: boolean): string {
  return useMicaBackdrop ? DESKTOP_MICA_TERMINAL_TINT_CLASS : SOLID_BACKGROUND_CLASS;
}

/** 工作区面板选中 tab：Mica 下轻 tint 以衔接面板底色。 */
export function desktopMicaWorkspaceTabSelectedClass(useMicaBackdrop: boolean): string {
  return useMicaBackdrop ? DESKTOP_MICA_WORKSPACE_TAB_SELECTED_TINT_CLASS : SOLID_BACKGROUND_CLASS;
}
