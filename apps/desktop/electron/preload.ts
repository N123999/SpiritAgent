import { clipboard, contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('spiritDesktop', {
  platform: process.platform,
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
  removeProviderModels(provider: string) {
    return ipcRenderer.invoke('desktop:invoke', 'removeProviderModels', { request: { provider } });
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
  submitStartImplementing() {
    return ipcRenderer.invoke('desktop:invoke', 'submitStartImplementing');
  },
  exportSessionLog() {
    return ipcRenderer.invoke('desktop:export-session-log');
  },
  compactHistory() {
    return ipcRenderer.invoke('desktop:invoke', 'compactHistory');
  },
  submitUserTurn(request: unknown) {
    return ipcRenderer.invoke('desktop:invoke', 'submitUserTurn', request);
  },
  setLoopEnabled(enabled: boolean) {
    return ipcRenderer.invoke('desktop:invoke', 'setLoopEnabled', { enabled });
  },
  setApprovalLevel(approvalLevel: string) {
    return ipcRenderer.invoke('desktop:invoke', 'setApprovalLevel', { approvalLevel });
  },
  setPendingGitBranch(branch: string) {
    return ipcRenderer.invoke('desktop:invoke', 'setPendingGitBranch', { branch });
  },
  setWorkLocation(workLocation: string) {
    return ipcRenderer.invoke('desktop:invoke', 'setWorkLocation', { workLocation });
  },
  checkoutGitBranch(request: { branch: string; discardLocalChanges?: boolean }) {
    return ipcRenderer.invoke('desktop:invoke', 'checkoutGitBranch', request);
  },
  mergeWorktreeToMain() {
    return ipcRenderer.invoke('desktop:invoke', 'mergeWorktreeToMain');
  },
  abortConversation() {
    return ipcRenderer.invoke('desktop:invoke', 'abortConversation');
  },
  continueAssistantCompletion(messageId: number) {
    return ipcRenderer.invoke('desktop:invoke', 'continueAssistantCompletion', { messageId });
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
  dreamSubscribe(callback: (snapshot: unknown) => void) {
    const onDreamUpdate = (_event: Electron.IpcRendererEvent, snapshot: unknown) => {
      callback(snapshot);
    };
    ipcRenderer.on('desktop:dream-updated', onDreamUpdate);
    return () => {
      ipcRenderer.removeListener('desktop:dream-updated', onDreamUpdate);
    };
  },
  replyPendingApproval(decision: unknown) {
    return ipcRenderer.invoke('desktop:invoke', 'replyPendingApproval', { decision });
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
  listWorkspaceFileReferenceSuggestions(request: unknown) {
    return ipcRenderer.invoke('desktop:invoke', 'listWorkspaceFileReferenceSuggestions', {
      request,
    });
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
  pickLocalFile() {
    return ipcRenderer.invoke('desktop:pick-local-file');
  },
  ingestClipboardImage() {
    return ipcRenderer.invoke('desktop:ingest-clipboard-image');
  },
  listSystemFonts() {
    return ipcRenderer.invoke('desktop:list-system-fonts');
  },
  readLocalImagePreviewDataUrl(filePath: string) {
    return ipcRenderer.invoke('desktop:read-local-image-preview', { filePath });
  },
  readManagedImagePreviewDataUrl(reference: string) {
    return ipcRenderer.invoke('desktop:read-managed-image-preview', { reference });
  },
  saveLocalImageAs(filePath: string) {
    return ipcRenderer.invoke('desktop:save-local-image-as', { filePath });
  },
  syncWindowFrame(request: {
    dark: boolean;
    nativeTheme: 'system' | 'light' | 'dark';
  }) {
    return ipcRenderer.invoke('desktop:sync-window-frame', request);
  },
  syncLanguage(lang: string) {
    return ipcRenderer.invoke('desktop:sync-language', lang);
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
  openExternalUrl(url: string) {
    return ipcRenderer.invoke('desktop:open-external-url', { url });
  },
  subscribeBrowserOpenUrl(callback: (url: string) => void) {
    const onOpen = (_event: Electron.IpcRendererEvent, payload: { url?: string }) => {
      const url = typeof payload?.url === 'string' ? payload.url.trim() : '';
      if (url) {
        callback(url);
      }
    };
    ipcRenderer.on('desktop:browser-open-url', onOpen);
    return () => {
      ipcRenderer.removeListener('desktop:browser-open-url', onOpen);
    };
  },
  listLocalListeningEndpoints() {
    return ipcRenderer.invoke('desktop:list-local-listeners');
  },
  scanLocalListeners() {
    ipcRenderer.send('desktop:scan-local-listeners');
  },
  subscribeLocalListeners(callbacks: {
    onFound: (item: { port: number; address?: string; processName?: string; url?: string; title?: string }) => void;
    onDone: () => void;
  }) {
    const onFound = (_event: Electron.IpcRendererEvent, item: { port: number; address?: string; processName?: string; url?: string; title?: string }) => {
      callbacks.onFound(item);
    };
    const onDone = () => {
      callbacks.onDone();
    };
    ipcRenderer.on('desktop:local-listener-found', onFound);
    ipcRenderer.on('desktop:local-listeners-done', onDone);
    return () => {
      ipcRenderer.removeListener('desktop:local-listener-found', onFound);
      ipcRenderer.removeListener('desktop:local-listeners-done', onDone);
    };
  },
  captureWebviewRect(
    webContentsId: number,
    rect: { x: number; y: number; width: number; height: number },
  ): Promise<string> {
    return ipcRenderer.invoke('desktop:capture-webview-rect', { webContentsId, rect });
  },
  ingestBrowserElementScreenshot(base64: string): Promise<string | null> {
    return ipcRenderer.invoke('desktop:ingest-browser-element-screenshot', { base64 });
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
  showNotification(request: {
    title: string;
    body?: string;
    tag?: string;
    silent?: boolean;
    actions?: Array<{ type: 'button'; text: string }>;
    kind?: 'task-complete' | 'approval' | 'ask-questions' | 'generic';
  }) {
    return ipcRenderer.invoke('desktop:show-notification', request);
  },
  getAppAwayFromUser() {
    return ipcRenderer.invoke('desktop:get-app-away') as Promise<boolean>;
  },
  reportRendererVisibility(hidden: boolean) {
    return ipcRenderer.invoke('desktop:report-renderer-visibility', { hidden }) as Promise<boolean>;
  },
  syncAttentionPending(flags: {
    needsApproval: boolean;
    needsQuestions: boolean;
    needsTaskComplete: boolean;
  }) {
    return ipcRenderer.invoke('desktop:sync-attention-pending', flags) as Promise<void>;
  },
  subscribeAppAwayChanged(callback: (away: boolean) => void) {
    const onAway = (_event: Electron.IpcRendererEvent, payload: { away?: boolean }) => {
      callback(payload?.away === true);
    };
    ipcRenderer.on('desktop:app-away-changed', onAway);
    return () => {
      ipcRenderer.removeListener('desktop:app-away-changed', onAway);
    };
  },
  subscribeNotifyRefresh(callback: () => void) {
    const onRefresh = () => {
      callback();
    };
    ipcRenderer.on('desktop:notify-refresh', onRefresh);
    return () => {
      ipcRenderer.removeListener('desktop:notify-refresh', onRefresh);
    };
  },
  subscribeApprovalFromNotification(callback: (payload: { decision: 'allow' | 'deny' }) => void) {
    const onApproval = (
      _event: Electron.IpcRendererEvent,
      payload: { decision?: string },
    ) => {
      if (payload?.decision === 'allow' || payload?.decision === 'deny') {
        callback({ decision: payload.decision });
      }
    };
    ipcRenderer.on('desktop:approval-from-notification', onApproval);
    return () => {
      ipcRenderer.removeListener('desktop:approval-from-notification', onApproval);
    };
  },
});
