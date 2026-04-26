import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('spiritDesktop', {
  bootstrap(request?: unknown) {
    return ipcRenderer.invoke('desktop:invoke', 'bootstrap', { request });
  },
  updateConfig(request: unknown) {
    return ipcRenderer.invoke('desktop:invoke', 'updateConfig', { request });
  },
  addModel(request: unknown) {
    return ipcRenderer.invoke('desktop:invoke', 'addModel', { request });
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
});