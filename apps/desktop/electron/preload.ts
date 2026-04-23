import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('spiritDesktop', {
  bootstrap(request?: unknown) {
    return ipcRenderer.invoke('desktop:invoke', 'bootstrap', { request });
  },
  updateConfig(request: unknown) {
    return ipcRenderer.invoke('desktop:invoke', 'updateConfig', { request });
  },
  submitUserTurn(text: string) {
    return ipcRenderer.invoke('desktop:invoke', 'submitUserTurn', { text });
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
  setNativeTheme(theme: 'system' | 'light' | 'dark') {
    return ipcRenderer.invoke('desktop:set-native-theme', theme);
  },
  syncWindowFrame(request: { dark: boolean }) {
    return ipcRenderer.invoke('desktop:sync-window-frame', request);
  },
});