import { BrowserWindow, Menu, app, dialog } from 'electron';

import i18nHost from '../src/lib/i18n-host.js';

const isDevChrome = Boolean(process.env.VITE_DEV_SERVER_URL) || !app.isPackaged;

export type ApplicationMenuSection = 'file' | 'edit' | 'view' | 'window' | 'help';

function menuLabel(key: string, options?: Record<string, unknown>): string {
  return i18nHost.t(`titleBar.${key}`, options);
}

function sendNewSession(win?: BrowserWindow): void {
  const target = win ?? BrowserWindow.getFocusedWindow();
  if (target && !target.isDestroyed()) {
    target.webContents.send('desktop:new-session');
  }
}

function editMenuItems(): Electron.MenuItemConstructorOptions[] {
  return [
    { role: 'undo', label: menuLabel('undo') },
    { role: 'redo', label: menuLabel('redo') },
    { type: 'separator' },
    { role: 'cut', label: menuLabel('cut') },
    { role: 'copy', label: menuLabel('copy') },
    { role: 'paste', label: menuLabel('paste') },
    { role: 'selectAll', label: menuLabel('selectAll') },
  ];
}

function viewMenuItems(): Electron.MenuItemConstructorOptions[] {
  return [
    ...(isDevChrome
      ? ([
          { role: 'reload' as const, label: menuLabel('reload') },
          { role: 'forceReload' as const, label: menuLabel('forceReload') },
          { role: 'toggleDevTools' as const, label: menuLabel('devTools') },
          { type: 'separator' as const },
        ] satisfies Electron.MenuItemConstructorOptions[])
      : []),
    { role: 'togglefullscreen', label: menuLabel('toggleFullscreen') },
  ];
}

function appMenuItems(): Electron.MenuItemConstructorOptions[] {
  const appName = app.name;
  return [
    { role: 'about', label: menuLabel('about') },
    { type: 'separator' },
    { role: 'services', label: menuLabel('services') },
    { type: 'separator' },
    { role: 'hide', label: menuLabel('hideApp', { appName }) },
    { role: 'hideOthers', label: menuLabel('hideOthers') },
    { role: 'unhide', label: menuLabel('showAll') },
    { type: 'separator' },
    { role: 'quit', label: menuLabel('quitApp', { appName }) },
  ];
}

function buildSectionTemplate(
  win: BrowserWindow,
  section: ApplicationMenuSection,
): Electron.MenuItemConstructorOptions[] {
  switch (section) {
    case 'file':
      return [
        {
          label: menuLabel('newSession'),
          click: () => {
            sendNewSession(win);
          },
        },
        { type: 'separator' },
        { role: 'quit', label: menuLabel('quit') },
      ];
    case 'edit':
      return editMenuItems();
    case 'view':
      return viewMenuItems();
    case 'window':
      return [
        { role: 'minimize', label: menuLabel('minimize') },
        {
          label: menuLabel('maximize'),
          click: (_item, focused) => {
            const target = focused ?? win;
            if (target.isMaximized()) {
              target.unmaximize();
            } else {
              target.maximize();
            }
          },
        },
        { role: 'close', label: menuLabel('close') },
      ];
    case 'help':
      return [
        {
          label: menuLabel('about'),
          click: () => {
            void dialog.showMessageBox(win, {
              type: 'info',
              title: 'Spirit Agent',
              message: 'Spirit Agent',
              detail: menuLabel('versionDetail', { version: app.getVersion() }),
            });
          },
        },
      ];
    default:
      return [];
  }
}

function buildMacOSApplicationMenuTemplate(): Electron.MenuItemConstructorOptions[] {
  return [
    {
      label: app.name,
      submenu: appMenuItems(),
    },
    {
      label: menuLabel('file'),
      submenu: [
        {
          label: menuLabel('newSession'),
          accelerator: 'CmdOrCtrl+N',
          click: () => {
            sendNewSession();
          },
        },
        { type: 'separator' },
        { role: 'close', label: menuLabel('close') },
      ],
    },
    {
      label: menuLabel('edit'),
      submenu: editMenuItems(),
    },
    {
      label: menuLabel('view'),
      submenu: viewMenuItems(),
    },
    {
      label: menuLabel('window'),
      submenu: [
        { role: 'minimize', label: menuLabel('minimize') },
        { role: 'zoom', label: menuLabel('zoom') },
        { type: 'separator' },
        { role: 'front', label: menuLabel('bringAllToFront') },
      ],
    },
  ];
}

/** macOS 系统菜单栏：包含标准应用菜单与 File 内“新会话”条目。 */
export function setMacOSApplicationMenu(): void {
  Menu.setApplicationMenu(Menu.buildFromTemplate(buildMacOSApplicationMenuTemplate()));
}

/** 自绘顶栏菜单项：原生子菜单；x/y 为相对内容区原点（勿加 getContentBounds）。 */
export function popupApplicationMenuSection(
  win: BrowserWindow,
  section: ApplicationMenuSection,
  anchorClientX: number,
  anchorClientY: number,
): void {
  const template = buildSectionTemplate(win, section);
  if (template.length === 0) {
    return;
  }
  const zoom = win.webContents.getZoomFactor() || 1;
  const menu = Menu.buildFromTemplate(template);
  menu.popup({
    window: win,
    x: Math.round(anchorClientX * zoom),
    y: Math.round(anchorClientY * zoom),
  });
}
