import { workspaceFileBasename } from '@/lib/file-picker-path';
import {
  resolveWorkspaceFileIcon,
  type WorkspaceFileIconColorMode,
} from '@/lib/workspace-file-icon-resolver';
import {
  injectSetiSvgDimensions,
  resolveDomSetiIconTheme,
} from '@/lib/workspace-file-icon-svg';
import type { WorkspaceExplorerEntryKind } from '@/types';

export type AppendWorkspaceFileIconSvgOptions = {
  colorMode?: WorkspaceFileIconColorMode;
  theme?: 'dark' | 'light';
};

/** contenteditable chip / DOM：注入 Seti SVG，与 React WorkspaceFileIcon 同源。 */
export function appendWorkspaceFileIconSvg(
  parent: HTMLElement,
  doc: Document,
  path: string,
  attrs: { size: number; className: string },
  kind: WorkspaceExplorerEntryKind = 'file',
  options: AppendWorkspaceFileIconSvgOptions = {},
): void {
  const { colorMode = 'seti', theme = resolveDomSetiIconTheme() } = options;
  const icon = resolveWorkspaceFileIcon(workspaceFileBasename(path), kind, {
    colorMode,
    theme,
  });
  if (!icon) {
    return;
  }

  const wrapper = doc.createElement('span');
  wrapper.className = attrs.className;
  wrapper.setAttribute('aria-hidden', 'true');
  wrapper.style.display = 'inline-flex';
  wrapper.style.width = `${attrs.size}px`;
  wrapper.style.height = `${attrs.size}px`;
  wrapper.style.alignItems = 'center';
  wrapper.style.justifyContent = 'center';
  if (icon.color) {
    wrapper.style.color = icon.color;
  }

  const template = doc.createElement('template');
  template.innerHTML = injectSetiSvgDimensions(icon.svg, attrs.size);
  const svg = template.content.firstElementChild;
  if (svg) {
    wrapper.appendChild(doc.importNode(svg, true));
  }
  parent.appendChild(wrapper);
}
