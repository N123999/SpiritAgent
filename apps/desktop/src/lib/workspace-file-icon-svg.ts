/** 使 Seti SVG 继承容器 `color`（currentColor），便于 React class 与 inline style 着色。 */
export function normalizeSetiSvgForCurrentColor(svg: string): string {
  if (svg.includes('fill=')) {
    return svg.replace(/\sfill="[^"]*"/gu, ' fill="currentColor"');
  }
  return svg.replace(/<path\b/gu, '<path fill="currentColor"');
}
