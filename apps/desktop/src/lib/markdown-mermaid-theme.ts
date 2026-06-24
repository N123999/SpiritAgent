import { createMermaidPlugin } from "@streamdown/mermaid";
import type { MermaidConfig } from "mermaid";

import { DEFAULT_FONT_ID } from "@/lib/font";

const MERMAID_FONT_FAMILY = `'${DEFAULT_FONT_ID === "geist" ? "Geist Variable" : "Geist Variable"}', sans-serif`;

/** Void 语义色：与 styles.css 暗色 token 对齐，避免 Mermaid 默认黄/紫 subgraph */
function buildVoidMermaidThemeVariables(resolvedDark: boolean): MermaidConfig["themeVariables"] {
  if (resolvedDark) {
    return {
      darkMode: true,
      background: "transparent",
      fontFamily: MERMAID_FONT_FAMILY,
      fontSize: "13px",
      primaryColor: "#181818",
      primaryTextColor: "#d4d4d4",
      primaryBorderColor: "#272727",
      secondaryColor: "#121212",
      secondaryTextColor: "#d4d4d4",
      secondaryBorderColor: "#272727",
      tertiaryColor: "#090909",
      tertiaryTextColor: "#a1a1a1",
      tertiaryBorderColor: "#272727",
      lineColor: "#525252",
      textColor: "#d4d4d4",
      mainBkg: "#181818",
      nodeBorder: "#272727",
      nodeTextColor: "#d4d4d4",
      clusterBkg: "#090909",
      clusterBorder: "#272727",
      defaultLinkColor: "#717171",
      titleColor: "#a1a1a1",
      edgeLabelBackground: "#181818",
      noteBkgColor: "#181818",
      noteTextColor: "#d4d4d4",
      noteBorderColor: "#272727",
    };
  }

  return {
    darkMode: false,
    background: "transparent",
    fontFamily: MERMAID_FONT_FAMILY,
    fontSize: "13px",
    primaryColor: "#f4f4f5",
    primaryTextColor: "#18181b",
    primaryBorderColor: "#e4e4e7",
    secondaryColor: "#fafafa",
    secondaryTextColor: "#18181b",
    secondaryBorderColor: "#e4e4e7",
    tertiaryColor: "#f4f4f5",
    tertiaryTextColor: "#52525b",
    tertiaryBorderColor: "#d4d4d8",
    lineColor: "#71717a",
    textColor: "#18181b",
    mainBkg: "#fafafa",
    nodeBorder: "#e4e4e7",
    nodeTextColor: "#18181b",
    clusterBkg: "#f4f4f5",
    clusterBorder: "#d4d4d8",
    defaultLinkColor: "#71717a",
    titleColor: "#52525b",
    edgeLabelBackground: "#fafafa",
    noteBkgColor: "#fafafa",
    noteTextColor: "#18181b",
    noteBorderColor: "#e4e4e7",
  };
}

export function getSpiritMermaidConfig(resolvedDark: boolean): MermaidConfig {
  return {
    theme: "base",
    themeVariables: buildVoidMermaidThemeVariables(resolvedDark),
  };
}

export function createSpiritMermaidPlugin(resolvedDark: boolean) {
  return createMermaidPlugin({
    config: getSpiritMermaidConfig(resolvedDark),
  });
}
