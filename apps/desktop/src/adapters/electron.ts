import type { HostApi } from '../host-api';

export async function createElectronHostApi(): Promise<HostApi> {
  if (typeof window === 'undefined' || !window.spiritDesktop) {
    throw new Error('Electron host bridge is unavailable.');
  }

  const bridge = window.spiritDesktop;

  return {
    kind: 'electron',
    bootstrap(request) {
      return bridge.bootstrap(request);
    },
    updateConfig(request) {
      return bridge.updateConfig(request);
    },
    submitUserTurn(text) {
      return bridge.submitUserTurn(text);
    },
    poll() {
      return bridge.poll();
    },
    replyPendingApproval(message) {
      return bridge.replyPendingApproval(message);
    },
    replyPendingQuestions(result) {
      return bridge.replyPendingQuestions(result);
    },
    resetSession() {
      return bridge.resetSession();
    },
    listSessions() {
      return bridge.listSessions();
    },
    openSession(path) {
      return bridge.openSession(path);
    },
  };
}