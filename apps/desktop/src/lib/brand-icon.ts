import spiritAgentIconMicaUrl from "../../build/icon.png?url";

/** 深色 UI：透明底品牌标（`public/spirit-agent-icon.png`） */
export const SPIRIT_AGENT_ICON_DARK_SRC = "./spirit-agent-icon.png";

/** 浅色 UI：透明底品牌标（`public/spirit-agent-icon-light.png`） */
export const SPIRIT_AGENT_ICON_LIGHT_SRC = "./spirit-agent-icon-light.png";

/** 云母顶栏：黑底打包标（`build/icon.png`，图案占画布比例小于透明标） */
export const SPIRIT_AGENT_ICON_MICA_SRC = spiritAgentIconMicaUrl;

export function spiritAgentBrandIconSrc(dark: boolean): string {
  return dark ? SPIRIT_AGENT_ICON_DARK_SRC : SPIRIT_AGENT_ICON_LIGHT_SRC;
}

export function spiritAgentTitleBarIconSrc(dark: boolean, useMicaBackdrop: boolean): string {
  return useMicaBackdrop ? SPIRIT_AGENT_ICON_MICA_SRC : spiritAgentBrandIconSrc(dark);
}
