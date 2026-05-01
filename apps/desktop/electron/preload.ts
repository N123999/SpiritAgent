import { clipboard, contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('spiritDesktop', {
  bootstrap(request?: unknown) {
    return ipcRenderer.invoke('desktop:invoke', 'bootstrap', { request });
  },
  rememberWorkspaceRoot(request: unknown) {
    return ipcRenderer.invoke('desktop:invoke', 'rememberWorkspaceRoot', { request });
  },
  commitChanges(request: unknown) {
    return ipcRenderer.invoke('desktop:invoke', 'commitChanges', { request });
  },
  updateConfig(request: unknown) {
    return ipcRenderer.invoke('desktop:invoke', 'updateConfig', { request });
  },
  addModel(request: unknown) {
    return ipcRenderer.invoke('desktop:invoke', 'addModel', { request });
  },
  addProviderModels(request: unknown) {
    return ipcRenderer.invoke('desktop:invoke', 'addProviderModels', { request });
  },
  previewModels(request: unknown) {
    return ipcRenderer.invoke('desktop:invoke', 'previewModels', { request });
  },
  removeModel(name: string) {
    return ipcRenderer.invoke('desktop:invoke', 'removeModel', { request: { name } });
  },
  addMcpServer(request: unknown) {
    return ipcRenderer.invoke('desktop:invoke', 'addMcpServer', { request });
  },
  deleteMcpServer(request: unknown) {
    return ipcRenderer.invoke('desktop:invoke', 'deleteMcpServer', { request });
  },
  inspectMcpServer(name: string) {
    return ipcRenderer.invoke('desktop:invoke', 'inspectMcpServer', { name });
  },
  importExtension(request: unknown) {
    return ipcRenderer.invoke('desktop:invoke', 'importExtension', { request });
  },
  listMarketplaceExtensions() {
    return ipcRenderer.invoke('desktop:invoke', 'listMarketplaceExtensions');
  },
  getMarketplaceExtensionDetail(extensionId: string) {
    return ipcRenderer.invoke('desktop:invoke', 'getMarketplaceExtensionDetail', { extensionId });
  },
  getMarketplaceExtensionReadme(extensionId: string) {
    return ipcRenderer.invoke('desktop:invoke', 'getMarketplaceExtensionReadme', { extensionId });
  },
  prepareMarketplaceExtensionInstall(request: unknown) {
    return ipcRenderer.invoke('desktop:invoke', 'prepareMarketplaceExtensionInstall', { request });
  },
  installMarketplaceExtension(request: unknown) {
    return ipcRenderer.invoke('desktop:invoke', 'installMarketplaceExtension', { request });
  },
  deleteExtension(request: unknown) {
    return ipcRenderer.invoke('desktop:invoke', 'deleteExtension', { request });
  },
  runExtension(request: unknown) {
    return ipcRenderer.invoke('desktop:invoke', 'runExtension', { request });
  },
  updateExtensionSettings(request: unknown) {
    return ipcRenderer.invoke('desktop:invoke', 'updateExtensionSettings', { request });
  },
  updateExtensionSecret(request: unknown) {
    return ipcRenderer.invoke('desktop:invoke', 'updateExtensionSecret', { request });
  },
  createSkill(request: unknown) {
    return ipcRenderer.invoke('desktop:invoke', 'createSkill', { request });
  },
  deleteSkill(request: unknown) {
    return ipcRenderer.invoke('desktop:invoke', 'deleteSkill', { request });
  },
  submitCreateSkillSlash(request: unknown) {
    return ipcRenderer.invoke('desktop:invoke', 'submitCreateSkillSlash', { request });
  },
  submitSkillSlash(request: unknown) {
    return ipcRenderer.invoke('desktop:invoke', 'submitSkillSlash', { request });
  },
  submitUserTurn(text: string) {
    return ipcRenderer.invoke('desktop:invoke', 'submitUserTurn', { text });
  },
  rewindAndSubmitMessage(request: unknown) {
    return ipcRenderer.invoke('desktop:invoke', 'rewindAndSubmitMessage', { request });
  },
  poll() {
    return ipcRenderer.invoke('desktop:invoke', 'poll');
  },
  listDreamsOverview() {
    return ipcRenderer.invoke('desktop:invoke', 'listDreamsOverview');
  },
  replyPendingApproval(message: string) {
    return ipcRenderer.invoke('desktop:invoke', 'replyPendingApproval', { message });
  },
  replyPendingQuestions(result: unknown) {
    return ipcRenderer.invoke('desktop:invoke', 'replyPendingQuestions', { result });
  },
  resetSession() {
    return ipcRenderer.invoke('desktop:invoke', 'resetSession');
  },
  listSessions() {
    return ipcRenderer.invoke('desktop:invoke', 'listSessions');
  },
  openSession(path: string) {
    return ipcRenderer.invoke('desktop:invoke', 'openSession', { path });
  },
  listWorkspaceExplorerChildren(relativePath: string) {
    return ipcRenderer.invoke('desktop:invoke', 'listWorkspaceExplorerChildren', {
      relativePath,
    });
  },
  readWorkspaceTextFile(relativePath: string) {
    return ipcRenderer.invoke('desktop:invoke', 'readWorkspaceTextFile', { relativePath });
  },
  writeWorkspaceTextFile(request: unknown) {
    return ipcRenderer.invoke('desktop:invoke', 'writeWorkspaceTextFile', { request });
  },
  pickWorkspaceDirectory() {
    return ipcRenderer.invoke('desktop:pick-workspace-directory');
  },
  syncWindowFrame(request: {
    dark: boolean;
    nativeTheme: 'system' | 'light' | 'dark';
  }) {
    return ipcRenderer.invoke('desktop:sync-window-frame', request);
  },
  popupApplicationMenu(
    section: 'file' | 'edit' | 'view' | 'window' | 'help',
    clientX: number,
    clientY: number,
  ) {
    return ipcRenderer.invoke('desktop:application-menu-popup', { section, clientX, clientY });
  },
  ptyCreate(request: { cwd: string; cols: number; rows: number }) {
    return ipcRenderer.invoke('desktop:pty-create', request);
  },
  ptyWrite(id: string, data: string) {
    ipcRenderer.send('desktop:pty-write', { id, data });
  },
  ptyResize(id: string, cols: number, rows: number) {
    ipcRenderer.send('desktop:pty-resize', { id, cols, rows });
  },
  ptyKill(id: string) {
    return ipcRenderer.invoke('desktop:pty-kill', id);
  },
  openSystemTerminal(cwd: string) {
    return ipcRenderer.invoke('desktop:open-system-terminal', cwd);
  },
  readClipboardText() {
    return clipboard.readText();
  },
  writeClipboardText(text: string) {
    clipboard.writeText(text);
  },
  ptySubscribe(callbacks: {
    onData: (payload: { id: string; data: string }) => void;
    onExit: (payload: { id: string; exitCode: number; signal?: number }) => void;
  }) {
    const onData = (_event: Electron.IpcRendererEvent, payload: { id: string; data: string }) => {
      callbacks.onData(payload);
    };
    const onExit = (
      _event: Electron.IpcRendererEvent,
      payload: { id: string; exitCode: number; signal?: number },
    ) => {
      callbacks.onExit(payload);
    };
    ipcRenderer.on('desktop:pty-data', onData);
    ipcRenderer.on('desktop:pty-exit', onExit);
    return () => {
      ipcRenderer.removeListener('desktop:pty-data', onData);
      ipcRenderer.removeListener('desktop:pty-exit', onExit);
    };
  },
});
