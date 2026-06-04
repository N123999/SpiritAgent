import i18n from '../lib/i18n-host.js';

export interface DesktopExtensionMessageBoxRequest {
  title: string;
  message: string;
  detail?: string;
  buttons?: string[];
  cancelId?: number;
  defaultId?: number;
  noLink?: boolean;
  type?: 'none' | 'info' | 'error' | 'question' | 'warning';
}

export interface DesktopExtensionHostAdapter {
  showMessageBox(request: DesktopExtensionMessageBoxRequest): Promise<void>;
}

let desktopExtensionHostAdapter: DesktopExtensionHostAdapter | undefined;

export function setDesktopExtensionHostAdapter(
  adapter: DesktopExtensionHostAdapter | undefined,
): void {
  desktopExtensionHostAdapter = adapter;
}

export function getDesktopExtensionHostAdapter(): DesktopExtensionHostAdapter | undefined {
  return desktopExtensionHostAdapter;
}

export function requireDesktopExtensionHostAdapter(): DesktopExtensionHostAdapter {
  if (!desktopExtensionHostAdapter) {
    throw new Error(i18n.t('error.extensionHostNotAvailable'));
  }
  return desktopExtensionHostAdapter;
}
