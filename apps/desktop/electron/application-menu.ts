import { BrowserWindow, Menu, app, dialog } from 'electron';

const isDevChrome = Boolean(process.env.VITE_DEV_SERVER_URL) || !app.isPackaged;

export type ApplicationMenuSection = 'file' | 'edit' | 'view' | 'window' | 'help';

function buildSectionTemplate(
  win: BrowserWindow,
  section: ApplicationMenuSection,
): Electron.MenuItemConstructorOptions[] {
  switch (section) {
    case 'file':
      return [
        {
          label: '新会话',
          click: () => {
            win.webContents.send('desktop:new-session');
          },
        },
        { type: 'separator' },
        { role: 'quit', label: '退出' },
      ];
    case 'edit':
      return [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' },
      ];
    case 'view':
      return [
        ...(isDevChrome
          ? ([
              { role: 'reload' as const, label: '重新加载' },
              { role: 'forceReload' as const, label: '强制重新加载' },
              { role: 'toggleDevTools' as const, label: '开发者工具' },
              { type: 'separator' as const },
            ] satisfies Electron.MenuItemConstructorOptions[])
          : []),
        { role: 'togglefullscreen', label: '切换全屏' },
      ];
    case 'window':
      return [
        { role: 'minimize', label: '最小化' },
        {
          label: '最大化',
          click: (_item, focused) => {
            const w = focused ?? win;
            if (w.isMaximized()) {
              w.unmaximize();
            } else {
              w.maximize();
            }
          },
        },
        { role: 'close', label: '关闭' },
      ];
    case 'help':
      return [
        {
          label: '关于 Spirit Agent',
          click: () => {
            void dialog.showMessageBox(win, {
              type: 'info',
              title: 'Spirit Agent',
              message: 'Spirit Agent',
              detail: `版本 ${app.getVersion()}`,
            });
          },
        },
      ];
    default:
      return [];
  }
}

/** macOS 系统菜单栏：包含标准应用菜单与 File 内“新会话”条目。 */
export function setMacOSApplicationMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'File',
      submenu: [
        {
          label: '新会话',
          accelerator: 'CmdOrCtrl+N',
          click: () => {
            const win = BrowserWindow.getFocusedWindow();
            if (win && !win.isDestroyed()) {
              win.webContents.send('desktop:new-session');
            }
          },
        },
        { type: 'separator' },
        { role: 'close', label: '关闭' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' },
      ],
    },
    {
      label: 'View',
      submenu: [
        ...(isDevChrome
          ? ([
              { role: 'reload' as const, label: '重新加载' },
              { role: 'forceReload' as const, label: '强制重新加载' },
              { role: 'toggleDevTools' as const, label: '开发者工具' },
              { type: 'separator' as const },
            ] satisfies Electron.MenuItemConstructorOptions[])
          : []),
        { role: 'togglefullscreen', label: '切换全屏' },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize', label: '最小化' },
        { role: 'zoom', label: '缩放' },
        { type: 'separator' },
        { role: 'front', label: '全部置于最前' },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
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
