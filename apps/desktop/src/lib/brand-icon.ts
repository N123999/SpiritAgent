/** 深色 UI：透明底品牌标（`public/spirit-agent-icon.png`） */
export const SPIRIT_AGENT_ICON_DARK_SRC = "./spirit-agent-icon.png";

/** 浅色 UI：透明底品牌标（`public/spirit-agent-icon-light.png`） */
export const SPIRIT_AGENT_ICON_LIGHT_SRC = "./spirit-agent-icon-light.png";

export function spiritAgentBrandIconSrc(dark: boolean): string {
  return dark ? SPIRIT_AGENT_ICON_DARK_SRC : SPIRIT_AGENT_ICON_LIGHT_SRC;
}
